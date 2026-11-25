import { describe, it, expect } from "vitest";
import { isSmallTalk } from "./intent";

describe("isSmallTalk", () => {
  it("'oi' não dispara o time", () => expect(isSmallTalk("oi")).toBe(true));
  it("'Bom dia!' não dispara o time", () => expect(isSmallTalk("Bom dia!")).toBe(true));
  it("pedido real dispara o time", () => expect(isSmallTalk("oi, crie uma landing page de academia")).toBe(false));
});
