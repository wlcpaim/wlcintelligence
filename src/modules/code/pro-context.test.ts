import { describe, expect, it } from "vitest";
import { boundedProHistory, PRO_HISTORY_BUDGET, proFileCost } from "./pro-context";

describe("PRO context budgets", () => {
  it("retains at most 24000 history characters without truncating messages", () => {
    const recent = { role: "user" as const, content: "b".repeat(14000) };
    const result = boundedProHistory([{ role: "user", content: "a".repeat(14000) }, recent]);
    expect(result).toEqual([recent]);
    expect(PRO_HISTORY_BUDGET).toBe(24000);
  });
  it("does not start with an orphan model turn", () => {
    expect(boundedProHistory([{ role: "model", content: "answer" }, { role: "user", content: "request" }])).toEqual([{ role: "user", content: "request" }]);
  });
  it("accounts for file path and serialization overhead", () => {
    expect(proFileCost({ path: "a.ts", content: "123" })).toBe(57);
  });
});