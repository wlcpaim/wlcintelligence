import { describe, expect, it } from "vitest";
import { routeMessage, orchestratorInstruction, agentsHeader, PRO_VERSION } from "./orchestrator";

const roles = (m: string) => routeMessage(m).agents.map((a) => a.role);

describe("WLC 1.7.1 PRO orchestrator", () => {
  it("full app requests run the whole pipeline", () => {
    expect(roles("Crie um aplicativo de barbearia com login")).toEqual(["architect", "dba", "backend", "frontend", "qa", "devops"]);
  });
  it("bugs go to QA first", () => {
    expect(routeMessage("Está dando erro no login").intent).toBe("FIX_BUG");
    expect(roles("Está dando erro no login")[0]).toBe("qa");
  });
  it("database changes go to the DBA", () => expect(roles("adicione uma tabela de pedidos")[0]).toBe("dba"));
  it("deploy goes to DevOps", () => expect(roles("o deploy no cloudflare")[0]).toBe("devops"));
  it("Go/Rust go to systems", () => expect(roles("escreva em rust um serviço")[0]).toBe("systems"));
  it("UI goes to frontend", () => expect(roles("melhore o layout da tela")).toEqual(["frontend"]));
  it("general questions use the architect", () => expect(routeMessage("olá, tudo bem?").intent).toBe("GENERAL"));
  it("instruction and header name the bots", () => {
    const plan = routeMessage("melhore o layout da tela");
    expect(orchestratorInstruction(plan)).toContain("Bot Frontend");
    expect(agentsHeader(plan)).toContain(PRO_VERSION.name);
  });
});
