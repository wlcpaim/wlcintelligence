/**
 * WLC 1.9.9 — coleta de arquivos faltantes (gap-healing) e escolha da API menos usada.
 * Puro: sem rede nem banco.
 */
import type { DualKeyStatus } from "./keys";

export interface GapFile { path: string; content: string }
export interface MissingImport { importer: string; spec: string; target: string; line: string }

const CODE_EXT = [".tsx", ".ts", ".jsx", ".js"];
const ASSET_RE = /\.(svg|png|jpe?g|gif|webp|ico|json|woff2?|ttf|mp4|webm)$/i;

function norm(p: string) { return p.trim().replace(/^\.\/+/, "").replace(/^\/+/, ""); }

function resolve(dir: string, spec: string): string {
  const parts = dir ? dir.split("/") : [];
  for (const seg of spec.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") parts.pop(); else parts.push(seg);
  }
  return parts.join("/");
}

/** Imports relativos/`@/` que apontam para arquivos inexistentes (quebram o build). */
export function findMissingLocalImports(files: GapFile[]): MissingImport[] {
  const paths = new Set(files.map((f) => norm(f.path)));
  const out: MissingImport[] = [];
  const seen = new Set<string>();
  const re = /(?:import|export)\s[^'"`;]*?from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|import\s+["']([^"']+)["']/g;
  for (const f of files) {
    const p = norm(f.path);
    if (p.startsWith("node_modules/") || !/\.(tsx?|jsx?|mjs)$/.test(p)) continue;
    const dir = p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "";
    for (const m of f.content.matchAll(re)) {
      const spec = m[1] ?? m[2] ?? m[3];
      if (!spec) continue;
      let base: string;
      if (spec.startsWith("./") || spec.startsWith("../")) base = resolve(dir, spec);
      else if (spec.startsWith("@/")) base = resolve("src", spec.slice(2));
      else continue;
      const clean = base.split("?")[0] ?? base;
      if (ASSET_RE.test(clean)) continue;
      let found: boolean;
      let target: string;
      if (/\.(tsx?|jsx?|css|scss)$/.test(clean)) { found = paths.has(clean); target = clean; }
      else {
        const cands = [...CODE_EXT.map((e) => clean + e), ...CODE_EXT.map((e) => `${clean}/index${e}`)];
        found = cands.some((c) => paths.has(c));
        target = clean + (/\.jsx?$/.test(p) ? ".jsx" : ".tsx");
        if (!found && /\/(lib|utils|types|hooks|services|api|store|data)(\/|$)/.test(clean) && !/\/components?\//.test(clean)) {
          target = clean + (/\.jsx?$/.test(p) ? ".js" : ".ts");
        }
      }
      if (found) continue;
      const key = `${p}->${target}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ importer: p, spec, target, line: (m[0] ?? "").slice(0, 200) });
    }
  }
  return out;
}

/** Contador de uso por chave (soma de caracteres gerados) durante uma execução. */
export type KeyUsage = Map<string, number>;

export function recordUsage(usage: KeyUsage | undefined, keyId: string | undefined, amount: number) {
  if (!usage || !keyId) return;
  usage.set(keyId, (usage.get(keyId) ?? 0) + Math.max(1, amount));
}

/** API menos usada até agora (empate: ordem original). Registra reserva para não repetir em paralelo. */
export function leastUsedKeyId(status: DualKeyStatus, usage: KeyUsage, reserve = 0): string | undefined {
  let best: { id: string; u: number } | undefined;
  for (const k of status.keys) {
    const u = usage.get(k.id) ?? 0;
    if (!best || u < best.u) best = { id: k.id, u };
  }
  if (best && reserve > 0) usage.set(best.id, best.u + reserve);
  return best?.id;
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
