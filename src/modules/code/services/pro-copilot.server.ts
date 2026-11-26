// Copilot próprio da WLC 1.7.1 PRO — Elite Software Engineering Agent.
// 1) vê o mapa inteiro do projeto e escolhe o que ler; 2) cria estruturas, edita trechos e moderniza sistemas.
import type { Db } from "@/modules/integrations/core/runs.server";
import { openChatStream } from "@/modules/integrations/gemini/services/chat-stream.server";
import { redactSecrets } from "@/modules/integrations/github/services/repository.server";
import { textFromGeminiChunk } from "@/services/gemini.server";
import { copilotPath, rankCopilotFiles, CopilotParseError, type CopilotAnswer } from "../copilot";
import { applyEditsRobust, parseJsonLoose, proAnswerSchema, proPickSchema } from "../pro-edits";
import { validateEditBatch, buildValidationReport } from "../edit-integrity";
import { CopilotProviderError } from "./copilot.server";
import { GENERATED_APP_CONTRACT } from "@/modules/engineering/generated-app-contract";
import { boundedProHistory, PRO_CONTEXT_BUDGET, proFileCost } from "../pro-context";

const PICK = `Você é o WLC 1.7.1 PRO — Elite Software Engineering Agent (fase de leitura).
Recebe o pedido e o MAPA de arquivos do projeto.
Escolha os arquivos necessários para cumprir o pedido com integridade (tipicamente 5–20; máximo 40).
Inclua o alvo direto E arquivos correlacionados: rotas (src/App.tsx), services, types, estilos e pontos de import.
Para modernização visual ou feature completa, priorize o design system (index.css / tokens), layout shell e páginas afetadas.
NÃO inclua secrets (.env) nem binários. Responda só JSON: {"read":["caminho", ...]} com caminhos existentes no mapa.`;

const BUILD = `Você é o WLC 1.7.1 PRO — Elite Software Engineering Agent (Fellow / Distinguished Engineer + Architect + UI/UX + Full-Stack + QA em um único motor).

PAPEL:
- Atue em projetos existentes de qualquer porte: modernizações visuais completas, features ponta a ponta, refatorações arquiteturais e correções.
- Criação de aplicativo completo do zero continua sendo papel do WLC 1.9.9 — se o pedido for isso, no summary oriente a usar 1.9.9 e deixe changes [].
- NUNCA gere Prompt Mestre, blocos [PROJETO]/[OBJETIVO] ou template de 6 seções (exclusivo do 1.5.6).

CAPACIDADE (não seja tímido):
- Pode alterar até 30 arquivos quando o pedido exigir (ex.: redesign, novo fluxo admin, checkout).
- Pode CRIAR módulos novos (páginas, services, components, hooks) quando forem necessários para cumprir o pedido.
- Pode atualizar package.json, rotas em src/App.tsx e estilos globais quando a feature depender disso.
- Preferência: edits search/replace com trecho único quando a mudança for local; content completo para arquivos novos ou reescritas amplas.

INTEGRIDADE (inegociável):
- Zero regressões: preserve comportamento não relacionado ao pedido.
- Zero botões mortos / mocks / any / stubs null artificiais.
- Autenticação: First-Admin Bootstrap (primeiro cadastro = admin); proibido credenciais hardcoded.
- Tipagem TypeScript estrita; imports locais devem apontar para arquivos que você cria ou que já existem.
- Se alterar imports de pacotes externos, declare a dependência em package.json (mesma mudança).
- Mobile First e contraste acessível quando o pedido afetar UI.

FORMATO (somente JSON válido):
{"summary":"1–5 frases do que mudou e por quê","changes":[{"path":"...","edits":[{"search":"trecho único","replace":"..."}]}]}
Arquivo novo ou reescrita: {"path":"...","content":"completo"}.
Perguntas sem edição → changes [].
Responda em português.
` + GENERATED_APP_CONTRACT;

const PLAN = `Você é o WLC 1.7.1 PRO — fase PLAN (antes de editar).
Dado o pedido e o mapa/arquivos lidos, produza um plano técnico curto em JSON:
{"goal":"objetivo em 1 frase","impact":["path afetado",...],"risks":["risco",...],"steps":["passo 1",...],"needs_new_files":boolean}
Máximo 12 paths em impact. Sem código. Responda só JSON.`;


async function ask(db: Db, userId: string, instruction: string, messages: { role: "user" | "model"; content: string }[], signal: AbortSignal, maxOutputTokens: number): Promise<string> {
  const opened = await openChatStream(db, userId, messages, signal, false, { instruction, maxOutputTokens, responseMimeType: "application/json", rotationStrategy: "least-recently-used" });
  if (!opened.ok) throw new CopilotProviderError(opened.error);
  if (!opened.response.body) return "";
  const reader = opened.response.body.getReader();
  const dec = new TextDecoder();
  let pending = "", out = "";
  const take = (l: string) => { const t = l.trim(); if (t.startsWith("data:")) out += textFromGeminiChunk(t.slice(5).trim()); };
  try {
    for (;;) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      pending += dec.decode(value, { stream: true });
      let i: number;
      while ((i = pending.indexOf("\n")) >= 0) { take(pending.slice(0, i)); pending = pending.slice(i + 1); }
    }
    take(pending);
  } finally { await reader.cancel().catch(() => {}); }
  return out;
}

/** Garante que package.json declare imports externos detectados nos conteúdos alterados (leve). */
function ensureDeclaredDeps(changes: { path: string; content: string }[], allFiles: { path: string; content: string }[]): { path: string; content: string } | null {
  const pkgFile = allFiles.find(f => f.path === "package.json") ?? changes.find(c => c.path === "package.json");
  if (!pkgFile) return null;
  let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string>; [k: string]: unknown };
  try { pkg = JSON.parse(pkgFile.content); } catch { return null; }
  pkg.dependencies = pkg.dependencies ?? {};
  pkg.devDependencies = pkg.devDependencies ?? {};
  const known: Record<string, { version: string; dev?: boolean }> = {
    "react-router-dom": { version: "^6.28.0" },
    "@supabase/supabase-js": { version: "^2.48.0" },
    "lucide-react": { version: "^0.460.0" },
    "sonner": { version: "^1.7.0" },
    "clsx": { version: "^2.1.0" },
    "tailwind-merge": { version: "^2.5.0" },
    "class-variance-authority": { version: "^0.7.0" },
    "zod": { version: "^3.23.0" },
    "@tanstack/react-query": { version: "^5.60.0" },
    "@tanstack/react-router": { version: "^1.80.0" },
    "date-fns": { version: "^4.1.0" },
    "recharts": { version: "^2.13.0" },
  };
  const blob = changes.map(c => c.content).join("\n");
  let changed = false;
  for (const [name, meta] of Object.entries(known)) {
    const re = new RegExp(`from\\s+["']${name.replace("/", "\\/")}(?:\\/[^"']*)?["']|import\\s*\\(\\s*["']${name.replace("/", "\\/")}["']`);
    if (!re.test(blob)) continue;
    if (pkg.dependencies[name] || pkg.devDependencies[name]) continue;
    if (meta.dev) pkg.devDependencies[name] = meta.version;
    else pkg.dependencies[name] = meta.version;
    changed = true;
  }
  if (!changed) return null;
  return { path: "package.json", content: JSON.stringify(pkg, null, 2) + "\n" };
}

export async function generateProCopilot(
  db: Db, userId: string, projectId: string, message: string, activePath: string | null,
  history: { role: "user" | "model"; content: string }[], signal: AbortSignal,
): Promise<CopilotAnswer> {
  const { data: project } = await db.from("code_projects").select("id,name").eq("id", projectId).eq("user_id", userId).single();
  if (!project) throw new Error("Projeto não encontrado.");
  const files: { path: string; content: string; updated_at: string; deleted: boolean }[] = [];
  for (let from = 0; ; from += 1000) {
    const r = await db.from("code_files").select("path,content,updated_at,deleted").eq("project_id", projectId).eq("user_id", userId).order("path").range(from, from + 999);
    if (r.error) throw new Error("Não foi possível ler o projeto.");
    files.push(...r.data);
    if (r.data.length < 1000) break;
  }
  const visible = files.filter(f => !f.deleted && copilotPath(f.path));
  const safe = (f: { content: string }) => f.content.length <= 80_000 && !f.content.includes("\0") && redactSecrets(f.content) === f.content;
  const paths = visible.map(f => f.path);
  const hist = boundedProHistory(history.map(h => ({ ...h, content: redactSecrets(h.content) })));
  // The most recent user turn is sufficient for file selection; BUILD retains bounded history.
  const selectionHistory = hist.filter(h => h.role === "user").slice(-1);

  let picked: string[] = [];
  try {
    const raw = await ask(db, userId, PICK, [...selectionHistory, { role: "user", content: JSON.stringify({ request: redactSecrets(message), paths: paths.slice(0, 3000) }) }], signal, 2000);
    picked = proPickSchema.parse(parseJsonLoose(raw)).read;
  } catch (e) { if (e instanceof CopilotProviderError) throw e; }
  const byPath = new Map(visible.map(f => [f.path, f]));
  const ranked = rankCopilotFiles(visible, message, activePath);
  // Always prefer App.tsx / main entry when present for route integrity
  const always = [activePath, "src/routes/__root.tsx", "src/router.tsx", "src/App.tsx", "src/main.tsx", "package.json"].filter((p): p is string => p !== null && byPath.has(p));
  const selected = picked.filter(p => byPath.has(p));
  const order = [
    ...always,
    ...selected,
    ...ranked.slice(0, selected.length ? 5 : 12).map(f => f.path),
  ];
  let budget = PRO_CONTEXT_BUDGET;
  const included = new Map<string, (typeof visible)[number]>();
  for (const path of order) {
    const f = byPath.get(path);
    if (!f || included.has(f.path) || !safe(f)) continue;
    const size = proFileCost(f);
    if (size > budget) continue;
    budget -= size; included.set(f.path, f);
    if (included.size >= 40) break;
  }

  const filePayload = [...included.values()].map(f => ({ path: f.path, content: f.content }));
  const req = [...selectionHistory, { role: "user" as const, content: JSON.stringify({
    project: project.name, request: redactSecrets(message),
    files: filePayload,
  }) }];

  // Fase PLAN: entendimento antes da edição (best-effort; não bloqueia se falhar)
  let planNote = "";
  try {
    const planRaw = await ask(db, userId, PLAN, req, signal, 2_000);
    const planObj = parseJsonLoose(planRaw) as { goal?: string; impact?: string[]; risks?: string[]; steps?: string[] };
    if (planObj && typeof planObj === "object") {
      planNote = [
        planObj.goal ? `Plano: ${planObj.goal}` : "",
        Array.isArray(planObj.impact) && planObj.impact.length ? `Impacto: ${planObj.impact.slice(0, 12).join(", ")}` : "",
        Array.isArray(planObj.risks) && planObj.risks.length ? `Riscos: ${planObj.risks.slice(0, 5).join("; ")}` : "",
      ].filter(Boolean).join("\n");
      // Expand included files from plan impact paths when present on disk
      if (Array.isArray(planObj.impact)) {
        for (const p of planObj.impact.slice(0, 12)) {
          const f = byPath.get(p);
          if (f && !included.has(p) && safe(f) && included.size < 40 && proFileCost(f) <= budget) {
            budget -= proFileCost(f);
            included.set(p, f);
          }
        }
      }
    }
  } catch { /* plan is advisory */ }

  const reqBuild = [...hist, { role: "user" as const, content: JSON.stringify({
    project: project.name, request: redactSecrets(message),
    plan: planNote || undefined,
    files: [...included.values()].map(f => ({ path: f.path, content: f.content })),
  }) }];
  let raw = await ask(db, userId, BUILD, reqBuild, signal, 16_000);
  let parsed;
  try { parsed = proAnswerSchema.parse(parseJsonLoose(raw)); }
  catch {
    raw = await ask(db, userId, `${BUILD}\nATENÇÃO: a resposta anterior não era JSON válido. Retorne apenas JSON válido.`,
      [...reqBuild, { role: "user", content: JSON.stringify({ previous_output: raw.slice(0, 60_000) }) }], signal, 16_000);
    try { parsed = proAnswerSchema.parse(parseJsonLoose(raw)); } catch { throw new CopilotParseError("invalid-schema"); }
  }

  const notes: string[] = [];
  const changes: CopilotAnswer["changes"] = [];
  const fullByPath = new Map(files.filter(f => !f.deleted).map(f => [f.path, f]));

  for (const c of parsed.changes) {
    // Prefer full project map over only "included" — removes "arquivo não foi lido" hard block
    const original = fullByPath.get(c.path) ?? null;
    let content: string;
    try {
      if (c.edits?.length) {
        if (!original) {
          // Cannot apply surgical edits without base; skip unless content also provided
          if (c.content !== undefined) content = c.content;
          else { notes.push(`Ignorado ${c.path}: edição em arquivo inexistente (forneça content completo para criar).`); continue; }
        } else {
          content = applyEditsRobust(original.content, c.edits);
        }
      } else {
        content = c.content ?? "";
      }
    } catch (e) {
      notes.push(`Ignorado ${c.path}: ${e instanceof Error ? e.message : "edição inválida"}`);
      continue;
    }
    if (content.length > 80_000 || redactSecrets(content) !== content) {
      notes.push(`Ignorado ${c.path}: grande demais ou com credencial.`);
      continue;
    }
    changes.push({
      path: c.path,
      content,
      before: original?.content ?? null,
      expectedUpdatedAt: original?.updated_at ?? null,
    });
  }

  // Post-pass: declare missing known deps in package.json when changes introduce imports
  const depFix = ensureDeclaredDeps(
    changes.map(c => ({ path: c.path, content: c.content })),
    visible.map(f => ({ path: f.path, content: f.content })),
  );
  if (depFix) {
    const existingPkg = changes.find(c => c.path === "package.json");
    const originalPkg = fullByPath.get("package.json");
    if (existingPkg) existingPkg.content = depFix.content;
    else {
      changes.push({
        path: "package.json",
        content: depFix.content,
        before: originalPkg?.content ?? null,
        expectedUpdatedAt: originalPkg?.updated_at ?? null,
      });
      notes.push("package.json atualizado com dependências detectadas nos arquivos alterados.");
    }
  }

  // Soft route integrity note (does not block)
  const appChange = changes.find(c => c.path === "src/App.tsx" || c.path === "src/App.jsx");
  if (appChange && /from\s+["']\.\/pages\//.test(appChange.content)) {
    const pageImports = [...appChange.content.matchAll(/from\s+["'](\.\/pages\/[^"']+)["']/g)].flatMap(m => m[1] ? [m[1]] : []);
    for (const spec of pageImports) {
      const base = spec.replace(/^\.\//, "src/");
      const candidates = [`${base}.tsx`, `${base}.ts`, `${base}.jsx`, `${base}/index.tsx`];
      const exists = candidates.some(p => fullByPath.has(p) || changes.some(ch => ch.path === p));
      if (!exists) notes.push(`Aviso de rota: ${spec} importado em App.tsx sem arquivo correspondente nesta entrega.`);
    }
  }

  // Integridade pós-edição: imports + sintaxe no snapshot+changes
  const integrity = validateEditBatch(
    visible.map(f => ({ path: f.path, content: f.content })),
    changes.map(c => ({ path: c.path, content: c.content })),
  );
  const report = buildValidationReport(integrity);
  if (!report.ok || report.warnings.length) {
    notes.push(report.summary);
  } else {
    notes.push("Validação local: ok (imports + sintaxe)");
  }

  let summary = notes.length ? `${parsed.summary}\n\n**Avisos:**\n${notes.map(n => `- ${n}`).join("\n")}` : parsed.summary;
  if (planNote) summary = `${planNote}\n\n${summary}`;
  return { summary, changes, coverage: { read: included.size, total: visible.length } };
}
