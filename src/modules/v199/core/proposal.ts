/**
 * Converte o que o time/diagnóstico devolveu em proposta segura para o painel do Copilot.
 * Nada é gravado aqui: o usuário revisa o diff e aplica com a checagem de conflito existente.
 */
import { redactSecrets } from "@/modules/integrations/github/services/repository.server";
import { copilotPath, type CopilotAnswer } from "@/modules/code/copilot";
import { normalizePath } from "@/modules/code/file-types";

export const MAX_PROPOSAL_CHANGES = 30;

export function buildProposal(
  raw: { path: string; content: string }[],
  current: Map<string, { content: string; updated_at: string }>,
  readPaths: Set<string>,
): { changes: CopilotAnswer["changes"]; notes: string[] } {
  const notes: string[] = [];
  const changes: CopilotAnswer["changes"] = [];
  for (const c of raw) {
    const path = normalizePath(c.path.trim().replace(/^(\.\/)+/, ""));
    if (!path || !copilotPath(path)) { notes.push(`Ignorado ${c.path}: caminho protegido ou inválido.`); continue; }
    const original = current.get(path) ?? null;
    if (original && !readPaths.has(path)) { notes.push(`Ignorado ${path}: arquivo existente que não foi lido.`); continue; }
    if (c.content.length > 80_000 || redactSecrets(c.content) !== c.content) { notes.push(`Ignorado ${path}: grande demais ou com credencial.`); continue; }
    if (original && original.content === c.content) continue;
    if (changes.length >= MAX_PROPOSAL_CHANGES) { notes.push(`Ignorado ${path}: limite de ${MAX_PROPOSAL_CHANGES} arquivos por proposta.`); continue; }
    changes.push({ path, content: c.content, before: original?.content ?? null, expectedUpdatedAt: original?.updated_at ?? null });
  }
  return { changes, notes };
}
