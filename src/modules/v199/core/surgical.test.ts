import { expect, it } from "vitest";
import { surgicalChanges } from "./surgical";

const files = [
  { path: "src/data.ts", content: "export const initialServices = [];\nexport const getServices = () => initialServices;" },
  { path: "src/Page.tsx", content: "import { getStoredServices } from './data';\nexport default function Page() { return <div>{getStoredServices().length}</div>; }" },
];
it("corrige import real preservando o resto do código", () => {
  const fixed = surgicalChanges(files, { changes: [{ path: "src/Page.tsx", edits: [{ search: "getStoredServices }", replace: "getServices as getStoredServices }" }] }] }, new Set(["src/Page.tsx"]));
  expect(fixed[0]?.content).toBe(files[1]?.content.replace("getStoredServices }", "getServices as getStoredServices }"));
});
it("bloqueia stubs que ocultam erro e destroem função", () => {
  expect(() => surgicalChanges(files, { changes: [{ path: "src/data.ts", edits: [{ search: "() => initialServices", replace: "() => null" }] }] }, new Set(["src/data.ts"]))).toThrow("stub");
});
it("rejeita alteração em arquivo não autorizado", () => {
  expect(() => surgicalChanges(files, { changes: [{ path: "src/data.ts", edits: [{ search: "[]", replace: "[1]" }] }] }, new Set(["src/Page.tsx"]))).toThrow("escopo");
});
it("rejeita nova sintaxe inválida e trechos ambíguos", () => {
  expect(() => surgicalChanges(files, { changes: [{ path: "src/data.ts", edits: [{ search: "[]", replace: "[" }] }] }, new Set(["src/data.ts"]))).toThrow("erro novo");
  expect(() => surgicalChanges([{ path: "src/a.ts", content: "const a=1; const b=1;" }], { changes: [{ path: "src/a.ts", edits: [{ search: "=1", replace: "=2" }] }] }, new Set(["src/a.ts"]))).toThrow("ambíguo");
});