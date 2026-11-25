// Diagnóstico de Deploy (WLC 1.9.9): compila e testa no WLC Runner (GitHub Actions, Ubuntu),
// lê o log de sucesso/erro e, se falhou, pede ao bot de Diagnóstico a causa e a correção.
// Não grava nada no projeto nem no repositório: devolve a proposta para o usuário revisar.
import { z } from "zod";
import type { Db } from "@/modules/integrations/core/runs.server";
import { listKeys } from "@/modules/integrations/gemini/services/keys.server";
import { getToken } from "@/modules/integrations/github/services/connection.server";
import { redactSecrets } from "@/modules/integrations/github/services/repository.server";
import { ghCall } from "@/modules/code/services/github-write.server";
import { findGitProject, getCreds, getDeployment, latestDeployment } from "@/modules/integrations/cloudflare/services/cloudflare.server";
import { runCommand } from "@/modules/orchestrator/runner-actions.server";
import { RUNNER_WORKFLOW_PATH, checkCommand } from "@/modules/orchestrator/runner-commands";
import { checkDualKeys, keyForRole } from "../core/keys";
import { parseJsonLoose } from "../core/architect";
import {
  DIAGNOSTICS_INSTRUCTION,
  errorTail,
  filesMentionedInLog,
  parseRunnerText,
  pickRunnerCommands,
  stripAnsi,
} from "../core/diagnostics";
import { askBot, type TeamChange, type TeamEvent } from "./runner.server";

export interface DiagnosticsResult {
  ok: boolean;
  stage: "setup" | "build" | "test" | "deploy" | "done";
  summary: string;
  runId: string | null;
  /** Arquivos do projeto lidos pelo bot (só estes podem ser alterados na proposta). */
  readPaths: string[];
  changes: TeamChange[];
}

const answerSchema = z.object({
  cause: z.string().default(""),
  summary: z.string().default(""),
  changes: z.array(z.object({ path: z.string().min(1).max(500), content: z.string().max(500_000) })).max(10).default([]),
});

const LOG_FOR_BOT = 12_000;
const READ_BUDGET = 60_000;

const stop = (stage: DiagnosticsResult["stage"], summary: string, runId: string | null = null): DiagnosticsResult =>
  ({ ok: false, stage, summary, runId, readPaths: [], changes: [] });

interface Analysis { cause: string; botSummary: string; changes: TeamChange[]; read: string[] }

/** Lê os arquivos citados no log e pede ao bot de Diagnóstico a causa raiz e a correção. */
async function analyzeFailure(
  db: Db, userId: string, files: { path: string; content: string }[], signal: AbortSignal,
  input: { source: "github-actions" | "cloudflare-pages"; label: string; conclusion: string | null; log: string },
): Promise<Analysis> {
  const log = redactSecrets(stripAnsi(input.log));
  const mentioned = filesMentionedInLog(log, files.map((f) => f.path));
  const wanted = [...mentioned, ...(mentioned.includes("package.json") ? [] : ["package.json"])];
  let budget = READ_BUDGET;
  const read: { path: string; content: string }[] = [];
  for (const p of wanted) {
    const f = files.find((x) => x.path === p);
    if (!f || f.content.includes("\0") || redactSecrets(f.content) !== f.content) continue;
    const size = f.path.length + f.content.length + 50;
    if (size > budget) continue;
    budget -= size;
    read.push({ path: f.path, content: f.content });
  }
  const dual = checkDualKeys(await listKeys(db, userId));
  try {
    const raw = await askBot(
      db, userId, DIAGNOSTICS_INSTRUCTION,
      JSON.stringify({ source: input.source, command: input.label, conclusion: input.conclusion, log_tail: log.slice(-LOG_FOR_BOT), files: read }),
      signal, 12_000, keyForRole(dual, "diagnostics")?.id,
    );
    const parsed = answerSchema.parse(parseJsonLoose(raw));
    return { cause: parsed.cause, botSummary: parsed.summary, changes: parsed.changes, read: read.map((r) => r.path) };
  } catch (e) {
    signal.throwIfAborted();
    return { cause: "", botSummary: `O bot de Diagnóstico não conseguiu analisar o log (${e instanceof Error ? e.message.slice(0, 120) : "erro"}).`, changes: [], read: read.map((r) => r.path) };
  }
}

interface CloudflareDeploy { project: string; state: string; stage: string; url: string; logs: string[] }

/** Deploy mais recente do projeto Pages ligado ao repositório. Opcional: sem Cloudflare/projeto devolve null. */
async function latestCloudflareDeploy(db: Db, userId: string, repo: string): Promise<CloudflareDeploy | null> {
  try {
    const { token, accountId } = await getCreds(db, userId);
    const project = await findGitProject(token, accountId, repo);
    if (!project) return null;
    const id = await latestDeployment(token, accountId, project.name);
    if (!id) return null;
    const d = await getDeployment(token, accountId, project.name, id);
    return { project: project.name, state: d.state, stage: d.stage, url: d.url, logs: d.logs };
  } catch {
    return null;
  }
}

export async function diagnoseWithRunner(
  db: Db,
  userId: string,
  projectId: string,
  signal: AbortSignal,
  onEvent: TeamEvent = () => {},
): Promise<DiagnosticsResult> {
  const { data: project } = await db.from("code_projects").select("id,name,repo_full_name,branch").eq("id", projectId).eq("user_id", userId).single();
  if (!project) throw new Error("Projeto não encontrado.");
  if (!project.repo_full_name || !project.branch)
    return stop("setup", "O build e os testes rodam no GitHub Actions do repositório vinculado. Vincule um repositório na tela Code.");

  const { data: rows, error } = await db.from("code_files").select("path,content,base_content,deleted").eq("project_id", projectId).eq("user_id", userId).limit(3000);
  if (error || !rows) throw new Error("Não foi possível ler o projeto.");
  const files = rows.filter((f) => !f.deleted);
  const pending = rows.filter((f) => (f.deleted ? f.base_content !== null : f.content !== f.base_content)).length;

  const commands = pickRunnerCommands(files);
  if (!commands.length)
    return stop("setup", "Não encontrei package.json com scripts `build` ou `test` para rodar no GitHub.");

  const token = await getToken(db, userId);
  const path = RUNNER_WORKFLOW_PATH.split("/").map(encodeURIComponent).join("/");
  try {
    await ghCall(token, "GET", `/repos/${project.repo_full_name}/contents/${path}?ref=${encodeURIComponent(project.branch)}`);
  } catch {
    return stop("setup", "Não encontrei o terminal WLC Runner neste repositório (ou não tenho acesso a ele). Instale com `setup_runner` (cria `.github/workflows/wlc-runner.yml`) e peça o diagnóstico de novo.");
  }
  const pendingNote = pending
    ? `\n\n⚠️ ${pending} alteração(ões) local(is) ainda não enviada(s): o Runner compila o código que está no GitHub. Envie (commit) e rode de novo para testar o estado atual.`
    : "";

  const passed: string[] = [];
  for (const { command, stage } of commands) {
    const bad = checkCommand(command);
    if (bad) return stop("setup", bad);
    onEvent(`🧪 Rodando \`${command}\` no GitHub Actions (${project.repo_full_name}@${project.branch})…`);
    const run = parseRunnerText((await runCommand(token, project.repo_full_name, project.branch, command, signal)).text);
    if (run.state === "pending") {
      onEvent(`⏳ \`${command}\` ainda em execução no GitHub.`);
      return stop(stage, `\`${command}\` ainda está rodando no GitHub${run.runId ? ` (run ${run.runId})` : ""}. Peça o diagnóstico de novo em instantes.${pendingNote}`, run.runId);
    }
    if (run.state === "success") {
      onEvent(`✅ \`${command}\` passou (run ${run.runId}).`);
      passed.push(`\`${command}\` ✅ (run ${run.runId})`);
      continue;
    }

    // Falhou: o bot lê os arquivos citados no log e propõe a correção.
    onEvent(`❌ \`${command}\` falhou (${run.conclusion}, run ${run.runId}) — analisando o log…`);
    const logSafe = redactSecrets(stripAnsi(run.log));
    const { cause, botSummary, changes, read } = await analyzeFailure(db, userId, files, signal, {
      source: "github-actions", label: command, conclusion: run.conclusion, log: logSafe,
    });
    onEvent(`🩺 Diagnóstico concluído — ${changes.length} arquivo(s) propostos.`);
    const head = `❌ **${stage === "build" ? "Build" : "Teste"} falhou** no GitHub: \`${command}\` → ${run.conclusion} (run ${run.runId})`;
    const summary = [
      head,
      passed.length ? `Antes disso passou: ${passed.join(", ")}` : "",
      cause ? `**Causa provável:** ${cause}` : "",
      botSummary,
      `**Trecho do log:**\n\`\`\`\n${errorTail(logSafe)}\n\`\`\``,
      changes.length ? "Revise o diff, aplique, envie ao GitHub e rode o diagnóstico de novo para confirmar." : "",
    ].filter(Boolean).join("\n\n") + pendingNote;
    return { ok: false, stage, summary, runId: run.runId, readPaths: read, changes };
  }

  onEvent("✅ Build e testes passaram no GitHub — conferindo o deploy na Cloudflare…");
  const deploy = await latestCloudflareDeploy(db, userId, project.repo_full_name);
  const okLine = `✅ **Passou no GitHub:** ${passed.join(", ")}.`;
  if (!deploy) return { ok: true, stage: "done", summary: `${okLine}${pendingNote}`, runId: null, readPaths: [], changes: [] };
  if (deploy.state !== "failure") {
    onEvent("🏁 Deploy mais recente na Cloudflare sem falha.");
    return { ok: true, stage: "done", summary: `${okLine}\n☁️ Deploy mais recente na Cloudflare (\`${deploy.project}\`): ${deploy.state}${deploy.url ? ` — ${deploy.url}` : ""}.${pendingNote}`, runId: null, readPaths: [], changes: [] };
  }

  onEvent(`❌ Deploy mais recente falhou na Cloudflare (${deploy.project}, etapa ${deploy.stage}) — analisando…`);
  const cfLog = redactSecrets(stripAnsi(deploy.logs.join("\n")));
  const { cause, botSummary, changes, read } = await analyzeFailure(db, userId, files, signal, {
    source: "cloudflare-pages", label: `deploy ${deploy.project} (${deploy.stage})`, conclusion: "failure", log: cfLog || "(sem logs de falha disponíveis)",
  });
  onEvent(`🩺 Diagnóstico concluído — ${changes.length} arquivo(s) propostos.`);
  const summary = [
    `${okLine}`,
    `☁️ **Mas o deploy falhou na Cloudflare:** projeto \`${deploy.project}\`, etapa ${deploy.stage}.`,
    cause ? `**Causa provável:** ${cause}` : "",
    botSummary,
    cfLog ? `**Trecho do log:**\n\`\`\`\n${errorTail(cfLog)}\n\`\`\`` : "O Cloudflare não devolveu logs dessa falha.",
    changes.length ? "Revise o diff, aplique, envie ao GitHub (a Cloudflare compila a cada push) e rode o diagnóstico de novo." : "",
  ].filter(Boolean).join("\n\n") + pendingNote;
  return { ok: false, stage: "deploy", summary, runId: null, readPaths: read, changes };
}
