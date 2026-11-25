import { describe, expect, it } from "vitest";
import {
  detectFakeRouting,
  detectMissingRedirects,
  detectMissingPersistence,
  detectMissingRouter,
  inspectArchitecture,
  architectureBootstrapFixes,
} from "./architecture";

describe("architecture integrity", () => {
  it("flags useState fake routing", () => {
    const issues = detectFakeRouting([
      {
        path: "src/App.tsx",
        content: `const [page, setPage] = useState<'landing' | 'admin'>('landing');`,
      },
    ]);
    expect(issues.some((i) => i.code === "FAKE_ROUTING")).toBe(true);
  });

  it("requires _redirects for Vite SPA", () => {
    const issues = detectMissingRedirects([
      { path: "package.json", content: JSON.stringify({ dependencies: { vite: "6.0.0" } }) },
      { path: "vite.config.ts", content: "export default {}" },
      { path: "src/main.tsx", content: "..." },
    ]);
    expect(issues.some((i) => i.code === "MISSING_SPA_REDIRECTS")).toBe(true);
  });

  it("requires supabase client and schema when services exist", () => {
    const issues = detectMissingPersistence([
      {
        path: "src/services/storage.ts",
        content: `export function getItems() { return JSON.parse(localStorage.getItem('x')||'[]') }`,
      },
    ]);
    expect(issues.some((i) => i.code === "MISSING_SUPABASE_CLIENT")).toBe(true);
    expect(issues.some((i) => i.code === "MISSING_SCHEMA")).toBe(true);
  });

  it("requires router dep when multi-page", () => {
    const issues = detectMissingRouter([
      { path: "src/App.tsx", content: `export default function App(){ return <div>/admin</div> }` },
      { path: "src/pages/Admin.tsx", content: `export default function Admin(){return null}` },
      { path: "package.json", content: JSON.stringify({ dependencies: { react: "19" } }) },
    ]);
    expect(issues.some((i) => i.code === "MISSING_ROUTER")).toBe(true);
  });

  it("bootstrap fixes emit _redirects and supabase client", () => {
    const fixes = architectureBootstrapFixes([
      { path: "package.json", content: JSON.stringify({ dependencies: { vite: "6" } }) },
      { path: "vite.config.ts", content: "export default {}" },
      {
        path: "src/services/items.ts",
        content: `export const getItems = () => []`,
      },
    ]);
    const paths = fixes.map((f) => f.path);
    expect(paths).toContain("public/_redirects");
    expect(paths).toContain("src/lib/supabase.ts");
    expect(paths).toContain("schema.sql");
  });

  it("passes clean multi-page project", () => {
    const { ok, errors } = inspectArchitecture([
      {
        path: "package.json",
        content: JSON.stringify({
          dependencies: {
            vite: "6",
            "react-router-dom": "^6.28.0",
            "@supabase/supabase-js": "^2.48.0",
          },
        }),
      },
      { path: "vite.config.ts", content: "export default {}" },
      { path: "public/_redirects", content: "/* /index.html 200\n" },
      {
        path: "src/App.tsx",
        content: `import { BrowserRouter, Routes, Route } from 'react-router-dom';
export default function App(){ return <BrowserRouter><Routes><Route path="/" element={null}/><Route path="/admin" element={null}/></Routes></BrowserRouter> }`,
      },
      {
        path: "src/lib/supabase.ts",
        content: `import { createClient } from '@supabase/supabase-js';
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
export const supabase = createClient(supabaseUrl||'https://x', supabaseAnonKey||'y');`,
      },
      {
        path: "schema.sql",
        content: "CREATE TABLE IF NOT EXISTS items (id UUID PRIMARY KEY);",
      },
      { path: "src/services/items.ts", content: "export const getItems = async () => []" },
    ]);
    expect(ok).toBe(true);
    expect(errors).toHaveLength(0);
  });
});
