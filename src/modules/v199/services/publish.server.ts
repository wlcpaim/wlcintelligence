import type { Db } from "@/modules/integrations/core/runs.server";
import { getCreds, getDbEnv, findGitProject, createGitProject, setProjectEnv, startBuild, latestDeployment, getDeployment } from "@/modules/integrations/cloudflare/services/cloudflare.server";
import { detectBuild, deployEnvVars } from "@/modules/integrations/cloudflare/build";
import { commitPending } from "@/modules/code/services/commit.server";
import { healPreflightIntegrity } from "./preflight.server";
import { healFailedDeployment } from "./deploy-healer.server";
import { recordMetric } from "@/modules/engineering/kernel";
import { provisionGeneratedDatabase } from "@/modules/engineering/generated-app.server";

/** Shared by authenticated Chat and Code; no client bypass of validation. Publish Guard: métrica + preflight. */
export async function startValidatedPublish(db: Db, userId: string, projectId: string) {
  const { data: p, error } = await db.from("code_projects").select("*").eq("id", projectId).eq("user_id", userId).single();
  if (error || !p) {
    recordMetric(userId, "publish_blocked");
    throw new Error("Projeto não encontrado.");
  }
  if (!p.repo_full_name) {
    recordMetric(userId, "publish_blocked");
    throw new Error("Vincule um repositório GitHub antes do Deploy.");
  }
  // Check provider credentials before committing: a missing connection must not cause side effects.
  const { token, accountId } = await getCreds(db, userId);
  const database = await getDbEnv(db, userId);
  const env = deployEnvVars(database);
  env['VITE_WLC_PROJECT_ID'] = { type: "plain_text", value: projectId };

  // Pré-voo com retry: se a 1ª autocorreção deixar sintaxe quebrada, o time de qualidade
  // roda de novo e o pré-voo tenta outra vez antes de bloquear o Deploy.
  let fs: Awaited<ReturnType<typeof healPreflightIntegrity>>["files"];
  let repaired = 0;
  const preflightSignal = AbortSignal.timeout(240000);
  try {
    const first = await healPreflightIntegrity(db, userId, p.id, p.base_sha, preflightSignal);
    fs = first.files;
    repaired = first.repaired;
  } catch (firstErr) {
    const msg = firstErr instanceof Error ? firstErr.message : String(firstErr);
    const syntaxBlocked = /Delimitadores|sintaxe|JSX não fechado|Publicação bloqueada|Autocorreção/i.test(msg);
    if (!syntaxBlocked) {
      recordMetric(userId, "publish_blocked");
      throw firstErr;
    }
    // Segunda chance: repairProjectQuality + pré-voo novamente
    const { repairProjectQuality } = await import("./quality.server");
    const rows: { path: string; content: string }[] = [];
    for (let from = 0; ; from += 1000) {
      const page = await db.from("code_files").select("path,content").eq("project_id", p.id).eq("user_id", userId).eq("deleted", false).range(from, from + 999);
      if (page.error || !page.data) break;
      rows.push(...page.data);
      if (page.data.length < 1000) break;
    }
    const usage = new Map();
    await repairProjectQuality(
      db, userId, rows, AbortSignal.timeout(120000),
      () => {}, usage, true,
    );
    try {
      const second = await healPreflightIntegrity(db, userId, p.id, p.base_sha, AbortSignal.timeout(180000));
      fs = second.files;
      repaired = second.repaired;
    } catch (secondErr) {
      recordMetric(userId, "publish_blocked");
      throw secondErr instanceof Error ? secondErr : firstErr;
    }
  }

  const provisioned = await provisionGeneratedDatabase(db, projectId, fs, database);
  const committed = await commitPending(db, userId, p.id, "deploy: atualização pelo WLC IA");
  const build = detectBuild(fs);
  const branch = p.branch || "main";
  let project = await findGitProject(token, accountId, p.repo_full_name);
  let created = false;
  if (!project) { project = await createGitProject(token, accountId, p.repo_full_name, branch, build, env); created = true; }
  else await setProjectEnv(token, accountId, project.name, env, build);
  const deploymentId = created ? await latestDeployment(token, accountId, project.name) ?? await startBuild(token, accountId, project.name, branch) : await startBuild(token, accountId, project.name, branch);
  const url = `https://${project.subdomain}`;
  const saved = await db.from("code_projects").update({ cf_project: project.name, deploy_url: url }).eq("id", p.id).eq("user_id", userId);
  if (saved.error) throw new Error("Publicação iniciada, mas não foi possível salvar o destino.");
  return { deploymentId, cfProject: project.name, url, committed: committed?.count ?? 0, repaired, databaseTables: provisioned.tables };
}

export async function monitorPublish(db: Db, userId: string, projectId: string, initial: Awaited<ReturnType<typeof startValidatedPublish>>, signal: AbortSignal, onEvent: (line: string) => void) {
  const { token, accountId } = await getCreds(db, userId);
  let deploymentId = initial.deploymentId;
  const started = Date.now();
  while (Date.now() - started < 10 * 60000) {
    signal.throwIfAborted();
    const d = await getDeployment(token, accountId, initial.cfProject, deploymentId);
    if (d.state === "success") {
      // Check THIS deployment URL, never a cached success from a previous commit.
      const url = new URL(d.url);
      if (url.protocol !== "https:" || !url.hostname.endsWith(".pages.dev")) throw new Error("URL de publicação inválida.");
      const response = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]) });
      if (!response.ok) throw new Error(`Publicação terminou, mas a página respondeu HTTP ${response.status}.`);
      await response.body?.cancel();
      recordMetric(userId, "publish_success");
      return { state: "published" as const, url: d.url, message: "Deploy confirmado e página acessível. Aparência e operações ainda precisam de teste no navegador." };
    }
    if (d.state === "failure") {
      onEvent(`🩺 Falha real na publicação (${d.stage}); iniciando recuperação cirúrgica.`);
      const healed = await healFailedDeployment(db, userId, projectId, deploymentId, initial.deploymentId);
      if (healed.state === "blocked") return { state: "blocked" as const, url: initial.url, message: healed.message };
      if (healed.state === "retry" && healed.deploymentId) deploymentId = healed.deploymentId;
      onEvent(healed.message);
    }
    await new Promise<void>((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(new Error("Publicação interrompida.")); };
      const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, 5000);
      signal.addEventListener("abort", abort, { once: true });
    });
  }
  return { state: "pending" as const, url: initial.url, message: "Publicação ainda em andamento; resultado não confirmado." };
}