import { describe, expect, it } from "vitest";
import { BOT_TOOLS, canWrite, parseBotStep } from "./tools";

describe("WLC PRO bot tools", () => {
  it("frontend writes only screens", () => {
    expect(canWrite("frontend", "src/components/Agenda.tsx")).toBe(true);
    expect(canWrite("frontend", "src/routes/api/x.ts")).toBe(false);
  });
  it("backend writes server code", () => expect(canWrite("backend", "src/routes/api/pedidos.ts")).toBe(true));
  it("DBA writes only migrations", () => {
    expect(canWrite("dba", "supabase/migrations/001_pedidos.sql")).toBe(true);
    expect(canWrite("dba", "src/components/A.tsx")).toBe(false);
  });
  it("architect cannot write", () => expect(canWrite("architect", "src/components/A.tsx")).toBe(false));
  it("secrets and traversal are blocked", () => {
    expect(canWrite("backend", "src/modules/integrations/quick-setup/credentials.server.ts")).toBe(false);
    expect(canWrite("frontend", "src/components/../../.env")).toBe(false);
  });
  it("a bot cannot use another bot's tool", () => {
    expect(BOT_TOOLS.frontend).not.toContain("inspect_schema");
    expect(parseBotStep('{"tool":"inspect_schema","args":{}}', "frontend").kind).toBe("done");
    expect(parseBotStep('{"tool":"inspect_schema","args":{}}', "dba")).toEqual({ kind: "tool", tool: "inspect_schema", args: {} });
  });
});

import { claimWritePaths } from "./tools";

describe("claimWritePaths", () => {
  it("gives first claimant ownership and lists conflicts", () => {
    const { owner, conflicts } = claimWritePaths([
      { role: "frontend", paths: ["src/components/Button.tsx", "src/routes/index.tsx"] },
      { role: "backend", paths: ["src/services/api.ts", "src/components/Button.tsx"] },
    ]);
    expect(owner.get("src/components/Button.tsx")).toBe("frontend");
    expect(owner.get("src/services/api.ts")).toBe("backend");
    expect(conflicts.some(c => c.path === "src/components/Button.tsx")).toBe(true);
  });
  it("rejects paths outside write area", () => {
    expect(canWrite("frontend", "src/services/secret.ts")).toBe(false);
    const { owner } = claimWritePaths([{ role: "frontend", paths: ["src/services/secret.ts"] }]);
    expect(owner.has("src/services/secret.ts")).toBe(false);
  });
});
