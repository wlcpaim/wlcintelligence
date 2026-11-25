import { describe, expect, it } from "vitest";
import { sortConversations, cleanTitle, shouldGenerateTitle } from "./conversations";

describe("permanent conversations", () => {
  it("never regenerates a manually renamed title", () => {
    expect(shouldGenerateTitle({ title_manual: true, title_generated: false })).toBe(false);
    expect(shouldGenerateTitle({ title_manual: false, title_generated: false })).toBe(true);
    expect(shouldGenerateTitle({ title_manual: false, title_generated: true })).toBe(false);
  });
  it("keeps pinned chats above more recent chats", () => {
    expect(sortConversations([
      { id: "new", title: "Novo", is_pinned: false, updated_at: "2026-11-21" },
      { id: "pinned", title: "Projeto", is_pinned: true, updated_at: "2026-11-20" },
    ]).map(c => c.id)).toEqual(["pinned", "new"]);
  });
  it("normalizes the contextual title without replacing its subject", () => {
    expect(cleanTitle('"Integração Gemini e limites"')).toBe("Integração Gemini e limites");
  });
});