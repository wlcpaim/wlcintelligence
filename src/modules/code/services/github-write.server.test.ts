import { afterEach, expect, it, vi } from "vitest";
import { Buffer } from "node:buffer";
import { commitChanges } from "./github-write.server";

afterEach(() => vi.unstubAllGlobals());

it("não escreve na branch quando o commit remoto mudou", async () => {
  const request = vi.fn().mockResolvedValue(Response.json({ object: { sha: "new-parent" } }));
  vi.stubGlobal("fetch", request);
  await expect(commitChanges("test-token", "owner/app", "main", "test", [{ path: "src/a.ts", content: "updated" }], "old-parent"))
    .rejects.toThrow("branch mudou");
  expect(request).toHaveBeenCalledTimes(1);
  expect(request.mock.calls[0]?.[1]?.method).toBe("GET");
});

it.each([true, false])("envia arquivo Unicode grande sem estouro de pilha (repo vazio: %s)", async (empty) => {
  const source = 'export const texto = "ação 🛒";\n'.repeat(20_000);
  const uploaded: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const path = new URL(input).pathname;
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    if (init?.method === "GET" && path.includes("/git/ref/")) {
      return empty ? new Response('{"message":"empty"}', { status: 409 })
        : Response.json({ object: { sha: "parent" } });
    }
    if (path.includes("/contents/") || path.endsWith("/git/blobs")) {
      uploaded.push(String(body["content"]));
      return Response.json({ commit: { sha: "initial" }, sha: "blob" });
    }
    if (init?.method === "GET") return Response.json({ tree: { sha: "tree" } });
    return Response.json({ sha: "final" });
  }));
  await expect(commitChanges("test-token", "owner/app", "main", "test", [{ path: "src/data.ts", content: source }]))
    .resolves.toBe(empty ? "initial" : "final");
  expect(uploaded).toHaveLength(1);
  expect(Buffer.from(uploaded[0] ?? "", "base64").toString("utf8")).toBe(source);
});