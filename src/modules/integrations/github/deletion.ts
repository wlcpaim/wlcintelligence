import { z } from "zod";

export const repositoryDeletionSchema = z.object({
  repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
  confirmation: z.string(),
}).refine((data) => data.confirmation === data.repo, {
  message: "Digite o nome completo do repositório para confirmar a exclusão.",
  path: ["confirmation"],
});