// Cloudflare por usuário: token criptografado (AES-GCM) e deploy compilado via Pages conectado ao GitHub.
import type { Db } from "../../core/runs.server";
import { seal, open, hintOf } from "../../core/crypto.server";
import { deployState, DB_ENV_KEYS, type BuildConfig, type DbEnv, type EnvVars } from "../build";

const API = "https://api.cloudflare.com/client/v4";
const aad = (userId: string) => `cloudflare:${userId}`;
export const CF_COLS = "account_id,account_name,token_hint,status,last_error,connected_at,last_checked_at,db_url,db_key,db_project_id" as const;

interface Env<T> { success: boolean; errors?: { code: number; message: string }[]; result: T }

export async function cf<T>(token: string, method: string, path: string, body?: BodyInit, json = true): Promise<T> {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (body && json) headers["Content-Type"] = "application/json";
  const res = await fetch(path.startsWith("http") ? path : `${API}${path}`, { method, headers, body: body ?? null });
  const text = await res.text();
  let data: Env<T> | null = null;
  try { data = JSON.parse(text) as Env<T>; } catch { /* corpo não-JSON */ }
  if (!res.ok || !data?.success) {
    const msg = data?.errors?.map(e => e.message).join("; ") || text.slice(0, 300);
    if (res.status === 403) throw new Error(`Sem permissão na Cloudflare (403). O token precisa de "Cloudflare Pages: Edit". Detalhe: ${msg}`);
    if (res.status === 401) throw new Error(`Token da Cloudflare inválido (401). ${msg}`);
    throw new Error(`Cloudflare ${res.status}: ${msg}`);
  }
  return data.result;
}

export async function verify(token: string, accountId: string) {
  try { await cf(token, "GET", `/accounts/${accountId}/tokens/verify`); }
  catch { await cf(token, "GET", "/user/tokens/verify"); }
  const acc = await cf<{ name: string }>(token, "GET", `/accounts/${accountId}`);
  return acc.name;
}

export async function connectCf(db: Db, userId: string, accountId: string, token: string) {
  const name = await verify(token, accountId);
  const s = await seal(token, aad(userId));
  const now = new Date().toISOString();
  const { data, error } = await db.from("cloudflare_connections").upsert({
    user_id: userId, account_id: accountId, account_name: name, token_ciphertext: s.ciphertext, token_iv: s.iv,
    token_hint: hintOf(token), status: "connected", last_error: null, connected_at: now, last_checked_at: now, updated_at: now,
  }).select(CF_COLS).single();
  if (error) throw new Error(error.message);
  return data;
}

export async function getCf(db: Db, userId: string) {
  const { data, error } = await db.from("cloudflare_connections").select(CF_COLS).eq("user_id", userId).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function getCreds(db: Db, userId: string) {
  const { data } = await db.from("cloudflare_connections").select("account_id,token_ciphertext,token_iv").eq("user_id", userId).maybeSingle();
  if (!data) throw new Error("Configure a Cloudflare em Configurações → API.");
  return { accountId: data.account_id, token: await open({ ciphertext: data.token_ciphertext, iv: data.token_iv }, aad(userId)) };
}

/** Salva o banco de dados usado pelos sites publicados (null apaga). */
export async function saveCfDb(db: Db, userId: string, cfg: DbEnv | null) {
  const { data, error } = await db.from("cloudflare_connections").update({
    db_url: cfg?.url ?? null, db_key: cfg?.key ?? null, db_project_id: cfg?.projectId || null, updated_at: new Date().toISOString(),
  }).eq("user_id", userId).select(CF_COLS).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Conecte a Cloudflare antes de configurar o banco de dados.");
  return data;
}

export async function getDbEnv(db: Db, userId: string): Promise<DbEnv | null> {
  const { data } = await db.from("cloudflare_connections").select("db_url,db_key,db_project_id").eq("user_id", userId).maybeSingle();
  return data?.db_url && data.db_key ? { url: data.db_url, key: data.db_key, projectId: data.db_project_id } : null;
}

/** Data de compatibilidade do servidor do site publicado (precisa suportar nodejs_compat). */
const COMPAT_DATE = "2025-09-01";

/** Grava as variáveis no projeto Pages (produção e prévia) antes do build. */
export async function setProjectEnv(token: string, accountId: string, project: string, vars: EnvVars, build?: BuildConfig) {
  // Chaves do banco ausentes vão como null para a Cloudflare apagar valores antigos.
  const env: Record<string, EnvVars[string] | null> = { ...vars };
  for (const k of DB_ENV_KEYS) if (!(k in env)) env[k] = null;
  const run = { compatibility_date: COMPAT_DATE, compatibility_flags: ["nodejs_compat"] };
  await cf(token, "PATCH", `/accounts/${accountId}/pages/projects/${project}`, JSON.stringify({
    ...(build?.command ? { build_config: { build_command: build.command, destination_dir: build.outDir, root_dir: "" } } : {}),
    deployment_configs: { production: { env_vars: env, ...run }, preview: { env_vars: env, ...run } },
  }));
}

/** Nome válido de projeto Pages: minúsculas, números e hífens, até 58 caracteres. */
export function pagesName(raw: string): string {
  const n = raw.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 58).replace(/-+$/, "");
  return n || "wlc-project";
}

interface PagesProject {
  name: string; subdomain: string;
  source?: { type: string; config?: { owner?: string; repo_name?: string; production_branch?: string } } | null;
}

/** Projeto Pages ligado ao repositório GitHub (compila na Cloudflare a cada push). */
export async function findGitProject(token: string, accountId: string, repo: string) {
  const [owner, name] = repo.toLowerCase().split("/");
  const list = await cf<PagesProject[]>(token, "GET", `/accounts/${accountId}/pages/projects`);
  return list.find((p) => p.source?.type === "github" && p.source.config?.owner?.toLowerCase() === owner && p.source.config?.repo_name?.toLowerCase() === name) ?? null;
}

/** Cria um projeto Pages conectado ao GitHub com o comando de build detectado. */
export async function createGitProject(token: string, accountId: string, repo: string, branch: string, build: BuildConfig, env: EnvVars) {
  const [owner, repoName] = repo.split("/") as [string, string];
  const base = pagesName(repoName);
  const existing = await cf<PagesProject[]>(token, "GET", `/accounts/${accountId}/pages/projects`);
  const taken = new Set(existing.map((p) => p.name));
  let name = base;
  for (let i = 1; taken.has(name); i++) name = `${base.slice(0, 52)}-app${i > 1 ? i : ""}`;
  try {
    return await cf<PagesProject>(token, "POST", `/accounts/${accountId}/pages/projects`, JSON.stringify({
      name, production_branch: branch,
      build_config: { build_command: build.command, destination_dir: build.outDir, root_dir: "" },
      source: { type: "github", config: { owner, repo_name: repoName, production_branch: branch, deployments_enabled: true, production_deployments_enabled: true, pr_comments_enabled: false, preview_deployment_setting: "none" } },
      deployment_configs: {
        production: { env_vars: env, compatibility_date: COMPAT_DATE, compatibility_flags: ["nodejs_compat"] },
        preview: { env_vars: env, compatibility_date: COMPAT_DATE, compatibility_flags: ["nodejs_compat"] },
      },
    }));
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    throw new Error(`Não foi possível ligar ${repo} à Cloudflare. Confira se o app "Cloudflare Workers and Pages" do GitHub tem acesso a esse repositório. Detalhe: ${m}`);
  }
}

/** Pede uma nova implantação: a Cloudflare baixa o último commit, roda o build e publica. */
export async function startBuild(token: string, accountId: string, project: string, branch: string) {
  const form = new FormData();
  form.set("branch", branch);
  const d = await cf<{ id: string }>(token, "POST", `/accounts/${accountId}/pages/projects/${project}/deployments`, form, false);
  return d.id;
}

/** Implantação mais recente (o primeiro build começa sozinho ao criar o projeto). */
export async function latestDeployment(token: string, accountId: string, project: string) {
  for (let i = 0; i < 3; i++) {
    const list = await cf<{ id: string }[]>(token, "GET", `/accounts/${accountId}/pages/projects/${project}/deployments`);
    if (list[0]) return list[0].id;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return null;
}

interface Deployment { id: string; url: string; latest_stage?: { name: string; status: string } | null; deployment_trigger?: { metadata?: { commit_hash?: string } } }

export async function getDeployment(token: string, accountId: string, project: string, id: string) {
  const d = await cf<Deployment>(token, "GET", `/accounts/${accountId}/pages/projects/${project}/deployments/${id}`);
  const state = deployState(d.latest_stage);
  let logs: string[] = [];
  if (state === "failure") {
    try {
      const l = await cf<{ data?: { line: string }[] }>(token, "GET", `/accounts/${accountId}/pages/projects/${project}/deployments/${id}/history/logs?size=5000`);
      logs = (l.data ?? []).map((x) => x.line).slice(-40);
    } catch { /* logs indisponíveis */ }
  }
  return { state, stage: d.latest_stage?.name ?? "queued", url: d.url, logs, commitSha: d.deployment_trigger?.metadata?.commit_hash ?? null };
}

export interface DeployItem { id: string; project: string; url: string; branch: string | null; message: string | null; env: string; stage: string; status: string; createdAt: string }

/** Todos os deploys de todos os projetos Pages da conta. */
export async function listAllDeployments(token: string, accountId: string): Promise<DeployItem[]> {
  const projects = await cf<PagesProject[]>(token, "GET", `/accounts/${accountId}/pages/projects`);
  const lists = await Promise.all(projects.map(async (p) => {
    const ds = await cf<{ id: string; url: string; environment: string; created_on: string; latest_stage?: { name: string; status: string } | null; deployment_trigger?: { metadata?: { branch?: string; commit_message?: string } } }[]>(token, "GET", `/accounts/${accountId}/pages/projects/${p.name}/deployments?per_page=25`);
    return ds.map((d) => ({ id: d.id, project: p.name, url: d.url, branch: d.deployment_trigger?.metadata?.branch ?? null, message: d.deployment_trigger?.metadata?.commit_message ?? null, env: d.environment, stage: d.latest_stage?.name ?? "queued", status: d.latest_stage?.status ?? "idle", createdAt: d.created_on }));
  }));
  return lists.flat().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function deleteDeployment(token: string, accountId: string, project: string, id: string) {
  await cf(token, "DELETE", `/accounts/${accountId}/pages/projects/${project}/deployments/${id}?force=true`);
}
