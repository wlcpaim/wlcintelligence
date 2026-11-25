// Commit das alterações salvas de um projeto (usado pelo botão Commit e pelo Deploy).
import type { Db } from "@/modules/integrations/core/runs.server";
import { getToken } from "@/modules/integrations/github/services/connection.server";
import { commitChanges } from "./github-write.server";

/** Envia tudo que mudou em um único commit; devolve null quando não há alterações. */
export async function commitPending(db: Db, userId: string, projectId: string, message: string) {
  const { data: p, error } = await db.from("code_projects").select("*").eq("id", projectId).single();
  if (error || !p) throw new Error("Projeto não encontrado.");
  if (!p.repo_full_name || !p.branch) throw new Error("Vincule um repositório antes do commit.");
  const { data: files, error: e2 } = await db.from("code_files").select("id,path,content,base_content,deleted,updated_at").eq("project_id", p.id).order("updated_at");
  if (e2) throw new Error(e2.message);
  const changed = (files ?? []).filter((f) => (f.deleted ? f.base_content !== null : f.content !== f.base_content));
  if (!changed.length) return null;

  // Snapshot automático do estado anterior de todos os arquivos antes de commitar
  const snapshotFiles = (files ?? []).map(f => ({ path: f.path, content: f.deleted ? null : (f.base_content ?? f.content) }));
  const backupRes = await db.from("code_project_backups").insert({
    user_id: userId,
    project_id: p.id,
    commit_sha: p.base_sha,
    parent_sha: p.base_sha,
    message,
    files_count: snapshotFiles.length,
    files_snapshot: snapshotFiles,
  }).select("id").single();

  const token = await getToken(db, userId);
  const sha = await commitChanges(token, p.repo_full_name, p.branch, message,
    changed.map((f) => ({ path: f.path, content: f.deleted ? null : f.content })));
  const gone = changed.filter((f) => f.deleted).map((f) => f.id);
  if (gone.length) await db.from("code_files").delete().in("id", gone);
  for (const f of changed.filter((f) => !f.deleted)) await db.from("code_files").update({ base_content: f.content }).eq("id", f.id);
  await db.from("code_files").delete().eq("project_id", p.id).eq("deleted", true).is("base_content", null);
  await db.from("code_projects").update({ base_sha: sha, updated_at: new Date().toISOString() }).eq("id", p.id);
  return { sha, count: changed.length, backupId: backupRes.data?.id ?? null, message };
}
