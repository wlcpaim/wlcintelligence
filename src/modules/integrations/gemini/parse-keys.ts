/** Extrai chaves Gemini de um texto colado (uma por linha, espaços ou vírgulas), sem duplicadas. */
export const KEY_PATTERN = /^(AQ\.|AIza)[\w.-]{20,}$/;
export function parseKeys(text: string): string[] {
  const out: string[] = [];
  for (const t of text.split(/[\s,;]+/)) {
    const k = t.trim();
    if (k && KEY_PATTERN.test(k) && !out.includes(k)) out.push(k);
  }
  return out;
}
