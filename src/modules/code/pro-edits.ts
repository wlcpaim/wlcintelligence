// WLC 1.7.1 PRO Copilot: regras puras de edição cirúrgica (testáveis).
import { z } from "zod";
import { copilotPath } from "./copilot";

export const proEditSchema = z.object({ search: z.string().min(1), replace: z.string() });
export const proChangeSchema = z.object({
  path: z.string().min(1).max(500).refine(copilotPath, "Arquivo protegido ou caminho inválido."),
  content: z.string().max(80_000).optional(),
  edits: z.array(proEditSchema).max(40).optional(),
}).refine(c => c.content !== undefined || (c.edits?.length ?? 0) > 0, "Sem conteúdo nem edições.");
export const proAnswerSchema = z.object({
  summary: z.string().min(1).max(8000),
  changes: z.array(proChangeSchema).max(30),
});
export const proPickSchema = z.object({ read: z.array(z.string()).max(40) });

/** Aplica trechos search/replace; cada trecho precisa existir exatamente uma vez. */
export function applyEdits(original: string, edits: { search: string; replace: string }[]): string {
  let out = original;
  for (const e of edits) {
    const first = out.indexOf(e.search);
    if (first < 0) throw new Error(`Trecho não encontrado: "${e.search.slice(0, 60)}"`);
    if (out.indexOf(e.search, first + 1) >= 0) throw new Error(`Trecho ambíguo (aparece mais de uma vez): "${e.search.slice(0, 60)}"`);
    out = out.slice(0, first) + e.replace + out.slice(first + e.search.length);
  }
  return out;
}

export function parseJsonLoose(text: string): unknown {
  const clean = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try { return JSON.parse(clean); } catch { /* tenta recorte */ }
  const s = clean.indexOf("{"), e = clean.lastIndexOf("}");
  if (s >= 0 && e > s) return JSON.parse(clean.slice(s, e + 1));
  throw new Error("no-json");
}
