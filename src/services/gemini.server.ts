// Utilitários de parsing das respostas Gemini (sem rede, sem segredos).

export function describeGeminiError(status: number, body: string): string {
  const prefix = status === 429 ? "Cota esgotada / limite de uso atingido. "
    : status === 401 ? "Chave não autorizada (401). Verifique a credencial Gemini. "
    : status === 403 ? "Acesso negado pelo Gemini (403). " : "";
  try {
    const j = JSON.parse(body) as { error?: { message?: string; status?: string } };
    if (j.error?.message) return `${prefix}Gemini ${status} ${j.error.status ?? ""}: ${j.error.message}`.trim();
  } catch {}
  return `${prefix}Gemini ${status}: ${body.slice(0, 300)}`;
}

/** Extrai o texto de um evento SSE do Gemini. */
export function textFromGeminiChunk(json: string): string {
  try {
    const j = JSON.parse(json) as {
      candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[];
    };
    return (j.candidates?.[0]?.content?.parts ?? [])
      .filter((p) => !p.thought)
      .map((p) => p.text ?? "")
      .join("");
  } catch {
    return "";
  }
}

