import { describe, it, expect, vi, afterEach } from "vitest";
import { mapRepo, deleteRepo, fetchRepos } from "../services/api.server";
import { repositoryDeletionSchema } from "../deletion";

afterEach(() => vi.unstubAllGlobals());

const apiRepo = {
  id: 1, full_name: "owner/repository", name: "repository", owner: { login: "owner" },
  description: null, default_branch: "main", private: true,
  permissions: { admin: true, push: true, pull: true }, html_url: "", updated_at: "",
};

describe("repository deletion", () => {
  it("requires the exact repository name before deletion", () => {
    expect(repositoryDeletionSchema.safeParse({ repo: "owner/repository", confirmation: "repository" }).success).toBe(false);
    expect(repositoryDeletionSchema.safeParse({ repo: "owner/repository", confirmation: "owner/repository" }).success).toBe(true);
  });
  it("rejects deletion when GitHub does not report admin access", async () => {
    const request = vi.fn().mockResolvedValue(Response.json({ ...apiRepo, permissions: { admin: false, push: true, pull: true } }));
    vi.stubGlobal("fetch", request);
    await expect(deleteRepo("test-token", "owner/repository")).rejects.toThrow("administrador");
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("deletes the requested repository and accepts GitHub's empty 204 response", async () => {
    const request = vi.fn().mockResolvedValueOnce(Response.json(apiRepo)).mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", request);
    await expect(deleteRepo("test-token", "owner/repository")).resolves.toBeUndefined();
    expect(request).toHaveBeenLastCalledWith("https://api.github.com/repos/owner/repository", expect.objectContaining({ method: "DELETE" }));
  });
  it("surfaces GitHub permission failures instead of reporting success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json(apiRepo)).mockResolvedValueOnce(Response.json({ message: "Resource not accessible by personal access token" }, { status: 403 })));
    await expect(deleteRepo("test-token", "owner/repository")).rejects.toThrow("GitHub 403");
  });
  it("lists every repository page exposed by the connected account", async () => {
    const request = vi.fn().mockResolvedValueOnce(Response.json([apiRepo], { headers: { link: '<https://api.github.com/user/repos?page=2>; rel="next"' } })).mockResolvedValueOnce(Response.json([{ ...apiRepo, id: 2, name: "second", full_name: "owner/second" }]));
    vi.stubGlobal("fetch", request);
    expect((await fetchRepos("test-token")).map((repo) => repo.full_name)).toEqual(["owner/repository", "owner/second"]);
    expect(request).toHaveBeenCalledTimes(2);
  });
});

describe("github repo mapping", () => {
  it("never claims write access the API did not report", () => {
    const r = mapRepo({
      id: 1,
      full_name: "o/r",
      name: "r",
      owner: { login: "o" },
      description: null,
      default_branch: "main",
      private: true,
      html_url: "",
      updated_at: "",
    });
    expect(r.permissions).toEqual({ admin: false, push: false, pull: false });
  });
  it("keeps the permissions returned by GitHub", () => {
    const r = mapRepo({
      id: 1,
      full_name: "o/r",
      name: "r",
      owner: { login: "o" },
      description: null,
      default_branch: "dev",
      private: false,
      permissions: { admin: false, push: true, pull: true },
      html_url: "",
      updated_at: "",
    });
    expect(r.permissions.push).toBe(true);
    expect(r.default_branch).toBe("dev");
  });
});
