// Lógica pura de rotação (testável sem rede).
export interface RotationKey {
  id: string;
  google_project: string;
  is_primary: boolean;
  enabled: boolean;
  cooldown_until: string | null;
  created_at: string;
  status?: string;
  /** Posição na fila: quem falhou/voltou recebe "agora" e vai para o fim. */
  last_checked_at?: string | null;
  last_used_at?: string | null;
}
/** Limite total de tentativas (chaves × modelos). Com fallback de modelos precisa ser maior. */
export const MAX_ATTEMPTS = 12;

const queuePos = (k: RotationKey): string => k.last_checked_at ?? k.created_at;
export function failedStatus(status: number | null): string {
  return status === 429 ? "quota_exhausted" : "error";
}
export function isFailedKey(status?: string): boolean {
  return status === "error" || status === "quota_exhausted";
}

/**
 * Fila de fallback: chaves saudáveis primeiro (principal saudável na frente, demais pela
 * posição na fila). Chaves recusadas (status "error") vão para o fim e só são usadas como
 * último recurso quando a espera delas já acabou. Desativadas nunca entram.
 */
export function orderCandidates<T extends RotationKey>(keys: T[], now: Date = new Date(), strategy: "primary" | "least-recently-used" = "primary"): T[] {
  const ready = keys.filter(
    (k) => k.enabled && (!k.cooldown_until || new Date(k.cooldown_until) <= now),
  );
  const healthy = ready
    .filter((k) => !isFailedKey(k.status))
    .sort(
      (a, b) =>
        Number(b.is_primary) - Number(a.is_primary) || queuePos(a).localeCompare(queuePos(b)),
    );
  const failed = ready
    .filter((k) => isFailedKey(k.status))
    .sort((a, b) => queuePos(a).localeCompare(queuePos(b)));
  if (strategy === "least-recently-used") {
    // Quotas are shared: compare the most recent usage of each Google project first.
    const projectUsage = new Map<string, string>();
    for (const key of keys) {
      const project = key.google_project || key.id;
      const usage = key.last_used_at ?? "";
      if (usage > (projectUsage.get(project) ?? "")) projectUsage.set(project, usage);
    }
    healthy.sort((a, b) =>
      (projectUsage.get(a.google_project || a.id) ?? "").localeCompare(projectUsage.get(b.google_project || b.id) ?? "") ||
      (a.last_used_at ?? "").localeCompare(b.last_used_at ?? "") ||
      Number(b.is_primary) - Number(a.is_primary) || queuePos(a).localeCompare(queuePos(b)) || a.id.localeCompare(b.id),
    );
  }
  return [...healthy, ...failed];
}

/** Erros em que vale tentar outra chave. 400 (pedido inválido) não troca de chave. */
export function isRecoverable(status: number): boolean {
  return status === 401 || status === 403 || status === 429 || status >= 500;
}

/** Cota é por projeto Google: 429 esgota todas as chaves do mesmo projeto. */
export function sharesQuota(status: number): boolean {
  return status === 429;
}

export function cooldownMs(status: number): number {
  if (status === 429) return 60_000;
  if (status === 401 || status === 403) return 60_000;
  return 15_000;
}

/** Itera candidatos respeitando cota compartilhada, limite de tentativas e abort. */
export async function runWithRotation<T extends RotationKey, R>(
  keys: T[],
  attempt: (
    key: T,
  ) => Promise<{ ok: true; value: R } | { ok: false; status: number; error: string }>,
  opts: {
    signal?: AbortSignal;
    onFail?: (key: T, status: number, error: string) => Promise<void> | void;
    now?: Date;
  } = {},
): Promise<{ ok: true; value: R; key: T } | { ok: false; error: string; aborted: boolean }> {
  const exhaustedProjects = new Set<string>();
  let lastError = "Nenhuma chave Gemini ativa disponível.";
  let tries = 0;
  for (const key of orderCandidates(keys, opts.now)) {
    if (opts.signal?.aborted)
      return { ok: false, error: "Interrompido pelo usuário.", aborted: true };
    if (tries >= MAX_ATTEMPTS) break;
    if (key.google_project && exhaustedProjects.has(key.google_project)) continue;
    tries++;
    let r: Awaited<ReturnType<typeof attempt>>;
    try {
      r = await attempt(key);
    } catch (e) {
      if (opts.signal?.aborted)
        return { ok: false, error: "Interrompido pelo usuário.", aborted: true };
      r = { ok: false, status: 503, error: e instanceof Error ? e.message : String(e) };
    }
    if (r.ok) return { ok: true, value: r.value, key };
    lastError = r.error;
    await opts.onFail?.(key, r.status, r.error);
    if (!isRecoverable(r.status)) break;
    if (sharesQuota(r.status) && key.google_project) exhaustedProjects.add(key.google_project);
  }
  return { ok: false, error: lastError, aborted: false };
}
