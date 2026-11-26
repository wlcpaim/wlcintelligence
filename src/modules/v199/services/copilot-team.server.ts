// Copilot da WLC 1.9.9 no Code: roda o time (Arquiteto → especialistas → Análise) em modo
// "propor", sem gravar nada. O resultado volta no mesmo formato do Pro (CopilotAnswer),
// então o painel mostra o diff e o usuário aplica com a checagem de conflito já existente.
import type { Db } from "@/modules/integrations/core/runs.server";
import { redactSecrets } from "@/modules/integrations/github/services/repository.server";
import { copilotPath, rankCopilotFiles, type CopilotAnswer } from "@/modules/code/copilot";
import { buildProposal } from "../core/proposal";
import { runHybridTeam } from "./runner.server";

const MAX_READ_FILES = 25;
const READ_BUDGET = 100_000; // caracteres enviados a CADA bot
const MAX_PATHS = 500;
const SUMMARY_LIMIT = 5_500;

export async function generateTeamCopilot(
  db: Db,
  userId: string,
  projectId: string,
  message: string,
  activePath: string | null,
  history: { role: "user" | "model"; content: string }[],
  signal: AbortSignal,
  deadline?: number,
): Promise<CopilotAnswer> {
  const { data: project } = await db.from("code_projects").select("id,name").eq("id", projectId).eq("user_id", userId).single();
  if (!project) throw new Error("Projeto não encontrado.");

  const files: { path: string; content: string; updated_at: string; deleted: boolean }[] = [];
  for (let from = 0; ; from += 1000) {
    const r = await db.from("code_files").select("path,content,updated_at,deleted").eq("project_id", projectId).eq("user_id", userId).order("path").range(from, from + 999);
    if (r.error) throw new Error("Não foi possível ler o projeto.");
    files.push(...r.data);
    if (r.data.length < 1000) break;
  }
  const visible = files.filter((f) => !f.deleted && copilotPath(f.path));
  const safe = (f: { content: string }) => f.content.length <= 80_000 && !f.content.includes("\0") && redactSecrets(f.content) === f.content;

  // Arquivos lidos: o ativo primeiro, depois os que mais combinam com o pedido.
  let budget = READ_BUDGET;
  const included = new Map<string, (typeof visible)[number]>();
  for (const f of rankCopilotFiles(visible, message, activePath)) {
    if (included.has(f.path) || !safe(f)) continue;
    const size = f.path.length + f.content.length + 50;
    if (size > budget) continue;
    budget -= size;
    included.set(f.path, f);
    if (included.size >= MAX_READ_FILES) break;
  }

  const recent = history.slice(-4).map((h) => `${h.role === "user" ? "Usuário" : "Copilot"}: ${redactSecrets(h.content).slice(0, 500)}`);
  const request = recent.length
    ? `${redactSecrets(message)}\n\n(Contexto recente da conversa)\n${recent.join("\n")}`
    : redactSecrets(message);

  const log: string[] = [];
  const team = await runHybridTeam(db, userId, request, signal, (line) => log.push(line), {
    apply: false,
    existingFiles: [...included.values()].map((f) => ({ path: f.path, content: f.content })),
    existingPaths: visible.map((f) => f.path).slice(0, MAX_PATHS),
    ...(deadline !== undefined ? { deadline } : {}),
  });
  if (!team.plan) throw new Error(team.summary);

  const current = new Map(files.filter((f) => !f.deleted).map((f) => [f.path, { content: f.content, updated_at: f.updated_at }]));
  const { changes, notes } = buildProposal(team.changes, current, new Set(included.keys()));

  const teamLines = log.filter((l) => /^(✅|❌|⚠️|\s+↳)/.test(l)).map((l) => `- ${l.trim()}`);
  const parts = [
    team.summary,
    teamLines.length ? `**Time:**\n${teamLines.join("\n")}` : "",
    notes.length ? `**Avisos:**\n${notes.map((n) => `- ${n}`).join("\n")}` : "",
  ].filter(Boolean);
  const summary = parts.join("\n\n").slice(0, SUMMARY_LIMIT);
  return { summary, changes, coverage: { read: included.size, total: visible.length } };
}
