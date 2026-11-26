/**
 * Validação leve pós-edição (pura, sem I/O): imports locais e sintaxe TS/JSX.
 * Usada pelo 1.7.1 PRO antes de devolver changes e após aplicar.
 */

export interface IntegrityFile { path: string; content: string }
export interface IntegrityIssue { path: string; message: string; severity: "error" | "warning" }

const CODE_EXT = [".tsx", ".ts", ".jsx", ".js"];

function norm(p: string) {
  return p.trim().replace(/^\.\//, "").replace(/^\/+/, "");
}

function resolve(from: string, spec: string): string {
  const parts = spec.startsWith("@/") ? ["src"] : from.split("/").slice(0, -1);
  for (const seg of (spec.startsWith("@/") ? spec.slice(2) : spec).split("/")) {
    if (seg === "..") parts.pop();
    else if (seg && seg !== ".") parts.push(seg);
  }
  return parts.join("/");
}

/** Detecta imports relativos/@/ que não resolvem para nenhum arquivo do snapshot. */
export function findBrokenLocalImports(files: IntegrityFile[]): IntegrityIssue[] {
  const paths = new Set(files.map(f => norm(f.path)));
  const issues: IntegrityIssue[] = [];
  const re = /(?:import|export)\s[^'"`;]*?from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/g;
  for (const f of files) {
    const p = norm(f.path);
    if (!/\.(tsx?|jsx?|mjs)$/.test(p) || p.startsWith("node_modules/")) continue;
    for (const m of f.content.matchAll(re)) {
      const spec = m[1] ?? m[2];
      if (!spec || (!spec.startsWith(".") && !spec.startsWith("@/"))) continue;
      if (/\.(css|scss|svg|png|jpe?g|gif|webp|json)$/i.test(spec)) continue;
      const base = resolve(p, spec).split("?")[0]!;
      const cands = /\.(tsx?|jsx?)$/.test(base)
        ? [base]
        : [...CODE_EXT.map(e => base + e), ...CODE_EXT.map(e => `${base}/index${e}`)];
      if (!cands.some(c => paths.has(c))) {
        issues.push({
          path: p,
          message: `Import local não resolvido: ${spec}`,
          severity: "error",
        });
      }
    }
  }
  return issues;
}

/**
 * Parse sintático via Babel (sem typecheck completo).
 * Detecta JSX/TS quebrado antes de aplicar.
 */
export function findSyntaxIssues(files: IntegrityFile[]): IntegrityIssue[] {
  // Dynamic require avoided — callers in server can pass parse fn; pure path uses regex heuristics + balanced checks
  const issues: IntegrityIssue[] = [];
  for (const f of files) {
    const p = norm(f.path);
    if (!/\.(tsx?|jsx?|mjs)$/.test(p)) continue;
    const c = f.content;
    if (c.includes("\0")) {
      issues.push({ path: p, message: "Arquivo contém byte nulo", severity: "error" });
      continue;
    }
    // Unbalanced braces/parens (heuristic). Strip comments, then strings/templates more carefully
    // so ${...} and nested backticks don't create false positives on valid code.
    let strip = c.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    // Remove template literals (backticks) by scanning so nested ${} don't break the strip
    {
      let out = "";
      let i = 0;
      while (i < strip.length) {
        const ch = strip[i];
        if (ch === "`") {
          i++;
          while (i < strip.length) {
            if (strip[i] === "\\") { i += 2; continue; }
            if (strip[i] === "`") { i++; break; }
            if (strip[i] === "$" && strip[i + 1] === "{") {
              // keep ${ } structure out of string strip by advancing until matching }
              i += 2;
              let depth = 1;
              while (i < strip.length && depth > 0) {
                if (strip[i] === "{") depth++;
                else if (strip[i] === "}") depth--;
                i++;
              }
              continue;
            }
            i++;
          }
          out += '""';
          continue;
        }
        if (ch === "'" || ch === '"') {
          const q = ch;
          i++;
          while (i < strip.length) {
            if (strip[i] === "\\") { i += 2; continue; }
            if (strip[i] === q) { i++; break; }
            i++;
          }
          out += '""';
          continue;
        }
        out += ch;
        i++;
      }
      strip = out;
    }
    let braces = 0, parens = 0, brackets = 0;
    let unbalanced = false;
    for (const ch of strip) {
      if (ch === "{") braces++;
      else if (ch === "}") braces--;
      else if (ch === "(") parens++;
      else if (ch === ")") parens--;
      else if (ch === "[") brackets++;
      else if (ch === "]") brackets--;
      if (braces < 0 || parens < 0 || brackets < 0) {
        issues.push({ path: p, message: "Delimitadores desbalanceados (sintaxe provavelmente inválida)", severity: "error" });
        unbalanced = true;
        break;
      }
    }
    if (!unbalanced && (braces !== 0 || parens !== 0 || brackets !== 0)) {
      issues.push({ path: p, message: "Delimitadores não fechados (sintaxe provavelmente inválida)", severity: "error" });
    }
    // JSX tag rough check
    if (/\.(tsx|jsx)$/.test(p)) {
      const opens = (c.match(/<[A-Za-z][A-Za-z0-9.]*/g) || []).length;
      const closes = (c.match(/<\/[A-Za-z]/g) || []).length + (c.match(/\/>/g) || []).length;
      if (opens > closes + 3) {
        issues.push({ path: p, message: "Possível JSX não fechado", severity: "warning" });
      }
    }
  }
  return issues;
}

/** Merge snapshot + changes e reporta issues de integridade. */
export function validateEditBatch(
  existing: IntegrityFile[],
  changes: IntegrityFile[],
): IntegrityIssue[] {
  const map = new Map(existing.map(f => [norm(f.path), f]));
  for (const c of changes) map.set(norm(c.path), c);
  const all = [...map.values()];
  return [...findBrokenLocalImports(all), ...findSyntaxIssues(changes)];
}

export interface ValidationReport {
  ok: boolean;
  errors: IntegrityIssue[];
  warnings: IntegrityIssue[];
  summary: string;
}

export function buildValidationReport(issues: IntegrityIssue[]): ValidationReport {
  const errors = issues.filter(i => i.severity === "error");
  const warnings = issues.filter(i => i.severity === "warning");
  const lines = [
    ...errors.slice(0, 10).map(i => `❌ ${i.path}: ${i.message}`),
    ...warnings.slice(0, 5).map(i => `⚠️ ${i.path}: ${i.message}`),
  ];
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    summary: lines.length
      ? `Validação local: ${errors.length} erro(s), ${warnings.length} aviso(s)\n${lines.join("\n")}`
      : "Validação local: ok (imports + sintaxe heurística)",
  };
}
