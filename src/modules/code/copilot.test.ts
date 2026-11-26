import { describe, expect, it } from "vitest";
import { copilotPath, fileStillMatches, parseCopilotAnswer } from "./copilot";

describe("Copilot WLC safeguards", () => {
  it("permite criar e editar código sem acessar credenciais ou metadados Git", () => {
    expect(copilotPath("src/app.tsx")).toBe(true);
    for (const path of ["../app.ts", "/app.ts", "C:/app.ts", ".env", "config/secrets.json", ".git/config", "cert.key"])
      expect(copilotPath(path)).toBe(false);
  });
  it("aceita uma proposta de criação sem executar nem salvar o código", () => {
    expect(parseCopilotAnswer('{"summary":"Criar aplicação","changes":[{"path":"src/app.ts","content":"export const app = 1;"}]}').changes)
      .toEqual([{ path: "src/app.ts", content: "export const app = 1;" }]);
  });
  it("rejeita alterações duplicadas e arquivos protegidos", () => {
    expect(() => parseCopilotAnswer('{"summary":"x","changes":[{"path":".env","content":"secret"}]}')).toThrow();
    expect(() => parseCopilotAnswer('{"summary":"x","changes":[{"path":"a.ts","content":"1"},{"path":"a.ts","content":"2"}]}')).toThrow();
  });
  it("não sobrescreve edição feita após a proposta", () => {
    const change = { path: "app.ts", content: "new", before: "old", expectedUpdatedAt: "2026-11-22T02:02:00Z" };
    expect(fileStillMatches({ content: "old", updated_at: "2026-11-22T02:02:00Z", deleted: false }, change)).toBe(true);
    expect(fileStillMatches({ content: "manual", updated_at: "2026-11-22T02:03:00Z", deleted: false }, change)).toBe(false);
    expect(fileStillMatches({ content: "old", updated_at: "2026-11-22T02:02:00Z", deleted: true }, change)).toBe(false);
    expect(fileStillMatches(null, { ...change, before: null, expectedUpdatedAt: null })).toBe(true);
    expect(fileStillMatches({ content: "manual", updated_at: "later", deleted: false }, { ...change, before: null })).toBe(false);
  });
});
import { parseCopilotAnswer as parseResilient, rankCopilotFiles, CopilotParseError } from "./copilot";
describe("parser resiliente", () => {
  it("ignora texto antes e depois do JSON", () => {
    const r = parseResilient('Claro! Aqui está:\n```json\n{"summary":"ok {x}","changes":[]}\n```\nEspero ajudar.');
    expect(r.summary).toBe("ok {x}");
  });
  it("lança CopilotParseError sem JSON", () => {
    expect(() => parseResilient("sem json")).toThrow(CopilotParseError);
  });
  it("prioriza arquivo ativo e depois termos do pedido", () => {
    const files = [{ path: "a.ts" }, { path: "src/nav/nav-items.ts" }, { path: "src/chat/ChatWindow.tsx" }];
    expect(rankCopilotFiles(files, "muda o menu nav", "a.ts").map(f => f.path)).toEqual(["a.ts", "src/nav/nav-items.ts", "src/chat/ChatWindow.tsx"]);
  });
});

import { buildLocalImportGraph, expandImpactPaths, rankCopilotFiles as rankWithImpact } from "./copilot";

describe("import impact graph", () => {
  const files = [
    { path: "src/App.tsx", content: 'import Home from "./pages/Home";\nexport default function App(){return <Home/>}' },
    { path: "src/pages/Home.tsx", content: 'import { listItems } from "../services/items";\nexport default function Home(){return null}' },
    { path: "src/services/items.ts", content: "export const listItems = () => [];" },
    { path: "src/unrelated.ts", content: "export const x = 1;" },
  ];
  it("builds local import edges", () => {
    const g = buildLocalImportGraph(files);
    expect(g.get("src/App.tsx")).toContain("src/pages/Home.tsx");
    expect(g.get("src/pages/Home.tsx")).toContain("src/services/items.ts");
  });
  it("expands impact from a seed", () => {
    const g = buildLocalImportGraph(files);
    const impact = expandImpactPaths(["src/pages/Home.tsx"], g);
    expect(impact).toEqual(expect.arrayContaining(["src/pages/Home.tsx", "src/App.tsx", "src/services/items.ts"]));
  });
  it("ranks dependency neighbors above unrelated files", () => {
    const ranked = rankWithImpact(files, "atualiza a home", null).map(f => f.path);
    expect(ranked.indexOf("src/pages/Home.tsx")).toBeLessThan(ranked.indexOf("src/unrelated.ts"));
    expect(ranked.indexOf("src/App.tsx")).toBeLessThan(ranked.indexOf("src/unrelated.ts"));
  });
});
