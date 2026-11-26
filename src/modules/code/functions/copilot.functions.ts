import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { changeSchema, fileStillMatches } from "../copilot";
import type { CopilotAnswer } from "../copilot";

async function copilotErrorMessage(error: unknown): Promise<string> {
  const { CopilotParseError } = await import("../copilot");
  const { CopilotProviderError } = await import("../services/copilot.server");
  if (error instanceof DOMException && error.name === "TimeoutError")
    return "O time passou do tempo limite. Seu prompt foi preservado: envie de novo ou divida em partes menores.";
  if (error instanceof DOMException && error.name === "AbortError") return "Pedido interrompido.";
  if (error instanceof CopilotParseError) return "A IA respondeu, mas não propôs alterações válidas de código. Tente reformular o pedido.";
  if (error instanceof CopilotProviderError) return `Erro na chave de API configurada: ${error.message}`;
  if (error instanceof Error && error.message) return error.message;
  return "Não foi possível gerar a proposta. Tente novamente.";
}

export const askCopilot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({
    projectId: z.string().uuid(), message: z.string().trim().min(1).max(100_000),
    activePath: z.string().max(500).nullable(),
    history: z.array(z.object({ role: z.enum(["user", "model"]), content: z.string().max(2000) })).max(6),
    versionId: z.string().uuid().optional(),
    pro: z.boolean().optional(),
    v199: z.boolean().optional(),
    diagnose: z.boolean().optional(),
  }).parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true; answer: CopilotAnswer } | { ok: false; error: string }> => {
    try {
      const { generateCopilot } = await import("../services/copilot.server");
      const signal = AbortSignal.any([getRequest().signal, AbortSignal.timeout(90_000)]);
      if (data.v199) {
        // Time completo (Arquiteto → especialistas → Análise): 4 etapas em sequência, precisa de mais tempo.
        const { TEAM_HARD_LIMIT_MS, TEAM_SOFT_BUDGET_MS } = await import("@/modules/v199/core/budget");
        const team = AbortSignal.any([getRequest().signal, AbortSignal.timeout(TEAM_HARD_LIMIT_MS)]);
        if (data.diagnose) {
          // Diagnóstico de Deploy: build/testes no WLC Runner (GitHub Actions) + correção proposta.
          const { generateDiagnosticsCopilot } = await import("@/modules/v199/services/copilot-diagnostics.server");
          return { ok: true, answer: await generateDiagnosticsCopilot(context.supabase, context.userId, data.projectId, team) };
        }
        const { generateTeamCopilot } = await import("@/modules/v199/services/copilot-team.server");
        return { ok: true, answer: await generateTeamCopilot(context.supabase, context.userId, data.projectId, data.message, data.activePath, data.history, team, Date.now() + TEAM_SOFT_BUDGET_MS) };
      }
      if (data.pro) {
        const { generateProCopilot } = await import("../services/pro-copilot.server");
        const pro = AbortSignal.any([getRequest().signal, AbortSignal.timeout(180_000)]);
        return { ok: true, answer: await generateProCopilot(context.supabase, context.userId, data.projectId, data.message, data.activePath, data.history, pro) };
      }
      let instruction: string | undefined;
      if (data.versionId) {
        const { loadVersionForUse } = await import("@/modules/versions/services/versions.server");
        const { copilotInstructionFor } = await import("@/modules/versions/instructions");
        const version = await loadVersionForUse(context.supabase, context.userId, data.versionId);
        if (version) instruction = copilotInstructionFor(version);
      } else {
        // Base version (WLC 1.5.6 Prompt Maker) — gera Prompt Mestre em vez de código
        const { PROMPT_MAKER_COPILOT_INSTRUCTION } = await import("@/modules/versions/instructions");
        instruction = PROMPT_MAKER_COPILOT_INSTRUCTION;
      }
      const answer = await generateCopilot(context.supabase, context.userId, data.projectId, data.message, data.activePath, data.history, signal, instruction);
      return { ok: true, answer };
    } catch (error) {
      return { ok: false, error: await copilotErrorMessage(error) };
    }
  });

export const applyCopilotFile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({
    projectId: z.string().uuid(), change: changeSchema.extend({
      before: z.string().max(80_000).nullable(), expectedUpdatedAt: z.string().nullable(),
    }),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const { redactSecrets } = await import("@/modules/integrations/github/services/repository.server");
    if (redactSecrets(data.change.content) !== data.change.content)
      return { ok: false as const, error: "Arquivo com credencial bloqueado. Use a configuração segura de segredos." };
    const db = context.supabase;
    const { data: project } = await db.from("code_projects").select("id").eq("id", data.projectId).eq("user_id", context.userId).single();
    if (!project) return { ok: false as const, error: "Projeto não encontrado." };
    const { data: current, error } = await db.from("code_files").select("id,content,updated_at,deleted").eq("project_id", data.projectId).eq("user_id", context.userId).eq("path", data.change.path).maybeSingle();
    if (error) return { ok: false as const, error: "Não foi possível conferir o arquivo." };
    if (!fileStillMatches(current, data.change)) return { ok: false as const, error: "O arquivo mudou após a proposta. Peça uma nova revisão para preservar suas edições." };
    const now = new Date().toISOString();
    const { updateCopilotFile } = await import("../services/save-copilot-file.server");
    const query = current
      ? updateCopilotFile(db, context.userId, current, data.change.content, now)
      : db.from("code_files").insert({ project_id: data.projectId, user_id: context.userId, path: data.change.path, content: data.change.content, base_content: null, updated_at: now });
    const result = await query.select("id,path,content,base_content,deleted,updated_at").single();
    if (result.error || !result.data) return { ok: false as const, error: "Arquivo não aplicado. Ele pode ter sido alterado em outra janela; peça uma nova revisão." };
    return { ok: true as const, file: result.data };
  });

/** Pós-aplicação: validação local + typecheck remoto opcional (GitHub Runner). */
export const validateAfterCopilotApply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({
    projectId: z.string().uuid(),
    withRemote: z.boolean().optional(),
  }).parse(input))
  .handler(async ({ data, context }) => {
    try {
      const { validateAfterApply } = await import("../services/post-edit-validate.server");
      const signal = AbortSignal.any([getRequest().signal, AbortSignal.timeout(data.withRemote ? 120_000 : 30_000)]);
      const report = await validateAfterApply(
        context.supabase,
        context.userId,
        data.projectId,
        signal,
        { withRemote: data.withRemote ?? false },
      );
      return { ok: true as const, report };
    } catch (error) {
      return {
        ok: false as const,
        error: error instanceof Error ? error.message : "Falha na validação pós-edição.",
      };
    }
  });
