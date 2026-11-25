import { describe, expect, it } from "vitest";
import { normalizeAnswer, parseAnswer } from "./engineering";

const block = (tag: string, content: string) => `\`\`\`\`markdown\n[${tag}]\n${content}\n\`\`\`\``;
describe("engineering identifiers", () => {
  it("assigns consecutive bug identifiers #bg00001 and #bg00002", () => {
    const result = parseAnswer(
      normalizeAnswer(`${block("BUG", "Defeito A")}\n\n${block("BUG", "Defeito B")}`, []),
    );
    expect(result.map((b) => b.id)).toEqual(["#bg00001", "#bg00002"]);
  });
  it("gives analysis and code separate category identifiers", () => {
    const result = parseAnswer(
      normalizeAnswer(
        `${block("ANALISE", "Arquitetura")}\n\n${block("CODIGO", "Implementação")}`,
        [],
      ),
    );
    expect(result.map((b) => b.id)).toEqual(["#an00001", "#cd00001"]);
  });
  it("continues after persisted answers and ignores user-supplied identifiers", () => {
    const history = [
      { role: "model", content: "#bg00002" },
      { role: "user", content: "#bg99999" },
    ];
    expect(parseAnswer(normalizeAnswer(block("BUG", "Defeito C"), history))[0]?.id).toBe(
      "#bg00003",
    );
  });
  it("keeps nested code fences copyable and normalization idempotent", () => {
    const code = "```ts\nconst a = 1;\n```";
    const result = normalizeAnswer(block("CODIGO", code), []);
    expect(parseAnswer(result)[0]?.content).toBe(code);
    expect(normalizeAnswer(result, [])).toBe(result);
  });
  it("wraps unstructured responses and partial responses as Markdown", () => {
    expect(parseAnswer(normalizeAnswer("Texto sem estrutura", []))[0]?.id).toBe("#an00001");
    expect(
      parseAnswer(normalizeAnswer("````markdown\n[BUG]\nDefeito parcial", []))[0]?.content,
    ).toBe("Defeito parcial");
  });
});
