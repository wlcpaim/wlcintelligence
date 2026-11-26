import type { Db } from "@/modules/integrations/core/runs.server";
import { commitPending } from "./commit.server";
import { runQualityGate } from "@/modules/engineering/kernel";
import { inspectContracts } from "@/modules/v199/core/contracts";
import { diagnoseBuildReadiness } from "@/modules/v199/core/bootstrap";
import { readGeneratedManifest, type GeneratedFile } from "@/modules/engineering/generated-app-contract";

export async function syncGeneratedProject(db: Db, userId: string, projectId: string) {
  const { data: project, error } = await db.from("code_projects").select("repo_full_name").eq("id", projectId).eq("user_id", userId).single();
  if (error || !project) throw new Error("Não foi possível ler o destino GitHub do projeto.");
  if (!project.repo_full_name) return null;
  const files: GeneratedFile[] = [];
  for (let from = 0; ; from += 1000) {
    const r = await db.from("code_files").select("path,content").eq("project_id", projectId).eq("user_id", userId).eq("deleted", false).order("id").range(from, from + 999);
    if (r.error || !r.data) throw new Error("Não foi possível validar os arquivos salvos antes do commit.");
    files.push(...r.data);
    if (r.data.length < 1000) break;
  }
  if (!files.length) return null;
  const gate = runQualityGate({ snapshot: files, changes: [], operation: "syncGeneratedProject" });
  if (!gate.ready || inspectContracts(files).issues.length || diagnoseBuildReadiness(files).length) {
    throw new Error("Auto-commit adiado: arquivos salvos ainda têm pendências de integridade.");
  }
  readGeneratedManifest(files);
  return commitPending(db, userId, projectId, "feat: geração validada pelo WLC IA");
}