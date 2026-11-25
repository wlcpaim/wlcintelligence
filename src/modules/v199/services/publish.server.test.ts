import { beforeEach, expect, it, vi } from "vitest";
import type { Db } from "@/modules/integrations/core/runs.server";
import { monitorPublish } from "./publish.server";

const mocks = vi.hoisted(() => ({ creds: vi.fn(), deployment: vi.fn(), heal: vi.fn() }));
vi.mock("@/modules/integrations/cloudflare/services/cloudflare.server", () => ({ getCreds: mocks.creds, getDeployment: mocks.deployment }));
vi.mock("./deploy-healer.server", () => ({ healFailedDeployment: mocks.heal }));
vi.mock("@/modules/code/services/commit.server", () => ({ commitPending: vi.fn() }));
const db = {} as Db;
const initial = { deploymentId: "first", cfProject: "test-project", url: "https://test-project.pages.dev", committed: 0 };
beforeEach(() => { vi.resetAllMocks(); mocks.creds.mockResolvedValue({ token: "test", accountId: "test" }); });
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