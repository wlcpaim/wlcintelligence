import { describe, it, expect } from "vitest";
import { fileType, normalizePath, isChanged } from "./file-types";

describe("code file types", () => {
  it("cores distintas por extensão", () => {
    expect(fileType("a.ts").lang).toBe("ts");
    expect(fileType("b.py").lang).toBe("py");
    expect(fileType("c.js").color).not.toBe(fileType("c.ts").color);
  });
  it("bloqueia caminhos inseguros", () => {
    expect(normalizePath("../x")).toBeNull();
    expect(normalizePath("/src//a.ts")).toBe("src/a.ts");
  });
  it("detecta alterações pendentes de commit", () => {
    expect(isChanged({ content: "a", base_content: "a", deleted: false })).toBe(false);
    expect(isChanged({ content: "b", base_content: "a", deleted: false })).toBe(true);
    expect(isChanged({ content: "", base_content: null, deleted: true })).toBe(false);
    expect(isChanged({ content: "", base_content: "a", deleted: true })).toBe(true);
  });
});
