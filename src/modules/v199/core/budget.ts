/**
 * Orçamento de tempo do time 1.9.9. Fases essenciais (Arquiteto + especialistas) usam o
 * limite total; fases de melhoria param no prazo "suave" para o resultado voltar ao usuário
 * em vez de estourar o tempo e perder tudo.
 */
export const TEAM_HARD_LIMIT_MS = 480_000;
export const TEAM_SOFT_BUDGET_MS = 330_000;

export function isPastDeadline(deadline: number | undefined, now = Date.now()): boolean {
  return deadline !== undefined && now >= deadline;
}

/** Sinal que aborta no cancelamento do pedido OU quando o prazo suave acaba. */
export function phaseSignal(signal: AbortSignal, deadline: number | undefined, now = Date.now()): AbortSignal {
  if (deadline === undefined) return signal;
  return AbortSignal.any([signal, AbortSignal.timeout(Math.max(1, deadline - now))]);
}
