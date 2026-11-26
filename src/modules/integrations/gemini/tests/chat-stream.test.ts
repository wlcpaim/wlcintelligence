import { beforeEach, expect, it, vi } from "vitest";
import type { Db } from "../../core/runs.server";
import { openChatStream } from "../services/chat-stream.server";

const mocks = vi.hoisted(() => ({ load: vi.fn(), patch: vi.fn(), stream: vi.fn(), log: vi.fn() }));
vi.mock("../services/keys.server", () => ({ loadUsableKeys: mocks.load, patchKey: mocks.patch }));
vi.mock("../services/client.server", () => ({ geminiStream: mocks.stream }));
vi.mock("../../core/runs.server", () => ({ logRun: mocks.log }));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.load.mockResolvedValue([
    { id: "bad", google_project: "one", is_primary: true, enabled: true, cooldown_until: null, created_at: "2026-01-01", status: "connected", model: "gemini-2.5-flash-lite", secret: "test-only" },
    { id: "good", google_project: "two", is_primary: false, enabled: true, cooldown_until: null, created_at: "2026-01-02", status: "connected", model: "gemini-2.5-flash-lite", secret: "test-only" },
  ]);
});

it("tries the next model on the same key after a 401 before failing", async () => {
  mocks.stream.mockResolvedValueOnce(new Response('{"error":{"message":"API key not valid"}}', { status: 401 })).mockResolvedValueOnce(new Response("data: {}\n"));
  const result = await openChatStream({} as Db, "owner", [{ role: "user", content: "Olá" }], new AbortController().signal);
  expect(mocks.stream).toHaveBeenCalledTimes(2);
  expect(result.ok && result.keyId).toBe("bad");
  expect(mocks.stream.mock.calls[1]?.[1]).not.toBe(mocks.stream.mock.calls[0]?.[1]);
});

it("moves to the next key only after every model of a key returned 401", async () => {
  const deny = () => new Response('{"error":{"message":"API key not valid"}}', { status: 401 });
  for (let i = 0; i < 5; i++) mocks.stream.mockResolvedValueOnce(deny());
  mocks.stream.mockResolvedValueOnce(new Response("data: {}\n"));
  const result = await openChatStream({} as Db, "owner", [{ role: "user", content: "Olá" }], new AbortController().signal);
  expect(mocks.stream).toHaveBeenCalledTimes(6);
  expect(result.ok && result.keyId).toBe("good");
  expect(mocks.patch).toHaveBeenCalledWith(expect.anything(), "owner", "bad", expect.objectContaining({ is_primary: false, status: "error" }));
});

it("returns the quota cause instead of a generic demand error", async () => {
  mocks.load.mockResolvedValue([{ id: "bad", google_project: "one", is_primary: true, enabled: true, cooldown_until: null, created_at: "2026-01-01", status: "connected", secret: "test-only" }]);
  mocks.stream.mockResolvedValue(new Response('{"error":{"message":"Quota exceeded"}}', { status: 429 }));
  const result = await openChatStream({} as Db, "owner", [], new AbortController().signal);
  expect(!result.ok && result.error).toContain("Cota esgotada");
  expect(mocks.patch).toHaveBeenCalledWith(expect.anything(), "owner", "bad", expect.objectContaining({ status: "quota_exhausted", is_primary: false }));
});

it("uses a separate copilot instruction and code-sized output without changing chat defaults", async () => {
  mocks.stream.mockResolvedValue(new Response("data: {}\n"));
  const signal = new AbortController().signal;
  await openChatStream({} as Db, "owner", [], signal, false, { instruction: "Copilot WLC", maxOutputTokens: 6000 });
  expect(mocks.stream.mock.calls[0]?.slice(4)).toEqual([false, "Copilot WLC", 6000, undefined]);
  await openChatStream({} as Db, "owner", [], signal);
  expect(mocks.stream.mock.calls[1]?.slice(4)).toEqual([false, undefined, undefined, undefined]);
});
it("uses the preferred key first and keeps the others as fallback", async () => {
  mocks.stream.mockResolvedValue(new Response("data: {}\n"));
  const result = await openChatStream({} as Db, "owner", [], new AbortController().signal, false, { instruction: "x", maxOutputTokens: 100, preferredKeyId: "good" });
  expect(result.ok && result.keyId).toBe("good");
  mocks.stream.mockReset();
  mocks.stream.mockResolvedValueOnce(new Response('{"error":{"message":"Quota exceeded"}}', { status: 429 })).mockResolvedValueOnce(new Response("data: {}\n"));
  const fallback = await openChatStream({} as Db, "owner", [], new AbortController().signal, false, { instruction: "x", maxOutputTokens: 100, preferredKeyId: "good" });
  expect(fallback.ok && fallback.keyId).toBe("bad");
});

it("ignores an unknown preferred key and follows the normal rotation", async () => {
  mocks.stream.mockResolvedValue(new Response("data: {}\n"));
  const result = await openChatStream({} as Db, "owner", [], new AbortController().signal, false, { instruction: "x", maxOutputTokens: 100, preferredKeyId: "nope" });
  expect(result.ok && result.keyId).toBe("bad");
});

it("does not retry another key after a non-recoverable 400", async () => {
  mocks.stream.mockResolvedValue(new Response("bad request", { status: 400 }));
  const result = await openChatStream({} as Db, "owner", [], new AbortController().signal);
  expect(result.ok).toBe(false);
  expect(mocks.stream).toHaveBeenCalledTimes(1);
});

it("persists a shared project cooldown and skips sibling keys after 429", async () => {
  mocks.load.mockResolvedValue([
    { id: "bad", google_project: "one", is_primary: true, enabled: true, cooldown_until: null, created_at: "2026-01-01", status: "connected", secret: "first" },
    { id: "sibling", google_project: "one", is_primary: false, enabled: true, cooldown_until: null, created_at: "2026-01-02", status: "connected", secret: "sibling" },
    { id: "good", google_project: "two", is_primary: false, enabled: true, cooldown_until: null, created_at: "2026-01-03", status: "connected", secret: "reserve" },
  ]);
  mocks.stream.mockResolvedValueOnce(new Response("quota", { status: 429 })).mockResolvedValueOnce(new Response("data: {}\n"));
  const result = await openChatStream({} as Db, "owner", [], new AbortController().signal);
  expect(result.ok && result.keyId).toBe("good");
  expect(mocks.stream.mock.calls.map(call => call[0])).toEqual(["first", "reserve"]);
  expect(mocks.patch).toHaveBeenCalledWith(expect.anything(), "owner", "sibling", expect.objectContaining({ status: "quota_exhausted", cooldown_until: expect.any(String) }));
});
