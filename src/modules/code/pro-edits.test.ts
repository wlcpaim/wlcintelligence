import { describe, expect, it } from "vitest";
import { applyEdits, proAnswerSchema } from "./pro-edits";

describe("PRO copilot edits", () => {
  it("replaces only the matched snippet", () => {
    expect(applyEdits("a\nb\nc", [{ search: "b", replace: "B" }])).toBe("a\nB\nc");
  });
  it("rejects missing snippets", () => {
    expect(() => applyEdits("abc", [{ search: "zzz", replace: "" }])).toThrow(/não encontrado/);
  });
  it("rejects ambiguous snippets", () => {
    expect(() => applyEdits("x x", [{ search: "x", replace: "y" }])).toThrow(/ambíguo/);
  });
  it("accepts up to 30 files and rejects protected paths", () => {
    expect(proAnswerSchema.safeParse({ summary: "s", changes: [{ path: ".env", content: "" }] }).success).toBe(false);
    expect(proAnswerSchema.safeParse({ summary: "s", changes: Array.from({ length: 30 }, (_, i) => ({ path: `src/f${i}.ts`, content: "" })) }).success).toBe(true);
  });
});
