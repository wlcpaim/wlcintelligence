/** Orçamentos em caracteres, não estimativas de faturamento em tokens. */
export const PRO_CONTEXT_BUDGET = 220_000;
export const PRO_HISTORY_BUDGET = 24_000;
export type ProMessage = { role: "user" | "model"; content: string };

/** Mantém mensagens recentes inteiras, sem cortar JSON/código no meio. */
export function boundedProHistory(history: ProMessage[]): ProMessage[] {
  const result: ProMessage[] = [];
  let remaining = PRO_HISTORY_BUDGET;
  for (const message of history.slice(-12).reverse()) {
    if (message.content.length > remaining) break;
    result.unshift(message);
    remaining -= message.content.length;
  }
  // Um turno model órfão não deve iniciar a conversa enviada ao provedor.
  while (result[0]?.role === "model") result.shift();
  return result;
}

export function proFileCost(file: { path: string; content: string }): number {
  return file.path.length + file.content.length + 50;
}