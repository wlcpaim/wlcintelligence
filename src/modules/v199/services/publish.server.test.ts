import { beforeEach, expect, it, vi } from "vitest";
import type { Db } from "@/modules/integrations/core/runs.server";
import { monitorPublish, startValidatedPublish } from "./publish.server";

const mocks = vi.hoisted(() => ({ creds: vi.fn(), deployment: vi.fn(), heal: vi.fn(), preflight: vi.fn(), provision: vi.fn(), commit: vi.fn(), env: vi.fn(), find: vi.fn(), setEnv: vi.fn(), start: vi.fn() }));
vi.mock("@/modules/integrations/cloudflare/services/cloudflare.server", () => ({ getCreds: mocks.creds, getDeployment: mocks.deployment, getDbEnv: mocks.env, findGitProject: mocks.find, setProjectEnv: mocks.setEnv, startBuild: mocks.start }));
vi.mock("./deploy-healer.server", () => ({ healFailedDeployment: mocks.heal }));
vi.mock("./preflight.server", () => ({ healPreflightIntegrity: mocks.preflight }));
vi.mock("@/modules/engineering/generated-app.server", () => ({ provisionGeneratedDatabase: mocks.provision }));
vi.mock("@/modules/code/services/commit.server", () => ({ commitPending: mocks.commit }));
const db = {} as Db;
const initial = { deploymentId: "first", cfProject: "test-project", url: "https://test-project.pages.dev", committed: 0, repaired: 0, databaseTables: 0 };
function projectDatabase() {
  const chain = {
    select: vi.fn(() => chain), eq: vi.fn(() => chain),
    single: vi.fn().mockResolvedValue({ data: { id: "project", repo_full_name: "owner/site", base_sha: "base", branch: "main" }, error: null }),
    update: vi.fn(() => chain),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve),
  };
  return { from: vi.fn(() => chain) } as unknown as Db;
}
beforeEach(() => { vi.resetAllMocks(); mocks.creds.mockResolvedValue({ token: "test", accountId: "test" }); mocks.provision.mockResolvedValue({ ready: true, tables: 0 }); });
it("não encerra com sucesso quando recuperação falha", async () => {
  mocks.deployment.mockResolvedValue({ state: "failure", stage: "build" });
  mocks.heal.mockResolvedValue({ state: "blocked", message: "Nenhuma correção segura" });
  const result = await monitorPublish(db, "owner", "project", initial, new AbortController().signal, () => {});
  expect(result.state).toBe("blocked");
  expect(mocks.heal).toHaveBeenCalledWith(db, "owner", "project", "first", "first");
});
it("verifica a URL do deploy exato, não a URL antiga do projeto", async () => {
  mocks.deployment.mockResolvedValue({ state: "success", url: "https://exact.test-project.pages.dev" });
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("<html/>"));
  const result = await monitorPublish(db, "owner", "project", initial, new AbortController().signal, () => {});
  expect(result.state).toBe("published");
  expect(String(fetchSpy.mock.calls[0]?.[0])).toBe("https://exact.test-project.pages.dev/");
  fetchSpy.mockRestore();
});
it("HTTP falho não equivale a publicação acessível", async () => {
  mocks.deployment.mockResolvedValue({ state: "success", url: "https://exact.test-project.pages.dev" });
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("failed", { status: 503 }));
  await expect(monitorPublish(db, "owner", "project", initial, new AbortController().signal, () => {})).rejects.toThrow("503");
  fetchSpy.mockRestore();
});
it("checks provider credentials before any repair or commit side effects", async () => {
  mocks.creds.mockRejectedValue(new Error("Conecte Cloudflare"));
  await expect(startValidatedPublish(projectDatabase(), "owner", "project")).rejects.toThrow("Conecte Cloudflare");
  expect(mocks.preflight).not.toHaveBeenCalled();
  expect(mocks.commit).not.toHaveBeenCalled();
});
it("repairs preflight before committing and starts deployment using the repaired snapshot", async () => {
  mocks.env.mockResolvedValue(null);
  mocks.preflight.mockResolvedValue({ files: [{ path: "package.json", content: JSON.stringify({ scripts: { build: "vite build" }, dependencies: { vite: "^5.4.0" } }) }], repaired: 1 });
  mocks.commit.mockResolvedValue({ count: 1, sha: "fixed" });
  mocks.find.mockResolvedValue({ name: "site", subdomain: "site.pages.dev" });
  mocks.start.mockResolvedValue("next-deployment");
  const result = await startValidatedPublish(projectDatabase(), "owner", "project");
  expect(result).toMatchObject({ repaired: 1, committed: 1, deploymentId: "next-deployment" });
  expect(mocks.preflight.mock.invocationCallOrder[0]).toBeLessThan(mocks.commit.mock.invocationCallOrder[0] ?? 0);
  expect(mocks.commit.mock.invocationCallOrder[0]).toBeLessThan(mocks.start.mock.invocationCallOrder[0] ?? 0);
  expect(mocks.provision.mock.invocationCallOrder[0]).toBeLessThan(mocks.commit.mock.invocationCallOrder[0] ?? 0);
});
it("não envia commit nem inicia Deploy se as tabelas não forem provisionadas", async () => {
  mocks.env.mockResolvedValue(null);
  mocks.preflight.mockResolvedValue({ files: [], repaired: 0 });
  mocks.provision.mockRejectedValue(new Error("Banco não provisionado"));
  await expect(startValidatedPublish(projectDatabase(), "owner", "project")).rejects.toThrow("Banco não provisionado");
  expect(mocks.commit).not.toHaveBeenCalled();
  expect(mocks.start).not.toHaveBeenCalled();
});
it("does not commit or deploy when preflight remains blocked", async () => {
  mocks.env.mockResolvedValue(null);
  mocks.preflight.mockRejectedValue(new Error("Publicação bloqueada após autocorreção"));
  await expect(startValidatedPublish(projectDatabase(), "owner", "project")).rejects.toThrow("bloqueada");
  expect(mocks.commit).not.toHaveBeenCalled();
  expect(mocks.start).not.toHaveBeenCalled();
});