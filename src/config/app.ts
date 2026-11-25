/** Identidade e configuração pública do WLC IA (sem segredos). */
export const APP_NAME = "WLC IA";
export const APP_VERSION = "0.1.0";

/**
 * Cadeia de fallback de modelos (cota free) — Novembro 2026.
 * Ordem: do mais generoso em requisições free / mais barato
 * para o que tem menos cota free (mais forte).
 *
 * Modelos 2.0-flash-lite e anteriores foram DESCONTINUADOS pelo Google.
 * A mensagem oficial pede para usar gemini-3.5-flash-lite.
 */
export const GEMINI_MODEL_FALLBACK = [
  "gemini-3.5-flash-lite", // recomendado pelo Google · mais cota free
  "gemini-3.1-flash-lite",
  "gemini-2.5-flash-lite",
  "gemini-3.6-flash",
  "gemini-3.8-flash",
] as const;

/** Modelo padrão (primeiro da cadeia). */
export const GEMINI_MODEL = GEMINI_MODEL_FALLBACK[0];

export const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
export const GITHUB_API_URL = "https://api.github.com";

/**
 * Troca modelos aposentados pelo Google pelo modelo atual da cadeia.
 * Qualquer modelo da família 1.x / 2.0 vira gemini-3.5-flash-lite.
 */
export function activeModel(model: string | null | undefined): string {
  if (!model) return GEMINI_MODEL;
  // Modelos descontinuados (2.0 e anteriores) → modelo atual
  if (/^gemini-(1\.|2\.0)/.test(model)) return GEMINI_MODEL;
  return model;
}

/**
 * Resolve a lista de modelos a tentar para uma chave.
 * Sempre começa pelo model atualizado da chave e continua a cadeia de fallback,
 * evitando modelos mortos.
 */
export function modelsForKey(keyModel: string | null | undefined): string[] {
  const preferred = activeModel(keyModel);
  const chain = [...GEMINI_MODEL_FALLBACK];
  // Garante que o preferido venha primeiro e sem duplicatas
  return [preferred, ...chain.filter((m) => m !== preferred)];
}
