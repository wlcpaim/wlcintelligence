import type { Db } from "@/modules/integrations/core/runs.server";
import { getToken } from "@/modules/integrations/github/services/connection.server";
import { commitChanges, ghCall } from "./github-write.server";

export interface BackupItem {
  id: string;
  project_id: string;
  commit_sha: string | null;
  parent_sha: string | null;
  message: string;
  files_count: number;
  created_at: string;
}

export async function listBackups(db: Db, userId: string, projectId: string): Promise<BackupItem[]> {
  const { data, error } = await db
    .from("code_project_backups")
    .select("id, project_id, commit_sha, parent_sha, message, files_count, created_at")
    .eq("user_id", userId)
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function revertBackup(db: Db, userId: string, backupId: string) {
  const { data: b, error } = await db
    .from("code_project_backups")
    .select("*")
    .eq("id", backupId)
    .eq("user_id", userId)
    .single();
  if (error || !b) throw new Error("Backup não encontrado.");

  const { data: p, error: pe } = await db
    .from("code_projects")
    .select("*")
    .eq("id", b.project_id)
    .single();
  if (pe || !p) throw new Error("Projeto não encontrado.");

  const snapshot = b.files_snapshot as { path: string; content: string | null }[];

  // Atualiza code_files com o snapshot do backup
  await db.from("code_files").delete().eq("project_id", p.id);
  if (snapshot.length > 0) {
    const rows = snapshot.map(f => ({
      project_id: p.id,
      user_id: userId,
      path: f.path,
      content: f.content ?? "",
      base_content: f.content,
      deleted: false,
    }));
    for (let i = 0; i < rows.length; i += 200) {
      const { error: insErr } = await db.from("code_files").insert(rows.slice(i, i + 200));
      if (insErr) throw new Error(insErr.message);
    }
  }

  let sha = p.base_sha;
  if (p.repo_full_name && p.branch) {
    const token = await getToken(db, userId);
    if (b.commit_sha) {
      try {
        const orig = await ghCall<{ tree: { sha: string } }>(token, "GET", `/repos/${p.repo_full_name}/git/commits/${b.commit_sha}`);
        let parent: string | null = null;
        try {
          parent = (await ghCall<{ object: { sha: string } }>(token, "GET", `/repos/${p.repo_full_name}/git/ref/heads/${encodeURIComponent(p.branch)}`)).object.sha;
        } catch {}
        const newCommit = await ghCall<{ sha: string }>(token, "POST", `/repos/${p.repo_full_name}/git/commits`, {
          message: `Rollback: Restaurado para backup ${b.commit_sha.slice(0, 7)}`,
          tree: orig.tree.sha,
          parents: parent ? [parent] : []
        });
        await ghCall(token, "PATCH", `/repos/${p.repo_full_name}/git/refs/heads/${encodeURIComponent(p.branch)}`, { sha: newCommit.sha });
        sha = newCommit.sha;
      } catch {
        sha = await commitChanges(
          token,
          p.repo_full_name,
          p.branch,
          `Rollback: Restaurado para backup ${b.commit_sha ? b.commit_sha.slice(0, 7) : b.id.slice(0, 7)}`,
          snapshot.map(f => ({ path: f.path, content: f.content }))
        );
      }
    } else {
      sha = await commitChanges(
        token,
        p.repo_full_name,
        p.branch,
        `Rollback: Restaurado para backup ${b.id.slice(0, 7)}`,
        snapshot.map(f => ({ path: f.path, content: f.content }))
      );
    }
  }

  await db.from("code_projects").update({
    base_sha: sha,
    updated_at: new Date().toISOString(),
  }).eq("id", p.id);

  return { ok: true, sha };
}
