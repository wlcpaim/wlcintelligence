import { describe, it, expect } from "vitest";
import {
  orderCandidates,
  runWithRotation,
  MAX_ATTEMPTS,
  type RotationKey,
} from "../services/rotation";

const k = (id: string, o: Partial<RotationKey> = {}): RotationKey => ({
  id,
  google_project: id,
  is_primary: false,
  enabled: true,
  cooldown_until: null,
  created_at: `2026-01-0${id.length}`,
  ...o,
});

describe("gemini rotation", () => {
  it("proactively selects the least recently used healthy project", () => {
    const keys = [
      k("a", { google_project: "p", is_primary: true, last_used_at: "2026-05-01T00:00:00Z" }),
      k("bb", { google_project: "p", last_used_at: null }),
      k("ccc", { google_project: "q", last_used_at: "2026-04-30T23:59:00Z" }),
    ];
    expect(orderCandidates(keys, new Date("2026-05-01T00:01:00Z"), "least-recently-used").map(x => x.id)).toEqual(["ccc", "bb", "a"]);
  });
  it("rotates after a successful phase and excludes cooling or disabled keys", () => {
    const now = new Date("2026-05-01T00:01:00Z");
    const keys = [k("a", { is_primary: true }), k("bb"), k("ccc", { enabled: false }), k("dddd", { cooldown_until: "2026-05-01T00:02:00Z" })];
    expect(orderCandidates(keys, now, "least-recently-used")[0]?.id).toBe("a");
    const used = keys.map(key => key.id === "a" ? { ...key, last_used_at: now.toISOString() } : key);
    expect(orderCandidates(used, now, "least-recently-used").map(x => x.id)).toEqual(["bb", "a"]);
  });
  it("uses the primary key first and skips disabled or cooling keys", () => {
    const now = new Date("2026-05-01T00:00:00Z");
    const keys = [
      k("a"),
      k("bb", { is_primary: true }),
      k("ccc", { enabled: false }),
      k("dddd", { cooldown_until: "2026-05-01T00:05:00Z" }),
    ];
    expect(orderCandidates(keys, now).map((x) => x.id)).toEqual(["bb", "a"]);
  });
  it("falls back to a reserve on a recoverable error and reports the key used", async () => {
    const r = await runWithRotation([k("a", { is_primary: true }), k("bb")], async (key) =>
      key.id === "a" ? { ok: false, status: 503, error: "x" } : { ok: true, value: 1 },
    );
    expect(r.ok && r.key.id).toBe("bb");
  });
  it("skips keys of the same Google project after a quota error", async () => {
    const tried: string[] = [];
    await runWithRotation(
      [
        k("a", { google_project: "p", is_primary: true }),
        k("bb", { google_project: "p" }),
        k("ccc", { google_project: "q" }),
      ],
      async (key) => {
        tried.push(key.id);
        return { ok: false, status: 429, error: "quota" };
      },
    );
    expect(tried).toEqual(["a", "ccc"]);
  });
  it("does not switch keys on a non-recoverable 400", async () => {
    const tried: string[] = [];
    await runWithRotation([k("a"), k("bb")], async (key) => {
      tried.push(key.id);
      return { ok: false, status: 400, error: "bad" };
    });
    expect(tried).toEqual(["a"]);
  });
  it("limits attempts", async () => {
    let n = 0;
    await runWithRotation(
      Array.from({ length: 20 }, (_, i) => k("x".repeat(i + 1))),
      async () => {
        n++;
        return { ok: false, status: 500, error: "e" };
      },
    );
    expect(n).toBe(MAX_ATTEMPTS);
  });
  it("stops immediately when the user presses Stop", async () => {
    const ac = new AbortController();
    let n = 0;
    const r = await runWithRotation(
      [k("a"), k("bb")],
      async () => {
        n++;
        ac.abort();
        return { ok: false, status: 503, error: "e" };
      },
      { signal: ac.signal },
    );
    expect(n).toBe(1);
    expect(!r.ok && r.aborted).toBe(true);
  });
});

describe("gemini fallback queue", () => {
  it("puts an exhausted primary behind every healthy key", () => {
    expect(orderCandidates([k("a", { status: "quota_exhausted", is_primary: true }), k("bb", { status: "connected" })]).map(x => x.id)).toEqual(["bb", "a"]);
  });
  const now = new Date("2026-05-01T00:00:00Z");
  it("moves a refused key to the end of the queue, even if primary", () => {
    const keys = [
      k("a", { is_primary: true, status: "error", last_checked_at: "2026-04-30T23:59:00Z" }),
      k("bb", { status: "connected" }),
      k("ccc", { status: "connected" }),
    ];
    expect(orderCandidates(keys, now).map((x) => x.id)).toEqual(["bb", "ccc", "a"]);
  });
  it("puts a recovered key last among healthy keys", () => {
    const keys = [
      k("a", { status: "connected", last_checked_at: "2026-04-30T23:59:30Z" }),
      k("bb", { status: "connected" }),
      k("ccc", { status: "connected" }),
    ];
    expect(orderCandidates(keys, now).map((x) => x.id)).toEqual(["bb", "ccc", "a"]);
  });
  it("retries refused keys after one minute of cooldown", () => {
    const keys = [k("a", { status: "error", cooldown_until: "2026-05-01T00:01:00Z" })];
    expect(orderCandidates(keys, now)).toHaveLength(0);
    expect(orderCandidates(keys, new Date("2026-05-01T00:01:00Z"))).toHaveLength(1);
  });
});
