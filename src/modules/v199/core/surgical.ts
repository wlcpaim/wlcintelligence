import { z } from "zod";
import { applyEdits, applyEditsRobust } from "@/modules/code/pro-edits";
import { inspectContracts, type ContractFile } from "./contracts";
import { parse } from "@babel/parser";

/** Aceita edits cirúrgicos OU content integral (fallback full-file). */
export const surgicalAnswerSchema = z.object({
  summary: z.string().max(1000).default(""),
  changes: z.array(z.object({
    path: z.string().max(500),
    content: z.string().max(120_000).optional(),
    edits: z.array(z.object({
      search: z.string().min(1).max(20_000),
      replace: z.string().max(20_000),
    })).max(20).optional(),
  }).refine(c => c.content !== undefined || (c.edits?.length ?? 0) > 0, {
    message: "change precisa de edits ou content",
  })).max(8),
});

function assertParseable(path: string, content: string) {
  if (!/\.(tsx?|jsx?|mjs)$/.test(path)) return;
  try {
    parse(content, {
      sourceType: "unambiguous",
      plugins: ["typescript", "jsx"],
      errorRecovery: false,
    });
  } catch (e) {
    throw new Error(`Fallback full-file inválido em ${path}: ${e instanceof Error ? e.message.slice(0, 120) : "syntax"}`);
  }
}

/** Patches cirúrgicos com fallback robusto e full-file validado por AST. */
export function surgicalChanges(files: ContractFile[], raw: unknown, allowedPaths: Set<string>): ContractFile[] {
  const answer = surgicalAnswerSchema.parse(raw);
  const changed: ContractFile[] = [];
  const seen = new Set<string>();
  for (const c of answer.changes) {
    if (!allowedPaths.has(c.path) || seen.has(c.path)) throw new Error("Correção fora do escopo lido ou duplicada.");
    seen.add(c.path);
    const f = files.find(f => f.path === c.path);

    // Full-file replacement path (fallback or new file in allowed set)
    if (c.content !== undefined && (!c.edits || c.edits.length === 0)) {
      if (/=>\s*(?:null|undefined)\b|return\s+(?:null|undefined)\s*;|:\s*any\b/.test(c.content)) {
        throw new Error("Correção não pode introduzir stub nulo ou any.");
      }
      assertParseable(c.path, c.content);
      if (!f || c.content !== f.content) changed.push({ path: c.path, content: c.content });
      continue;
    }

    if (!f) throw new Error(`Correção fora do escopo lido ou duplicada.`);
    if (!c.edits?.length) throw new Error("Sem edits nem content.");

    for (const edit of c.edits) {
      // Soft limit: 400 lines (was 80 — bloqueava componentes moderados)
      if (edit.search.split("\n").length > 400 || edit.replace.split("\n").length > 400) {
        throw new Error("Correção ampla demais.");
      }
      if (/=>\s*(?:null|undefined)\b|return\s+(?:null|undefined)\s*;|:\s*any\b/.test(edit.replace)) {
        throw new Error("Correção não pode introduzir stub nulo ou any.");
      }
    }

    let content: string;
    try {
      content = applyEdits(f.content, c.edits);
    } catch (e1) {
      if (e1 instanceof Error && e1.message.includes("ambíguo")) {
        throw e1;
      }
      try {
        content = applyEditsRobust(f.content, c.edits);
      } catch (e2) {
        // Last resort: if model also provided full content, use it after AST check
        if (c.content !== undefined) {
          assertParseable(c.path, c.content);
          content = c.content;
        } else {
          throw e2;
        }
      }
    }
    if (content !== f.content) changed.push({ path: c.path, content });
  }
  const updated = files.map(f => changed.find(c => c.path === f.path) ?? f);
  // For brand-new paths from full content, append
  for (const c of changed) {
    if (!updated.some(u => u.path === c.path)) updated.push(c);
  }
  const before = new Set(inspectContracts(files).issues.map(i => `${i.path}:${i.message}`));
  const newIssues = inspectContracts(updated).issues.filter(i => !before.has(`${i.path}:${i.message}`));
  if (newIssues.length) throw new Error(`Correção criou erro novo: ${newIssues[0]?.message}`);
  return changed;
}

/**
 * Bot de Bugs multi-API: várias APIs propõem correções independentes.
 * Vence a correção com mais concordância entre APIs; empate → a menor (mais cirúrgica).
 */
export function pickRepairConsensus(candidates: ContractFile[][]): { changes: ContractFile[]; votes: number } {
  const valid = candidates.filter(c => c.length > 0);
  if (!valid.length) return { changes: [], votes: 0 };
  const sig = (c: ContractFile[]) => [...c].sort((a, b) => a.path.localeCompare(b.path)).map(f => `${f.path}\u0000${f.content}`).join("\u0001");
  const size = (c: ContractFile[]) => c.reduce((n, f) => n + f.content.length, 0);
  const groups = new Map<string, { changes: ContractFile[]; votes: number }>();
  for (const c of valid) {
    const k = sig(c);
    const g = groups.get(k);
    if (g) g.votes++; else groups.set(k, { changes: c, votes: 1 });
  }
  return [...groups.values()].sort((a, b) => b.votes - a.votes || size(a.changes) - size(b.changes))[0]!;
}
