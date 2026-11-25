import { z } from "zod";
import { normalizePath } from "./file-types";

export function copilotPath(path: string): boolean {
  return normalizePath(path) === path && !/^(\/|[a-z]:)/i.test(path)
    && !/(^|\/)(\.env(?:\..*)?|\.git|node_modules|dist|build|coverage|\.next|\.npmrc|\.pypirc|credentials(?:\..*)?|secrets?(?:\..*)?|id_rsa|id_ed25519)(\/|$)/i.test(path)
    && !/\.(pem|key|p12|pfx|png|jpe?g|gif|webp|ico|pdf|zip|gz|woff2?|ttf|mp4|mp3|exe|wasm)$/i.test(path);
}

export const changeSchema = z.object({
  path: z.string().min(1).max(500).refine(copilotPath, "Arquivo protegido ou caminho inválido."),
  content: z.string().max(80_000),
});
export const answerSchema = z.object({
  summary: z.string().min(1).max(100_000),
  changes: z.array(changeSchema).max(12),
}).refine(value => new Set(value.changes.map(c => c.path)).size === value.changes.length, "Arquivos duplicados.");

export type CopilotChange = z.infer<typeof changeSchema> & {
  before: string | null;
  expectedUpdatedAt: string | null;
};
export interface CopilotAnswer {
  summary: string;
  changes: CopilotChange[];
  coverage: { read: number; total: number };
}

/** Returns every balanced top-level `{...}` substring, respecting JSON strings. */
function balancedObjects(text: string): string[] {
  const found: string[] = [];
  let depth = 0, start = -1, inString = false, escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"' && depth > 0) inString = true;
    else if (ch === "{") { if (depth === 0) start = i; depth++; }
    else if (ch === "}" && depth > 0) { depth--; if (depth === 0) found.push(text.slice(start, i + 1)); }
  }
  return found;
}

export class CopilotParseError extends Error {}

/** Detecta resposta de Prompt Maker (texto/Markdown com Prompt Mestre). */
export function looksLikePromptMaster(text: string): boolean {
  const t = text.trim();
  return (
    /\[PROJETO\]\s*:/i.test(t) ||
    /```text[\s\S]*?\[PROJETO\]/i.test(t) ||
    /Prompt Mestre/i.test(t) ||
    /WLC 1\.5\.6 Prompt Maker/i.test(t)
  );
}

export function parseCopilotAnswer(text: string) {
  const clean = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const attempts = [clean, ...balancedObjects(text)];
  let schemaError: unknown = null;
  for (const candidate of attempts) {
    let value: unknown;
    try { value = JSON.parse(candidate); } catch { continue; }
    const result = answerSchema.safeParse(value);
    if (result.success) return result.data;
    schemaError ??= result.error;
  }
  // Prompt Maker e respostas textuais longas: encapsula como summary sem changes
  const trimmed = text.trim();
  if (trimmed.length > 0 && (looksLikePromptMaster(trimmed) || (!trimmed.startsWith("{") && trimmed.length > 200))) {
    return { summary: trimmed.slice(0, 100_000), changes: [] as z.infer<typeof changeSchema>[] };
  }
  throw new CopilotParseError(schemaError ? "invalid-schema" : "no-json");
}

export function fileStillMatches(
  file: { content: string; updated_at: string; deleted: boolean } | null,
  change: CopilotChange,
): boolean {
  if (change.before === null) return file === null;
  return file !== null && !file.deleted && file.content === change.before && file.updated_at === change.expectedUpdatedAt;
}
const STOP = new Set(["para","com","que","uma","um","the","and","mais","menos","deixa","deixe","muda","mude","faz","faça","fazer","como","este","esse","isso","dos","das","nos","nas","por","pelo","pela","seu","sua"]);

/** Orders files: active file first, then by keyword matches with the request in path, then by path. */
export function rankCopilotFiles<T extends { path: string }>(files: T[], message: string, activePath: string | null): T[] {
  const terms = [...new Set(message.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9]+/).filter(t => t.length >= 3 && !STOP.has(t)))];
  const score = (path: string) => {
    if (path === activePath) return Number.MAX_SAFE_INTEGER;
    const lower = path.toLowerCase();
    const name = lower.split("/").pop() ?? lower;
    // Arquivos de contexto ajudam a entender comandos, dependências e compilação.
    const contextPriority = new Map([
      ["agents.md", 24], ["package.json", 22], ["tsconfig.json", 20],
      ["vite.config.ts", 16], ["vitest.config.ts", 16], ["eslint.config.js", 14],
      ["readme.md", 12],
    ]).get(name) ?? 0;
    return contextPriority + terms.reduce((sum, t) => sum + (name.includes(t) ? 3 : lower.includes(t) ? 1 : 0), 0);
  };
  return files.map(f => ({ f, s: score(f.path) }))
    .sort((a, b) => b.s - a.s || a.f.path.localeCompare(b.f.path)).map(x => x.f);
}
