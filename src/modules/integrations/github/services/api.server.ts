// Cliente HTTP da API oficial do GitHub. Recebe o token explicitamente.
import { GITHUB_API_URL } from "@/config/app";

export class GithubError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function gh<T>(
  token: string,
  path: string,
  options: { signal?: AbortSignal; method?: "GET" | "DELETE" } = {},
): Promise<{ data: T; headers: Headers }> {
  const res = await fetch(`${GITHUB_API_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "WLC-IA",
    },
  });
  const body = await res.text();
  if (!res.ok) {
    let msg = body.slice(0, 200);
    try {
      msg = (JSON.parse(body) as { message?: string }).message ?? msg;
    } catch {
      /* corpo não-JSON */
    }
    throw new GithubError(res.status, `GitHub ${res.status}: ${msg}`);
  }
  return { data: (body ? JSON.parse(body) : null) as T, headers: res.headers };
}

export interface GhUser {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string;
  html_url: string;
  email: string | null;
}
interface GhRepo {
  id: number;
  full_name: string;
  name: string;
  owner: { login: string };
  description: string | null;
  default_branch: string;
  private: boolean;
  permissions?: { admin: boolean; push: boolean; pull: boolean };
  html_url: string;
  updated_at: string;
}

export function mapRepo(r: GhRepo) {
  return {
    id: r.id,
    full_name: r.full_name,
    owner: r.owner.login,
    name: r.name,
    description: r.description,
    default_branch: r.default_branch,
    private: r.private,
    permissions: {
      admin: !!r.permissions?.admin,
      push: !!r.permissions?.push,
      pull: !!r.permissions?.pull,
    },
    html_url: r.html_url,
    updated_at: r.updated_at,
  };
}
export async function fetchRepos(token: string) {
  const repos: ReturnType<typeof mapRepo>[] = [];
  for (let page = 1; page <= 50; page++) {
    const { data, headers } = await gh<GhRepo[]>(
      token,
      `/user/repos?per_page=100&sort=updated&page=${page}`,
    );
    repos.push(...data.map(mapRepo));
    if (!headers.get("link")?.includes('rel="next"')) return repos;
  }
  throw new Error(
    "A listagem excedeu o limite de repositórios. Restrinja o acesso da conexão GitHub.",
  );
}
export async function fetchRepo(token: string, fullName: string) {
  return mapRepo((await gh<GhRepo>(token, `/repos/${fullName}`)).data);
}

export async function deleteRepo(token: string, fullName: string) {
  const repo = await fetchRepo(token, fullName);
  if (!repo.permissions.admin) {
    throw new Error("Você precisa ser administrador deste repositório para excluí-lo.");
  }
  await gh<null>(token, `/repos/${fullName}`, { method: "DELETE" });
}
