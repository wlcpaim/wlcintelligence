import { beforeEach, expect, it, vi } from "vitest";
import type { Db } from "@/modules/integrations/core/runs.server";
import { healPreflightIntegrity } from "./preflight.server";

const repair = vi.hoisted(() => vi.fn());
vi.mock("./quality.server", () => ({ proposeSurgicalRepair: repair }));
const files = [
  { path: "package.json", content: JSON.stringify({ scripts: { build: "vite build" }, devDependencies: { vite: "^5.4.0", tailwindcss: "^4.0.0" } }) },
  { path: "vite.config.ts", content: 'import tailwindcss from "@tailwindcss/vite"; export default { plugins: [tailwindcss()] };' },
  { path: "index.html", content: '<script src="/src/main.tsx"></script>' },
  { path: "src/main.tsx", content: 'import "./index.css";' },
  { path: "src/index.css", content: '@import "tailwindcss";' },
];
function database(options: { backupError?: boolean; concurrent?: boolean; input?: typeof files } = {}) {
  const rows = (options.input ?? files).map((f, i) => ({ ...f, id: `file-${i}`, updated_at: "original" }));
  const writes: string[] = [];
  const from = vi.fn((table: string) => {
    let mode = "read";
    let payload: unknown;
    const chain = {
      select: vi.fn(() => chain), eq: vi.fn(() => chain),
      range: vi.fn().mockResolvedValue({ data: rows, error: null }),
      insert: vi.fn((data: unknown) => { mode = "insert"; payload = data; writes.push(`insert:${table}`); return chain; }),
      update: vi.fn((data: unknown) => { mode = "update"; payload = data; writes.push(`update:${table}`); return chain; }),
      then: (resolve: (value: unknown) => unknown) => {
        if (table === "code_files" && mode === "update" && !options.concurrent) {
          const update = payload as { content: string };
          const row = rows.find(r => r.path === "package.json");
          if (row) row.content = update.content;
        }
        return Promise.resolve({ data: options.concurrent && mode === "update" ? [] : [{ id: "saved" }], error: options.backupError && table === "code_project_backups" ? { message: "failed" } : null }).then(resolve);
      },
    };
    return chain;
  });
  return { db: { from } as unknown as Db, writes, rows };
}
beforeEach(() => { vi.resetAllMocks(); repair.mockResolvedValue([]); });
it("repairs missing Tailwind plugin and SPA fallback, saves backup first, and reads back the corrected package", async () => {
  const d = database();
  const result = await healPreflightIntegrity(d.db, "owner", "project", "base-sha", new AbortController().signal);
  expect(result.repaired).toBe(2);
  expect(JSON.parse(d.rows.find(r => r.path === "package.json")?.content ?? "{}").devDependencies["@tailwindcss/vite"]).toBe("^4.0.0");
  expect(result.files.find(f => f.path === "public/_redirects")?.content).toBe("/* /index.html 200\n");
  expect(d.writes).toEqual(["insert:code_project_backups", "update:code_files", "insert:code_files"]);
  expect(repair).not.toHaveBeenCalled();
});
it("never writes a repair if backup fails", async () => {
  const d = database({ backupError: true });
  await expect(healPreflightIntegrity(d.db, "owner", "project", null, new AbortController().signal)).rejects.toThrow("backup");
  expect(d.writes).toEqual(["insert:code_project_backups"]);
});
it("stops publication when a file changes concurrently", async () => {
  const d = database({ concurrent: true });
  await expect(healPreflightIntegrity(d.db, "owner", "project", null, new AbortController().signal)).rejects.toThrow("mudou");
  expect(d.writes).not.toContain("insert:code_files");
});
it("calls the surgical bot for unresolved imports and blocks rather than persisting unsafe partial results", async () => {
  const d = database({ input: [...files, { path: "src/broken.ts", content: 'import x from "unknown-package";' }] });
  await expect(healPreflightIntegrity(d.db, "owner", "project", null, new AbortController().signal)).rejects.toThrow("unknown-package");
  expect(repair).toHaveBeenCalledOnce();
  expect(d.writes).toEqual([]);
});
it("keeps the repair loop bounded at two model calls", async () => {
  const d = database({ input: [...files, { path: "src/broken.ts", content: 'import x from "unknown-package";' }] });
  repair.mockResolvedValue([{ path: "src/broken.ts", content: 'import x from "unknown-package"; // no fix' }]);
  await expect(healPreflightIntegrity(d.db, "owner", "project", null, new AbortController().signal)).rejects.toThrow("unknown-package");
  expect(repair).toHaveBeenCalledTimes(2);
  expect(d.writes).toEqual([]);
});
it("creates deterministic stub for missing local page import (Cart) and unblocks publication", async () => {
  const d = database({
    input: [
      ...files,
      {
        path: "src/App.tsx",
        content: `import Cart from "./pages/Cart";
export default function App() { return <Cart />; }`,
      },
    ],
  });
  const result = await healPreflightIntegrity(d.db, "owner", "project", "base-sha", new AbortController().signal);
  expect(result.repaired).toBeGreaterThanOrEqual(1);
  const cart = result.files.find(f => f.path === "src/pages/Cart.tsx");
  expect(cart).toBeDefined();
  expect(cart?.content).toContain("export default function");
  expect(cart?.content).toContain("Cart");
  expect(d.writes).toContain("insert:code_project_backups");
});
