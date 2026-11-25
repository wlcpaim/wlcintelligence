import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export interface WorkspaceFile {
  id: string; path: string; content: string; base_content: string | null;
  deleted: boolean; updated_at: string;
}

export async function readWorkspaceFiles(db: SupabaseClient<Database>, projectId: string): Promise<WorkspaceFile[]> {
  const files: WorkspaceFile[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("code_files")
      .select("id,path,content,base_content,deleted,updated_at")
      .eq("project_id", projectId).order("path").range(from, from + 999);
    if (error) throw new Error("Não foi possível sincronizar os arquivos. Suas edições foram preservadas.");
    files.push(...data);
    if (data.length < 1000) return files;
  }
}

/** Keep writes made during the read, including newly created files and local deletions. */
export function mergeWorkspaceFiles(
  remote: WorkspaceFile[], current: WorkspaceFile[], started: WorkspaceFile[], protectedIds: ReadonlySet<string>,
): WorkspaceFile[] {
  const before = new Map(started.map(file => [file.id, file]));
  const local = new Map(current.map(file => [file.id, file]));
  const keep = new Map(current.filter(file => {
    const initial = before.get(file.id);
    return protectedIds.has(file.id) || !initial || initial.content !== file.content
      || initial.updated_at !== file.updated_at || initial.deleted !== file.deleted;
  }).map(file => [file.id, file]));
  const merged = remote.filter(file => !before.has(file.id) || local.has(file.id))
    .map(file => keep.get(file.id) ?? file);
  const ids = new Set(merged.map(file => file.id));
  for (const file of keep.values()) if (!ids.has(file.id)) merged.push(file);
  return merged.sort((a, b) => a.path.localeCompare(b.path));
}