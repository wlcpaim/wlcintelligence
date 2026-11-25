import { describe, it, expect } from "vitest";
import { parseKeys } from "../parse-keys";

const a = "AQ.Ab8RN6aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const b = "AQ.Ab8RN6bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
describe("parseKeys", () => {
  it("conta 6 chaves separadas por linhas em branco", () => {
    const keys = Array.from({ length: 6 }, (_, i) => `AQ.Ab8RN6${String(i).repeat(40)}`);
    expect(parseKeys(keys.join("\n\n\n"))).toHaveLength(6);
  });
  it("ignora duplicadas e texto que não é chave", () => {
    expect(parseKeys(`${a}\n${a}\nolá\n${b}`)).toEqual([a, b]);
  });
});
