/**
 * Bridge de comandos entre bots.
 * Outros bots (Lite, Pro, bots externos) podem enviar comandos diretos
 * para a WLC 1.1.0 System via este canal.
 *
 * Autenticação: Bearer token do usuário (mesmo nível Owner).
 * O System executa com autoridade máxima, isolado do Gemini.
 */

import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { plan } from "../core/cognitive";
import { handleSystemMessage } from "../services/system-chat.server";
import { SYSTEM_VERSION } from "../identity";

export const bridgeCommandSchema = z.object({
  /** Identificador do bot que está enviando o comando. */
  sourceBot: z.string().min(1).max(80),
  /** Comando em texto livre ou estruturado. */
  command: z.string().trim().min(1).max(50_000),
  /** Se true, a System trata como já confirmado (usar com cuidado). */
  confirmed: z.boolean().default(false),
  /** Contexto da sessão, sem credenciais. */
  meta: z.object({ projectId: z.string().uuid().optional(), conversationId: z.string().uuid().optional(), sessionKey: z.string().min(1).max(160).optional() }).optional(),
});

export type BridgeCommand = z.infer<typeof bridgeCommandSchema>;

export interface BridgeResult {
  ok: boolean;
  sourceBot: string;
  systemVersion: typeof SYSTEM_VERSION;
  reply: string;
  data?: Record<string, unknown>;
  error?: string;
}

/**
 * Processa um comando vindo de outro bot.
 * Mesma autoridade Owner do chat humano.
 */
export async function handleBridgeCommand(
  payload: BridgeCommand,
  userId: string,
  authToken?: string,
  db?: SupabaseClient<Database>,
): Promise<BridgeResult> {
  const parsed = bridgeCommandSchema.safeParse(payload);
  if (!parsed.success) {
    return {
      ok: false,
      sourceBot: payload?.sourceBot ?? "unknown",
      systemVersion: SYSTEM_VERSION,
      reply: "Payload de bridge inválido.",
      error: parsed.error.message,
    };
  }

  const { sourceBot, command, confirmed, meta } = parsed.data;
  const cognitivePlan = plan(command);

  const output = await handleSystemMessage({
    message: command, userId, authToken, db,
    projectId: meta?.projectId,
    conversationId: meta?.conversationId,
    sessionKey: meta?.sessionKey ?? meta?.conversationId ?? (meta?.projectId ? `project:${meta.projectId}` : `bridge:${sourceBot}`),
    source: sourceBot,
    // A confirmation executes only the previously stored plan, never a replacement command.
    confirm: confirmed,
  });
  const result = output.result;

  return {
    ok: result.ok,
    sourceBot,
    systemVersion: SYSTEM_VERSION,
    reply: result.text,
    data: {
      intent: cognitivePlan.intent,
      requiresConfirm: result.requiresConfirm,
      confirmToken: result.confirmToken,
      ...result.data,
    },
  };
}
