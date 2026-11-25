import { beforeEach, describe, expect, it, vi } from "vitest";
import { gh } from "../services/api.server";
import { loadRepository, exclusionReason, redactSecrets } from "../services/repository.server";
vi.mock("../services/api.server", () => ({ gh: vi.fn() }));
const api = vi.mocked(gh);
const commit = "a".repeat(40);
const entry = (path: string, sha = "blob", size = 12) => ({ path, sha, size, type: "blob" });
const response = (data: unknown) => ({ data, headers: new Headers() });
beforeEach(() => {
  api.mockReset();
});

describe("repository analysis context", () => {
  it("loads files by immutable commit and blob and preserves exact code with line numbers", async () => {
    api
      .mockResolvedValueOnce(response({ default_branch: "main" }))
      .mockResolvedValueOnce(response({ sha: commit, commit: { tree: { sha: "tree" } } }))
      .mockResolvedValueOnce(response({ tree: [entry("src/a.ts")], truncated: false }))
      .mockResolvedValueOnce(
        response({ content: btoa("const a = 1;"), encoding: "base64", size: 12 }),
      );
    const snapshot = await loadRepository("test-token", "owner/repo", commit);
    expect(snapshot.ref).toEqual({ repo: "owner/repo", commit });
    expect(snapshot.files[0]?.content).toBe("1: const a = 1;");
    expect(api.mock.calls.map((call) => call[1])).toEqual([
      "/repos/owner/repo",
      `/repos/owner/repo/commits/${commit}`,
      "/repos/owner/repo/git/trees/tree?recursive=1",
      "/repos/owner/repo/git/blobs/blob",
    ]);
  });
  it("does not download sensitive or generated files and reports exclusions", async () => {
    api
      .mockResolvedValueOnce(response({ default_branch: "main" }))
      .mockResolvedValueOnce(response({ sha: commit, commit: { tree: { sha: "tree" } } }))
      .mockResolvedValueOnce(
        response({ tree: [entry(".env"), entry("node_modules/a.js")], truncated: true }),
      );
    const snapshot = await loadRepository("test-token", "owner/repo");
    expect(snapshot.files.map((file) => file.status)).toEqual(["excluded", "excluded"]);
    expect(snapshot.truncated).toBe(true);
    expect(api).toHaveBeenCalledTimes(3);
  });
  it("retains all readable files instead of returning only a skeleton", async () => {
    api.mockImplementation(async (_token, path) => {
      if (path.endsWith("/owner/repo")) return response({ default_branch: "main" });
      if (path.includes("/commits/"))
        return response({ sha: commit, commit: { tree: { sha: "tree" } } });
      if (path.includes("/trees/"))
        return response({ tree: [entry("a.ts", "a"), entry("b.ts", "b")], truncated: false });
      return response({
        content: btoa(path.endsWith("/a") ? "export const a = 1;" : "import { a } from './a';"),
        encoding: "base64",
        size: 24,
      });
    });
    const result = await loadRepository("test-token", "owner/repo");
    expect(result.files.map((f) => f.content)).toEqual([
      "1: export const a = 1;",
      "1: import { a } from './a';",
    ]);
  });
  it("never treats an access-denied response as successful analysis", async () => {
    api.mockRejectedValueOnce(new Error("Permission denied"));
    await expect(loadRepository("test-token", "owner/private")).rejects.toThrow(
      "Permission denied",
    );
  });
  it("omits credentials and private key files", () => {
    expect(exclusionReason("server/.env.production", 10)).toBe("Arquivo sensível");
    expect(exclusionReason("server/private.pem", 10)).toBe("Arquivo sensível");
    expect(redactSecrets('const password = "example-sensitive-password";')).not.toContain(
      "example-sensitive-password",
    );
  });
});
