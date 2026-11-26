// Commit das alterações salvas de um projeto (usado pelo botão Commit e pelo Deploy).
import type { Db } from "@/modules/integrations/core/runs.server";
import { getToken } from "@/modules/integrations/github/services/connection.server";
import { commitChanges } from "./github-write.server";

/** Envia tudo que mudou em um único commit; devolve null quando não há alterações. */
export async function commitPending(db: Db, userId: string, projectId: string, message: string) {
  const { data: p, error } = await db.from("code_projects").select("*").eq("id", projectId).eq("user_id", userId).single();
  if (error || !p) throw new Error("Projeto não encontrado.");
  if (!p.repo_full_name || !p.branch) throw new Error("Vincule um repositório antes do commit.");
  const { data: lease, error: leaseError } = await db.rpc("begin_project_commit", { p_project_id: projectId });
  if (leaseError || typeof lease !== "string") throw new Error(leaseError?.message ?? "Não foi possível reservar o commit.");
  try {
  const files = [];
  for (let from = 0; ; from += 1000) {
    const { data: page, error: e2 } = await db.from("code_files").select("id,path,content,base_content,deleted,updated_at").eq("project_id", p.id).eq("user_id", userId).order("id").range(from, from + 999);
    if (e2) throw new Error(e2.message);
    files.push(...page ?? []);
    if ((page?.length ?? 0) < 1000) break;
  }
  const changed = (files ?? []).filter((f) => (f.deleted ? f.base_content !== null : f.content !== f.base_content));
  if (!changed.length) return null;

  // Snapshot automático do estado anterior de todos os arquivos antes de commitar
  const snapshotFiles = (files ?? []).map(f => ({ path: f.path, content: f.deleted ? null : (f.base_content ?? f.content) }));
  const token = await getToken(db, userId);
  const backupRes = await db.from("code_project_backups").insert({
    user_id: userId,
    project_id: p.id,
    commit_sha: p.base_sha,
    parent_sha: p.base_sha,
    message,
    files_count: snapshotFiles.length,
    files_snapshot: snapshotFiles,
  }).select("id").single();

  if (backupRes.error) throw new Error("Backup não salvo; commit cancelado antes de enviar ao GitHub.");
  const sha = await commitChanges(token, p.repo_full_name, p.branch, message,
    changed.map((f) => ({ path: f.path, content: f.deleted ? null : f.content })), p.base_sha);
  const recorded = await db.rpc("complete_project_commit", {
    p_project_id: projectId, p_lease_id: lease, p_sha: sha,
    p_files: changed.map(f => ({ id: f.id, content: f.content, deleted: f.deleted, updated_at: f.updated_at })),
  });
  if (recorded.error) throw new Error(`GitHub aceitou o commit ${sha.slice(0, 7)}, mas o registro local falhou; sincronize antes de tentar novamente.`);

  // Fallback explícito: garante base_content = content para zerar o contador de pendentes
  // mesmo se o RPC tiver falhado parcialmente em alguma linha (RLS/id/cast).
  for (const f of changed) {
    if (f.deleted) {
      await db.from("code_files").delete().eq("id", f.id).eq("user_id", userId).eq("project_id", projectId);
    } else {
      const { error: syncErr } = await db
        .from("code_files")
        .update({ base_content: f.content, deleted: false })
        .eq("id", f.id)
        .eq("user_id", userId)
        .eq("project_id", projectId);
      if (syncErr) {
        // Não desfaz o commit no GitHub; sinaliza para o caller recarregar/sincronizar
        throw new Error(
          `Commit ${sha.slice(0, 7)} no GitHub ok, mas não foi possível marcar "${f.path}" como sincronizado. Atualize a página ou sincronize.`,
        );
      }
    }
  }

  return { sha, count: changed.length, backupId: backupRes.data?.id ?? null, message };
  } finally {
    await db.rpc("release_project_commit", { p_project_id: projectId, p_lease_id: lease });
  }
}
