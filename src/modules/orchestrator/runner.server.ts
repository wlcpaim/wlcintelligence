// Ciclo real dos bots: cada bot pensa, usa SUAS ferramentas e entrega um relatório.
import type { Db } from "@/modules/integrations/core/runs.server";
import { openChatStream } from "@/modules/integrations/gemini/services/chat-stream.server";
import { textFromGeminiChunk } from "@/services/gemini.server";
import type { RoutePlan } from "./orchestrator";
import { BOT_TOOLS, parseBotStep } from "./tools";
import { clearWriteClaims } from "./tools.server";
import { openWorkspace, runTool } from "./tools.server";

const MAX_STEPS = 5;

async function complete(db: Db, userId: string, instruction: string, history: { role: string; content: string }[], signal: AbortSignal): Promise<string> {
  const opened = await openChatStream(db, userId, history, signal, false, { instruction, maxOutputTokens: 12_000, responseMimeType: "application/json" });
  if (!opened.ok) throw new Error(opened.error);
  if (!opened.response.body) return "";
  const reader = opened.response.body.getReader();
  const dec = new TextDecoder();
  let pending = "", out = "";
  const take = (l: string) => { const t = l.trim(); if (t.startsWith("data:")) out += textFromGeminiChunk(t.slice(5).trim()); };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      pending += dec.decode(value, { stream: true });
      let i: number;
      while ((i = pending.indexOf("\n")) >= 0) { take(pending.slice(0, i)); pending = pending.slice(i + 1); }
    }
    take(pending);
  } finally { await reader.cancel().catch(() => {}); }
  return out;
}

export type BotEvent = (line: string) => void;

/** Executa a esteira; devolve o diário de trabalho real para o maestro consolidar. */
export async function runBots(db: Db, userId: string, plan: RoutePlan, request: string, signal: AbortSignal, onEvent: BotEvent): Promise<string> {
  const ws = await openWorkspace(db, userId);
  onEvent(ws.projectName ? `📂 Área de trabalho: projeto **${ws.projectName}**` : "📂 Nenhum projeto em Code: bots trabalham só com banco e deploys.");
  const reports: string[] = [];
  for (const agent of plan.agents) {
    const tools = BOT_TOOLS[agent.role];
    const instruction = `Você é o Bot ${agent.name} (${agent.languages}) da WLC 1.7.1 PRO. Missão: ${agent.mission}
Ferramentas disponíveis SOMENTE para você: ${tools.join(", ")}.
- list_files {} · read_file {"path"} · write_file {"path","content"} (conteúdo COMPLETO; só na sua área) · inspect_schema {} · apply_migration {"sql"?,"path"?} (executa migrações SQL no banco com privilégios DDL totais via admin) · list_deploys {} · deploy_logs {} · setup_runner {} · run_command {"command"} (executa de verdade numa VM Ubuntu do GitHub Actions com Node 20, Bun, Python 3.11; ex.: "npx vitest run", "pytest", "go test ./...") · run_status {"run_id"} · run_logs {"run_id"?}
A cada passo responda só JSON: {"tool":"nome","args":{...}} para agir, ou {"done":true,"report":"o que você fez de verdade, em português"} ao terminar.
Use no máximo ${MAX_STEPS} ações. Nunca invente resultados de ferramentas.`;
    const history: { role: string; content: string }[] = [{ role: "user", content: JSON.stringify({ pedido: request, relatorios_anteriores: reports }) }];
    onEvent(`🤖 **Bot ${agent.name}** começou`);
    let report = "";
    for (let step = 0; step <= MAX_STEPS; step++) {
      signal.throwIfAborted();
      const raw = await complete(db, userId, instruction, history, signal);
      const decision = parseBotStep(raw, agent.role);
      if (decision.kind === "done" || step === MAX_STEPS) { report = decision.kind === "done" ? decision.report : "Limite de ações atingido."; break; }
      let result: string;
      try { result = await runTool(ws, agent.role, decision.tool, decision.args); }
      catch (e) { result = `Erro: ${e instanceof Error ? e.message : "falha"}`; }
      onEvent(`   🛠️ ${decision.tool}${(decision.args["path"] ?? decision.args["command"]) ? ` \`${decision.args["path"] ?? decision.args["command"]}\`` : ""} → ${result.split("\n")[0]?.slice(0, 120) ?? ""}`);
      history.push({ role: "model", content: raw }, { role: "user", content: JSON.stringify({ resultado: result }) });
    }
    reports.push(`Bot ${agent.name}: ${report}`);
    onEvent(`✅ **Bot ${agent.name}** terminou`);
  }
  return reports.join("\n\n");
}
