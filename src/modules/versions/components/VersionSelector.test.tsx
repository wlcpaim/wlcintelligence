import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sync: vi.fn(),
  invalidateQueries: vi.fn(),
}));
vi.mock("@tanstack/react-start", () => ({ useServerFn: () => mocks.sync }));
vi.mock("@tanstack/react-query", async importOriginal => ({
  ...await importOriginal<typeof import("@tanstack/react-query")>(),
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}));
vi.mock("../functions/versions.functions", () => ({
  syncChatVersions: vi.fn(), listChatVersions: vi.fn(), getTrainingHistory: vi.fn(),
}));

import { useVersionsAutoSync } from "./VersionSelector";

describe("version auto-sync", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.sync.mockResolvedValue({ changed: true });
  });
  afterEach(() => vi.useRealTimers());

  it("syncs immediately, refreshes changed versions, and stops on unmount", async () => {
    const { unmount } = renderHook(() => useVersionsAutoSync());
    await act(async () => { await Promise.resolve(); });
    expect(mocks.sync).toHaveBeenCalledTimes(1);
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["chat-versions"] });
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(mocks.sync).toHaveBeenCalledTimes(2);
    unmount();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocks.sync).toHaveBeenCalledTimes(2);
  });

  it("does not refresh unchanged versions", async () => {
    mocks.sync.mockResolvedValue({ changed: false });
    const { unmount } = renderHook(() => useVersionsAutoSync());
    await act(async () => { await Promise.resolve(); });
    expect(mocks.sync).toHaveBeenCalledTimes(1);
    expect(mocks.invalidateQueries).not.toHaveBeenCalled();
    unmount();
  });
});