import { sanitizeChanges } from "../core/sanitize";
import { functionalGapIssues, inspectArchitecture } from "../core/architecture";
import { inspectContracts } from "../core/contracts";
import { repairProjectQuality } from "./quality.server";
import { chunk, findMissingLocalImports, leastUsedKeyId, recordUsage, type KeyUsage, type MissingImport } from "../core/gaps";
import { isSmallTalk, SMALL_TALK_REPLY } from "../core/intent";
import { isPastDeadline, phaseSignal } from "../core/budget";
/**
 * WLC 1.9.9 Hybrid Team — Runner paralelo em segundo plano.
 *
 * Fluxo:
 * 1. Arquiteto (síncrono) → gera distribution
 * 2. Especialistas da fase 2 disparam TODOS em paralelo (Promise.allSettled)
 * 3. Fase 3 (QA + DevOps) em paralelo
 * 4. Code Analyst consolida e corrige
 * 5. (Diagnóstico só sob demanda de falha de Deploy)
 *
 * Cada bot recebe sua tarefa e a regra anti-spam. Não espera um terminar para começar o outro.
 */

import type { Db } from "@/modules/integrations/core/runs.server";
import { openChatStream } from "@/modules/integrations/gemini/services/chat-stream.server";
import { textFromGeminiChunk } from "@/services/gemini.server";
import {
  SPECIALISTS,
  WLC_PRO_ENGINEERING_STANDARD,
  V199_ARCHITECT_INSTRUCTION,
  V199_ANTI_SPAM_RULE,
  V199_PIPELINE_INSTRUCTION,
  type SpecialistRole,
} from "../identity";
import { checkDualKeys, keyForRole, type DualKeyStatus } from "../core/keys";
import { listKeys } from "@/modules/integrations/gemini/services/keys.server";
import { applyTeamChanges } from "./apply.server";
import { syncGeneratedProject } from "@/modules/code/services/sync-generated.server";
import { openWorkspace } from "@/modules/orchestrator/tools.server";
import {
  normalizeDistribution,
  type DistributionItem,
  type PipelinePlan,
} from "../core/pipeline";
import { z } from "zod";
import {
  ARCHITECT_RETRY_NOTE,
  fallbackArchitectPlan,
  parseArchitectPlan,
  parseJsonLoose,
} from "../core/architect";
import {
  CRITICAL_BUILD_PATHS,
  buildDevOpsBootstrapTask,
  diagnoseBuildReadiness,
  findMissingDependencies,
  missingBootstrapFiles,
} from "../core/bootstrap";

// ─── tipos ───────────────────────────────────────────────────────────────────

export type TeamEvent = (line: string) => void;

export interface TeamChange {
  path: string;
  content: string;
}

export interface SpecialistResult {
  role: SpecialistRole;
  ok: boolean;
  summary: string;
  changes: TeamChange[];
  error?: string;
}

/**
 * Opções do time. Por padrão (apply !== false) os bots gravam direto no projeto (/api/chat).
 * Com apply:false (Copilot do Code) nada é gravado: as mudanças voltam como proposta para o usuário revisar.
 */
export interface TeamOptions {
  apply?: boolean;
  /** Arquivos existentes lidos do projeto (podem ser alterados, devolvendo o arquivo completo). */
  existingFiles?: { path: string; content: string }[];
  /** Mapa de caminhos existentes (não lidos) — para o time conectar o novo ao que já existe. */
  existingPaths?: string[];
  /** Destino fixo (chat): projectId null cria um projeto novo e isolado. */
  workspace?: { projectId: string | null; projectName: string | null };
  /** Prazo suave (epoch ms): depois dele as fases de melhoria são puladas e o resultado volta. */
  deadline?: number;
}

const EXISTING_RULE =
  "Arquivos em existing_files já existem: só altere se necessário e devolva o arquivo COMPLETO, preservando o que não muda. " +
  "Caminhos só em existing_paths NÃO foram lidos: não sobrescreva; crie arquivos novos e conecte-os ao que existe.";

function existingContext(opts: TeamOptions): Record<string, unknown> {
  if (!opts.existingFiles?.length && !opts.existingPaths?.length) return {};
  return {
    existing_files: opts.existingFiles ?? [],
    existing_paths: opts.existingPaths ?? [],
    existing_rule: EXISTING_RULE,
  };
}

/** Mescla arquivos existentes com os já gerados pelo time (última escrita vence por path). */
function mergeProjectSnapshot(opts: TeamOptions, results: SpecialistResult[]) {
  const fileMap = new Map<string, { path: string; content: string }>();
  for (const f of opts.existingFiles ?? []) fileMap.set(f.path, f);
  for (const r of results) {
    for (const c of r.changes) fileMap.set(c.path, c);
  }
  const pathSet = new Set<string>(opts.existingPaths ?? []);
  for (const p of fileMap.keys()) pathSet.add(p);
  return { files: [...fileMap.values()], paths: [...pathSet] };
}

/** Seleciona contexto atualizado para a Fase 3 (prioriza arquivos de build + gerados na Fase 2). */
function buildPhase3Options(opts: TeamOptions, phase2Results: SpecialistResult[]): TeamOptions {
  const snap = mergeProjectSnapshot(opts, phase2Results);
  const MAX_BUDGET = 120_000;
  const prioritized = [...snap.files].sort((a, b) => {
    const pa = CRITICAL_BUILD_PATHS.has(a.path) ? 0 : 1;
    const pb = CRITICAL_BUILD_PATHS.has(b.path) ? 0 : 1;
    return pa - pb;
  });
  let budget = MAX_BUDGET;
  const selected: { path: string; content: string }[] = [];
  for (const f of prioritized) {
    const size = f.path.length + f.content.length + 50;
    if (size > budget) continue;
    budget -= size;
    selected.push(f);
  }
  return {
    ...opts,
    existingFiles: selected,
    existingPaths: snap.paths,
  };
}

export interface TeamRunResult {
  projectId?: string | null;
  projectName?: string | null;
  qualityIssues?: string[];
  plan: PipelinePlan | null;
  results: SpecialistResult[];
  analysis: SpecialistResult | null;
  /** Mudanças consolidadas (último write por path vence) */
  changes: TeamChange[];
  summary: string;
}

// ─── parsing ─────────────────────────────────────────────────────────────────

const changeSchema = z.object({
  path: z.string().min(1).max(500),
  content: z.string().max(500_000),
});

const specialistAnswerSchema = z.object({
  summary: z.string().default(""),
  changes: z.array(changeSchema).max(30).default([]),
  recovered: z.boolean().default(false),
});


// ─── chamada isolada a uma API ───────────────────────────────────────────────

export async function askBot(
  db: Db,
  userId: string,
  instruction: string,
  userContent: string,
  signal: AbortSignal,
  maxTokens = 12_000,
  preferredKeyId?: string,
  usage?: KeyUsage,
): Promise<string> {
  const history = [{ role: "user" as const, content: userContent }];
  const opened = await openChatStream(db, userId, history, signal, false, {
    instruction,
    maxOutputTokens: maxTokens,
    responseMimeType: "application/json",
    ...(preferredKeyId ? { preferredKeyId } : {}),
  });
  if (!opened.ok) throw new Error(opened.error);
  if (!opened.response.body) { recordUsage(usage, opened.keyId, 1); return ""; }

  const reader = opened.response.body.getReader();
  const dec = new TextDecoder();
  let pending = "";
  let out = "";
  const take = (l: string) => {
    const t = l.trim();
    if (t.startsWith("data:")) out += textFromGeminiChunk(t.slice(5).trim());
  };
  try {
    for (;;) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      pending += dec.decode(value, { stream: true });
      let i: number;
      while ((i = pending.indexOf("\n")) >= 0) {
        take(pending.slice(0, i));
        pending = pending.slice(i + 1);
      }
    }
    take(pending);
  } finally {
    await reader.cancel().catch(() => {});
    recordUsage(usage, opened.keyId, out.length);
  }
  return out;
}

// ─── fase 1: Arquiteto ───────────────────────────────────────────────────────

async function runArchitect(
  db: Db,
  userId: string,
  request: string,
  signal: AbortSignal,
  onEvent: TeamEvent,
  keyStatus: DualKeyStatus,
  opts: TeamOptions = {},
): Promise<PipelinePlan> {
  onEvent("🏗️ **Arquiteto** recebendo o pedido e categorizando…");
  const architectKey = keyForRole(keyStatus, "architect")?.id;
  const userContent = opts.existingPaths?.length
    ? JSON.stringify({ request, existing_paths: opts.existingPaths })
    : request;
  const raw = await askBot(db, userId, V199_ARCHITECT_INSTRUCTION, userContent, signal, 4_000, architectKey, keyStatus.usage);
  let parsed = parseArchitectPlan(raw);
  if (!parsed) {
    // 1 nova tentativa mostrando a resposta anterior, antes de cair no plano padrão
    onEvent("🔁 Arquiteto retornou plano inválido — tentando de novo…");
    try {
      const retryRaw = await askBot(
        db,
        userId,
        `${V199_ARCHITECT_INSTRUCTION}\n${ARCHITECT_RETRY_NOTE}`,
        JSON.stringify({ original_request: userContent, previous_output: raw.slice(0, 20_000) }),
        signal,
        4_000,
        architectKey,
        keyStatus.usage,
      );
      parsed = parseArchitectPlan(retryRaw);
    } catch {
      // Cancelamento propaga; erro transitório da 2ª tentativa cai no plano padrão.
      signal.throwIfAborted();
    }
  }
  if (!parsed) {
    onEvent("⚠️ Arquiteto falhou duas vezes — usando distribuição padrão.");
    parsed = fallbackArchitectPlan(request);
  }

  const distribution: DistributionItem[] = normalizeDistribution(
    parsed.distribution
      .filter((d) => d.role in SPECIALISTS)
      .map((d) => ({
        role: d.role as SpecialistRole,
        task: d.task,
        ...(d.owns !== undefined ? { owns: d.owns } : {}),
        ...(d.connects_to !== undefined ? { connects_to: d.connects_to } : {}),
        ...(d.priority !== undefined ? { priority: d.priority } : {}),
      })),
  );

  // Garante pelo menos frontend se o pedido parece visual
  if (distribution.length === 0) {
    distribution.push({
      role: "frontend",
      task: "Implementar a interface solicitada (Mobile First)",
      priority: 1,
    });
  }

  onEvent(
    `📋 Arquiteto concluiu plano concreto. Intent: **${parsed.intent || "—"}** · ${distribution.length} tarefa(s) conectadas`,
  );
  const contracts = parsed.contracts;
  if (contracts.integrations.length) {
    onEvent(`🔗 Integrações definidas: ${contracts.integrations.slice(0, 3).join(" · ")}`);
  }
  for (const d of distribution) {
    const conn = d.connects_to?.length ? ` ↔ ${d.connects_to[0]}` : "";
    onEvent(`   → ${SPECIALISTS[d.role].name}: ${d.task.slice(0, 70)}${conn}`);
  }

  const palette = contracts.design_tokens.length ? contracts.design_tokens : parsed.palette_hints;
  return {
    intent: parsed.intent,
    structure: parsed.structure,
    contracts,
    palette_hints: palette,
    distribution,
    ...(parsed.notes !== undefined ? { notes: parsed.notes } : {}),
  };
}

// ─── fase 2/3: especialista isolado ─────────────────────────────────────────

function buildSpecialistInstruction(role: SpecialistRole, task: string, plan: PipelinePlan, item?: DistributionItem): string {
  const spec = SPECIALISTS[role];
  const c = plan.contracts;
  const owns = item?.owns?.length ? item.owns.join(", ") : "conforme a tarefa";
  const connects = item?.connects_to?.length
    ? item.connects_to.map((x) => `  - ${x}`).join("\n")
    : "  - respeite os contratos e integrações do plano";
  return `
Você é o Bot **${spec.name}** da WLC IA PRO (padrão Fellow / Staff).
${WLC_PRO_ENGINEERING_STANDARD}

Missão geral: ${spec.mission}
Linguagens: ${spec.languages}

RESULTADO FINAL DO PROJETO (o que tem que funcionar no fim):
${plan.intent}

TAREFA CONCRETA QUE O ARQUITETO TE ATRIBUIU:
${task}

ARQUIVOS SOB SUA RESPONSABILIDADE:
${owns}

COMO SUA PARTE SE CONECTA AO TODO:
${connects}

CONTRATOS DO ARQUITETO (obrigatório respeitar):
- Pastas: ${plan.structure.folders.join(", ") || "—"}
- Arquivos do plano: ${plan.structure.files.join(", ") || "—"}
- Tipos compartilhados: ${c.shared_types.join(" | ") || "—"}
- Tokens: ${c.design_tokens.map((t) => `${t.name}=${t.hex}`).join(", ") || plan.palette_hints.map((p) => `${p.name}=${p.hex}`).join(", ") || "—"}
- Rotas: ${c.routes.map((r) => `${r.path}→${r.page}`).join(", ") || "—"}
- Integrações: ${c.integrations.join(" · ") || "—"}
${plan.notes ? `\nNotas do Arquiteto: ${plan.notes}` : ""}

${V199_ANTI_SPAM_RULE}

Gere código que JÁ ENCAIXA no plano (mesmos nomes, imports e contratos).
Responda SOMENTE JSON válido:
{"summary":"o que você fez e como se conecta ao resto","changes":[{"path":"...","content":"arquivo completo"}]}
(até 15 arquivos; se não houver código, changes: [])
`.trim();
}

async function runSpecialist(
  db: Db,
  userId: string,
  role: SpecialistRole,
  task: string,
  plan: PipelinePlan,
  originalRequest: string,
  signal: AbortSignal,
  onEvent: TeamEvent,
  keyStatus: DualKeyStatus,
  opts: TeamOptions = {},
): Promise<SpecialistResult> {
  const name = SPECIALISTS[role].name;
  onEvent(`🚀 **${name}** iniciado em paralelo…`);
  try {
    const item = plan.distribution.find((d) => d.role === role);
    const instruction = buildSpecialistInstruction(role, task, plan, item);
    const userContent = JSON.stringify({
      original_request: originalRequest,
      your_task: task,
      plan_structure: plan.structure,
      module_contracts: plan.contracts.modules ?? [],
      export_manifest: inspectContracts(opts.existingFiles ?? []).manifest,
      ...existingContext(opts),
    });
    const raw = await askBot(db, userId, instruction, userContent, signal, 14_000, keyForRole(keyStatus, role)?.id, keyStatus.usage);
    const parsed = specialistAnswerSchema.parse(parseJsonLoose(raw, true));
    if (parsed.recovered) onEvent(`⚠️ **${name}**: resposta interrompida; recuperados ${parsed.changes.length} arquivos completos. Entrega parcial, requer revisão.`);
    onEvent(`${parsed.recovered ? "⚠️" : "✅"} **${name}** concluiu — ${parsed.changes.length} arquivo(s)`);
    return {
      role,
      ok: !parsed.recovered,
      summary: parsed.summary || `${name} concluiu`,
      changes: parsed.changes,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "erro desconhecido";
    onEvent(`❌ **${name}** falhou: ${msg.slice(0, 120)}`);
    return { role, ok: false, summary: "", changes: [], error: msg };
  }
}

// ─── fase 4: Análise de Código ───────────────────────────────────────────────

async function runCodeAnalyst(
  db: Db,
  userId: string,
  plan: PipelinePlan,
  specialistResults: SpecialistResult[],
  signal: AbortSignal,
  onEvent: TeamEvent,
  keyStatus: DualKeyStatus,
  opts: TeamOptions = {},
): Promise<SpecialistResult> {
  onEvent("🔍 **Análise de Código** revisando o conjunto e corrigindo bugs…");
  const delivered = specialistResults
    .filter((r) => r.ok)
    .map((r) => ({
      role: r.role,
      summary: r.summary,
      files: r.changes.map((c) => c.path),
    }));

  const snap = mergeProjectSnapshot(opts, specialistResults);
  const staticIssues = diagnoseBuildReadiness(snap.files);
  const missingBase = missingBootstrapFiles(snap.paths);
  if (staticIssues.length || missingBase.length) {
    onEvent(`🩺 Pré-checagem estática encontrou ${staticIssues.length} alerta(s) de build e ${missingBase.length} arquivo(s) base ausente(s).`);
  }

  // Envia arquivos críticos de build/config na íntegra (sem truncar em 400 chars)
  const configFiles = snap.files
    .filter((f) => CRITICAL_BUILD_PATHS.has(f.path))
    .map((f) => ({ path: f.path, content: f.content.slice(0, 12_000) }));
  const configSet = new Set(configFiles.map((f) => f.path));

  const allChanges = consolidate(specialistResults);
  const preview = allChanges
    .filter((c) => !configSet.has(c.path))
    .slice(0, 25)
    .map((c) => ({
      path: c.path,
      size: c.content.length,
      head: c.content.slice(0, 1_200),
    }));

  const instruction = `
Você é o Bot **Análise de Código** da WLC 1.9.9.
Os especialistas já entregaram o código. Sua missão:
1. Resolver TODOS os problemas listados em \`static_issues\` e \`missing_bootstrap_files\` (ex.: criar \`tsconfig.json\`, \`index.html\`, \`src/main.tsx\` ausentes e adicionar dependências importadas que faltam em \`package.json\`).
2. Revisar inconsistências entre \`config_files\`, \`all_paths\` e \`preview\` (imports quebrados, nomes divergentes, falta de Mobile First, etc.).
3. Gerar correções cirúrgicas (devolva o conteúdo COMPLETO de cada arquivo criado/corrigido).
4. Não inventar features fora do pedido. Porém issues HOLLOW_ADMIN, UNLINKED_SCHEMA, BROKEN_ROUTER_WILDCARD, UNDECLARED_ROUTE_TARGET e UNCONSUMED_SERVICE em \`static_issues\` são entregas incompletas: implemente o service da entidade (list/create/update/remove com seed) e a página de admin funcional (tabela, formulário, excluir com confirmação), e troque o roteamento do admin por layout aninhado com <Outlet/>. Para cada destino de link sem rota, crie a página real e registre a rota; nunca apague o link.

${V199_ANTI_SPAM_RULE}

Responda SOMENTE JSON:
{"summary":"problemas encontrados e o que foi corrigido","changes":[{"path":"...","content":"arquivo completo corrigido"}]}
`.trim();

  try {
    const raw = await askBot(
      db,
      userId,
      instruction,
      JSON.stringify({
        intent: plan.intent,
        all_paths: snap.paths,
        missing_bootstrap_files: missingBase,
        static_issues: staticIssues,
        contract_issues: inspectContracts(snap.files).issues,
        export_manifest: inspectContracts(snap.files).manifest,
        missing_local_imports: findMissingLocalImports(snap.files).slice(0, 30),
        config_files: configFiles,
        delivered,
        preview,
      }),
      signal,
      12_000,
      keyStatus.usage ? leastUsedKeyId(keyStatus, keyStatus.usage) : keyForRole(keyStatus, "code_analyst")?.id,
      keyStatus.usage,
    );
    const parsed = specialistAnswerSchema.parse(parseJsonLoose(raw, true));
    if (parsed.recovered) onEvent("⚠️ Análise interrompida: somente correções completas recuperadas; revisão pendente.");
    onEvent(`✅ **Análise de Código** concluiu — ${parsed.changes.length} correção(ões)`);
    return {
      role: "code_analyst",
      ok: !parsed.recovered,
      summary: parsed.summary,
      changes: parsed.changes,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "erro";
    onEvent(`⚠️ Análise de Código falhou: ${msg.slice(0, 100)}`);
    return { role: "code_analyst", ok: false, summary: "", changes: [], error: msg };
  }
}

// ─── coleta de faltantes (gap-healing) ───────────────────────────────────────

/** Arquivos que precisam existir: imports locais quebrados + arquivos de bots interrompidos. */
function collectGaps(plan: PipelinePlan, opts: TeamOptions, results: SpecialistResult[], partialRoles: Set<SpecialistRole>) {
  const snap = mergeProjectSnapshot(opts, results);
  const have = new Set(snap.paths);
  const gaps = new Map<string, { path: string; reasons: string[] }>();
  const add = (path: string, reason: string) => {
    if (have.has(path)) return;
    const g = gaps.get(path) ?? { path, reasons: [] };
    if (g.reasons.length < 3) g.reasons.push(reason);
    gaps.set(path, g);
  };
  const missingImports: MissingImport[] = findMissingLocalImports(snap.files);
  for (const m of missingImports) add(m.target, `importado em ${m.importer}: ${m.line}`);
  for (const d of plan.distribution) {
    if (!partialRoles.has(d.role)) continue;
    for (const o of d.owns ?? []) {
      if (/\.(tsx?|jsx?|css)$/.test(o) && !o.includes("*")) add(o.replace(/^\.?\//, ""), `planejado para ${SPECIALISTS[d.role]?.name ?? d.role} (resposta interrompida)`);
    }
  }
  return { gaps: [...gaps.values()].slice(0, 24), snap };
}

async function runGapHealer(
  db: Db, userId: string, plan: PipelinePlan, request: string, opts: TeamOptions,
  results: SpecialistResult[], partialRoles: Set<SpecialistRole>, signal: AbortSignal,
  onEvent: TeamEvent, keyStatus: DualKeyStatus, maxRounds = 2,
): Promise<SpecialistResult[]> {
  const healed: SpecialistResult[] = [];
  const usage = keyStatus.usage ?? new Map<string, number>();
  for (let round = 1; round <= maxRounds; round++) {
    const { gaps, snap } = collectGaps(plan, opts, [...results, ...healed], round === 1 ? partialRoles : new Set());
    if (!gaps.length) {
      if (round > 1 || healed.length) onEvent("🧩 Coleta de faltantes concluída — nenhum import quebrado.");
      return healed;
    }
    onEvent(`🧩 **Coleta de faltantes** (rodada ${round}): ${gaps.length} arquivo(s) — ${gaps.slice(0, 5).map((g) => g.path).join(", ")}${gaps.length > 5 ? "…" : ""}`);
    const importers = new Set(gaps.flatMap((g) => g.reasons.map((r) => r.match(/^importado em (\S+):/)?.[1]).filter(Boolean) as string[]));
    const context = snap.files
      .filter((f) => importers.has(f.path) || CRITICAL_BUILD_PATHS.has(f.path) || /types?\.(ts|tsx)$/.test(f.path))
      .slice(0, 8)
      .map((f) => ({ path: f.path, content: f.content.slice(0, 6_000) }));
    const batches = chunk(gaps, 4);
    const settled = await Promise.allSettled(batches.map(async (batch) => {
      const keyId = leastUsedKeyId(keyStatus, usage, 20_000);
      const instruction = `
Você é o Bot **Coleta de Faltantes** da WLC 1.9.9.
Outro especialista foi interrompido e os arquivos abaixo NÃO existem, mas já são importados/planejados.
Crie SOMENTE esses arquivos, completos, funcionais e profissionais (Tailwind, lucide-react, responsivo, estados vazios/carregando).
Respeite exatamente o estilo de import (default vs nomeado) mostrado em "reasons" e os contratos do plano.
Não reescreva outros arquivos. Sem explicações longas.

${V199_ANTI_SPAM_RULE}

Responda SOMENTE JSON: {"summary":"...","changes":[{"path":"...","content":"arquivo completo"}]}
`.trim();
      const raw = await askBot(db, userId, instruction, JSON.stringify({
        original_request: request.slice(0, 4_000),
        intent: plan.intent,
        routes: plan.contracts.routes,
        shared_types: plan.contracts.shared_types,
        module_contracts: plan.contracts.modules ?? [],
        export_manifest: inspectContracts(snap.files).manifest,
        design_tokens: plan.contracts.design_tokens,
        all_paths: snap.paths,
        files_to_create: batch,
        context_files: context,
      }), signal, 14_000, keyId, usage);
      const parsed = specialistAnswerSchema.parse(parseJsonLoose(raw, true));
      const wanted = new Set(batch.map((b) => b.path));
      return parsed.changes.filter((c) => wanted.has(c.path.replace(/^\.?\//, "")));
    }));
    let got = 0;
    for (const s of settled) {
      if (s.status === "fulfilled" && s.value.length) {
        got += s.value.length;
        healed.push({ role: "frontend", ok: true, summary: "Coleta de faltantes", changes: s.value });
      }
    }
    onEvent(`${got ? "✅" : "⚠️"} Coleta de faltantes: ${got} arquivo(s) criado(s) com as APIs menos usadas.`);
    if (!got) break;
  }
  const { gaps } = collectGaps(plan, opts, [...results, ...healed], new Set());
  if (gaps.length) onEvent(`⚠️ Ainda faltam ${gaps.length} arquivo(s) importado(s): ${gaps.slice(0, 5).map((g) => g.path).join(", ")} — o deploy pode falhar.`);
  return healed;
}

// ─── completude funcional (anti-vitrine) ─────────────────────────────────────

/**
 * Fecha a lacuna entre Backend e Frontend gerados em paralelo: cria as páginas que os
 * botões/menus já apontam, registra as rotas e liga os services às telas e ao /admin.
 */
async function runProductCompletion(
  db: Db, userId: string, plan: PipelinePlan, request: string, opts: TeamOptions,
  results: SpecialistResult[], signal: AbortSignal, onEvent: TeamEvent, keyStatus: DualKeyStatus,
): Promise<SpecialistResult | null> {
  const snap = mergeProjectSnapshot(opts, results);
  const gaps = functionalGapIssues(snap.files);
  if (!gaps.length) return null;
  onEvent(`🧱 **Completude funcional**: ${gaps.length} lacuna(s) — ${gaps.slice(0, 3).map((g) => g.code).join(", ")}. Ligando telas, rotas e dados…`);
  const services = snap.files.filter((f) => /^src\/services\//.test(f.path)).slice(0, 6);
  const context = snap.files
    .filter((f) => /^src\/(App|main)\.(t|j)sx$/.test(f.path) || /^src\/(pages|routes|layouts)\//.test(f.path) || /^src\/(types|lib)\//.test(f.path))
    .slice(0, 14);
  const instruction = `
Você é o Bot **Completude Funcional** da WLC 1.9.9.
O projeto compila, mas é uma VITRINE: há botões/menus que levam a páginas inexistentes, services de dados que nenhuma tela usa e/ou admin sem dados.
Sua missão é transformar em PRODUTO FUNCIONAL, resolvendo TODAS as lacunas em \`gaps\`:
1. UNDECLARED_ROUTE_TARGET: crie a página real para cada destino e registre a rota em src/App.tsx (admin em layout aninhado com <Outlet/>, <Route index> e rotas filhas). Nunca remova o link para "resolver".
2. UNCONSUMED_SERVICE / UNLINKED_SCHEMA: as páginas operacionais (ex.: PDV, dashboard, agenda) e de admin DEVEM importar os exports reais do service (veja export_manifest) e usar list/create/update/remove com estados loading/vazio/erro.
3. HOLLOW_ADMIN: cada página de admin tem tabela com dados do service, formulário criar/editar e excluir com confirmação.
4. Proteja /admin com guard que lê a mesma constante de storage do Login; mantenha path="*".
Devolva src/App.tsx COMPLETO e cada página nova/alterada COMPLETA. Use só pacotes já declarados em package.json.

${V199_ANTI_SPAM_RULE}

Responda SOMENTE JSON: {"summary":"...","changes":[{"path":"...","content":"arquivo completo"}]}
`.trim();
  try {
    const raw = await askBot(db, userId, instruction, JSON.stringify({
      original_request: request.slice(0, 6_000),
      intent: plan.intent,
      routes: plan.contracts.routes,
      design_tokens: plan.contracts.design_tokens,
      gaps: gaps.slice(0, 20).map((g) => ({ code: g.code, path: g.path, message: g.message, fix: g.fix })),
      export_manifest: inspectContracts(snap.files).manifest,
      all_paths: snap.paths,
      services: services.map((f) => ({ path: f.path, content: f.content.slice(0, 8_000) })),
      context_files: context.map((f) => ({ path: f.path, content: f.content.slice(0, 6_000) })),
    }), signal, 16_000, leastUsedKeyId(keyStatus, keyStatus.usage ?? new Map(), 20_000), keyStatus.usage);
    const parsed = specialistAnswerSchema.parse(parseJsonLoose(raw, true));
    const after = functionalGapIssues(mergeProjectSnapshot(opts, [...results, { role: "frontend", ok: true, summary: "", changes: parsed.changes }]).files);
    onEvent(`${after.length < gaps.length ? "✅" : "⚠️"} Completude funcional: ${parsed.changes.length} arquivo(s); lacunas ${gaps.length} → ${after.length}.`);
    return { role: "frontend", ok: !parsed.recovered && after.length === 0, summary: parsed.summary || "Telas e rotas ligadas aos dados", changes: parsed.changes };
  } catch (e) {
    signal.throwIfAborted();
    onEvent(`⚠️ Completude funcional falhou: ${(e instanceof Error ? e.message : "erro").slice(0, 120)}`);
    return null;
  }
}

// ─── consolidação ────────────────────────────────────────────────────────────

function consolidate(results: SpecialistResult[]): TeamChange[] {
  const map = new Map<string, TeamChange>();
  for (const r of results) {
    for (const c of r.changes) {
      map.set(c.path, c); // último write vence
    }
  }
  return [...map.values()];
}

// ─── entry point público ─────────────────────────────────────────────────────

/**
 * Executa o time completo em paralelo.
 * - Arquiteto sequencial
 * - Fase 2 (design/frontend/backend/dba) em paralelo
 * - Fase 3 (qa/devops) em paralelo
 * - Análise de Código no final
 */
export async function runHybridTeam(
  db: Db,
  userId: string,
  request: string,
  signal: AbortSignal,
  onEvent: TeamEvent = () => {},
  opts: TeamOptions = {},
): Promise<TeamRunResult> {
  // Conversa simples (ex.: "oi") não gasta o time inteiro
  if (isSmallTalk(request)) {
    onEvent("💬 Mensagem conversacional — time não acionado.");
    return { plan: null, results: [], analysis: null, changes: [], summary: SMALL_TALK_REPLY };
  }

  // Pré-check de APIs
  const keys = await listKeys(db, userId);
  const dual = checkDualKeys(keys);
  dual.usage = new Map();
  if (dual.count === 0) {
    onEvent("❌ Nenhuma API Gemini conectada.");
    return {
      plan: null,
      results: [],
      analysis: null,
      changes: [],
      summary: dual.message ?? "Cadastre APIs Gemini em Configurações.",
    };
  }
  onEvent(`🔑 ${dual.count} API(s) disponível(is) · especialistas em paralelo`);
  for (const [role, key] of Object.entries(dual.assignment)) {
    if (key) onEvent(`   ↳ ${SPECIALISTS[role as SpecialistRole]?.name ?? role} → ${key.label}`);
  }

  // 1. Arquiteto
  // Resolve once: parallel bots must never write into different projects.
  const workspace = opts.apply === false ? null : opts.workspace ?? await openWorkspace(db, userId);
  const plan = await runArchitect(db, userId, request, signal, onEvent, dual, opts);

  // Separa por fase
  const phase2 = plan.distribution.filter(
    (d) => SPECIALISTS[d.role]?.phase === 2,
  );
  const phase3 = plan.distribution.filter(
    (d) => SPECIALISTS[d.role]?.phase === 3,
  );
  // Se o arquiteto não colocou QA/DevOps e o pedido é grande, força-os
  if (phase3.length === 0 && phase2.length >= 2) {
    phase3.push(
      { role: "qa", task: "Escrever testes básicos do que foi criado", priority: 1 },
      { role: "devops", task: "Garantir bootstrap de build e scripts", priority: 2 },
    );
  }

  const allResults: SpecialistResult[] = [];

  // 2. Fase 2 em PARALELO (segundo plano)
  if (phase2.length) {
    onEvent(`⚡ Disparando **${phase2.length}** especialista(s) em paralelo…`);
    const settled = await Promise.allSettled(
      phase2.map((d) =>
        runSpecialist(db, userId, d.role, d.task, plan, request, signal, onEvent, dual, opts),
      ),
    );
    settled.forEach((s, i) => {
      if (s.status === "fulfilled") allResults.push(s.value);
      else {
        const target = phase2[i];
        if (!target) return;
        allResults.push({
          role: target.role,
          ok: false,
          summary: "",
          changes: [],
          error: String(s.reason),
        });
      }
    });
  }

  // 2b. Coleta de faltantes (bots interrompidos / imports quebrados) com as APIs menos usadas
  const partialRoles = new Set<SpecialistRole>(allResults.filter((r) => !r.ok).map((r) => r.role));
  if (isPastDeadline(opts.deadline)) onEvent("⏱️ Tempo do time quase no limite — pulando coleta de faltantes.");
  else allResults.push(...await runGapHealer(db, userId, plan, request, opts, allResults, partialRoles, phaseSignal(signal, opts.deadline), onEvent, dual));

  // 2c. Completude funcional: essencial (usa o sinal principal, não o prazo suave).
  const completion = await runProductCompletion(db, userId, plan, request, opts, allResults, signal, onEvent, dual);
  if (completion) allResults.push(completion);

  // 3. Fase 3 em PARALELO
  const phase2Snapshot = mergeProjectSnapshot(opts, allResults);
  const missingFiles = missingBootstrapFiles(phase2Snapshot.paths);
  const missingDeps = findMissingDependencies(phase2Snapshot.files);
  const buildIssues = diagnoseBuildReadiness(phase2Snapshot.files);
  const existingDevOpsIdx = phase3.findIndex((d) => d.role === "devops");
  const existingDevOps = existingDevOpsIdx >= 0 ? phase3[existingDevOpsIdx] : undefined;
  const devopsTask = buildDevOpsBootstrapTask(existingDevOps?.task, missingFiles, missingDeps, buildIssues);

  if (devopsTask && (missingFiles.length > 0 || missingDeps.length > 0 || buildIssues.length > 0)) {
    const bootstrapOwns = [...new Set([...(existingDevOps?.owns ?? []), "package.json", ...missingFiles])];
    if (existingDevOps) {
      phase3[existingDevOpsIdx] = { ...existingDevOps, task: devopsTask, owns: bootstrapOwns };
    } else {
      phase3.push({ role: "devops", task: devopsTask, owns: bootstrapOwns, priority: 1 });
    }
    const reasons = [
      missingFiles.length ? `arquivos base ausentes (${missingFiles.join(", ")})` : "",
      missingDeps.length ? `dependências não declaradas (${[...new Set(missingDeps.map((d) => d.pkg))].join(", ")})` : "",
    ].filter(Boolean).join(" · ");
    onEvent(`🛠️ **Bootstrap obrigatório**: ${reasons || `${buildIssues.length} alerta(s) de build`} — escalando DevOps.`);
  }

  const phase3Opts = buildPhase3Options(opts, allResults);
  if (phase3.length && isPastDeadline(opts.deadline)) {
    onEvent("⏱️ Tempo do time quase no limite — QA/DevOps pulados; bootstrap determinístico cobre o básico.");
  } else if (phase3.length) {
    const p3Signal = phaseSignal(signal, opts.deadline);
    onEvent(`⚡ Disparando **${phase3.length}** bot(s) de qualidade/ops em paralelo…`);
    const settled = await Promise.allSettled(
      phase3.map((d) =>
        runSpecialist(db, userId, d.role, d.task, plan, request, p3Signal, onEvent, dual, phase3Opts),
      ),
    );
    for (const s of settled) {
      if (s.status === "fulfilled") allResults.push(s.value);
    }
  }

  // 4. Análise de Código (depois que todos terminaram)
  const analysis = isPastDeadline(opts.deadline)
    ? (onEvent("⏱️ Tempo do time quase no limite — Análise de Código pulada."), null)
    : await runCodeAnalyst(db, userId, plan, allResults, phaseSignal(signal, opts.deadline), onEvent, dual, opts);
  if (analysis) allResults.push(analysis);
  // 4b. Garantia final: DevOps/Análise podem ter criado imports novos (ex.: main.tsx → páginas)
  const partialLate = new Set<SpecialistRole>(allResults.filter((r) => !r.ok && SPECIALISTS[r.role]?.phase === 3).map((r) => r.role));
  if (!isPastDeadline(opts.deadline)) allResults.push(...await runGapHealer(db, userId, plan, request, opts, allResults, partialLate, phaseSignal(signal, opts.deadline), onEvent, dual));

  // 4c. Segunda passada de completude se a análise/DevOps reabriram lacunas.
  if (!isPastDeadline(opts.deadline) && functionalGapIssues(mergeProjectSnapshot(opts, allResults).files).length) {
    const again = await runProductCompletion(db, userId, plan, request, opts, allResults, phaseSignal(signal, opts.deadline), onEvent, dual);
    if (again) allResults.push(again);
  }

  const quality = await repairProjectQuality(db, userId, sanitizeChanges(mergeProjectSnapshot(opts, allResults).files), phaseSignal(signal, opts.deadline), onEvent, dual.usage, !isPastDeadline(opts.deadline));
  signal.throwIfAborted(); // cancelamento do usuário nunca grava resultado
  if (quality.changes.length) allResults.push({ role: "code_analyst", ok: quality.issues.length === 0, summary: "Correções de contratos e bootstrap visual", changes: quality.changes });
  const changes = sanitizeChanges(consolidate(allResults));
  const finalSnapshot = mergeProjectSnapshot(opts, [{ role: "code_analyst", ok: true, summary: "", changes }]);
  const archIssues = inspectArchitecture(finalSnapshot.files).errors.map(i => `${i.path}: [${i.code}] ${i.message}`);
  const qualityIssues = [...quality.issues.map(i => `${i.path}: ${i.message}`), ...findMissingLocalImports(finalSnapshot.files).map(i => `${i.importer}: falta ${i.target}`), ...diagnoseBuildReadiness(finalSnapshot.files).map(i => `${i.path}: ${i.message}`), ...archIssues];
  if (qualityIssues.length) onEvent(`⚠️ Projeto salvo com ${qualityIssues.length} pendência(s). Não está validado para deploy.`);
  const okCount = allResults.filter((r) => r.ok).length;
  const summary = [
    `Time concluiu: ${okCount}/${allResults.length} bots ok · ${changes.length} arquivo(s) gerado(s).`,
    qualityIssues.length ? `Validação pendente: ${qualityIssues.slice(0, 6).join("; ")}` : "Integridade estática verificada; publicação e testes de uso ainda precisam ser confirmados.",
    ...allResults.filter((r) => r.ok && r.summary).map((r) => `• ${SPECIALISTS[r.role]?.name ?? r.role}: ${r.summary.slice(0, 120)}`),
  ].join("\n");

  if (opts.apply === false) {
    onEvent(`🏁 **Pipeline finalizado** — ${changes.length} arquivo(s) proposto(s) para revisão`);
    return { plan, results: allResults, analysis, changes, summary, qualityIssues };
  }

  // Garantia final: consolida e grava o que ainda não foi (ex.: overlapping)
  const finalApply = await applyTeamChanges(db, userId, changes, {
    projectId: workspace?.projectId ?? null,
    projectName: workspace?.projectName ?? null,
    request,
  });
  if (finalApply.skipped.length) {
    onEvent(`⚠️ ${finalApply.skipped.length} arquivo(s) não salvo(s): ${finalApply.skipped[0]?.reason ?? "erro"}`);
  }
  if (finalApply.written.length) {
    onEvent(`💾 Consolidação final: ${finalApply.written.length} arquivo(s) no projeto${finalApply.projectName ? ` "${finalApply.projectName}"` : ""}`);
  } else if (!finalApply.projectId) {
    onEvent(`⚠️ Nenhum projeto em Code — os bots geraram código mas não puderam injetar. Abra/crie um projeto.`);
  }
  if (finalApply.projectId && finalApply.written.length && !finalApply.skipped.length && !qualityIssues.length) {
    try {
      const synced = await syncGeneratedProject(db, userId, finalApply.projectId);
      if (synced) onEvent(`GitHub confirmou ${synced.sha.slice(0, 7)}: ${synced.count} arquivo(s) enviados sem exigir Deploy.`);
    } catch (error) {
      onEvent(`Arquivos preservados; sincronização pendente: ${error instanceof Error ? error.message : "GitHub indisponível"}`);
    }
  }
  onEvent(`🏁 **Pipeline finalizado** — ${changes.length} arquivo(s) · ${finalApply.written.length} gravado(s) no disco do projeto`);
  return { plan, results: allResults, analysis, changes, summary, qualityIssues, projectId: finalApply.projectId, projectName: finalApply.projectName };
}
