import { GENERATED_APP_CLIENT_SOURCE } from "@/modules/engineering/generated-app-contract";
// Split so the bundler does not replace this literal text with real env values.
const IME = "import" + ".meta" + ".env";
/**
 * Validador de arquitetura de produto WLC 1.9.9.
 * Regras inegociáveis para SPA comercial: rotas reais, admin isolado, Supabase e fallback SPA.
 * Puro: sem rede nem banco — testável e determinístico.
 */

export interface ArchFile {
  path: string;
  content: string;
}

export interface ArchIssue {
  path: string;
  severity: "error" | "warning";
  code: string;
  message: string;
  fix?: string;
}

function norm(p: string): string {
  return p.trim().replace(/^\.\/+/, "").replace(/^\/+/, "");
}

function byPath(files: ArchFile[]): Map<string, ArchFile> {
  const map = new Map<string, ArchFile>();
  for (const f of files) map.set(norm(f.path), f);
  return map;
}

function hasImport(content: string, pkg: string): boolean {
  const re = new RegExp(
    String.raw`(?:from\s+|import\s*\(\s*|^\s*import\s+)["']${pkg.replace("/", "\\/")}(?:\/[^"']*)?["']`,
    "m",
  );
  return re.test(content);
}

function packageDeclares(pkgJson: string | undefined, name: string): boolean {
  if (!pkgJson) return false;
  try {
    const pkg = JSON.parse(pkgJson) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return Boolean(pkg.dependencies?.[name] || pkg.devDependencies?.[name]);
  } catch {
    return false;
  }
}

/** Detecta simulação de rotas com useState para páginas mestras (anti-padrão). */
export function detectFakeRouting(files: ArchFile[]): ArchIssue[] {
  const issues: ArchIssue[] = [];
  const fakeRe =
    /useState\s*(?:<\s*['"`](?:landing|home|admin|page|screen|view|tab)['"`](?:\s*\|\s*['"`][^'"`]+['"`])*\s*>)?\s*\(\s*['"`](?:landing|home|admin)['"`]\s*\)/i;
  const setPageRe =
    /set(?:Page|Screen|View|Tab|Route|Section)\s*\(\s*['"`](?:admin|landing|home)['"`]\s*\)/i;

  for (const f of files) {
    const p = norm(f.path);
    if (!/\.(tsx|jsx)$/.test(p) || p.startsWith("node_modules/")) continue;
    if (fakeRe.test(f.content) || setPageRe.test(f.content)) {
      issues.push({
        path: p,
        severity: "error",
        code: "FAKE_ROUTING",
        message:
          "Simulação de rotas com useState para páginas mestras detectada. Deep links e reload quebram.",
        fix: "Substituir por react-router-dom (<BrowserRouter> + <Routes>/<Route>) em src/App.tsx.",
      });
    }
  }
  return issues;
}

/** Exige react-router-dom quando há múltiplas páginas ou App.tsx de SPA. */
export function detectMissingRouter(files: ArchFile[]): ArchIssue[] {
  const map = byPath(files);
  const issues: ArchIssue[] = [];
  const pkg = map.get("package.json")?.content ?? "";
  const isMeta = /@tanstack\/react-start|"next"|"nuxt"|"astro"/.test(pkg) || map.has("src/routes/__root.tsx") || map.has("src/router.tsx");
  if (isMeta) return issues;
  const app = map.get("src/App.tsx") ?? map.get("src/App.jsx");
  const allCode = [...map.values()]
    .filter((f) => /\.(tsx?|jsx?)$/.test(f.path))
    .map((f) => f.content)
    .join("\n");

  const usesRouter = /react-router-dom/.test(allCode) || /BrowserRouter|HashRouter|createBrowserRouter/.test(allCode);
  const looksMultiPage =
    /path\s*[:=]\s*['"`]\/admin/.test(allCode) ||
    /['"`]\/admin['"`]/.test(allCode) ||
    /pages\/Admin|pages\/Home|Route\s+path=/.test(allCode) ||
    Boolean(map.get("src/pages/Admin.tsx") || map.get("src/pages/Home.tsx"));

  if (app && looksMultiPage && !usesRouter) {
    issues.push({
      path: app.path,
      severity: "error",
      code: "MISSING_ROUTER",
      message: "Projeto multi-página sem react-router-dom. Rotas reais são obrigatórias.",
      fix: "Adicionar react-router-dom e envolver a app com <BrowserRouter> + <Routes>.",
    });
  }

  if (usesRouter && !packageDeclares(pkg, "react-router-dom")) {
    issues.push({
      path: "package.json",
      severity: "error",
      code: "MISSING_ROUTER_DEP",
      message: "Código importa react-router-dom, mas o pacote não está em package.json.",
      fix: 'Adicionar "react-router-dom": "^6.28.0" em dependencies.',
    });
  }

  if (app && usesRouter && !/BrowserRouter|HashRouter|RouterProvider|createBrowserRouter/.test(app.content)) {
    // Router pode estar no main.tsx
    const main = map.get("src/main.tsx") ?? map.get("src/main.jsx");
    const entry = main?.content ?? "";
    if (!/BrowserRouter|HashRouter|RouterProvider|createBrowserRouter/.test(entry + app.content)) {
      issues.push({
        path: app.path,
        severity: "warning",
        code: "ROUTER_NOT_MOUNTED",
        message: "react-router-dom importado, mas BrowserRouter/HashRouter não encontrado no entrypoint.",
        fix: "Montar <BrowserRouter> em src/main.tsx ou src/App.tsx.",
      });
    }
  }

  return issues;
}

/** Detecta CTA de admin exposto na vitrine pública (navbar/hero). */
export function detectAdminLeak(files: ArchFile[]): ArchIssue[] {
  const issues: ArchIssue[] = [];
  const leakRe =
    /(?:Painel\s+Admin|Área\s+Restrita|Admin\s+Panel|Go\s+to\s+Admin|Acessar\s+Admin|Entrar\s+no\s+Admin)/i;
  const publicPaths = [
    "src/pages/Home.tsx",
    "src/pages/Landing.tsx",
    "src/pages/Index.tsx",
    "src/components/Hero.tsx",
    "src/components/Navbar.tsx",
    "src/components/Header.tsx",
    "src/components/Nav.tsx",
  ];

  for (const f of files) {
    const p = norm(f.path);
    const isPublic =
      publicPaths.some((x) => p === x) ||
      (/src\/(pages|components)\//.test(p) && !/admin|login|dashboard/i.test(p));
    if (!isPublic || !/\.(tsx|jsx)$/.test(p)) continue;
    if (leakRe.test(f.content) && /to=['"`]\/admin|href=['"`]\/admin|navigate\(['"`]\/admin/.test(f.content)) {
      issues.push({
        path: p,
        severity: "error",
        code: "ADMIN_CTA_LEAK",
        message: "Link/botão de admin exposto na vitrine pública (quebra profissionalismo).",
        fix: "Remover CTA de admin do navbar/hero. Acesso só por URL direta /admin ou link discreto no rodapé.",
      });
    }
  }
  return issues;
}

/** Exige cliente Supabase + schema quando há serviços de domínio ou multi-página comercial. */
export function detectMissingPersistence(files: ArchFile[]): ArchIssue[] {
  const map = byPath(files);
  const issues: ArchIssue[] = [];
  const pkg = map.get("package.json")?.content;
  const hasSupabaseFile = map.has("src/lib/supabase.ts") || map.has("src/lib/supabase.tsx");
  const hasSchema = map.has("schema.sql") || [...map.keys()].some((k) => /schema\.sql$/.test(k));
  const allCode = [...map.values()]
    .filter((f) => /\.(tsx?|jsx?)$/.test(f.path))
    .map((f) => f.content)
    .join("\n");

  const needsDb =
    /src\/services\//.test([...map.keys()].join("\n")) ||
    /from\(['"`]\w+['"`]\)\.select|supabase\.from/.test(allCode) ||
    /localStorage\.setItem|const\s+\w+\s*=\s*\[\s*\{/.test(allCode);

  if (needsDb && !hasSupabaseFile) {
    issues.push({
      path: "src/lib/supabase.ts",
      severity: "error",
      code: "MISSING_SUPABASE_CLIENT",
      message: "Persistência comercial sem src/lib/supabase.ts.",
      fix: "Criar cliente @supabase/supabase-js com VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY/ANON_KEY.",
    });
  }

  if (needsDb && !hasSchema) {
    issues.push({
      path: "schema.sql",
      severity: "error",
      code: "MISSING_SCHEMA",
      message: "Projeto com dados de domínio sem schema.sql (tabelas + seed + RLS).",
      fix: "Gerar schema.sql com CREATE TABLE IF NOT EXISTS, UUID PK, RLS e seed.",
    });
  }

  if ((hasSupabaseFile || /@supabase\/supabase-js/.test(allCode)) && !packageDeclares(pkg, "@supabase/supabase-js")) {
    issues.push({
      path: "package.json",
      severity: "error",
      code: "MISSING_SUPABASE_DEP",
      message: "@supabase/supabase-js usado no código mas ausente do package.json.",
      fix: 'Adicionar "@supabase/supabase-js": "^2.48.0" em dependencies.',
    });
  }

  // Cliente existe mas não lê as env vars do Vite
  const supabaseFile = map.get("src/lib/supabase.ts") ?? map.get("src/lib/supabase.tsx");
  if (supabaseFile && !/import\.meta\.env\.VITE_SUPABASE_/.test(supabaseFile.content)) {
    issues.push({
      path: supabaseFile.path,
      severity: "warning",
      code: "SUPABASE_ENV_NOT_USED",
      message: "src/lib/supabase.ts não consome VITE_SUPABASE_URL / VITE_SUPABASE_*_KEY.",
      fix: "Usar " + IME + ".VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY || VITE_SUPABASE_ANON_KEY.",
    });
  }

  return issues;
}

/** Exige public/_redirects para SPA Vite no Cloudflare Pages. */
export function detectMissingRedirects(files: ArchFile[]): ArchIssue[] {
  const map = byPath(files);
  const issues: ArchIssue[] = [];
  const pkg = map.get("package.json")?.content ?? "";
  const isViteSpa =
    /"vite"/.test(pkg) || map.has("vite.config.ts") || map.has("vite.config.js");
  const isMeta =
    /@tanstack\/react-start|"next"|"nuxt"|"astro"/.test(pkg) ||
    map.has("src/routes/__root.tsx") ||
    map.has("src/router.tsx");

  if (isViteSpa && !isMeta && !map.has("public/_redirects")) {
    issues.push({
      path: "public/_redirects",
      severity: "error",
      code: "MISSING_SPA_REDIRECTS",
      message: "SPA Vite sem public/_redirects — reload em /admin retorna 404 no Cloudflare Pages.",
      fix: 'Criar public/_redirects com conteúdo: /* /index.html 200',
    });
  }

  const redirects = map.get("public/_redirects");
  if (redirects && !/\/\*\s+\/index\.html\s+200/.test(redirects.content)) {
    issues.push({
      path: "public/_redirects",
      severity: "warning",
      code: "WEAK_SPA_REDIRECTS",
      message: "public/_redirects existe mas não contém o fallback /* /index.html 200.",
      fix: "Incluir a linha: /* /index.html 200",
    });
  }

  return issues;
}


/** Detecta ausência de ErrorBoundary e chaves localStorage divergentes. */
export function detectResilienceGaps(files: ArchFile[]): ArchIssue[] {
  const issues: ArchIssue[] = [];
  const map = byPath(files);
  const allCode = [...map.values()].map(f => f.content).join("\n");
  const app = map.get("src/App.tsx") ?? map.get("src/App.jsx") ?? map.get("src/main.tsx");

  if (app && /react-router-dom|BrowserRouter|Routes/.test(allCode)) {
    if (!/ErrorBoundary|componentDidCatch|getDerivedStateFromError/.test(allCode)) {
      issues.push({
        path: app.path,
        severity: "error",
        code: "MISSING_ERROR_BOUNDARY",
        message: "SPA sem ErrorBoundary — qualquer ReferenceError vira tela preta.",
        fix: "Envolver <Routes> com ErrorBoundary de classe (componentDidCatch) e UI de fallback com botão Voltar ao início.",
      });
    }
  }

  // Coleta literais de localStorage.setItem/getItem
  const keys = new Map<string, string[]>(); // key -> files
  for (const f of files) {
    if (!/\.(tsx?|jsx?)$/.test(f.path)) continue;
    for (const m of f.content.matchAll(/localStorage\.(?:get|set|remove)Item\s*\(\s*['"`]([^'"`]+)['"`]/g)) {
      const k = m[1];
      if (!k) continue;
      const list = keys.get(k) ?? [];
      list.push(norm(f.path));
      keys.set(k, list);
    }
  }
  // Heurística: múltiplas chaves contendo auth/admin/session sugerem desalinhamento
  const authLike = [...keys.keys()].filter(k => /auth|admin|session|token|logged/i.test(k));
  if (authLike.length > 1) {
    issues.push({
      path: "src/lib/constants.ts",
      severity: "warning",
      code: "DIVERGENT_STORAGE_KEYS",
      message: `Múltiplas chaves de auth/storage detectadas: ${authLike.map(k => `'${k}'`).join(", ")}. Risco de Login gravar uma chave e Dashboard ler outra.`,
      fix: "Centralizar em src/lib/constants.ts (ex: export const AUTH_STORAGE_KEY = 'app_auth_session') e importar em todos os pontos.",
    });
  }
  return issues;
}


/**
 * Detecta "vitrine oca": compila, mas não funciona.
 * - BROKEN_ROUTER_WILDCARD: rota "/x/*" cujo componente não tem <Routes>/<Outlet> cobrindo o redirect do pai.
 * - HOLLOW_ADMIN: página de admin sem formulário, tabela/lista nem estado (stub).
 * - UNLINKED_SCHEMA: schema.sql com tabelas, mas nenhum código consulta dados.
 */
export function detectFunctionalGaps(files: ArchFile[]): ArchIssue[] {
  const issues: ArchIssue[] = [];
  const code = files.filter((f) => /\.(tsx|jsx)$/.test(norm(f.path)) && !norm(f.path).startsWith("node_modules/"));
  const map = byPath(files);

  // 1) Redirect do pai para sub-rota que o filho não declara (tela branca no React Router v6).
  for (const f of code) {
    for (const m of f.content.matchAll(/<Route\s+path=["'](\/[\w-]+)\/\*["']\s+element=\{\s*<(\w+)/g)) {
      const base = m[1]!, comp = m[2]!;
      const redirect = new RegExp(String.raw`<Navigate\s+to=["']${base}\/([\w-]+)["']`).exec(f.content);
      const imp = new RegExp(String.raw`import\s+${comp}\s+from\s+["']\.\/?([^"']+)["']`).exec(f.content);
      if (!redirect || !imp) continue;
      const dir = norm(f.path).split("/").slice(0, -1).join("/");
      const rel = imp[1]!.replace(/^\.\//, "");
      const target = [".tsx", ".jsx", "/index.tsx"].map((e) => map.get(norm(`${dir}/${rel}${e}`))).find(Boolean);
      if (!target) continue;
      const sub = redirect[1]!;
      if (!new RegExp(String.raw`path=["']\/?${sub}["']`).test(target.content) && !/<Outlet/.test(target.content)) {
        issues.push({ path: norm(target.path), severity: "error", code: "BROKEN_ROUTER_WILDCARD",
          message: `"${base}" redireciona para "${base}/${sub}", mas ${comp} não declara a sub-rota "${sub}" — a área fica em branco.`,
          fix: `Usar layout aninhado: <Route path="${base}" element={<Layout/>}> com <Outlet/>, <Route index> e <Route path="${sub}">.` });
      }
    }
  }

  // 2) Admin oco.
  for (const f of code) {
    const p = norm(f.path);
    if (!/(^|\/)(pages|routes)\/.*admin/i.test(p)) continue;
    if (/<Outlet/.test(f.content) || /login/i.test(p)) continue;
    const interactive = /<form|<table|\.map\(|onSubmit|onClick=\{\s*\(?/.test(f.content);
    const stateful = /use(State|Reducer|Effect|Query|SyncExternalStore)\b|from\s+["'][^"']*(services|store|hooks)\//.test(f.content);
    if (!interactive || !stateful) {
      issues.push({ path: p, severity: "error", code: "HOLLOW_ADMIN",
        message: `${p} é uma página de admin sem dados nem ações reais (stub de vitrine).`,
        fix: "Implementar listagem com dados do service, formulário criar/editar, excluir com confirmação e estados loading/vazio/erro." });
    }
  }

  // 3) Schema sem consumo.
  const schema = map.get("schema.sql");
  const tables = schema ? [...schema.content.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?["]?(\w+)/gi)].map((m) => m[1]!) : [];
  if (tables.length) {
    const ts = files.filter((f) => /\.(tsx?|jsx?)$/.test(norm(f.path)));
    const used = ts.some((f) => /^src\/services\//.test(norm(f.path)) || /\.from\(\s*["'`]\w+["'`]\s*\)/.test(f.content));
    if (!used) {
      issues.push({ path: "src/services", severity: "error", code: "UNLINKED_SCHEMA",
        message: `schema.sql define ${tables.length} tabela(s) (${tables.slice(0, 4).join(", ")}), mas nenhum service lê ou grava esses dados.`,
        fix: "Criar src/services/<entidade>.ts com list/create/update/remove (Supabase + fallback localStorage com seed) e usá-los nas páginas." });
    }
  }
  return issues;
}

/** Caminhos declarados em <Route path> / { path: } (inclui rotas filhas relativas). */
function collectDeclaredRoutes(files: ArchFile[]): { absolute: string[]; relative: string[] } {
  const absolute: string[] = [];
  const relative: string[] = [];
  for (const f of files) {
    if (!/\.(tsx|jsx|ts|js)$/.test(norm(f.path))) continue;
    if (!/<Route\b|createBrowserRouter|RouteObject/.test(f.content)) continue;
    for (const m of f.content.matchAll(/path\s*(?:=\s*\{?\s*|:\s*)["'`]([^"'`$]*)["'`]/g)) {
      const raw = (m[1] ?? "").trim();
      if (!raw || raw === "*" || raw === "/*") continue;
      (raw.startsWith("/") ? absolute : relative).push(raw.replace(/\/+$/, "") || "/");
    }
  }
  return { absolute, relative };
}

function routeMatches(pattern: string, target: string): boolean {
  const re = "^" + pattern.split("/").map((seg) =>
    seg === "*" ? ".*" : seg.startsWith(":") ? "[^/]+" : seg.replace(/[.+?^${}()|[\]\\]/g, "\\$&"),
  ).join("/") + "$";
  return new RegExp(re).test(target);
}

/** Destinos de navegação estáticos usados pela UI (Link/NavLink/navigate/Navigate). */
export function collectNavigationTargets(files: ArchFile[]): { path: string; target: string }[] {
  const out: { path: string; target: string }[] = [];
  const re = /(?:<(?:Link|NavLink|Navigate)\b[^>]*?\bto=\{?\s*|navigate\(\s*)["'`](\/[^"'`$#?]*)/g;
  for (const f of files) {
    const p = norm(f.path);
    if (!/\.(tsx|jsx)$/.test(p) || /\.test\.|__tests__/.test(p)) continue;
    for (const m of f.content.matchAll(re)) {
      const target = (m[1] ?? "").replace(/\/+$/, "") || "/";
      out.push({ path: p, target });
    }
  }
  return out;
}

/**
 * Detecta "links mortos": botão/menu leva a um caminho sem rota declarada.
 * Com catch-all para "/", o clique volta à home e o usuário vê um botão que "não faz nada".
 */
export function detectDeadLinks(files: ArchFile[]): ArchIssue[] {
  const usesRouter = files.some((f) => /react-router-dom|createBrowserRouter/.test(f.content));
  if (!usesRouter) return [];
  const { absolute, relative } = collectDeclaredRoutes(files);
  if (!absolute.length && !relative.length) return [];
  const isDeclared = (target: string): boolean => {
    if (target === "/") return absolute.includes("/") || relative.length > 0 || absolute.length > 0;
    if (absolute.some((a) => routeMatches(a, target))) return true;
    // Rota filha relativa (ex.: "dashboard" dentro de <Route path="/admin">).
    const segs = target.slice(1).split("/");
    for (let i = 1; i < segs.length; i++) {
      const parent = "/" + segs.slice(0, i).join("/");
      const rest = segs.slice(i).join("/");
      const parentOk = absolute.some((a) => routeMatches(a, parent) || routeMatches(a.replace(/\/\*$/, ""), parent));
      if (parentOk && relative.some((r) => routeMatches(r, rest))) return true;
    }
    return false;
  };
  const byTarget = new Map<string, string[]>();
  for (const { path, target } of collectNavigationTargets(files)) {
    if (isDeclared(target)) continue;
    byTarget.set(target, [...(byTarget.get(target) ?? []), path]);
  }
  return [...byTarget.entries()].map(([target, from]) => ({
    path: from[0]!,
    severity: "error" as const,
    code: "UNDECLARED_ROUTE_TARGET",
    message: `Navegação para "${target}" (em ${[...new Set(from)].join(", ")}) sem rota declarada — o botão/menu cai no curinga e parece não funcionar.`,
    fix: `Criar a página real e registrar <Route path="${target}"> (ou rota filha no layout aninhado) em src/App.tsx.`,
  }));
}

/** Detecta services de domínio que nenhuma tela importa (backend existe, UI não usa). */
export function detectUnconsumedServices(files: ArchFile[]): ArchIssue[] {
  const issues: ArchIssue[] = [];
  const code = files.filter((f) => /\.(tsx?|jsx?)$/.test(norm(f.path)) && !/\.test\.|__tests__/.test(norm(f.path)));
  const ui = code.filter((f) => /\.(tsx|jsx)$/.test(norm(f.path)));
  for (const svc of code) {
    const p = norm(svc.path);
    const m = /^src\/services\/(.+)\.(tsx?|jsx?)$/.exec(p);
    if (!m) continue;
    const base = m[1]!.replace(/\/index$/, "");
    const importRe = new RegExp(String.raw`from\s+["'][^"']*services\/${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\/index)?(?:\.(?:ts|tsx|js))?["']`);
    if (!ui.some((f) => norm(f.path) !== p && importRe.test(f.content))) {
      issues.push({ path: p, severity: "error", code: "UNCONSUMED_SERVICE",
        message: `${p} implementa a lógica de dados, mas nenhuma tela o importa — a interface é vitrine estática.`,
        fix: "Criar/atualizar as páginas operacionais e de admin para importar este service (listar, criar, editar, excluir) com estados loading/vazio/erro." });
    }
  }
  return issues;
}

/** Códigos que significam "compila, mas não funciona" — exigem completar telas, não só build. */
export const FUNCTIONAL_GAP_CODES = new Set([
  "UNDECLARED_ROUTE_TARGET", "UNCONSUMED_SERVICE", "HOLLOW_ADMIN", "BROKEN_ROUTER_WILDCARD", "UNLINKED_SCHEMA",
]);

/** Somente os erros funcionais (links mortos, admin oco, service sem tela). */
export function functionalGapIssues(files: ArchFile[]): ArchIssue[] {
  return inspectArchitecture(files).errors.filter((i) => FUNCTIONAL_GAP_CODES.has(i.code));
}

/** Executa todas as regras de arquitetura de produto. */
export function inspectArchitecture(files: ArchFile[]): {
  issues: ArchIssue[];
  errors: ArchIssue[];
  warnings: ArchIssue[];
  ok: boolean;
} {
  const issues = [
    ...detectFakeRouting(files),
    ...detectMissingRouter(files),
    ...detectAdminLeak(files),
    ...detectMissingPersistence(files),
    ...detectMissingRedirects(files),
    ...detectResilienceGaps(files),
    ...detectFunctionalGaps(files),
    ...detectDeadLinks(files),
    ...detectUnconsumedServices(files),
  ];
  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");
  return { issues, errors, warnings, ok: errors.length === 0 };
}

/** Gera stubs mínimos para gaps de arquitetura (sem LLM). */
export function architectureBootstrapFixes(files: ArchFile[]): ArchFile[] {
  const map = byPath(files);
  const fixes: ArchFile[] = [];
  const arch = inspectArchitecture(files);
  if (map.has("database.manifest.json") && !map.has("src/lib/generated-app-client.ts")) {
    fixes.push({ path: "src/lib/generated-app-client.ts", content: GENERATED_APP_CLIENT_SOURCE });
  }

  for (const issue of arch.errors) {
    if (issue.code === "MISSING_SPA_REDIRECTS" && !map.has("public/_redirects")) {
      fixes.push({ path: "public/_redirects", content: "/*    /index.html   200\n" });
    }
    if (issue.code === "MISSING_SUPABASE_CLIENT" && !map.has("src/lib/supabase.ts")) {
      fixes.push({
        path: "src/lib/supabase.ts",
        content: `import { createClient } from '@supabase/supabase-js';

const supabaseUrl = ${IME}.VITE_SUPABASE_URL || '';
const supabaseAnonKey =
  ${IME}.VITE_SUPABASE_PUBLISHABLE_KEY ||
  ${IME}.VITE_SUPABASE_ANON_KEY ||
  '';

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-key'
);
`,
      });
    }
    if (issue.code === "MISSING_SCHEMA" && !map.has("schema.sql")) {
      fixes.push({
        path: "schema.sql",
        content: `-- WLC 1.9.9 schema bootstrap (ajuste as tabelas ao domínio do projeto)
CREATE TABLE IF NOT EXISTS items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE items ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "items_public_read" ON items FOR SELECT USING (true);
CREATE POLICY IF NOT EXISTS "items_auth_write" ON items FOR ALL USING (auth.uid() = user_id);

INSERT INTO items (title, status) VALUES
  ('Item demonstração 1', 'active'),
  ('Item demonstração 2', 'active'),
  ('Item demonstração 3', 'pending'),
  ('Item demonstração 4', 'active')
ON CONFLICT DO NOTHING;
`,
      });
    }
  }

  // Garante dependências no package.json se o arquivo já existir
  const pkgFile = map.get("package.json");
  if (pkgFile) {
    try {
      const pkg = JSON.parse(pkgFile.content) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
        [k: string]: unknown;
      };
      pkg.dependencies = pkg.dependencies ?? {};
      let changed = false;
      const allCode = [...map.values()].map((f) => f.content).join("\n");
      if (
        (/react-router-dom/.test(allCode) || arch.errors.some((e) => e.code.startsWith("MISSING_ROUTER"))) &&
        !pkg.dependencies["react-router-dom"]
      ) {
        pkg.dependencies["react-router-dom"] = "^6.28.0";
        changed = true;
      }
      if (
        (map.has("src/lib/supabase.ts") ||
          /@supabase\/supabase-js/.test(allCode) ||
          arch.errors.some((e) => e.code.includes("SUPABASE"))) &&
        !pkg.dependencies["@supabase/supabase-js"]
      ) {
        pkg.dependencies["@supabase/supabase-js"] = "^2.48.0";
        changed = true;
      }
      if (changed) {
        fixes.push({ path: "package.json", content: JSON.stringify(pkg, null, 2) + "\n" });
      }
    } catch {
      /* ignore invalid package.json */
    }
  }

  return fixes;
}
