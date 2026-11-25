// Regras puras do deploy compilado (sem dependências de servidor) — testáveis.

export interface BuildConfig { command: string; outDir: string }

/** O build (TanStack Start + Nitro) já gera dist/_worker.js; remove o wrangler.json e o redirecionamento .wrangler/deploy que quebram o Pages. */
export const PAGES_WORKER_STEP = "rm -rf .wrangler/deploy dist/_worker.js/wrangler.json";

/** Lê o package.json do projeto e escolhe o comando de build e a pasta gerada. */
export function detectBuild(files: { path: string; content: string }[]): BuildConfig {
  const pkgFile = files.find((f) => f.path === "package.json");
  if (!pkgFile) return { command: "", outDir: "" }; // site estático: publica a raiz
  let pkg: { scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> } = {};
  try { pkg = JSON.parse(pkgFile.content); } catch { /* package.json inválido: usa o padrão */ }
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const has = (n: string) => n in deps;
  const base = pkg.scripts?.["build"] ? "npm run build" : "";
  const command = base && has("@tanstack/react-start") ? `${base} && ${PAGES_WORKER_STEP}` : base;
  const outDir = has("next") ? "out"
    : has("react-scripts") ? "build"
    : has("@tanstack/react-start") ? "dist"
    : command ? "dist" : "";
  return { command, outDir };
}

export type DeployState = "running" | "success" | "failure";

/** Estado final de uma implantação a partir da etapa atual da Cloudflare. */
export function deployState(stage: { name: string; status: string } | null | undefined): DeployState {
  if (!stage) return "running";
  if (stage.status === "failure" || stage.status === "canceled") return "failure";
  if (stage.name === "deploy" && stage.status === "success") return "success";
  return "running";
}

export const STAGE_LABEL: Record<string, string> = {
  queued: "Na fila", initialize: "Preparando", clone_repo: "Baixando código", build: "Compilando", deploy: "Publicando",
};

/** Banco de dados que o site publicado usa (endereço e chave pública — nunca a chave de serviço). */
export interface DbEnv { url: string; key: string; projectId?: string | null | undefined }
export type EnvVars = Record<string, { type: "plain_text"; value: string }>;

/** Extrai o identificador do projeto de um endereço https://<id>.supabase.co. */
export function projectRef(url: string): string {
  return /^https:\/\/([a-z0-9]+)\.supabase\.co\/?$/i.exec(url.trim())?.[1] ?? "";
}

export const DB_ENV_KEYS = ["VITE_SUPABASE_URL", "VITE_SUPABASE_PUBLISHABLE_KEY", "VITE_SUPABASE_PROJECT_ID", "SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_PROJECT_ID"] as const;

/** Variáveis enviadas ao build da Cloudflare: VITE_* entram no site compilado, as demais ficam para o servidor. */
export function deployEnvVars(db: DbEnv | null): EnvVars {
  const env: EnvVars = { NODE_VERSION: { type: "plain_text", value: "22" } };
  if (!db?.url || !db.key) return env;
  const v = (value: string) => ({ type: "plain_text" as const, value });
  const url = db.url.trim().replace(/\/+$/, "");
  const id = db.projectId?.trim() || projectRef(url);
  env["VITE_SUPABASE_URL"] = v(url);
  env["VITE_SUPABASE_PUBLISHABLE_KEY"] = v(db.key.trim());
  env["SUPABASE_URL"] = v(url);
  env["SUPABASE_PUBLISHABLE_KEY"] = v(db.key.trim());
  if (id) { env["VITE_SUPABASE_PROJECT_ID"] = v(id); env["SUPABASE_PROJECT_ID"] = v(id); }
  return env;
}
