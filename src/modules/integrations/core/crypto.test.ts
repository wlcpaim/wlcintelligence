import { describe, it, expect } from "vitest";
import { seal, open, hintOf } from "./crypto.server";

const M = "m".repeat(64);
describe("AES-256-GCM secrets", () => {
  it("round-trips and never stores plaintext", async () => {
    const s = await seal("AIzaSecretValue123456", "gemini:u1", M);
    expect(s.ciphertext).not.toContain("AIzaSecret");
    expect(await open(s, "gemini:u1", M)).toBe("AIzaSecretValue123456");
  });
  it("refuses to decrypt another user's secret", async () => {
    const s = await seal("token", "gemini:u1", M);
    await expect(open(s, "gemini:u2", M)).rejects.toThrow();
  });
  it("refuses a different master key", async () => {
    const s = await seal("token", "a", M);
    await expect(open(s, "a", "n".repeat(64))).rejects.toThrow();
  });
  it("shows only a partial identifier", () => {
    expect(hintOf("AIzaSyABCDEFGHIJ1234")).toBe("AIz…1234");
  });
});

describe("master key strength", () => {
  it("accepts a 20-character master key", async () => {
    const m = "k".repeat(20);
    const s = await seal("x", "a", m);
    expect(await open(s, "a", m)).toBe("x");
  });
  it("rejects a master key under 16 characters", async () => {
    await expect(seal("x", "a", "short")).rejects.toThrow();
  });
});
