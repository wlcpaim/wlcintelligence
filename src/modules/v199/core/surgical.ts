import { z } from "zod";
import { applyEdits } from "@/modules/code/pro-edits";
import { inspectContracts, type ContractFile } from "./contracts";

export const surgicalAnswerSchema = z.object({
  summary: z.string().max(1000).default(""),
  changes: z.array(z.object({
    path: z.string().max(500),
    edits: z.array(z.object({ search: z.string().min(1).max(6000), replace: z.string().max(6000) })).min(1).max(12),
  })).max(4),
});

/** Exact-unique patches only: preserve unrelated code and reject invented success stubs. */
export function surgicalChanges(files: ContractFile[], raw: unknown, allowedPaths: Set<string>): ContractFile[] {
  const answer = surgicalAnswerSchema.parse(raw);
  const changed: ContractFile[] = [];
  const seen = new Set<string>();
  for (const c of answer.changes) {
    const f = files.find(f => f.path === c.path);
    if (!f || !allowedPaths.has(c.path) || seen.has(c.path)) throw new Error("Correção fora do escopo lido ou duplicada.");
    seen.add(c.path);
    for (const edit of c.edits) {
      if (edit.search.split("\n").length > 80 || edit.replace.split("\n").length > 80) throw new Error("Correção ampla demais.");
      if (/=>\s*(?:null|undefined)\b|return\s+(?:null|undefined)\s*;|:\s*any\b/.test(edit.replace)) throw new Error("Correção não pode introduzir stub nulo ou any.");
    }
    const content = applyEdits(f.content, c.edits);
    if (content !== f.content) changed.push({ path: c.path, content });
  }
  const updated = files.map(f => changed.find(c => c.path === f.path) ?? f);
  const before = new Set(inspectContracts(files).issues.map(i => `${i.path}:${i.message}`));
  const newIssues = inspectContracts(updated).issues.filter(i => !before.has(`${i.path}:${i.message}`));
  if (newIssues.length) throw new Error(`Correção criou erro novo: ${newIssues[0]?.message}`);
  return changed;
}