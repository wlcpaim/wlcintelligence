// Diagnóstico GitHub: cada permissão é confirmada pela API, nunca presumida.
import type { DiagnosticCheck, DiagnosticReport } from "../../core/types";
import { safeMessage } from "../../core/errors";
import { gh, fetchRepos, fetchRepo } from "./api.server";
import { identify } from "./connection.server";

export async function diagnoseGithub(
  token: string,
  defaultRepo: string | null,
): Promise<DiagnosticReport> {
  const checks: DiagnosticCheck[] = [];
  const step = async (name: string, fn: () => Promise<string>): Promise<boolean> => {
    try {
      checks.push({ name, ok: true, detail: await fn() });
      return true;
    } catch (e) {
      checks.push({ name, ok: false, detail: safeMessage(e) });
      return false;
    }
  };
  const authed = await step("Autenticação e identificação da conta", async () => {
    const i = await identify(token);
    return `@${i.login} (ID ${i.account_id})`;
  });
  if (authed) {
    await step(
      "Acesso aos repositórios",
      async () => `${(await fetchRepos(token)).length} repositório(s) acessível(is)`,
    );
    if (defaultRepo) {
      let push = false;
      const repoOk = await step(`Leitura de ${defaultRepo}`, async () => {
        const r = await fetchRepo(token, defaultRepo);
        push = r.permissions.push;
        if (!r.permissions.pull) throw new Error("Sem permissão de leitura");
        return `Branch principal: ${r.default_branch}`;
      });
      if (repoOk) {
        checks.push({
          name: "Permissão de escrita (informada pela API)",
          ok: push,
          detail: push ? "push = true" : "push = false — somente leitura",
        });
        await step("Acesso a branches", async () => {
          const { data } = await gh<unknown[]>(
            token,
            `/repos/${defaultRepo}/branches?per_page=100`,
          );
          return `${data.length} branch(es)`;
        });
        await step("Acesso a arquivos", async () => {
          const { data } = await gh<unknown[]>(token, `/repos/${defaultRepo}/contents/`);
          return `${Array.isArray(data) ? data.length : 1} item(ns) na raiz`;
        });
      }
    } else
      checks.push({
        name: "Permissões em repositório",
        ok: true,
        detail:
          "Selecione um repositório padrão para testar leitura, escrita, branches e arquivos.",
      });
  }
  return { ok: checks.every((c) => c.ok), ranAt: new Date().toISOString(), checks };
}
