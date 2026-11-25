import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { ChatMessage } from "@/types/chat";
import { z } from "zod";
import { sortConversations } from "./conversations";

const conversationId = z.object({ id: z.string().uuid() });

export const listConversations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.from("conversations")
      .select("id,title,is_pinned,updated_at").eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return sortConversations(data ?? []);
  });

export const createConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.from("conversations")
      .insert({ user_id: context.userId, title: "Novo chat" }).select("id").single();
    if (error) throw new Error(error.message);
    return data;
  });

export const updateConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid(), title: z.string().trim().min(1).max(80).optional(), is_pinned: z.boolean().optional() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("conversations").update({
      ...(data.title !== undefined ? { title: data.title, title_manual: true } : {}),
      ...(data.is_pinned !== undefined ? { is_pinned: data.is_pinned } : {}),
    }).eq("id", data.id).eq("user_id", context.userId).select("id").single();
    if (error) throw new Error("Não foi possível atualizar este chat.");
    return { ok: true };
  });

export const deleteConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => conversationId.parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("conversations").delete()
      .eq("id", data.id).eq("user_id", context.userId).select("id").single();
    if (error) throw new Error("Não foi possível excluir este chat.");
    return { ok: true };
  });

/** Histórico de uma conversa que pertence ao usuário autenticado. */
export const getChatHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => conversationId.parse(input))
  .handler(async ({ data: input, context }) => {
    const conv = await context.supabase.from("conversations").select("id,title,is_pinned,updated_at")
      .eq("id", input.id).eq("user_id", context.userId).single();
    if (conv.error) throw new Error("Chat não encontrado ou excluído.");
    const { data, error } = await context.supabase
      .from("messages")
      .select("id, role, content, created_at")
      .eq("user_id", context.userId)
      .eq("conversation_id", input.id)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return { conversation: conv.data, messages: (data ?? []) as ChatMessage[] };
  });
