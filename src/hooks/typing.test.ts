import { expect, it } from "vitest";
import { revealCount, TYPING_SPEED } from "./typing";
it("reveals text at 1.5 times the base cadence", () => {
  expect(TYPING_SPEED).toBe(1.5);
  expect(revealCount(1000)).toBe(90);
  expect(revealCount(100)).toBe(9);
});