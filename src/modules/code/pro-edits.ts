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

/** Aplica trechos search/replace; cada trecho precisa existir exatamente uma vez (modo estrito legado). */
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

/**
 * Edição tolerante: exact → line-ending normalize → trim → normalização de indentação.
 * Usado pelo Elite Engineering Agent quando o search/replace frágil falharia por indentação/CRLF.
 */
export function applyEditsRobust(original: string, edits: { search: string; replace: string }[]): string {
  let out = original;
  for (const e of edits) {
    // 1. Exact match (unique)
    let idx = out.indexOf(e.search);
    if (idx >= 0) {
      if (out.indexOf(e.search, idx + 1) >= 0) {
        // ambiguous exact — try normalized uniqueness below
      } else {
        out = out.slice(0, idx) + e.replace + out.slice(idx + e.search.length);
        continue;
      }
    }

    // 2. Normalize line endings
    const normOut = out.replace(/\r\n/g, "\n");
    const normSearch = e.search.replace(/\r\n/g, "\n");
    idx = normOut.indexOf(normSearch);
    if (idx >= 0 && normOut.indexOf(normSearch, idx + 1) < 0) {
      out = normOut.slice(0, idx) + e.replace + normOut.slice(idx + normSearch.length);
      continue;
    }

    // 3. Trim edges
    const trimmedSearch = normSearch.trim();
    if (trimmedSearch.length > 0) {
      idx = normOut.indexOf(trimmedSearch);
      if (idx >= 0 && normOut.indexOf(trimmedSearch, idx + 1) < 0) {
        out = normOut.slice(0, idx) + e.replace + normOut.slice(idx + trimmedSearch.length);
        continue;
      }
    }

    // 4. Map every normalized character back to the source, never guess a line window.
    // Only leading indentation is normalized; literal/internal spaces remain significant.
    const mapped = normalizeIndentation(normOut);
    const normalizedSearch = normalizeIndentation(normSearch.trim()).text;
    const cIdx = mapped.text.indexOf(normalizedSearch);
    if (normalizedSearch.length > 0 && cIdx >= 0) {
      if (mapped.text.indexOf(normalizedSearch, cIdx + 1) >= 0) {
        throw new Error(`Trecho ambíguo após normalização: "${e.search.slice(0, 60)}"`);
      }
      const start = mapped.starts[cIdx];
      const end = mapped.ends[cIdx + normalizedSearch.length - 1];
      if (start !== undefined && end !== undefined) {
        out = normOut.slice(0, start) + e.replace + normOut.slice(end);
        continue;
      }
    }

    const appearsMultipleTimes = out.indexOf(e.search) >= 0 && out.indexOf(e.search, out.indexOf(e.search) + 1) >= 0;
    if (appearsMultipleTimes) {
      throw new Error(`Trecho ambíguo (aparece mais de uma vez): "${e.search.slice(0, 60)}"`);
    }
    throw new Error(`Trecho não localizado para substituição: "${e.search.slice(0, 60)}..."`);
  }
  return out;
}

function normalizeIndentation(source: string): { text: string; starts: number[]; ends: number[] } {
  let text = "";
  const starts: number[] = [], ends: number[] = [];
  for (let i = 0; i < source.length;) {
    const start = i;
    const char = source[i];
    if (char === undefined) break;
    if ((i === 0 || source[i - 1] === "\n") && /[ \t]/.test(char)) {
      while (i < source.length && /[ \t]/.test(source[i] ?? "")) i++;
      text += " ";
    } else {
      text += char;
      i++;
    }
    starts.push(start);
    ends.push(i);
  }
  return { text, starts, ends };
}

export function parseJsonLoose(text: string): unknown {
  const clean = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try { return JSON.parse(clean); } catch { /* tenta recorte */ }
  const s = clean.indexOf("{"), e = clean.lastIndexOf("}");
  if (s >= 0 && e > s) return JSON.parse(clean.slice(s, e + 1));
  throw new Error("no-json");
}
