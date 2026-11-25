/** Remove qualquer coisa parecida com segredo de mensagens antes de exibir/registrar. */
export function safeMessage(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  return m.replace(/(AIza|AQ\.|ghp_|github_pat_|gho_)[\w.-]+/g, "[redacted]").slice(0, 500);
}
