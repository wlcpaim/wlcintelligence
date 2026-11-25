import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const svc = () => import("../services/versions.server");
const idSchema = z.object({ id: z.string().uuid() });

export const listChatVersions = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => (await svc()).listVersions(context.supabase, context.userId));

export const syncChatVersions = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => (await svc()).syncVersions(context.supabase, context.userId));

export const createChatVersion = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ name: z.string().trim().min(2).max(60) }).parse(i))
  .handler(async ({ data, context }) => (await svc()).createVersion(context.supabase, context.userId, data.name));

export const createPresetChatVersion = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ presetId: z.enum(["frontend", "backend", "debug", "security", "data"]) }).parse(i))
  .handler(async ({ data, context }) => (await svc()).createPresetVersion(context.supabase, context.userId, data.presetId));

export const deleteChatVersion = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => idSchema.parse(i))
  .handler(async ({ data, context }) => (await svc()).deleteVersion(context.supabase, context.userId, data.id));

export const getTrainingHistory = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => idSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase.from("version_training_messages").select("id,role,content,created_at")
      .eq("version_id", data.id).eq("user_id", context.userId).order("created_at");
    if (error) throw new Error(error.message);
    return rows;
  });

export const trainChatVersion = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid(), message: z.string().trim().min(1).max(20_000) }).parse(i))
  .handler(async ({ data, context }) => {
    try {
      const signal = AbortSignal.any([getRequest().signal, AbortSignal.timeout(90_000)]);
      const r = await (await svc()).trainVersion(context.supabase, context.userId, data.id, data.message, signal);
      return { ok: true as const, reply: r.reply, added: r.added.length, syncError: r.version.sync_error };
    } catch (e) { return { ok: false as const, error: e instanceof Error ? e.message : "Falha no treino." }; }
  });

export const removeVersionRule = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid(), ruleId: z.string().min(1).max(100) }).parse(i))
  .handler(async ({ data, context }) => { await (await svc()).removeRule(context.supabase, context.userId, data.id, data.ruleId); return { ok: true }; });

export const getBaseVersionFile = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .handler(async () => ({ content: (await svc()).baseVersionFile() }));

export const importChatVersion = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ content: z.string().min(2).max(1_000_000), id: z.string().uuid().optional() }).parse(i))
  .handler(async ({ data, context }) => (await svc()).importVersion(context.supabase, context.userId, data.content, data.id));
