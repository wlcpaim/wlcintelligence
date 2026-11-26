import { beforeEach, expect, it, vi } from "vitest";
import type { Db } from "@/modules/integrations/core/runs.server";
import { healFailedDeployment } from "./deploy-healer.server";
const mocks = vi.hoisted(() => ({ creds: vi.fn(), deployment: vi.fn(), repair: vi.fn(), provision: vi.fn(), env: vi.fn(), preflight: vi.fn(), commit: vi.fn(), start: vi.fn() }));
vi.mock("@/modules/integrations/cloudflare/services/cloudflare.server", () => ({ getCreds: mocks.creds, getDbEnv: mocks.env, getDeployment: mocks.deployment, startBuild: mocks.start }));
vi.mock("@/modules/engineering/generated-app.server", () => ({ provisionGeneratedDatabase: mocks.provision }));
vi.mock("./preflight.server", () => ({ healPreflightIntegrity: mocks.preflight }));
vi.mock("./quality.server", () => ({ proposeSurgicalRepair: mocks.repair }));
vi.mock("@/modules/code/services/commit.server", () => ({ commitPending: mocks.commit }));

function database(prior: { id: string; detail: string }[] = [], content = "export const a = 1;", backupError = false) {
  const writes: string[] = [];
  const from = vi.fn((table: string) => {
    let mode = "read";
    const chain = {
      select: vi.fn(() => chain), eq: vi.fn(() => chain), limit: vi.fn(() => chain),
      single: vi.fn().mockResolvedValue({ data: { cf_project: "site", repo_full_name: "owner/site", base_sha: "sha", branch: "main" }, error: null }),
      insert: vi.fn(() => { writes.push(`insert:${table}`); mode = "insert"; return chain; }),
      update: vi.fn(() => { writes.push(`update:${table}`); mode = "update"; return chain; }),
      then: (resolve: (v: unknown) => unknown) => Promise.resolve({
        data: mode === "read" ? table === "integration_runs" ? prior : table === "code_files" ? [{ id: "file", path: "src/a.ts", content, base_content: "export const a = 1;", deleted: false, updated_at: "now" }] : [] : [{ id: "file" }],
        error: backupError && table === "code_project_backups" ? { message: "failed" } : null,
      }).then(resolve),
    };
    return chain;
  });
  return { db: { from } as unknown as Db, writes };
}
beforeEach(() => {
  vi.resetAllMocks(); mocks.creds.mockResolvedValue({ token: "test", accountId: "test" });
  mocks.deployment.mockResolvedValue({ state: "failure", logs: ["src/a.ts failed"], commitSha: "sha" });
  mocks.repair.mockResolvedValue([{ path: "src/a.ts", content: "export const a = 2;" }]);
  mocks.commit.mockResolvedValue({ sha: "next" }); mocks.start.mockResolvedValue("next-deploy");
  mocks.env.mockResolvedValue(null); mocks.provision.mockResolvedValue({ ready: true, tables: 0 }); mocks.preflight.mockResolvedValue({ files: [], repaired: 0 });
});
it("limita recuperação a três rodadas sem chamar API nem alterar arquivos", async () => {
  const d = database([{ id: "one", detail: "{}" }, { id: "two", detail: "{}" }, { id: "three", detail: "{}" }]);
  expect((await healFailedDeployment(d.db, "owner", "project", "fourth", "root")).state).toBe("blocked");
  expect(mocks.deployment).not.toHaveBeenCalled(); expect(d.writes).toEqual([]);
});
it("repetição do mesmo deploy reutiliza resultado sem duplicar commit", async () => {
  const d = database([{ id: "failed", detail: JSON.stringify({ state: "retry", deploymentId: "next" }) }]);
  expect((await healFailedDeployment(d.db, "owner", "project", "failed", "root")).deploymentId).toBe("next");
  expect(mocks.commit).not.toHaveBeenCalled();
});
it("não sobrescreve alterações locais não publicadas", async () => {
  const d = database([], "export const a = 99;");
  expect((await healFailedDeployment(d.db, "owner", "project", "root", "root")).state).toBe("blocked");
  expect(mocks.repair).not.toHaveBeenCalled(); expect(mocks.commit).not.toHaveBeenCalled();
});
it("sem backup não altera arquivos nem comita", async () => {
  const d = database([], undefined, true);
  expect((await healFailedDeployment(d.db, "owner", "project", "root", "root")).state).toBe("blocked");
  expect(d.writes).not.toContain("update:code_files"); expect(mocks.commit).not.toHaveBeenCalled();
});
it("salva backup antes de alterar, comita e retorna um novo deploymentId", async () => {
  const d = database();
  expect((await healFailedDeployment(d.db, "owner", "project", "root", "root")).deploymentId).toBe("next-deploy");
  expect(d.writes.indexOf("insert:code_project_backups")).toBeLessThan(d.writes.indexOf("update:code_files"));
  expect(mocks.commit).toHaveBeenCalledOnce(); expect(mocks.start).toHaveBeenCalledOnce();
});
it("não usa logs de um commit antigo para corrigir versão atual", async () => {
  const d = database(); mocks.deployment.mockResolvedValue({ state: "failure", logs: ["failed"], commitSha: "old" });
  expect((await healFailedDeployment(d.db, "owner", "project", "root", "root")).state).toBe("blocked");
  expect(d.writes).toEqual([]);
});
it("recuperação não comita nem republica quando banco não fica pronto", async () => {
  const d = database();
  mocks.provision.mockRejectedValue(new Error("Banco não provisionado"));
  expect((await healFailedDeployment(d.db, "owner", "project", "root", "root")).state).toBe("blocked");
  expect(mocks.commit).not.toHaveBeenCalled(); expect(mocks.start).not.toHaveBeenCalled();
});