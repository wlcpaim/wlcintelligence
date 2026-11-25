import type { Db } from "@/modules/integrations/core/runs.server";
import { getCreds, getDbEnv, findGitProject, createGitProject, setProjectEnv, startBuild, latestDeployment, getDeployment } from "@/modules/integrations/cloudflare/services/cloudflare.server";
import { detectBuild, deployEnvVars } from "@/modules/integrations/cloudflare/build";
import { commitPending } from "@/modules/code/services/commit.server";
import { inspectContracts } from "../core/contracts";
import { findMissingLocalImports } from "../core/gaps";
import { diagnoseBuildReadiness } from "../core/bootstrap";
import { healFailedDeployment } from "./deploy-healer.server";

/** Shared by authenticated Chat and Code; no client bypass of validation. */
export async function startValidatedPublish(db: Db, userId: string, projectId: string) {
  const { data: p, error } = await db.from("code_projects").select("*").eq("id", projectId).eq("user_id", userId).single();
  if (error || !p) throw new Error("Projeto não encontrado.");
  if (!p.repo_full_name) throw new Error("Vincule um repositório GitHub antes do Deploy.");
  const { data: fs, error: fileError } = await db.from("code_files").select("path,content").eq("project_id", p.id).eq("user_id", userId).eq("deleted", false).limit(3000);
  if (fileError || !fs) throw new Error("Não foi possível validar arquivos antes de publicar.");
  const issues = [...inspectContracts(fs).issues.map(i => `${i.path}: ${i.message}`), ...diagnoseBuildReadiness(fs).map(i => `${i.path}: ${i.message}`), ...findMissingLocalImports(fs).map(i => `${i.importer}: falta ${i.target}`)];
  if (issues.length) throw new Error(`Publicação bloqueada por integridade: ${issues.slice(0, 5).join("; ")}`);
  // Check provider credentials before committing: a missing connection must not cause side effects.
  const { token, accountId } = await getCreds(db, userId);
  const env = deployEnvVars(await getDbEnv(db, userId));
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
  return { deploymentId, cfProject: project.name, url, committed: committed?.count ?? 0 };
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