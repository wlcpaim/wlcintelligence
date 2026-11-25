// Diagnóstico de Deploy no Copilot: roda build/testes no WLC Runner e devolve a proposta de correção
// no mesmo formato do Pro/Time (o usuário revisa o diff e aplica; nada é gravado aqui).
import type { Db } from "@/modules/integrations/core/runs.server";
import type { CopilotAnswer } from "@/modules/code/copilot";
import { buildProposal } from "../core/proposal";
import { diagnoseWithRunner } from "./diagnostics.server";

export async function generateDiagnosticsCopilot(
  db: Db, userId: string, projectId: string, signal: AbortSignal,
): Promise<CopilotAnswer> {
  const result = await diagnoseWithRunner(db, userId, projectId, signal);
  const { data } = await db.from("code_files").select("path,content,updated_at,deleted").eq("project_id", projectId).eq("user_id", userId).limit(3000);
  const current = new Map((data ?? []).filter((f) => !f.deleted).map((f) => [f.path, { content: f.content, updated_at: f.updated_at }]));
  const { changes, notes } = buildProposal(result.changes, current, new Set(result.readPaths));
  const summary = notes.length ? `${result.summary}\n\n**Avisos:**\n${notes.map((n) => `- ${n}`).join("\n")}` : result.summary;
  return { summary: summary.slice(0, 5_500), changes, coverage: { read: result.readPaths.length, total: current.size } };
}
