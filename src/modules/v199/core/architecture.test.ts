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
        content: `import { Component } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
class ErrorBoundary extends Component { componentDidCatch(){} render(){ return this.props.children } }
export default function App(){ return <BrowserRouter><ErrorBoundary><Routes><Route path="/" element={null}/><Route path="/admin" element={null}/></Routes></ErrorBoundary></BrowserRouter> }`,
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
      { path: "src/pages/Home.tsx", content: "import { getItems } from '../services/items';\nexport const Home = () => <button onClick={() => getItems()}>Itens</button>;" },
    ]);
    expect(ok).toBe(true);
    expect(errors).toHaveLength(0);
  });
});

import { detectFunctionalGaps } from "./architecture";
describe("functional gaps (vitrine oca)", () => {
  const app = { path: "src/App.tsx", content: `import Admin from './pages/Admin';
<Route path="/admin" element={<Navigate to="/admin/dashboard" replace />} />
<Route path="/admin/*" element={<Admin />} />` };
  it("flags parent redirect to a sub-route the admin does not declare", () => {
    const codes = detectFunctionalGaps([app, { path: "src/pages/Admin.tsx", content: `<Routes><Route path="/" element={<div/>} /></Routes>` }]).map((i) => i.code);
    expect(codes).toContain("BROKEN_ROUTER_WILDCARD");
    expect(codes).toContain("HOLLOW_ADMIN");
  });
  it("accepts nested admin layout with Outlet", () => {
    const codes = detectFunctionalGaps([app, { path: "src/pages/Admin.tsx", content: `<Outlet />` }]).map((i) => i.code);
    expect(codes).not.toContain("BROKEN_ROUTER_WILDCARD");
  });
  it("flags schema tables with no service consuming them", () => {
    const codes = detectFunctionalGaps([{ path: "schema.sql", content: "CREATE TABLE IF NOT EXISTS products (id uuid);" }]).map((i) => i.code);
    expect(codes).toContain("UNLINKED_SCHEMA");
  });
});

describe("anti-vitrine: links mortos e services sem tela", () => {
  const base = [
    { path: "package.json", content: JSON.stringify({ dependencies: { "react-router-dom": "^6" } }) },
    { path: "src/App.tsx", content: `import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Home } from './pages/Home';
export default function App() { return <BrowserRouter><Routes>
  <Route path="/" element={<Home />} />
  <Route path="/login" element={<Login />} />
  <Route path="*" element={<Navigate to="/" replace />} />
</Routes></BrowserRouter>; }` },
    { path: "src/pages/Home.tsx", content: `import { Link } from 'react-router-dom';
export const Home = () => <><Link to="/pdv">PDV</Link><Link to="/admin/login">Admin</Link></>;` },
    { path: "src/services/posService.ts", content: "export function listProducts() { return []; }" },
  ];

  it("reproduz o bug do Projetowlcia: /pdv e /admin/login sem rota e service sem tela", () => {
    const codes = inspectArchitecture(base).errors.map((e) => `${e.code}:${e.message.match(/"([^"]+)"/)?.[1] ?? e.path}`);
    expect(codes).toContain("UNDECLARED_ROUTE_TARGET:/pdv");
    expect(codes).toContain("UNDECLARED_ROUTE_TARGET:/admin/login");
    expect(codes).toContain("UNCONSUMED_SERVICE:src/services/posService.ts");
  });

  it("aceita rotas filhas aninhadas, parâmetros e service importado por uma tela", () => {
    const fixed = [
      ...base.filter((f) => f.path !== "src/App.tsx"),
      { path: "src/App.tsx", content: `import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
export default function App() { return <BrowserRouter><Routes>
  <Route path="/" element={<Home />} />
  <Route path="/pdv" element={<Pdv />} />
  <Route path="/admin" element={<AdminLayout />}>
    <Route path="login" element={<Login />} />
    <Route path="produtos/:id" element={<P />} />
  </Route>
  <Route path="*" element={<Navigate to="/" replace />} />
</Routes></BrowserRouter>; }` },
      { path: "src/pages/Pdv.tsx", content: `import { listProducts } from '../services/posService';
import { useNavigate } from 'react-router-dom';
export const Pdv = () => { const n = useNavigate(); return <button onClick={() => n('/admin/produtos/42')}>{listProducts().length}</button>; };` },
    ];
    const errors = inspectArchitecture(fixed).errors.filter((e) => e.code === "UNDECLARED_ROUTE_TARGET" || e.code === "UNCONSUMED_SERVICE");
    expect(errors).toEqual([]);
  });
});
