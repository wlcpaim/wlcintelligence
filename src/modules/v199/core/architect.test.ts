import { expect, it } from "vitest";
import { ARCHITECT_RETRY_NOTE, fallbackArchitectPlan, parseArchitectPlan, parseJsonLoose } from "./architect";

const valid = { intent: "landing", distribution: [{ role: "frontend", task: "Criar a página" }] };

it("aceita JSON válido, com ou sem cerca de código e texto em volta", () => {
  expect(parseArchitectPlan(JSON.stringify(valid))?.distribution).toHaveLength(1);
  expect(parseArchitectPlan("```json\n" + JSON.stringify(valid) + "\n```")?.intent).toBe("landing");
  expect(parseArchitectPlan("Aqui está: " + JSON.stringify(valid) + " pronto")?.intent).toBe("landing");
});

it("rejeita JSON quebrado, sem objeto e esquema errado", () => {
  expect(parseArchitectPlan("{ intent: ")).toBeNull();
  expect(parseArchitectPlan("sem json nenhum")).toBeNull();
  expect(parseArchitectPlan(JSON.stringify({ distribution: "frontend" }))).toBeNull();
});

it("rejeita plano cujas tarefas não apontam para nenhum especialista existente", () => {
  expect(parseArchitectPlan(JSON.stringify({ intent: "x", distribution: [] }))).toBeNull();
  expect(parseArchitectPlan(JSON.stringify({ intent: "x", distribution: [{ role: "inexistente", task: "t" }] }))).toBeNull();
});

it("plano de reserva é válido pelo próprio esquema e mantém o pedido como intent", () => {
  const fb = fallbackArchitectPlan("x".repeat(300));
  expect(fb.intent).toHaveLength(200);
  expect(parseArchitectPlan(JSON.stringify(fb))?.distribution.map((d) => d.role)).toEqual(["design", "frontend", "backend", "dba", "devops"]);
  expect(fb.structure.files).toEqual(expect.arrayContaining(["package.json", "tsconfig.json", "index.html", "src/main.tsx"]));
});

it("parseJsonLoose falha sem objeto e a nota de retry exige JSON", () => {
  expect(() => parseJsonLoose("nada")).toThrow();
  expect(ARCHITECT_RETRY_NOTE).toContain("JSON");
});

it("recupera arquivos completos sem fabricar o arquivo cortado", () => {
  const complete = { path: "src/App.tsx", content: 'export const x = "Olá { loja }";\n' };
  const raw = '{"summary":"ok","changes":[' + JSON.stringify(complete) + ',{"path":"src/PDV.tsx","content":"export function';
  expect(parseJsonLoose(raw, true)).toMatchObject({ recovered: true, changes: [complete] });
  expect(() => parseJsonLoose(raw)).toThrow();
});

it("recupera fechamento externo ausente e preserva escapes Unicode", () => {
  const file = { path: "src/Loja.tsx", content: 'const a = "ação 🛒 \\";\n' };
  expect(parseJsonLoose('{"changes":[' + JSON.stringify(file) + ']', true)).toMatchObject({ changes: [file] });
});

it("não aceita arquivo incompleto ou sem content e não recupera o Arquiteto", () => {
  expect(() => parseJsonLoose('{"changes":[{"path":"src/x.ts"},', true)).toThrow();
  expect(() => parseJsonLoose('{"changes":[{"path":"src/x.ts","content":"x', true)).toThrow();
  expect(parseArchitectPlan('{"distribution":[{"role":"frontend","task":"Criar"}')).toBeNull();
});
