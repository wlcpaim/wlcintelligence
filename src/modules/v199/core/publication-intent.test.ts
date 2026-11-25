import { expect, it } from "vitest";
import { wantsPublication } from "./publication-intent";
it("publica somente por pedido explícito, não por especificação de deploy-ready", () => {
  expect(wantsPublication("Crie o SmartAgenda e faça o deploy")).toBe(true);
  expect(wantsPublication("publique o projeto")).toBe(true);
  expect(wantsPublication("crie projeto deploy-ready Cloudflare Pages")).toBe(false);
});