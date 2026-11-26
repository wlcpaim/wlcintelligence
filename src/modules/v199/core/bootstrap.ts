/**
 * Regras puras de Bootstrap (Nível 0) e integridade pré-build da WLC 1.9.9.
 * Sem rede nem banco: detecta arquivos base ausentes e dependências não declaradas
 * antes da fase de DevOps e da Análise de Código.
 */

import { visualBootstrap } from "./visual-bootstrap";
import { inspectArchitecture } from "./architecture";

export interface BootstrapFile {
  path: string;
  content: string;
}

export interface MissingDep {
  pkg: string;
  path: string;
  line: number;
}

export interface BuildIssue {
  path: string;
  line: number;
  message: string;
  fix?: string | undefined;
}

const NODE_BUILTINS = new Set([
  "assert", "async_hooks", "buffer", "child_process", "cluster", "console", "constants", "crypto",
  "dgram", "diagnostics_channel", "dns", "domain", "events", "fs", "http", "http2", "https",
  "inspector", "module", "net", "os", "path", "perf_hooks", "process", "punycode", "querystring",
  "readline", "repl", "stream", "string_decoder", "sys", "test", "timers", "tls", "trace_events",
  "tty", "url", "util", "v8", "vm", "wasi", "worker_threads", "zlib",
]);

const META_FRAMEWORKS = [
  "@tanstack/react-start", "next", "nuxt", "astro", "@sveltejs/kit", "@remix-run/react",
];

const ENTRYPOINT_CANDIDATES = [
  "src/main.tsx", "src/main.ts", "src/main.jsx", "src/main.js",
  "src/index.tsx", "src/index.ts", "src/index.jsx", "src/index.js",
  "src/routes/__root.tsx", "app/layout.tsx", "src/app/layout.tsx",
];

const META_CONFIG_RE = /^(?:next|nuxt|astro|svelte)\.config\./;

export const CRITICAL_BUILD_PATHS = new Set([
  "package.json",
  "tsconfig.json",
  "vite.config.ts",
  "vite.config.js",
  "vite.config.mjs",
  "index.html",
  "src/main.tsx",
  "src/App.tsx",
  "public/_redirects",
  "src/index.css", "src/styles.css",
  "tailwind.config.js", "tailwind.config.ts", "tailwind.config.cjs", "tailwind.config.mjs",
  "postcss.config.js", "postcss.config.cjs", "postcss.config.mjs",
  "src/lib/supabase.ts",
  "schema.sql",
]);

function normPath(raw: string): string {
  return raw.trim().replace(/^\.\/+/, "").replace(/^\/+/, "");
}

/** Extrai o nome do pacote npm de um specifier de import, ou null se for local/builtin/virtual. */
export function extractPackageName(specifier: string): string | null {
  const s = specifier.trim();
  if (!s) return null;
  if (
    s.startsWith(".") || s.startsWith("/") || s.startsWith("@/") || s.startsWith("~/") ||
    s.startsWith("#") || s.startsWith("node:") || s.startsWith("bun:") ||
    s.startsWith("cloudflare:") || s.startsWith("virtual:") ||
    s.startsWith("http://") || s.startsWith("https://") || s.startsWith("data:")
  ) {
    return null;
  }
  const clean = s.split("?")[0] ?? s;
  if (clean.startsWith("@")) {
    const parts = clean.split("/");
    if (parts.length < 2 || !parts[0] || !parts[1]) return null;
    return `${parts[0]}/${parts[1]}`;
  }
  const pkg = clean.split("/")[0] ?? "";
  if (!pkg || NODE_BUILTINS.has(pkg)) return null;
  return pkg;
}

/** Lista os arquivos do quarteto base de runtime ausentes no projeto. */
export function missingBootstrapFiles(paths: Iterable<string>): string[] {
  const set = new Set<string>();
  for (const p of paths) set.add(normPath(p));
  const isMeta = [...set].some((p) => META_CONFIG_RE.test(p) || p === "src/routes/__root.tsx");
  const missing: string[] = [];
  if (!set.has("package.json")) missing.push("package.json");
  if (!set.has("tsconfig.json")) missing.push("tsconfig.json");
  if (!isMeta && !set.has("index.html")) missing.push("index.html");
  if (!ENTRYPOINT_CANDIDATES.some((p) => set.has(p))) missing.push("src/main.tsx");
  return missing;
}

interface ParsedPackageJson {
  name?: string;
  scripts?: Record<string, unknown>;
  dependencies?: Record<string, unknown>;
  devDependencies?: Record<string, unknown>;
  peerDependencies?: Record<string, unknown>;
  optionalDependencies?: Record<string, unknown>;
}

function parsePkgJson(content: string): { ok: true; data: ParsedPackageJson } | { ok: false; error: string } {
  try {
    return { ok: true, data: JSON.parse(content) as ParsedPackageJson };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

function declaredPackages(pkg: ParsedPackageJson): Set<string> {
  const out = new Set<string>();
  for (const bag of [pkg.dependencies, pkg.devDependencies, pkg.peerDependencies, pkg.optionalDependencies]) {
    if (!bag || typeof bag !== "object") continue;
    for (const k of Object.keys(bag)) out.add(k);
  }
  if (typeof pkg.name === "string" && pkg.name.trim()) out.add(pkg.name.trim());
  return out;
}

/** Detecta pacotes externos importados no código que não estão declarados em package.json. */
export function findMissingDependencies(files: BootstrapFile[]): MissingDep[] {
  const pkgFile = files.find((f) => normPath(f.path) === "package.json");
  if (!pkgFile) return [];
  const parsed = parsePkgJson(pkgFile.content);
  if (!parsed.ok) return [];
  const declared = declaredPackages(parsed.data);
  const seen = new Set<string>();
  const missing: MissingDep[] = [];

  for (const f of files) {
    const p = normPath(f.path);
    if (
      p.startsWith("node_modules/") ||
      !/\.(ts|tsx|js|jsx|mjs|mts|cjs)$/.test(p) ||
      /\.(test|spec)\.[tj]sx?$/.test(p) ||
      /(^|\/)(tests?|__tests__)\//.test(p)
    ) continue;
    const lines = f.content.split("\n");
    lines.forEach((line, idx) => {
      const trimmed = line.trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("*")) return;
      for (const m of line.matchAll(/(?:from\s+|import\s*\(\s*|^\s*import\s+)["']([^"']+)["']/g)) {
        const spec = m[1];
        if (!spec) continue;
        const pkg = extractPackageName(spec);
        if (!pkg || declared.has(pkg)) continue;
        const key = `${pkg}:${p}`;
        if (seen.has(key)) continue;
        seen.add(key);
        missing.push({ pkg, path: p, line: idx + 1 });
      }
    });
  }
  return missing;
}


/** Extrai path strings de <Route path="..."> no App/router. */
function extractRoutePaths(content: string): string[] {
  const paths: string[] = [];
  for (const m of content.matchAll(/path\s*=\s*\{?\s*["'`]([^"'`]+)["'`]/g)) {
    if (m[1]) paths.push(m[1]);
  }
  for (const m of content.matchAll(/path\s*:\s*["'`]([^"'`]+)["'`]/g)) {
    if (m[1]) paths.push(m[1]);
  }
  return paths;
}

/**
 * Auditoria de rotas SPA: subcaminhos órfãos (ex: /admin/login sem /admin)
 * e ausência de catch-all path="*".
 */
export function validateRouterCompleteness(files: BootstrapFile[]): BuildIssue[] {
  const issues: BuildIssue[] = [];
  const app =
    files.find(f => normPath(f.path) === "src/App.tsx") ??
    files.find(f => normPath(f.path) === "src/App.jsx") ??
    files.find(f => /router\.tsx?$/.test(normPath(f.path)));
  if (!app) return issues;
  const content = app.content;
  if (!/react-router-dom|BrowserRouter|Routes|createBrowserRouter/.test(content)) return issues;

  const paths = extractRoutePaths(content);
  if (!paths.length) return issues;

  // Catch-all obrigatório
  if (!paths.some(p => p === "*" || p === "/*")) {
    issues.push({
      path: normPath(app.path),
      line: 1,
      message: 'Router sem rota curinga path="*". Acesso a URLs desconhecidas resulta em tela em branco.',
      fix: 'Adicionar <Route path="*" element={<Navigate to="/" replace />} /> no final das Routes.',
    });
  }

  // Subcaminhos órfãos: se existe /admin/login, deve existir /admin (ou redirect)
  const normalized = paths.filter(p => p !== "*" && p !== "/*").map(p => p.replace(/^\//, ""));
  const has = new Set(normalized);
  for (const p of normalized) {
    const parts = p.split("/").filter(Boolean);
    if (parts.length < 2) continue;
    // verifica prefixos: admin/login -> precisa de admin
    for (let i = 1; i < parts.length; i++) {
      const parent = parts.slice(0, i).join("/");
      if (!has.has(parent) && !has.has(parent + "/")) {
        // também aceita se há Navigate para o parent no arquivo
        const parentRe = new RegExp(`path\\s*=\\s*["'\`]/?${parent}["'\`]`);
        if (parentRe.test(content)) continue;
        issues.push({
          path: normPath(app.path),
          line: 1,
          message: `Rota órfã: existe "/${p}" mas falta a rota pai "/${parent}" (ou redirect). Acesso direto a /${parent} resulta em tela em branco.`,
          fix: `Adicionar <Route path="/${parent}" element={<Navigate to="/${p}" replace />} /> ou uma página para /${parent}.`,
        });
        break; // uma issue por cadeia basta
      }
    }
  }
  return issues;
}


/** Diagnóstico preventivo de build: tsconfig, index.html, entrypoint e dependências ausentes. */
export function diagnoseBuildReadiness(files: BootstrapFile[]): BuildIssue[] {
  const byPath = new Map<string, BootstrapFile>();
  for (const f of files) byPath.set(normPath(f.path), f);
  const issues: BuildIssue[] = [];

  const pkgFile = byPath.get("package.json");
  if (!pkgFile) {
    if ([...byPath.keys()].some((p) => /\.(ts|tsx|js|jsx)$/.test(p))) {
      issues.push({
        path: "package.json",
        line: 1,
        message: 'Falta "package.json" na raiz do projeto.',
        fix: "Criar package.json com scripts dev/build e dependências",
      });
    }
    return issues;
  }

  const parsed = parsePkgJson(pkgFile.content);
  if (!parsed.ok) {
    issues.push({ path: "package.json", line: 1, message: `JSON inválido: ${parsed.error}` });
    return issues;
  }

  const buildScript = typeof parsed.data.scripts?.["build"] === "string" ? parsed.data.scripts["build"] : "";
  const declared = declaredPackages(parsed.data);
  const isMeta = META_FRAMEWORKS.some((m) => declared.has(m)) || [...byPath.keys()].some((p) => META_CONFIG_RE.test(p));

  if (/\btsc\b/.test(buildScript) && !byPath.has("tsconfig.json")) {
    issues.push({
      path: "package.json",
      line: 1,
      message: 'Script de build executa "tsc", mas "tsconfig.json" não existe.',
      fix: "Criar tsconfig.json na raiz com configuração compatível",
    });
  }

  if (/\bvite\b/.test(buildScript) && !isMeta && !byPath.has("index.html")) {
    issues.push({
      path: "package.json",
      line: 1,
      message: 'Script de build executa "vite", mas "index.html" não existe na raiz.',
      fix: "Criar index.html na raiz apontando para /src/main.tsx",
    });
  }

  if (/\bvite\b/.test(buildScript) && !isMeta && !byPath.has("public/_redirects")) {
    issues.push({ path: "public/_redirects", line: 1,
      message: "SPA Vite sem fallback de navegação no Cloudflare Pages.",
      fix: "Criar public/_redirects com /* /index.html 200 (somente SPA, nunca SSR)." });
  }

  const html = byPath.get("index.html");
  if (html) {
    const lines = html.content.split("\n");
    lines.forEach((line, idx) => {
      for (const m of line.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)) {
        const rawSrc = m[1];
        if (!rawSrc || /^(?:https?:|\/\/|data:)/i.test(rawSrc)) continue;
        const entry = normPath(rawSrc.split("?")[0] ?? rawSrc);
        if (entry && !byPath.has(entry)) {
          issues.push({
            path: "index.html",
            line: idx + 1,
            message: `Entrypoint referenciado em index.html não encontrado: "${rawSrc}"`,
            fix: `Criar ${entry} ou ajustar src em index.html`,
          });
        }
      }
    });
  }

  for (const dep of findMissingDependencies(files)) {
    issues.push({
      path: dep.path,
      line: dep.line,
      message: `Dependência "${dep.pkg}" importada mas ausente em package.json`,
      fix: `Adicionar "${dep.pkg}" em dependencies ou devDependencies de package.json`,
    });
  }

  const visual = visualBootstrap(files);
  for (const change of visual.changes) issues.push({ path: change.path, line: 1, message: `Configuração visual obrigatória ausente: ${change.path}` });
  for (const issue of visual.issues) issues.push({ ...issue, line: 1 });

  // Arquitetura de produto: rotas reais, Supabase, _redirects, anti useState-router
  for (const issue of inspectArchitecture(files).errors) {
    issues.push({
      path: issue.path,
      line: 1,
      message: `[${issue.code}] ${issue.message}`,
      fix: issue.fix,
    });
  }
  for (const issue of validateRouterCompleteness(files)) issues.push(issue);
  return issues;
}export function buildDevOpsBootstrapTask(
  existingTask: string | undefined,
  missingFiles: string[],
  missingDeps: MissingDep[],
  buildIssues: BuildIssue[],
): string | null {
  const uniqueDeps = [...new Set(missingDeps.map((d) => d.pkg))];
  if (!missingFiles.length && !uniqueDeps.length && !buildIssues.length) {
    return existingTask ?? null;
  }
  const notes: string[] = [];
  if (missingFiles.length) {
    notes.push(`Criar arquivos obrigatórios de runtime ausentes: ${missingFiles.join(", ")}.`);
  }
  if (uniqueDeps.length) {
    notes.push(`Declarar em package.json (dependencies/devDependencies) os pacotes já importados: ${uniqueDeps.join(", ")}.`);
  }
  if (buildIssues.length) {
    notes.push(`Resolver pendências de build detectadas: ${buildIssues.slice(0, 6).map((i) => i.message).join("; ")}.`);
  }
  const base = existingTask?.trim()
    ? `${existingTask.trim()}\n`
    : "Garantir bootstrap completo de compilação e deploy.\n";
  return `${base}CHECKLIST OBRIGATÓRIO DE BOOTSTRAP:\n- ${notes.join("\n- ")}`;
}