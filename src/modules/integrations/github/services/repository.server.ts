import { gh } from "./api.server";
import type { RepoRef, RepositorySnapshot, RepositoryFile } from "../repository";

const MAX_FILES = 300;
const MAX_FILE_BYTES = 80_000;
const MAX_CONTEXT_BYTES = 1_000_000;
interface Entry {
  path: string;
  type: string;
  sha: string;
  size?: number;
}

export function exclusionReason(path: string, size: number): string {
  if (
    /(^|\/)(\.env(?:\..*)?|\.npmrc|\.pypirc|credentials(?:\..*)?|secrets?(?:\..*)?|id_rsa|id_ed25519)$/i.test(
      path,
    ) ||
    /\.(pem|key|p12|pfx)$/i.test(path)
  )
    return "Arquivo sensível";
  if (/(^|\/)(node_modules|vendor|dist|build|coverage|\.git|\.next)(\/|$)/.test(path))
    return "Dependências ou arquivos gerados";
  if (/\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|woff2?|ttf|mp4|mp3|exe|wasm)$/i.test(path))
    return "Arquivo binário";
  if (size > MAX_FILE_BYTES) return "Arquivo acima do limite de leitura";
  return "";
}

export function redactSecrets(text: string): string {
  return text
    .replace(
      /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g,
      "[SEGREDO OCULTO]",
    )
    .replace(/\b(?:github_pat_|gh[pousr]_)[A-Za-z0-9_]{20,}\b/g, "[SEGREDO OCULTO]")
    .replace(/\b(?:AIza[\w-]{20,}|AQ\.[\w.-]{20,}|sk-[\w-]{20,})/g, "[SEGREDO OCULTO]")
    .replace(
      /((?:api[_-]?key|secret|password|access[_-]?token|authorization)\s*[=:]\s*["'])[^\r\n"']+["']/gi,
      '$1[SEGREDO OCULTO]"',
    );
}

export async function loadRepository(
  token: string,
  repo: string,
  commit?: string,
  signal?: AbortSignal,
): Promise<RepositorySnapshot> {
  const options = signal ? { signal } : {};
  const { data: info } = await gh<{ default_branch: string }>(token, `/repos/${repo}`, options);
  const { data: revision } = await gh<{ sha: string; commit: { tree: { sha: string } } }>(
    token,
    `/repos/${repo}/commits/${encodeURIComponent(commit ?? info.default_branch)}`,
    options,
  );
  const ref: RepoRef = { repo, commit: revision.sha };
  const { data: tree } = await gh<{ tree: Entry[]; truncated: boolean }>(
    token,
    `/repos/${repo}/git/trees/${revision.commit.tree.sha}?recursive=1`,
    options,
  );
  const entries = tree.tree
    .filter((e) => e.type !== "tree")
    .sort((a, b) => a.path.localeCompare(b.path));
  const files: RepositoryFile[] = [];
  let bytes = 0;
  let included = 0;
  // Batches keep Worker requests bounded; immutable blob SHAs prevent mixed revisions.
  for (let start = 0; start < entries.length; start += 6) {
    signal?.throwIfAborted();
    const batch = entries.slice(start, start + 6);
    const results = await Promise.all(
      batch.map(async (entry): Promise<RepositoryFile> => {
        const reason =
          entry.type !== "blob"
            ? "Submódulo ou link externo"
            : exclusionReason(entry.path, entry.size ?? 0);
        if (reason) return { path: entry.path, status: "excluded", reason, content: "" };
        if (included >= MAX_FILES || bytes + (entry.size ?? MAX_FILE_BYTES) > MAX_CONTEXT_BYTES)
          return {
            path: entry.path,
            status: "excluded",
            reason: "Limite de contexto",
            content: "",
          };
        included++;
        bytes += entry.size ?? MAX_FILE_BYTES;
        const { data: blob } = await gh<{ content: string; encoding: string; size: number }>(
          token,
          `/repos/${repo}/git/blobs/${entry.sha}`,
          options,
        );
        if (blob.encoding !== "base64" || blob.size > MAX_FILE_BYTES)
          return {
            path: entry.path,
            status: "excluded",
            reason: "Conteúdo não suportado",
            content: "",
          };
        const binary = atob(blob.content.replace(/\s/g, ""));
        const decoded = new TextDecoder("utf-8", { fatal: true });
        let content: string;
        try {
          content = decoded.decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
        } catch {
          return { path: entry.path, status: "excluded", reason: "Arquivo binário", content: "" };
        }
        if (content.includes("\0"))
          return { path: entry.path, status: "excluded", reason: "Arquivo binário", content: "" };
        return {
          path: entry.path,
          status: "included",
          reason: "",
          content: redactSecrets(content)
            .split("\n")
            .map((line, i) => `${i + 1}: ${line}`)
            .join("\n"),
        };
      }),
    );
    files.push(...results);
  }
  return { ref, branch: info.default_branch, files, truncated: tree.truncated };
}
