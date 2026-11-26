import { expect, it, vi } from "vitest";
import type { Db } from "@/modules/integrations/core/runs.server";
import { generateProCopilot } from "./pro-copilot.server";

const mocks = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock("@/modules/integrations/gemini/services/chat-stream.server", () => ({ openChatStream: mocks.open }));

function output(value: unknown) {
  return { ok: true, response: new Response(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(value) }] } }] })}\n\n`), keyId: "test", model: "test" };
}

it("runs PICK/PLAN/BUILD with one project map and returns an exact reviewable proposal", async () => {
  const files = [{ path: "src/app.ts", content: "export const value = 1;", updated_at: "2026-11-26T00:00:00Z", deleted: false }];
  const from = vi.fn(() => ({
    select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: { name: "Test" } }),
    range: vi.fn().mockResolvedValue({ data: files, error: null }),
  }));
  mocks.open.mockReset();
  mocks.open
    .mockResolvedValueOnce(output({ read: ["src/app.ts"] }))
    .mockResolvedValueOnce(output({ goal: "Update", impact: ["src/app.ts"] }))
    .mockResolvedValueOnce(output({ summary: "Updated", changes: [{ path: "src/app.ts", edits: [{ search: "value = 1", replace: "value = 2" }] }] }));
  const answer = await generateProCopilot({ from } as unknown as Db, "owner", "project", "Change value to 2", "src/app.ts", [], new AbortController().signal);
  expect(answer.changes[0]).toEqual({ path: "src/app.ts", content: "export const value = 2;", before: "export const value = 1;", expectedUpdatedAt: "2026-11-26T00:00:00Z" });
  expect(mocks.open).toHaveBeenCalledTimes(3);
  const payloads = mocks.open.mock.calls.map(call => {
    const messages = call[2] as { content: string }[];
    return JSON.parse(messages.at(-1)?.content ?? "{}") as Record<string, unknown>;
  });
  expect(payloads[0]?.["paths"]).toEqual(["src/app.ts"]);
  expect(payloads[1]?.["paths"]).toBeUndefined();
  expect(payloads[2]?.["paths"]).toBeUndefined();
  for (const call of mocks.open.mock.calls) expect(call[5]).toEqual(expect.objectContaining({ rotationStrategy: "least-recently-used" }));
});