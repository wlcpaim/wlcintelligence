import { describe, expect, it } from "vitest";
import {
  buildDevOpsBootstrapTask,
  diagnoseBuildReadiness,
  extractPackageName,
  findMissingDependencies,
  missingBootstrapFiles,
  validateRouterCompleteness,
} from "./bootstrap";

describe("v199 bootstrap & build readiness", () => {
  it("detecta o quarteto base ausente em projeto vazio ou parcial", () => {
    expect(missingBootstrapFiles([])).toEqual(["package.json", "tsconfig.json", "index.html", "src/main.tsx"]);
    expect(missingBootstrapFiles(["package.json", "vite.config.ts", "src/utils/validators.ts"])).toEqual([
      "tsconfig.json",
      "index.html",
      "src/main.tsx",
    ]);
    expect(missingBootstrapFiles(["package.json", "tsconfig.json", "index.html", "src/main.tsx"])).toEqual([]);
  });

  it("não exige index.html em meta-frameworks com __root.tsx ou next.config", () => {
    expect(missingBootstrapFiles(["package.json", "tsconfig.json", "src/routes/__root.tsx"])).toEqual([]);
  });

  it("extrai corretamente nomes de pacotes externos e ignora locais/builtins", () => {
    expect(extractPackageName("@vitejs/plugin-react")).toBe("@vitejs/plugin-react");
    expect(extractPackageName("react-dom/client")).toBe("react-dom");
    expect(extractPackageName("./App")).toBeNull();
    expect(extractPackageName("@/lib/utils")).toBeNull();
    expect(extractPackageName("node:fs")).toBeNull();
    expect(extractPackageName("path")).toBeNull();
  });

  it("identifica exatamente os defeitos reais de build (caso Testing199)", () => {
    const brokenFiles = [
      {
        path: "package.json",
        content: JSON.stringify({
          name: "testing199",
          scripts: { build: "tsc && vite build" },
          devDependencies: { vite: "^5.0.0", typescript: "^5.0.0" },
        }),
      },
      {
        path: "vite.config.ts",
        content: 'import { defineConfig } from "vite";\nimport react from "@vitejs/plugin-react";\nexport default defineConfig({ plugins: [react()] });',
      },
      {
        path: "src/App.tsx",
        content: 'import React from "react";\nexport default function App() { return <div />; }',
      },
    ];

    const issues = diagnoseBuildReadiness(brokenFiles);
    const messages = issues.map((i) => i.message);
    expect(messages).toContain('Script de build executa "tsc", mas "tsconfig.json" não existe.');
    expect(messages).toContain('Script de build executa "vite", mas "index.html" não existe na raiz.');
    expect(messages).toContain('Dependência "@vitejs/plugin-react" importada mas ausente em package.json');
    expect(messages).toContain('Dependência "react" importada mas ausente em package.json');
  });

  it("passa limpo em projeto Vite+React+TS completo e válido", () => {
    const validFiles = [
      {
        path: "package.json",
        content: JSON.stringify({
          name: "ok-app",
          scripts: { build: "tsc && vite build" },
          dependencies: { react: "^18.3.1", "react-dom": "^18.3.1" },
          devDependencies: { vite: "^5.4.0", typescript: "^5.6.0", "@vitejs/plugin-react": "^4.3.0" },
        }),
      },
      { path: "tsconfig.json", content: '{"compilerOptions":{"jsx":"react-jsx"}}' },
      { path: "index.html", content: '<html><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>' },
      { path: "src/main.tsx", content: 'import { createRoot } from "react-dom/client";\nimport App from "./App";\ncreateRoot(document.getElementById("root")!).render(<App />);' },
      { path: "src/App.tsx", content: 'export default function App() { return <main />; }' },
      { path: "vite.config.ts", content: 'import { defineConfig } from "vite";\nimport react from "@vitejs/plugin-react";\nexport default defineConfig({ plugins: [react()] });' },
      { path: "public/_redirects", content: "/* /index.html 200\n" },
    ];
    expect(diagnoseBuildReadiness(validFiles)).toEqual([]);
    expect(findMissingDependencies(validFiles)).toEqual([]);
  });

  it("gera checklist de bootstrap para o DevOps quando faltam arquivos ou dependências", () => {
    const task = buildDevOpsBootstrapTask(
      undefined,
      ["tsconfig.json", "index.html"],
      [{ pkg: "@vitejs/plugin-react", path: "vite.config.ts", line: 2 }],
      [],
    );
    expect(task).toContain("tsconfig.json, index.html");
    expect(task).toContain("@vitejs/plugin-react");
    expect(buildDevOpsBootstrapTask(undefined, [], [], [])).toBeNull();
  });

  it("exige fallback para SPA mas não para TanStack SSR", () => {
    const files = [
      { path: "package.json", content: JSON.stringify({ scripts: { build: "vite build" }, dependencies: { vite: "7" } }) },
      { path: "index.html", content: "" },
    ];
    expect(diagnoseBuildReadiness(files).map((i) => i.path)).toContain("public/_redirects");
    files[0] = { path: "package.json", content: JSON.stringify({ scripts: { build: "vite build" }, dependencies: { "@tanstack/react-start": "1" } }) };
    expect(diagnoseBuildReadiness(files).map((i) => i.path)).not.toContain("public/_redirects");
  });

  it("flags missing catch-all and orphan admin parent", () => {
    const issues = validateRouterCompleteness([
      {
        path: "src/App.tsx",
        content: `import { BrowserRouter, Routes, Route } from 'react-router-dom';
export default function App() {
  return <BrowserRouter><Routes>
    <Route path="/" element={null} />
    <Route path="/admin/login" element={null} />
    <Route path="/admin/dashboard" element={null} />
  </Routes></BrowserRouter>;
}`,
      },
    ]);
    expect(issues.some(i => /curinga|path="\*"/.test(i.message))).toBe(true);
    expect(issues.some(i => /órfã|\/admin/.test(i.message))).toBe(true);
  });
});
