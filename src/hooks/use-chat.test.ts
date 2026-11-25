import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useChat } from "./use-chat";
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: { access_token: "test-session" } } })),
    },
  },
}));
afterEach(() => {
  vi.unstubAllGlobals();
});
describe("repository chat streaming", () => {
  it("sends the repository reference and keeps the final server-assigned identifier", async () => {
    const fetcher = vi.fn(
      async (_url: unknown, _options: RequestInit) =>
        new Response(
          `${JSON.stringify({ type: "delta", text: "part" })}\n${JSON.stringify({ type: "complete", text: "````markdown\n#bg00007 — Bug\n\nEvidence\n````" })}\n`,
        ),
    );
    vi.stubGlobal("fetch", fetcher);
    localStorage.setItem("wlc.version", "wlc-1.5.6");
    const { result } = renderHook(() => useChat([], "11111111-1111-4111-8111-111111111111"));
    await act(async () => {
      await result.current.send(
        "Review",
        { repo: "owner/repo", commit: "a".repeat(40) },
        { files: ["src/a.ts"], full: false },
      );
    });
    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[1]?.content).toContain("#bg00007");
    const options = fetcher.mock.calls[0]?.[1];
    expect(JSON.parse(String(options?.body))).toEqual({
      conversationId: "11111111-1111-4111-8111-111111111111",
      message: "Review",
      repository: { repo: "owner/repo", commit: "a".repeat(40) },
      files: ["src/a.ts"],
      full: false,
    });
    expect(result.current.error).toBeNull();
  });
  it("Stop aborts without retrying or duplicating messages", async () => {
    const fetcher = vi.fn(
      (_url: unknown, options: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          options.signal?.addEventListener("abort", () =>
            reject(new DOMException("Stopped", "AbortError")),
          );
        }),
    );
    vi.stubGlobal("fetch", fetcher);
    const { result } = renderHook(() => useChat([], "11111111-1111-4111-8111-111111111111"));
    let sending: Promise<void> | undefined;
    act(() => {
      sending = result.current.send("Review");
    });
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    await act(async () => {
      result.current.stop();
      await sending;
    });
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.streaming).toBe(false);
    expect(result.current.error).toBeNull();
  });
});
