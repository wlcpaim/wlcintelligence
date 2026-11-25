import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { listBackups, revertBackup } from "../services/backup.server";

export const listProjectBackups = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ projectId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    try {
      const items = await listBackups(context.supabase, context.userId, data.projectId);
      return { ok: true as const, items };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : "Erro ao listar backups" };
    }
  });

export const revertProjectBackup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ backupId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    try {
      const r = await revertBackup(context.supabase, context.userId, data.backupId);
      return { ok: true as const, sha: r.sha };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : "Erro ao reverter backup" };
    }
  });
