import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  connect,
  disconnect,
  getAccount,
  getToken,
  patchAccount,
  identify,
} from "../services/connection.server";
import { fetchRepos, fetchRepo, deleteRepo } from "../services/api.server";
import { repositoryDeletionSchema } from "../deletion";
import { diagnoseGithub } from "../services/diagnostics.server";
import { logRun } from "../../core/runs.server";
import { safeMessage } from "../../core/errors";

const tokenSchema = z.object({
  token: z
    .string()
    .trim()
    .regex(/^(ghp_|github_pat_|gho_|ghu_)[\w]{20,255}$/, "Token GitHub em formato inválido"),
});

async function selected(
  db: Parameters<typeof getAccount>[0],
  userId: string,
): Promise<string | null> {
  const { data } = await db
    .from("github_selection")
    .select("repo_full_name")
    .eq("user_id", userId)
    .maybeSingle();
  return data?.repo_full_name ?? null;
}

export const getGithubState = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const account = await getAccount(context.supabase, context.userId);
    return { account, selected: account ? await selected(context.supabase, context.userId) : null };
  });

export const connectGithub = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => tokenSchema.parse(d))
  .handler(async ({ data, context }) => {
    try {
      const a = await connect(context.supabase, context.userId, data.token);
      await logRun(context.supabase, context.userId, {
        provider: "github",
        kind: "connect",
        ok: true,
        detail: `@${a.login}`,
      });
      return { ok: true as const, login: a.login };
    } catch (e) {
      await logRun(context.supabase, context.userId, {
        provider: "github",
        kind: "connect",
        ok: false,
        detail: safeMessage(e),
      });
      return { ok: false as const, error: safeMessage(e) };
    }
  });

export const disconnectGithub = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await disconnect(context.supabase, context.userId);
    return { ok: true };
  });

export const refreshGithubAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase: db, userId } = context;
    const now = new Date().toISOString();
    try {
      const ident = await identify(await getToken(db, userId));
      await patchAccount(db, userId, {
        ...ident,
        status: "connected",
        last_error: null,
        last_checked_at: now,
      });
      return { ok: true };
    } catch (e) {
      await patchAccount(db, userId, {
        status: "error",
        last_error: safeMessage(e),
        last_checked_at: now,
      });
      return { ok: false, error: safeMessage(e) };
    }
  });

export const listGithubRepos = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => fetchRepos(await getToken(context.supabase, context.userId)));

export const deleteGithubRepo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => repositoryDeletionSchema.parse(data))
  .handler(async ({ data, context }) => {
    try {
      await deleteRepo(await getToken(context.supabase, context.userId), data.repo);
      return { ok: true as const };
    } catch (error) {
      return { ok: false as const, error: safeMessage(error) };
    }
  });

export const selectDefaultRepo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const r = await fetchRepo(await getToken(context.supabase, context.userId), data.repo); // confirma acesso real
    const { error } = await context.supabase.from("github_selection").upsert({
      user_id: context.userId,
      repo_full_name: r.full_name,
      updated_at: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const diagnoseGithubConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase: db, userId } = context;
    const report = await diagnoseGithub(await getToken(db, userId), await selected(db, userId));
    const failed = report.checks.find((c) => !c.ok);
    await patchAccount(db, userId, {
      status: report.checks[0]?.ok ? "connected" : "error",
      last_error: failed?.detail ?? null,
      last_checked_at: report.ranAt,
    });
    await logRun(db, userId, {
      provider: "github",
      kind: "diagnostic",
      ok: report.ok,
      detail: failed?.detail ?? "Todos os testes passaram",
    });
    return report;
  });
