/**
 * Validação pós-aplicação: local (sempre) + typecheck remoto via WLC Runner (se GitHub vinculado).
 * Limite: 1 tentativa de tsc, timeout pelo signal do caller.
 * Integra QualityGate compartilhado (fonte única de verdade).
 */
import type { Db } from "@/modules/integrations/core/runs.server";
import { checkCommand } from "@/modules/orchestrator/runner-commands";
import { runCommand } from "@/modules/orchestrator/runner-actions.server";
import { getToken } from "@/modules/integrations/github/services/connection.server";
import { commitPending } from "@/modules/code/services/commit.server";
import {
  buildValidationReport,
  findBrokenLocalImports,
  findSyntaxIssues,
  type IntegrityFile,
  type ValidationReport,
} from "../edit-integrity";
import {
  runQualityGate,
  recordMetric,
  type QualityGateResult,
} from "@/modules/engineering/kernel";

export interface PostEditValidation {
  local: ValidationReport;
  remote: { mode: "tsc" | "skipped" | "unavailable" | "failed"; log: string; ok: boolean };
  summary: string;
  gate?: QualityGateResult;
}

/** Lê arquivos do projeto (não deletados) para validação local. */
async function loadProjectFiles(db: Db, userId: string, projectId: string): Promise<IntegrityFile[]> {
  const rows: IntegrityFile[] = [];
  for (let from = 0; ; from += 1000) {
    const r = await db
      .from("code_files")
      .select("path,content,deleted")
      .eq("project_id", projectId)
      .eq("user_id", userId)
      .eq("deleted", false)
      .range(from, from + 999);
    if (r.error || !r.data) break;
    for (const f of r.data) rows.push({ path: f.path, content: f.content });
    if (r.data.length < 1000) break;
  }
  return rows;
}

/**
 * Typecheck remoto: sincroniza pending → GitHub Actions → `npx tsc --noEmit`.
 * Não bloqueia se não houver repo; não entra em loop de heal aqui (só reporta).
 */
export async function runRemoteTypecheck(
  db: Db,
  userId: string,
  projectId: string,
  signal: AbortSignal,
): Promise<{ mode: "tsc" | "skipped" | "unavailable" | "failed"; log: string; ok: boolean }> {
  const { data: project } = await db
    .from("code_projects")
    .select("id,repo_full_name,branch")
    .eq("id", projectId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!project?.repo_full_name || !project.branch) {
    return {
      mode: "unavailable",
      ok: true,
      log: "Typecheck remoto indisponível: vincule um repositório GitHub ao projeto.",
    };
  }

  const command = "npx tsc --noEmit";
  const bad = checkCommand(command);
  if (bad) return { mode: "failed", ok: false, log: bad };

  try {
    signal.throwIfAborted();
    const token = await getToken(db, userId);
    await commitPending(db, userId, projectId, "WLC: sync antes do typecheck pós-edição");
    const out = await runCommand(token, project.repo_full_name, project.branch, command, signal);
    const text = out.text ?? "";
    const failed =
      /\berror TS\d+/i.test(text) ||
      /Found \d+ error/i.test(text) ||
      (out as { ok?: boolean }).ok === false;
    // runCommand may return text with conclusion embedded
    const conclusionFail = /conclusion[:\s]+failure/i.test(text) || /Process completed with exit code [1-9]/i.test(text);
    const ok = !failed && !conclusionFail;
    return {
      mode: "tsc",
      ok,
      log: text.slice(-4000) || (ok ? "tsc --noEmit: ok" : "tsc --noEmit: falhou"),
    };
  } catch (e) {
    if (signal.aborted) throw e;
    return {
      mode: "failed",
      ok: false,
      log: e instanceof Error ? e.message.slice(0, 500) : "Falha ao executar typecheck remoto",
    };
  }
}

/** Validação completa pós-apply: local sempre; remoto se GitHub ok e `withRemote`. QualityGate unificado. */
export async function validateAfterApply(
  db: Db,
  userId: string,
  projectId: string,
  signal: AbortSignal,
  opts: { withRemote?: boolean } = {},
): Promise<PostEditValidation> {
  const files = await loadProjectFiles(db, userId, projectId);
  const issues = [...findBrokenLocalImports(files), ...findSyntaxIssues(files)];
  const local = buildValidationReport(issues);

  let remote: PostEditValidation["remote"] = {
    mode: "skipped",
    ok: true,
    log: "Typecheck remoto não solicitado.",
  };

  if (opts.withRemote && local.ok) {
    remote = await runRemoteTypecheck(db, userId, projectId, signal);
    if (remote.mode === "tsc") {
      recordMetric(userId, remote.ok ? "tsc_ok" : "tsc_fail");
    }
  } else if (opts.withRemote && !local.ok) {
    remote = {
      mode: "skipped",
      ok: false,
      log: "Typecheck remoto adiado: corrija erros locais de import/sintaxe primeiro.",
    };
  }

  const gate = runQualityGate({
    snapshot: files,
    changes: [],
    operation: "validateAfterApply",
    remoteTypecheck:
      remote.mode === "tsc" ? { ok: remote.ok, log: remote.log } : undefined,
  });
  recordMetric(userId, gate.ready ? "gate_pass" : "gate_fail");

  const parts = [local.summary];
  if (remote.mode !== "skipped" || opts.withRemote) {
    parts.push(
      remote.mode === "tsc"
        ? `Typecheck remoto (tsc): ${remote.ok ? "ok" : "falhou"}\n${remote.log.slice(0, 1500)}`
        : remote.log,
    );
  }
  parts.push(`QualityGate: ${gate.ready ? "aprovado" : "reprovado"} (${gate.status})`);

  return {
    local,
    remote,
    summary: parts.join("\n\n"),
    gate,
  };
}
