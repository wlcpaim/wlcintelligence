import { describe, expect, it } from "vitest";
import { findBrokenLocalImports, findSyntaxIssues, validateEditBatch, buildValidationReport } from "./edit-integrity";

describe("edit-integrity", () => {
  it("flags missing local import", () => {
    const issues = findBrokenLocalImports([
      { path: "src/App.tsx", content: 'import Cart from "./pages/Cart";\nexport default function App(){return null}' },
    ]);
    expect(issues.some(i => /Cart/.test(i.message))).toBe(true);
  });
  it("accepts resolved import after change batch", () => {
    const existing = [
      { path: "src/App.tsx", content: 'import Cart from "./pages/Cart";\nexport default function App(){return null}' },
    ];
    const changes = [
      { path: "src/pages/Cart.tsx", content: "export default function Cart(){return null}" },
    ];
    expect(validateEditBatch(existing, changes).filter(i => /Import local/.test(i.message))).toEqual([]);
  });
  it("flags unbalanced braces", () => {
    const issues = findSyntaxIssues([
      { path: "src/broken.ts", content: "export function x() { if (true) { return 1; }" },
    ]);
    expect(issues.some(i => /Delimitadores/.test(i.message))).toBe(true);
  });
  it("buildValidationReport marks ok when clean", () => {
    expect(buildValidationReport([]).ok).toBe(true);
  });
});
