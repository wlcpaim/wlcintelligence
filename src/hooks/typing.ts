export const TYPING_SPEED = 1.5;
export const BASE_CHARACTERS_PER_SECOND = 60;
export function revealCount(elapsedMs: number): number {
  return Math.max(0, Math.floor(elapsedMs * BASE_CHARACTERS_PER_SECOND * TYPING_SPEED / 1000));
}