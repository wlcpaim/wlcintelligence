import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { GEMINI_MODEL, activeModel } from "@/config/app";
import {
  listKeys,
  addKey,
  revealKey,
  setPrimary,
  patchKey,
  deleteKey,
} from "../services/keys.server";
import { diagnoseKey } from "../services/diagnostics.server";
import { logRun } from "../../core/runs.server";
import { safeMessage } from "../../core/errors";
import type { GeminiRunView } from "../types";
import { KEY_PATTERN } from "../parse-keys";
import { failedStatus } from "../services/rotation";

const id = z.object({ id: z.string().uuid() });
const meta = {
  label: z.string().trim().min(1).max(80),
  google_project: z.string().trim().max(120),
  model: z
    .string()
    .trim()
    .regex(/^[\w.-]{1,80}$/),
};

export const listGeminiKeys = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const keys = await listKeys(context.supabase, context.userId);
    const { data } = await context.supabase
      .from("integration_runs")
      .select("id,kind,ok,http_status,detail,key_id,created_at")
      .eq("user_id", context.userId)
      .eq("provider", "gemini")
      .order("created_at", { ascending: false })
      .limit(20);
    return { keys, runs: (data ?? []) as GeminiRunView[], defaultModel: GEMINI_MODEL };
  });

export const addGeminiKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ ...meta, apiKey: z.string().trim().min(20).max(300) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const k = await addKey(context.supabase, context.userId, data);
    return { id: k.id };
  });

/** Cadastro em lote: nome automático, primeira vira principal (se não houver), demais reservas. */
export const addGeminiKeysBulk = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ keys: z.array(z.string().trim().regex(KEY_PATTERN).max(300)).min(1).max(50) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const existing = await listKeys(context.supabase, context.userId);
    const ids: string[] = [];
    let n = existing.length;
    for (const apiKey of data.keys) {
      n += 1;
      const k = await addKey(context.supabase, context.userId, {
        label: `Gemini #${n}`,
        google_project: "",
        model: GEMINI_MODEL,
        apiKey,
      });
      ids.push(k.id);
    }
    return { ids };
  });

export const updateGeminiKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid(), ...meta }).parse(d))
  .handler(async ({ data: { id: keyId, ...rest }, context }) => {
    await patchKey(context.supabase, context.userId, keyId, rest);
    return { ok: true };
  });

export const toggleGeminiKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ id: z.string().uuid(), enabled: z.boolean() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await patchKey(context.supabase, context.userId, data.id, {
      enabled: data.enabled,
      cooldown_until: null,
    });
    return { ok: true };
  });

export const makePrimaryGeminiKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => id.parse(d))
  .handler(async ({ data, context }) => {
    await setPrimary(context.supabase, context.userId, data.id);
    return { ok: true };
  });

export const deleteGeminiKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => id.parse(d))
  .handler(async ({ data, context }) => {
    await deleteKey(context.supabase, context.userId, data.id);
    return { ok: true };
  });

export const diagnoseGeminiKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => id.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase: db, userId } = context;
    const { data: row, error } = await db
      .from("gemini_keys")
      .select("model")
      .eq("user_id", userId)
      .eq("id", data.id)
      .single();
    if (error) throw new Error("Chave não encontrada.");
    let report;
    try {
      // diagnoseKey já aplica activeModel + cadeia de fallback internamente
      report = await diagnoseKey(await revealKey(db, userId, data.id), row.model);
    } catch (e) {
      report = {
        ok: false,
        ranAt: new Date().toISOString(),
        httpStatus: null,
        checks: [{ name: "Descriptografia", ok: false, detail: safeMessage(e) }],
      };
    }
    const failed = report.checks.find((c) => !c.ok);
    await patchKey(db, userId, data.id, {
      status: report.ok ? "connected" : failedStatus(report.httpStatus),
      ...(!report.ok ? { is_primary: false, cooldown_until: new Date(Date.now() + 60_000).toISOString() } : {}),
      last_error: failed ? safeMessage(failed.detail) : null,
      last_checked_at: report.ranAt,
      // Atualiza o model da chave para o que realmente funcionou
      ...(report.ok && report.resolvedModel ? { model: report.resolvedModel, cooldown_until: null } : {}),
      ...(report.ok && !report.resolvedModel ? { cooldown_until: null } : {}),
    });
    await logRun(db, userId, {
      provider: "gemini",
      kind: "diagnostic",
      ok: report.ok,
      key_id: data.id,
      http_status: report.httpStatus,
      detail: failed?.detail ?? "Todos os testes passaram",
    });
    return report;
  });
