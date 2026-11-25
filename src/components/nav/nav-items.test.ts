import { describe, expect, it } from "vitest";
import { isMenuPath } from "./nav-items";

describe("isMenuPath", () => {
  it("shows the footer on each menu screen", () => {
    for (const p of ["/code", "/code/", "/wlcia", "/settings", "/settings/database"]) expect(isMenuPath(p)).toBe(true);
  });
  it("hides the footer inside opened screens", () => {
    for (const p of ["/code/abc", "/wlcia/abc"]) expect(isMenuPath(p)).toBe(false);
  });
  it("does not treat legacy /chat as menu path", () => {
    expect(isMenuPath("/chat")).toBe(false);
    expect(isMenuPath("/chat/abc")).toBe(false);
  });
});
