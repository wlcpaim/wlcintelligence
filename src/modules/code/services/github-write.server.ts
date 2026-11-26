// Escrita no GitHub (criar repositório e commits) — solicitada explicitamente para a área Code.
import JSZip from "jszip";
import { Buffer } from "node:buffer";
import { GITHUB_API_URL } from "@/config/app";
import { GithubError } from "@/modules/integrations/github/services/api.server";
import { exclusionReason } from "@/modules/integrations/github/services/repository.server";

export async function ghCall<T>(token: string, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${GITHUB_API_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "WLC-IA",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = text.slice(0, 200);
    try { msg = (JSON.parse(text) as { message?: string }).message ?? msg; } catch { /* não-JSON */ }
    throw new GithubError(res.status, friendly(res.status, msg));
  }
  return (text ? JSON.parse(text) : {}) as T;
}

function friendly(status: number, msg: string): string {
  if (status === 401) return "Token GitHub inválido ou expirado. Reconecte em Configurações → API.";
  if (status === 403 || status === 404) return `Sem permissão de escrita no GitHub (${status}). Use um token com permissão "Contents: write" / escopo "repo". Detalhe: ${msg}`;
  if (status === 422) return `GitHub recusou: ${msg}`;
  return `GitHub ${status}: ${msg}`;
}

export interface LoadedFile { path: string; content: string }

const MAX_FILES = 800;
export async function loadEditableRepo(token: string, repo: string) {
  const info = await ghCall<{ default_branch: string; size: number }>(token, "GET", `/repos/${repo}`);
  const branch = info.default_branch;
  let sha: string;
  try {
    sha = (await ghCall<{ object: { sha: string } }>(token, "GET", `/repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`)).object.sha;
  } catch (e) {
    if (e instanceof GithubError && (e.status === 409 || e.status === 404)) return { branch, sha: null, files: [] as LoadedFile[] };
    throw e;
  }
  const commit = await ghCall<{ tree: { sha: string } }>(token, "GET", `/repos/${repo}/git/commits/${sha}`);
  const tree = await ghCall<{ tree: { path: string; type: string; sha: string; size?: number }[] }>(token, "GET", `/repos/${repo}/git/trees/${commit.tree.sha}?recursive=1`);
  const zipRes = await fetch(`${GITHUB_API_URL}/repos/${repo}/zipball/${encodeURIComponent(branch)}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "WLC-IA",
    },
  });

  if (!zipRes.ok) {
    let msg = zipRes.statusText;
    try { msg = ((await zipRes.json()) as { message?: string }).message ?? msg; } catch {}
    throw new GithubError(zipRes.status, friendly(zipRes.status, msg));
  }

  const zipBuffer = await zipRes.arrayBuffer();
  const zip = await JSZip.loadAsync(zipBuffer);
  const files: LoadedFile[] = [];

  for (const [rawPath, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    const parts = rawPath.split("/");
    parts.shift();
    const filePath = parts.join("/");

    if (!filePath || exclusionReason(filePath, 0) || /\.(env)$/.test(filePath)) continue;

    try {
      const content = await entry.async("string");
      if (!content.includes("\0")) {
        files.push({ path: filePath, content });
      }
    } catch {}

    if (files.length >= MAX_FILES) break;
  }
  return { branch, sha, files };
}

export interface Change { path: string; content: string | null } // null = excluir

/** Um único commit atômico com todas as alterações, na ordem em que foram feitas. */
export async function commitChanges(token: string, repo: string, branch: string, message: string, changes: Change[], expectedBase?: string | null) {
  const enc = (s: string) => Buffer.from(s, "utf8").toString("base64");
  let parent: string | null = null;
  try {
    parent = (await ghCall<{ object: { sha: string } }>(token, "GET", `/repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`)).object.sha;
  } catch (e) {
    if (!(e instanceof GithubError && (e.status === 409 || e.status === 404))) throw e;
  }
  if (expectedBase !== undefined && parent !== expectedBase) {
    throw new Error("A branch mudou no GitHub; sincronize o projeto antes de enviar. Nenhum arquivo remoto foi sobrescrito.");
  }
  let pending = changes;
  if (!parent) {
    // Repositório vazio: a API Git exige um primeiro commit, criado via Contents API.
    const first = changes.find((c) => c.content !== null);
    if (!first || first.content === null) throw new Error("Nada para enviar em um repositório vazio.");
    const r = await ghCall<{ commit: { sha: string } }>(token, "PUT", `/repos/${repo}/contents/${first.path.split("/").map(encodeURIComponent).join("/")}`, { message, content: enc(first.content), branch });
    parent = r.commit.sha;
    pending = changes.filter((c) => c !== first);
    if (!pending.length) return parent;
  }
  const base = await ghCall<{ tree: { sha: string } }>(token, "GET", `/repos/${repo}/git/commits/${parent}`);
  const tree = [];
  for (const c of pending) {
    if (c.content === null) { tree.push({ path: c.path, mode: "100644", type: "blob", sha: null }); continue; }
    const b = await ghCall<{ sha: string }>(token, "POST", `/repos/${repo}/git/blobs`, { content: enc(c.content), encoding: "base64" });
    tree.push({ path: c.path, mode: "100644", type: "blob", sha: b.sha });
  }
  const newTree = await ghCall<{ sha: string }>(token, "POST", `/repos/${repo}/git/trees`, { base_tree: base.tree.sha, tree });
  const commit = await ghCall<{ sha: string }>(token, "POST", `/repos/${repo}/git/commits`, { message, tree: newTree.sha, parents: [parent] });
  await ghCall(token, "PATCH", `/repos/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, { sha: commit.sha, force: false });
  return commit.sha;
}
