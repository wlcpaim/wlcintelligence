import { expect, it } from "vitest";
import { isPastDeadline, phaseSignal, TEAM_HARD_LIMIT_MS, TEAM_SOFT_BUDGET_MS } from "./budget";

it("prazo suave termina antes do limite total, sobrando tempo para devolver o resultado", () => {
  expect(TEAM_SOFT_BUDGET_MS).toBeLessThan(TEAM_HARD_LIMIT_MS - 60_000);
});

it("detecta prazo vencido só quando existe prazo", () => {
  expect(isPastDeadline(undefined, 10)).toBe(false);
  expect(isPastDeadline(100, 99)).toBe(false);
  expect(isPastDeadline(100, 100)).toBe(true);
});

it("sinal da fase aborta quando o prazo já passou, sem abortar o pedido principal", async () => {
  const main = new AbortController();
  const s = phaseSignal(main.signal, Date.now() - 1);
  await new Promise((r) => setTimeout(r, 20));
  expect(s.aborted).toBe(true);
  expect(main.signal.aborted).toBe(false);
});
