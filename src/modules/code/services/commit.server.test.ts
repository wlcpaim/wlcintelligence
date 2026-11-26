import { beforeEach, expect, it, vi } from "vitest";
import type { Db } from "@/modules/integrations/core/runs.server";
import { commitPending } from "./commit.server";
const mocks = vi.hoisted(() => ({ token: vi.fn(), write: vi.fn() }));
vi.mock("@/modules/integrations/github/services/connection.server", () => ({ getToken: mocks.token }));
vi.mock("./github-write.server", () => ({ commitChanges: mocks.write }));
const original = { id: "file", path: "src/a.ts", content: "new", base_content: "old", deleted: false, updated_at: "now" };
function database(options: { backupError?: boolean; leaseError?: boolean; completeError?: boolean; noChanges?: boolean } = {}) {
  const rpc = vi.fn(async (name: string) => ({ data: name === "begin_project_commit" ? "lease" : null,
    error: options.leaseError && name === "begin_project_commit" ? { message: "Commit em andamento" } : options.completeError && name === "complete_project_commit" ? { message: "failed" } : null }));
  const from = vi.fn((table: string) => {
    const chain: Record<string, unknown> = {};
    const self = () => chain;
    Object.assign(chain, {
      select: vi.fn(self), eq: vi.fn(self), order: vi.fn(self), range: vi.fn(self), insert: vi.fn(self),
      update: vi.fn(self), delete: vi.fn(self),
      single: vi.fn(async () => ({ data: table === "code_projects" ? { id: "project", repo_full_name: "owner/site", branch: "main", base_sha: "old-sha" } : { id: "backup" }, error: options.backupError && table === "code_project_backups" ? { message: "failed" } : null })),
      then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [{ ...original, ...(options.noChanges ? { content: "old" } : {}) }], error: null }).then(resolve),
    });
    return chain;
  });
  return { db: { rpc, from } as unknown as Db, rpc };
}
beforeEach(() => { vi.resetAllMocks(); mocks.token.mockResolvedValue("test-token"); mocks.write.mockResolvedValue("accepted-sha"); });
it("não envia commit simultâneo quando já existe reserva", async () => {
  const d = database({ leaseError: true });
  await expect(commitPending(d.db, "owner", "project", "test")).rejects.toThrow("Commit em andamento");
  expect(mocks.write).not.toHaveBeenCalled();
});
it("backup recusado impede envio e libera a reserva", async () => {
  const d = database({ backupError: true });
  await expect(commitPending(d.db, "owner", "project", "test")).rejects.toThrow("Backup não salvo");
  expect(mocks.write).not.toHaveBeenCalled();
  expect(d.rpc).toHaveBeenCalledWith("release_project_commit", { p_project_id: "project", p_lease_id: "lease" });
});
it("registra o snapshot aceito sem substituir conteúdo editado durante o envio", async () => {
  const d = database();
  await expect(commitPending(d.db, "owner", "project", "test")).resolves.toMatchObject({ sha: "accepted-sha", count: 1 });
  expect(mocks.write).toHaveBeenCalledWith("test-token", "owner/site", "main", "test", [{ path: "src/a.ts", content: "new" }], "old-sha");
  expect(d.rpc).toHaveBeenCalledWith("complete_project_commit", { p_project_id: "project", p_lease_id: "lease", p_sha: "accepted-sha", p_files: [{ id: "file", content: "new", deleted: false, updated_at: "now" }] });
});
it("distingue GitHub aceito de falha do registro local", async () => {
  const d = database({ completeError: true });
  await expect(commitPending(d.db, "owner", "project", "test")).rejects.toThrow("GitHub aceitou");
  expect(mocks.write).toHaveBeenCalledOnce();
});
it("sem alterações não envia commit nem mantém reserva", async () => {
  const d = database({ noChanges: true });
  await expect(commitPending(d.db, "owner", "project", "test")).resolves.toBeNull();
  expect(mocks.write).not.toHaveBeenCalled();
  expect(d.rpc).toHaveBeenCalledWith("release_project_commit", expect.anything());
});