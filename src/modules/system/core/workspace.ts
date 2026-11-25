/** Regras puras do terminal System sobre os arquivos do projeto (testáveis). */
import { applyEdits } from "@/modules/code/pro-edits";

export interface WsFile {
  id: string; path: string; content: string; base_content: string | null;
  deleted: boolean; updated_at: string;
}

export type ChangeState = "unchanged" | "modified" | "created" | "deleted";

export function changeState(f: WsFile): ChangeState {
  if (f.deleted) return f.base_content === null ? "unchanged" : "deleted";
  if (f.base_content === null) return "created";
  return f.content === f.base_content ? "unchanged" : "modified";
}

export function normalizePath(p: string): string | null {
  const clean = p.trim().replace(/^\.?\/+/, "").replace(/\/+/g, "/").replace(/\/$/, "");
  if (!clean || clean.split("/").some((s) => s === ".." || s === ".")) return null;
  return clean;
}

export const visible = (files: WsFile[]) => files.filter((f) => !f.deleted);

/** Entradas diretas de uma pasta (arquivos e subpastas). */
export function listDir(files: WsFile[], dir: string): string[] {
  const prefix = dir ? `${dir.replace(/\/$/, "")}/` : "";
  const out = new Set<string>();
  for (const f of visible(files)) {
    if (!f.path.startsWith(prefix)) continue;
    const rest = f.path.slice(prefix.length);
    const slash = rest.indexOf("/");
    out.add(slash < 0 ? rest : `${rest.slice(0, slash)}/`);
  }
  return [...out].sort((a, b) => (a.endsWith("/") === b.endsWith("/") ? a.localeCompare(b) : a.endsWith("/") ? -1 : 1));
}

export function renderTree(files: WsFile[], dir = "", maxLines = 400): string {
  const lines: string[] = [];
  const walk = (d: string, indent: string) => {
    const entries = listDir(files, d);
    entries.forEach((e, i) => {
      if (lines.length >= maxLines) return;
      const last = i === entries.length - 1;
      lines.push(`${indent}${last ? "└── " : "├── "}${e}`);
      if (e.endsWith("/")) walk(`${d ? `${d}/` : ""}${e.slice(0, -1)}`, indent + (last ? "    " : "│   "));
    });
  };
  walk(dir, "");
  if (lines.length >= maxLines) lines.push(`… (árvore cortada em ${maxLines} linhas)`);
  return [dir || ".", ...lines].join("\n");
}

export interface SearchHit { path: string; line: number; text: string }
export function searchFiles(files: WsFile[], term: string, max = 100): SearchHit[] {
  const hits: SearchHit[] = [];
  const needle = term.toLowerCase();
  for (const f of visible(files)) {
    const lines = f.content.split("\n");
    for (let i = 0; i < lines.length && hits.length < max; i++) {
      if (lines[i]!.toLowerCase().includes(needle)) hits.push({ path: f.path, line: i + 1, text: lines[i]!.trim().slice(0, 160) });
    }
    if (hits.length >= max) break;
  }
  return hits;
}

/** Corpo de `edit`: blocos <<< / === / >>> viram edições cirúrgicas; senão é o conteúdo completo. */
export function applyEditBody(current: string, body: string): string {
  if (!/^<<<\s*$/m.test(body)) return body;
  const edits: { search: string; replace: string }[] = [];
  const re = /^<<<\s*\n([\s\S]*?)\n===\s*\n([\s\S]*?)\n?>>>\s*$/gm;
  for (const m of body.matchAll(re)) edits.push({ search: m[1]!, replace: m[2]! });
  if (!edits.length) throw new Error("Blocos de edição inválidos. Use <<< (trecho atual) === (trecho novo) >>>.");
  return applyEdits(current, edits);
}

/** Diff simples por linhas (LCS) no formato unificado reduzido. */
export function lineDiff(before: string, after: string, maxLines = 200): string {
  const a = before === "" ? [] : before.split("\n"), b = after === "" ? [] : after.split("\n");
  if (a.length * b.length > 4_000_000) return `(arquivo grande: ${a.length} → ${b.length} linhas)`;
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--)
    dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  const out: string[] = [];
  let i = 0, j = 0;
  while ((i < a.length || j < b.length) && out.length < maxLines) {
    if (i < a.length && j < b.length && a[i] === b[j]) { i++; j++; continue; }
    if (i < a.length && (j >= b.length || dp[i + 1]![j]! >= dp[i]![j + 1]!)) out.push(`- ${a[i++]}`);
    else out.push(`+ ${b[j++]}`);
  }
  if (out.length >= maxLines) out.push("… (diff cortado)");
  return out.join("\n") || "(sem diferenças)";
}

const EXT = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".json", ".css", "/index.ts", "/index.tsx", "/index.js"];

const NODE_BUILTINS = new Set([
  "assert", "async_hooks", "buffer", "child_process", "cluster", "console", "constants", "crypto",
  "dgram", "diagnostics_channel", "dns", "domain", "events", "fs", "http", "http2", "https",
  "inspector", "module", "net", "os", "path", "perf_hooks", "process", "punycode", "querystring",
  "readline", "repl", "stream", "string_decoder", "sys", "test", "timers", "tls", "trace_events",
  "tty", "url", "util", "v8", "vm", "wasi", "worker_threads", "zlib",
]);

const META_FRAMEWORKS = ["@tanstack/react-start", "next", "nuxt", "astro", "@sveltejs/kit", "@remix-run/react"];

function externalPkgName(spec: string): string | null {
  const s = spec.trim().split("?")[0] ?? "";
  if (
    !s || s.startsWith(".") || s.startsWith("/") || s.startsWith("@/") || s.startsWith("~/") ||
    s.startsWith("#") || s.startsWith("node:") || s.startsWith("bun:") || s.startsWith("cloudflare:") ||
    s.startsWith("virtual:") || s.startsWith("http://") || s.startsWith("https://") || s.startsWith("data:")
  ) return null;
  if (s.startsWith("@")) {
    const p = s.split("/");
    return p.length >= 2 && p[0] && p[1] ? `${p[0]}/${p[1]}` : null;
  }
  const pkg = s.split("/")[0] ?? "";
  return pkg && !NODE_BUILTINS.has(pkg) ? pkg : null;
}

export interface Issue { path: string; line: number; message: string; fix?: string }

/** Diagnóstico estático: imports quebrados, marcadores de conflito, JSON inválido e pré-checagem de build. */
export function diagnose(files: WsFile[]): Issue[] {
  const live = visible(files);
  const paths = new Set(live.map((f) => f.path));
  const issues: Issue[] = [];
  let declaredDeps: Set<string> | null = null;
  const pkgFile = live.find((f) => f.path === "package.json");
  if (pkgFile) {
    try {
      const pkg = JSON.parse(pkgFile.content) as {
        name?: string;
        scripts?: Record<string, unknown>;
        dependencies?: Record<string, unknown>;
        devDependencies?: Record<string, unknown>;
        peerDependencies?: Record<string, unknown>;
        optionalDependencies?: Record<string, unknown>;
      };
      declaredDeps = new Set<string>();
      for (const bag of [pkg.dependencies, pkg.devDependencies, pkg.peerDependencies, pkg.optionalDependencies]) {
        if (bag && typeof bag === "object") for (const k of Object.keys(bag)) declaredDeps.add(k);
      }
      if (typeof pkg.name === "string" && pkg.name.trim()) declaredDeps.add(pkg.name.trim());
      const buildScript = typeof pkg.scripts?.["build"] === "string" ? pkg.scripts["build"] : "";
      const isMeta = META_FRAMEWORKS.some((m) => declaredDeps?.has(m)) || live.some((x) => /^(?:next|nuxt|astro|svelte)\.config\./.test(x.path));
      if (/\btsc\b/.test(buildScript) && !paths.has("tsconfig.json")) {
        issues.push({ path: "package.json", line: 1, message: 'Script de build executa "tsc", mas "tsconfig.json" não existe', fix: "Criar tsconfig.json na raiz" });
      }
      if (/\bvite\b/.test(buildScript) && !isMeta && !paths.has("index.html")) {
        issues.push({ path: "package.json", line: 1, message: 'Script de build executa "vite", mas "index.html" não existe', fix: "Criar index.html na raiz apontando para o entrypoint" });
      }
    } catch {
      // JSON inválido já é reportado no loop principal abaixo
    }
  }
  const resolve = (from: string, spec: string): string | null => {
    let base: string;
    if (spec.startsWith("@/")) base = `src/${spec.slice(2)}`;
    else if (spec.startsWith(".")) {
      const parts = from.split("/").slice(0, -1);
      for (const seg of spec.split("/")) { if (seg === "..") parts.pop(); else if (seg !== ".") parts.push(seg); }
      base = parts.join("/");
    } else return "external";
    for (const e of EXT) if (paths.has(base + e)) return base + e;
    return null;
  };
  for (const f of live) {
    const lines = f.content.split("\n");
    if (/\.(ts|tsx|js|jsx|mjs)$/.test(f.path)) {
      const seenMissingPkgs = new Set<string>();
      lines.forEach((l, i) => {
        const trimmed = l.trim();
        if (trimmed.startsWith("//") || trimmed.startsWith("*")) return;
        for (const m of l.matchAll(/(?:from\s+|import\s*\(\s*|^\s*import\s+)["']([^"']+)["']/g)) {
          const spec = m[1]!;
          if (spec.startsWith("@/") && !paths.has("tsconfig.json") && !live.some((x) => x.path.startsWith("src/"))) continue;
          if (spec.endsWith(".asset.json") || spec.includes("?")) continue;
          if (resolve(f.path, spec) === null) {
            const name = spec.split("/").pop()!.replace(/\.\w+$/, "");
            const guess = live.find((x) => x.path.replace(/\.\w+$/, "").endsWith(`/${name}`));
            issues.push({ path: f.path, line: i + 1, message: `Import não encontrado: "${spec}"`, ...(guess ? { fix: `arquivo parecido: ${guess.path}` } : {}) });
          } else if (declaredDeps) {
            const pkg = externalPkgName(spec);
            if (pkg && !declaredDeps.has(pkg) && !seenMissingPkgs.has(pkg)) {
              seenMissingPkgs.add(pkg);
              issues.push({ path: f.path, line: i + 1, message: `Dependência ausente em package.json: "${pkg}"`, fix: `Adicionar "${pkg}" em package.json` });
            }
          }
        }
      });
    }
    if (f.path === "index.html") {
      lines.forEach((l, i) => {
        for (const m of l.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)) {
          const rawSrc = m[1]!;
          if (/^(?:https?:|\/\/|data:)/i.test(rawSrc)) continue;
          const entry = rawSrc.split("?")[0]!.replace(/^\.\/+/, "").replace(/^\/+/, "");
          if (entry && !paths.has(entry)) {
            issues.push({ path: f.path, line: i + 1, message: `Entrypoint não encontrado: "${rawSrc}"`, fix: `Criar ${entry} ou corrigir src em index.html` });
          }
        }
      });
    }
    lines.forEach((l, i) => { if (/^(<{7}|>{7})( |$)/.test(l)) issues.push({ path: f.path, line: i + 1, message: "Marcador de conflito de merge" }); });
    if (f.path.endsWith(".json")) {
      try { JSON.parse(f.content); } catch (e) { issues.push({ path: f.path, line: 1, message: `JSON inválido: ${(e as Error).message}` }); }
    }
  }
  return issues;
}

/** Resumo da estrutura do projeto. */
export function analyze(files: WsFile[]) {
  const live = visible(files);
  const byExt = new Map<string, number>();
  for (const f of live) { const e = f.path.includes(".") ? f.path.split(".").pop()! : "(sem extensão)"; byExt.set(e, (byExt.get(e) ?? 0) + 1); }
  const top = new Map<string, number>();
  for (const f of live) { const d = f.path.includes("/") ? `${f.path.split("/")[0]}/` : f.path; top.set(d, (top.get(d) ?? 0) + 1); }
  const pkg = live.find((f) => f.path === "package.json");
  let deps: string[] = [], scripts: string[] = [];
  if (pkg) try {
    const j = JSON.parse(pkg.content) as { dependencies?: Record<string, string>; scripts?: Record<string, string> };
    deps = Object.keys(j.dependencies ?? {}); scripts = Object.keys(j.scripts ?? {});
  } catch { /* JSON inválido aparece no diagnose */ }
  const lines = live.reduce((n, f) => n + f.content.split("\n").length, 0);
  const changes = files.filter((f) => changeState(f) !== "unchanged").length;
  return { files: live.length, lines, byExt: [...byExt].sort((a, b) => b[1] - a[1]), top: [...top].sort((a, b) => b[1] - a[1]), deps, scripts, changes };
}

/** Pontua arquivos para um pedido em linguagem natural. */
export function relatedFiles(files: WsFile[], request: string, max = 12): { path: string; score: number }[] {
  const words = request.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9_.-]+/).filter((w) => w.length > 2);
  return visible(files).map((f) => {
    const p = f.path.toLowerCase(), c = f.content.toLowerCase();
    let score = 0;
    for (const w of words) { if (p.includes(w)) score += 5; if (c.includes(w)) score += 1; }
    return { path: f.path, score };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, max);
}
