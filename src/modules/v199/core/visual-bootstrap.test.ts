import { expect, it } from "vitest";
import { visualBootstrap } from "./visual-bootstrap";

const v3 = [
  { path: "package.json", content: '{"devDependencies":{"tailwindcss":"^3.4.17"}}' },
  { path: "postcss.config.js", content: "export default {plugins:{tailwindcss:{}}}" },
  { path: "src/index.css", content: "@tailwind base; @tailwind components; @tailwind utilities;" },
  { path: "src/main.tsx", content: "import './index.css'" },
];
it("cria apenas configuração faltante do Tailwind v3 para index e src", () => {
  const result = visualBootstrap(v3);
  expect(result.changes).toHaveLength(1);
  expect(result.changes[0]?.path).toBe("tailwind.config.js");
  expect(result.issues).toEqual([]);
  expect(visualBootstrap([...v3, ...result.changes]).changes).toEqual([]);
});
it("não sobrescreve tema existente com content incorreto", () => {
  const result = visualBootstrap([...v3, { path: "tailwind.config.js", content: "export default {content:[],theme:{extend:{}}}" }]);
  expect(result.changes).toEqual([]);
  expect(result.issues.map(i => i.path)).toEqual(["tailwind.config.js"]);
});
it("v4 funciona sem tailwind.config quando CSS e plugin estão configurados", () => {
  const files = [
    { path: "package.json", content: '{"dependencies":{"tailwindcss":"^4.3.5"}}' },
    { path: "src/styles.css", content: '@import "tailwindcss";' },
    { path: "vite.config.ts", content: 'import tailwind from "@tailwindcss/vite"; export default {plugins:[tailwind()]};' },
  ];
  expect(visualBootstrap(files)).toEqual({ changes: [], issues: [] });
});
it("detecta mistura de versões e CSS não importado", () => {
  const files = v3.map(f => f.path === "package.json" ? { ...f, content: '{"dependencies":{"tailwindcss":"4"}}' } : f.path === "src/main.tsx" ? { ...f, content: "import App from './App'" } : f);
  expect(visualBootstrap(files).issues.map(i => i.path)).toEqual(["src/index.css", "vite.config.ts", "src/main.tsx"]);
});