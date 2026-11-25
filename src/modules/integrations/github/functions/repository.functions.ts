import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getToken } from "../services/connection.server";
import { loadRepository } from "../services/repository.server";
import type { RepositoryPreview } from "../repository";

export const prepareRepository = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/) }).parse(input),
  )
  .handler(
    async ({
      data,
      context,
    }): Promise<{ ok: true; preview: RepositoryPreview } | { ok: false; error: string }> => {
      try {
        const snapshot = await loadRepository(
          await getToken(context.supabase, context.userId),
          data.repo,
        );
        return {
          ok: true,
          preview: {
            ...snapshot,
            files: snapshot.files.map(({ path, status, reason }) => ({ path, status, reason })),
          },
        };
      } catch {
        return {
          ok: false,
          error:
            "Não foi possível ler o repositório. Verifique a conexão GitHub e a permissão de leitura dos arquivos.",
        };
      }
    },
  );
