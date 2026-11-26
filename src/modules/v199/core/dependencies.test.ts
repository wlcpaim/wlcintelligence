import { describe, expect, it } from "vitest";
import { reconcileMissingDependencies } from "./dependencies";
import { findMissingDependencies, diagnoseBuildReadiness } from "./bootstrap";

describe("dependency reconciliation", () => {
  const files = [
    { path: "package.json", content: JSON.stringify({ scripts: { build: "vite build" }, devDependencies: { vite: "^5.4.0", tailwindcss: "^4.0.0" } }) },
    { path: "vite.config.ts", content: 'import tailwindcss from "@tailwindcss/vite"; export default { plugins: [tailwindcss()] };' },
    { path: "index.html", content: '<script src="/src/main.tsx"></script>' },
    { path: "src/main.tsx", content: 'import "./index.css";' },
    { path: "src/index.css", content: '@import "tailwindcss";' },
    { path: "public/_redirects", content: "/* /index.html 200" },
  ];
  it("reproduces and repairs the missing @tailwindcss/vite deployment failure", () => {
    expect(findMissingDependencies(files).map(d => d.pkg)).toEqual(["@tailwindcss/vite"]);
    const changes = reconcileMissingDependencies(files);
    const pkg = JSON.parse(changes[0]?.content ?? "{}");
    expect(pkg.devDependencies["@tailwindcss/vite"]).toBe("^4.0.0");
    const repaired = files.map(f => changes.find(c => c.path === f.path) ?? f);
    expect(diagnoseBuildReadiness(repaired)).toEqual([]);
    expect(reconcileMissingDependencies(repaired)).toEqual([]);
  });
  it("does not silently upgrade an explicit Tailwind v3 stack", () => {
    const v3 = files.map(f => f.path === "package.json" ? { ...f, content: f.content.replace("^4.0.0", "^3.4.0") } : f);
    expect(reconcileMissingDependencies(v3)).toEqual([]);
  });
  it("uses a compatible React plugin for Vite 7", () => {
    const changes = reconcileMissingDependencies([
      { path: "package.json", content: JSON.stringify({ devDependencies: { vite: "^7.0.0" } }) },
      { path: "vite.config.ts", content: 'import react from "@vitejs/plugin-react";' },
    ]);
    expect(JSON.parse(changes[0]?.content ?? "{}").devDependencies["@vitejs/plugin-react"]).toBe("^5.0.0");
  });
  it("does not guess unknown package versions", () => {
    expect(reconcileMissingDependencies([files[0] ?? { path: "package.json", content: "{}" }, { path: "src/app.ts", content: 'import x from "unknown-company-package";' }])).toEqual([]);
  });
  it("does not block publication on the environment advisory alone", () => {
    const envClient = [
      { path: "package.json", content: JSON.stringify({ dependencies: { "@supabase/supabase-js": "^2.48.0" } }) },
      { path: "src/lib/supabase.ts", content: "export const configured = false;" },
    ];
    expect(diagnoseBuildReadiness(envClient)).toEqual([]);
  });
});