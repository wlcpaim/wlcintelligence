/**
 * Serviço de chat da WLC 1.1.0 System.
 * Salva o histórico em messages, guarda o plano pendente e executa operações reais.
 * Isolado — zero import de Gemini.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { plan } from "../core/cognitive";
import { execute, type ExecutionResult } from "../core/executor";
import { SYSTEM_GREETING, SYSTEM_VERSION } from "../identity";
import { loadSession, saveSession } from "./session.server";

export interface SystemChatInput {
  message: string;
  userId: string;
  conversationId?: string | undefined;
  confirm?: boolean | undefined;
  authToken?: string | undefined;
  db?: SupabaseClient<Database> | undefined;
  projectId?: string | undefined;
  sessionKey?: string | undefined;
  /** Who sent the command (e.g. wlc-code, lovable-agent); shared per project in system_events. */
  source?: string | undefined;
}

export interface SystemChatOutput {
  reply: string;
  version: typeof SYSTEM_VERSION;
  result: ExecutionResult;
  greeting?: boolean;
}

export const CONFIRM_RE = /^(confirmar|confirmo|sim|yes|y|confirm|ok|pode|execute|executar)$/i;
export const CANCEL_RE = /^(cancelar|cancela|não|nao|no|n|cancel)$/i;

export async function handleSystemMessage(input: SystemChatInput): Promise<SystemChatOutput> {
  const text = input.message.trim();
  const out = (result: ExecutionResult, extra: Partial<SystemChatOutput> = {}): SystemChatOutput =>
    ({ reply: result.text, version: SYSTEM_VERSION, result, ...extra });
  if (!text) return out({ ok: true, text: SYSTEM_GREETING }, { greeting: true });

  const db = input.db;
  const key = input.sessionKey ?? input.conversationId ?? "default";
  const session = db ? await loadSession(db, input.userId, key) : { activeProjectId: null, pendingPlan: null };

  if (db && input.conversationId) {
    await db.from("messages").insert({ conversation_id: input.conversationId, user_id: input.userId, role: "user", content: text });
  }

  let result: ExecutionResult;
  if (input.projectId && session.activeProjectId && input.projectId !== session.activeProjectId) {
    session.pendingPlan = null;
  }
  const ctx = { userId: input.userId, conversationId: input.conversationId, authToken: input.authToken, db, projectId: input.projectId ?? session.activeProjectId, sessionKey: key };
  if (CONFIRM_RE.test(text) || input.confirm) {
    result = session.pendingPlan
      ? await execute(session.pendingPlan, { ...ctx, confirmed: true })
      : { ok: true, text: "Nenhuma ação pendente para confirmar." };
    session.pendingPlan = null;
  } else if (CANCEL_RE.test(text)) {
    result = { ok: true, text: session.pendingPlan ? `Cancelado: ${session.pendingPlan.summary}` : "Nada para cancelar." };
    session.pendingPlan = null;
  } else {
    const p = plan(text);
    result = await execute(p, { ...ctx, confirmed: false });
    if (p.intent !== "CONNECT") session.pendingPlan = result.requiresConfirm ? p : null;
  }
  if (result.activeProjectId) session.activeProjectId = result.activeProjectId;

  if (db) {
    await saveSession(db, input.userId, key, session);
    const eventProject = result.activeProjectId ?? ctx.projectId;
    if (eventProject) {
      const source = input.source ?? "system";
      await db.from("system_events").insert([
        { user_id: input.userId, project_id: eventProject, source, role: "user", content: text },
        { user_id: input.userId, project_id: eventProject, source, role: "model", content: result.text },
      ]);
    }
    if (input.conversationId) {
      await db.from("messages").insert({ conversation_id: input.conversationId, user_id: input.userId, role: "model", content: result.text });
      await db.from("conversations").update({ updated_at: new Date().toISOString() }).eq("id", input.conversationId);
    }
  }
  return out(result);
}
