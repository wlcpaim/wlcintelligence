import type { Db } from "@/modules/integrations/core/runs.server";
import { getCreds, getDbEnv, getDeployment, startBuild } from "@/modules/integrations/cloudflare/services/cloudflare.server";
import { commitPending } from "@/modules/code/services/commit.server";
import { findSyntaxIssues } from "@/modules/code/edit-integrity";
import { filesMentionedInLog } from "../core/diagnostics";
import { inspectContracts, resolveLocalModule } from "../core/contracts";
import { proposeSurgicalRepair } from "./quality.server";
import { redactSecrets } from "@/modules/integrations/github/services/repository.server";
import { provisionGeneratedDatabase } from "@/modules/engineering/generated-app.server";
import { healPreflightIntegrity } from "./preflight.server";

export interface HealResult { state: "retry" | "blocked" | "running"; deploymentId?: string; message: string }

/** Idempotent per failed deployment; stored claims survive reloads and concurrent requests. */
export async function healFailedDeployment(db: Db, userId: string, projectId: string, deploymentId: string, rootId: string): Promise<HealResult> {
  const { data: project, error } = await db.from("code_projects").select("*").eq("id", projectId).eq("user_id", userId).single();
  if (error || !project?.cf_project || !project.repo_full_name) throw new Error("Projeto de deploy não encontrado.");
  const kind = `deploy-heal:${projectId}:${rootId}`;
  const { data: prior, error: readError } = await db.from("integration_runs").select("id,detail").eq("user_id", userId).eq("provider", "cloudflare").eq("kind", kind);
  if (readError) throw new Error("Não foi possível ler o histórico da recuperação.");
  const same = prior?.find(r => r.id === deploymentId);
  if (same) { try { return JSON.parse(same.detail ?? "") as HealResult; } catch { return { state: "running", message: "Correção em andamento." }; } }
  if ((prior?.length ?? 0) >= 3) return { state: "blocked", message: "Limite de três correções atingido; revise os logs sem perder o projeto." };
  if (deploymentId !== rootId && !prior?.some(r => {
    try { return (JSON.parse(r.detail ?? "{}") as HealResult).deploymentId === deploymentId; } catch { return false; }
  })) throw new Error("Deploy não pertence a esta recuperação.");
  const { token, accountId } = await getCreds(db, userId);
  const failed = await getDeployment(token, accountId, project.cf_project, deploymentId);
  if (failed.state !== "failure" || !failed.logs.length) return { state: "blocked", message: "Sem falha confirmada ou logs úteis para corrigir." };
  if (!failed.commitSha || failed.commitSha !== project.base_sha) return { state: "blocked", message: "O código mudou desde esta falha; publique a versão atual antes de corrigir." };
  const pending: HealResult = { state: "running", message: "Analisando falha real e preservando arquivos existentes." };
  const claim = await db.from("integration_runs").insert({ id: deploymentId, user_id: userId, provider: "cloudflare", kind, ok: false, detail: JSON.stringify(pending) });
  if (claim.error) {
    if (claim.error.code === "23505") return pending;
    throw new Error("Não foi possível registrar a recuperação.");
  }
  const finish = async (result: HealResult) => {
    const { error } = await db.from("integration_runs").update({ detail: JSON.stringify(result), ok: result.state === "retry" }).eq("id", deploymentId).eq("user_id", userId);
    if (error) throw new Error("Não foi possível registrar o resultado da correção.");
    return result;
  };
  try {
    const { data: rows, error: filesError } = await db.from("code_files").select("id,path,content,base_content,deleted,updated_at").eq("project_id", projectId).eq("user_id", userId).limit(3000);
    if (filesError || !rows) throw new Error("Não foi possível ler os arquivos.");
    if (rows.some(f => f.deleted || f.content !== f.base_content)) return finish({ state: "blocked", message: "Há alterações não publicadas; correção automática não sobrescreverá seu trabalho." });
    const files = rows.filter(f => !f.deleted && redactSecrets(f.content) === f.content);
    const log = redactSecrets(failed.logs.join("\n"));
    const paths = new Set(filesMentionedInLog(log, files.map(f => f.path), 6));
    // Inclui arquivos com sintaxe local quebrada (delimitadores/JSX) mesmo se o log da CF não citar o path
    for (const syn of findSyntaxIssues(files).filter(i => i.severity === "error")) {
      paths.add(syn.path);
    }
    for (const issue of inspectContracts(files).issues) { if (paths.has(issue.path)) { if (issue.target) paths.add(issue.target); } }
    for (const file of files.filter(f => paths.has(f.path))) {
      for (const m of file.content.matchAll(/from\s+["']([^"']+)["']/g)) {
        const target = m[1] ? resolveLocalModule(file.path, m[1], files.map(f => f.path)) : null;
        if (target && paths.size < 12) paths.add(target);
      }
    }
    paths.add("package.json");
    paths.add("src/lib/generated-app-client.ts");
    const read = files.filter(f => paths.has(f.path));
    if (read.reduce((n, f) => n + f.content.length, 0) > 100000) return finish({ state: "blocked", message: "Contexto grande demais para correção segura; revisão necessária." });
    const changes = await proposeSurgicalRepair(db, userId, files, [log], paths, AbortSignal.timeout(90000));
    if (!changes.length) return finish({ state: "blocked", message: "Não foi encontrada correção segura; nenhuma função será inventada para mascarar a falha." });
    const backup = await db.from("code_project_backups").insert({ project_id: projectId, user_id: userId, commit_sha: project.base_sha, parent_sha: project.base_sha, message: "backup: antes da recuperação WLC 1.9.9", files_count: files.length, files_snapshot: files.map(f => ({ path: f.path, content: f.content })) });
    if (backup.error) throw new Error("Backup não salvo; correção cancelada.");
    for (const c of changes) {
      const original = files.find(f => f.path === c.path);
      if (!original || redactSecrets(c.content) !== c.content) throw new Error("Arquivo inseguro na correção.");
      const saved = await db.from("code_files").update({ content: c.content, updated_at: new Date().toISOString() }).eq("id", original.id).eq("user_id", userId).eq("updated_at", original.updated_at).select("id");
      if (saved.error || saved.data?.length !== 1) throw new Error("Arquivo alterado durante a correção; processo interrompido com backup preservado.");
    }
    const checked = await healPreflightIntegrity(db, userId, projectId, project.base_sha, AbortSignal.timeout(180000));
    await provisionGeneratedDatabase(db, projectId, checked.files, await getDbEnv(db, userId));
    const committed = await commitPending(db, userId, projectId, "fix(deploy): correção cirúrgica WLC 1.9.9");
    if (!committed) throw new Error("Correção não gerou commit novo.");
    const next = await startBuild(token, accountId, project.cf_project, project.branch || "main");
    return finish({ state: "retry", deploymentId: next, message: `Correção enviada (${committed.sha.slice(0, 7)}); aguardando nova publicação.` });
  } catch (e) { return finish({ state: "blocked", message: redactSecrets(e instanceof Error ? e.message : "Falha na recuperação.") }); }
}