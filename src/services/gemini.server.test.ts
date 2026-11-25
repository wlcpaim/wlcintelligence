import { describe, it, expect } from "vitest";
import { textFromGeminiChunk, describeGeminiError } from "./gemini.server";

describe("gemini parsing", () => {
  it("classifies exhausted quota separately from invalid credentials", () => {
    expect(describeGeminiError(429, '{"error":{"status":"RESOURCE_EXHAUSTED","message":"Quota exceeded"}}')).toContain("Cota esgotada");
    expect(describeGeminiError(401, '{"error":{"status":"UNAUTHENTICATED","message":"API key not valid"}}')).not.toContain("Cota esgotada");
  });
  it("extracts text and skips thought parts", () => {
    const j = JSON.stringify({ candidates: [{ content: { parts: [{ text: "hidden", thought: true }, { text: "Olá" }] } }] });
    expect(textFromGeminiChunk(j)).toBe("Olá");
  });
  it("surfaces the provider error message instead of hiding it", () => {
    const body = JSON.stringify({ error: { message: "high demand", status: "UNAVAILABLE" } });
    expect(describeGeminiError(503, body)).toBe("Gemini 503 UNAVAILABLE: high demand");
  });
});
