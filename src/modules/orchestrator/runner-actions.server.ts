// Terminal real dos bots: dispara o workflow WLC Runner no GitHub Actions e lê o log.
import { GITHUB_API_URL } from "@/config/app";
import { ghCall } from "@/modules/code/services/github-write.server";
import { RUNNER_WORKFLOW_FILE, RUNNER_WORKFLOW_PATH, RUNNER_WORKFLOW_YAML, trimLog } from "./runner-commands";

const enc = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Garante o workflow no repositório (escrita explícita pedida pelo dono). */
export async function ensureRunner(token: string, repo: string, branch: string): Promise<string> {
  const path = RUNNER_WORKFLOW_PATH.split("/").map(encodeURIComponent).join("/");
  let sha: string | undefined;
  try {
    const cur = await ghCall<{ sha: string; content: string }>(token, "GET", `/repos/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`);
    if (atob(cur.content.replace(/\s/g, "")).includes("WLC_COMMAND")) return "Terminal já instalado.";
    sha = cur.sha;
  } catch { /* não existe */ }
  await ghCall(token, "PUT", `/repos/${repo}/contents/${path}`, { message: "chore: instalar terminal WLC Runner", content: enc(RUNNER_WORKFLOW_YAML), branch, ...(sha ? { sha } : {}) });
  return "Terminal WLC Runner instalado no repositório.";
}

interface Run { id: number; status: string; conclusion: string | null; html_url: string; display_title?: string }

/** Executa um comando na VM Ubuntu e espera até ~50s pelo resultado. */
export async function runCommand(token: string, repo: string, branch: string, command: string, signal?: AbortSignal) {
  await ensureRunner(token, repo, branch);
  const tag = crypto.randomUUID().slice(0, 8);
  await ghCall(token, "POST", `/repos/${repo}/actions/workflows/${RUNNER_WORKFLOW_FILE}/dispatches`, { ref: branch, inputs: { command, run_tag: tag } });
  let run: Run | undefined;
  for (let i = 0; i < 25; i++) {
    signal?.throwIfAborted();
    await sleep(i < 3 ? 2000 : 2500);
    const list = await ghCall<{ workflow_runs: Run[] }>(token, "GET", `/repos/${repo}/actions/workflows/${RUNNER_WORKFLOW_FILE}/runs?per_page=10&event=workflow_dispatch`);
    run = list.workflow_runs.find((r) => r.display_title?.includes(tag)) ?? run;
    if (run?.status === "completed") break;
  }
  if (!run) return { runId: null, text: "Execução enviada, mas ainda não apareceu no GitHub. Use run_status em seguida." };
  if (run.status !== "completed") return { runId: run.id, text: `Rodando (run ${run.id}, ${run.status}). Use run_status {"run_id":"${run.id}"} depois. ${run.html_url}` };
  return { runId: run.id, text: `Concluído: ${run.conclusion} (run ${run.id})\n${await runLogs(token, repo, String(run.id))}` };
}

export async function runStatus(token: string, repo: string, runId: string) {
  const r = await ghCall<Run>(token, "GET", `/repos/${repo}/actions/runs/${encodeURIComponent(runId)}`);
  return `run ${r.id}: ${r.status}${r.conclusion ? ` → ${r.conclusion}` : ""} ${r.html_url}`;
}

export async function runLogs(token: string, repo: string, runId?: string) {
  let id = runId;
  if (!id) {
    const list = await ghCall<{ workflow_runs: Run[] }>(token, "GET", `/repos/${repo}/actions/workflows/${RUNNER_WORKFLOW_FILE}/runs?per_page=1`);
    id = list.workflow_runs[0] ? String(list.workflow_runs[0].id) : undefined;
    if (!id) return "Nenhuma execução ainda.";
  }
  const jobs = await ghCall<{ jobs: { id: number; conclusion: string | null }[] }>(token, "GET", `/repos/${repo}/actions/runs/${encodeURIComponent(id)}/jobs`);
  const job = jobs.jobs[0];
  if (!job) return "Sem jobs nesta execução.";
  const res = await fetch(`${GITHUB_API_URL}/repos/${repo}/actions/jobs/${job.id}/logs`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "WLC-IA" },
  });
  if (!res.ok) return `Log indisponível ainda (${res.status}).`;
  return trimLog(await res.text());
}
