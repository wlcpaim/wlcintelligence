import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { connectCf, getCf, getCreds, getDeployment, saveCfDb } from "../services/cloudflare.server";
import { safeMessage } from "../../core/errors";

export const getCloudflareState = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => ({ account: await getCf(context.supabase, context.userId) }));

export const connectCloudflare = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    accountId: z.string().trim().regex(/^[a-f0-9]{32}$/, "Account ID inválido (32 caracteres hexadecimais)"),
    token: z.string().trim().min(20, "Token muito curto").max(300),
  }).parse(d))
  .handler(async ({ data, context }) => {
    try { return { ok: true as const, account: await connectCf(context.supabase, context.userId, data.accountId, data.token) }; }
    catch (e) { return { ok: false as const, error: safeMessage(e) }; }
  });

/** Banco de dados dos sites publicados: endereço + chave pública (a chave de serviço nunca é aceita). */
export const saveCloudflareDatabase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    url: z.string().trim().url("Endereço inválido").startsWith("https://", "O endereço precisa começar com https://").max(300),
    key: z.string().trim().min(20, "Chave muito curta").max(600)
      .refine((k) => !k.startsWith("sb_secret_") && !/service_role/.test(k), "Use a chave pública (anon/publishable), nunca a chave de serviço."),
    projectId: z.string().trim().regex(/^[a-z0-9]{0,40}$/i, "ID inválido").optional(),
  }).nullable().parse(d))
  .handler(async ({ data, context }) => {
    try { return { ok: true as const, account: await saveCfDb(context.supabase, context.userId, data) }; }
    catch (e) { return { ok: false as const, error: safeMessage(e) }; }
  });

export const disconnectCloudflare = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { error } = await context.supabase.from("cloudflare_connections").delete().eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Deploy compilado: envia as alterações ao GitHub e pede à Cloudflare um build real (npm run build). */
export const deployProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ projectId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    try {
      const { startValidatedPublish } = await import("@/modules/v199/services/publish.server");
      return { ok: true as const, ...await startValidatedPublish(context.supabase, context.userId, data.projectId) };
    } catch (e) { return { ok: false as const, error: safeMessage(e) }; }
  });

/** Andamento do build na Cloudflare (etapa atual, resultado e últimas linhas do log em caso de erro). */
export const deployStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ cfProject: z.string().regex(/^[a-z0-9-]{1,58}$/), deploymentId: z.string().min(1).max(64) }).parse(d))
  .handler(async ({ data, context }) => {
    try {
      const { data: owned } = await context.supabase.from("code_projects").select("id").eq("cf_project", data.cfProject).eq("user_id", context.userId).limit(1).maybeSingle();
      if (!owned) throw new Error("Projeto de deploy não encontrado.");
      const { token, accountId } = await getCreds(context.supabase, context.userId);
      return { ok: true as const, ...(await getDeployment(token, accountId, data.cfProject, data.deploymentId)) };
    } catch (e) { return { ok: false as const, error: safeMessage(e) }; }
  });

export const repairFailedDeploy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ projectId: z.string().uuid(), deploymentId: z.string().uuid(), rootId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    try {
      const { healFailedDeployment } = await import("@/modules/v199/services/deploy-healer.server");
      return { ok: true as const, ...await healFailedDeployment(context.supabase, context.userId, data.projectId, data.deploymentId, data.rootId) };
    } catch (e) { return { ok: false as const, error: safeMessage(e) }; }
  });

export const listCloudflareDeployments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    try {
      const { listAllDeployments } = await import("../services/cloudflare.server");
      const { token, accountId } = await getCreds(context.supabase, context.userId);
      return { ok: true as const, items: await listAllDeployments(token, accountId) };
    } catch (e) { return { ok: false as const, error: safeMessage(e), items: [] }; }
  });

export const deleteCloudflareDeployment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ project: z.string().regex(/^[a-z0-9-]{1,58}$/), id: z.string().regex(/^[a-f0-9-]{8,64}$/) }).parse(d))
  .handler(async ({ data, context }) => {
    try {
      const { deleteDeployment } = await import("../services/cloudflare.server");
      const { token, accountId } = await getCreds(context.supabase, context.userId);
      await deleteDeployment(token, accountId, data.project, data.id);
      return { ok: true as const };
    } catch (e) { return { ok: false as const, error: safeMessage(e) }; }
  });
