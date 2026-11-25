
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
  const pkg = map.get("package.json")?.content;
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
