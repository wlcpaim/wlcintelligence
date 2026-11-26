import { describe, expect, it } from "vitest";
import { applyEdits, applyEditsRobust, proAnswerSchema } from "./pro-edits";

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

describe("applyEditsRobust", () => {
  it("exact match works like applyEdits", () => {
    expect(applyEditsRobust("a\nb\nc", [{ search: "b", replace: "B" }])).toBe("a\nB\nc");
  });
  it("normalizes CRLF line endings", () => {
    const original = "line1\r\nline2\r\nline3";
    const result = applyEditsRobust(original, [{ search: "line2\n", replace: "LINE2\n" }]);
    expect(result).toContain("LINE2");
    expect(result).not.toContain("line2");
  });
  it("matches trimmed search when exact fails on surrounding whitespace", () => {
    const original = "  const x = 1;\n  const y = 2;\n";
    const result = applyEditsRobust(original, [{ search: "const x = 1;", replace: "const x = 42;" }]);
    expect(result).toContain("const x = 42;");
  });
  it("throws when nothing matches", () => {
    expect(() => applyEditsRobust("abc", [{ search: "zzz-not-here", replace: "" }])).toThrow(/não localizado/);
  });
});
