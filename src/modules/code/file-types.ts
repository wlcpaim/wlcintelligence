// Cores por extensão no estilo VS Code (tokens --code-* em styles.css).
export interface FileType { label: string; color: string; lang: "js" | "ts" | "jsx" | "tsx" | "py" | "html" | "css" | "json" | "md" | "text" }

const MAP: Record<string, FileType> = {
  js: { label: "JS", color: "var(--code-js)", lang: "js" },
  mjs: { label: "JS", color: "var(--code-js)", lang: "js" },
  cjs: { label: "JS", color: "var(--code-js)", lang: "js" },
  jsx: { label: "JSX", color: "var(--code-react)", lang: "jsx" },
  ts: { label: "TS", color: "var(--code-ts)", lang: "ts" },
  tsx: { label: "TSX", color: "var(--code-react)", lang: "tsx" },
  py: { label: "PY", color: "var(--code-py)", lang: "py" },
  html: { label: "<>", color: "var(--code-html)", lang: "html" },
  css: { label: "#", color: "var(--code-css)", lang: "css" },
  scss: { label: "#", color: "var(--code-css)", lang: "css" },
  json: { label: "{}", color: "var(--code-json)", lang: "json" },
  md: { label: "MD", color: "var(--code-md)", lang: "md" },
  sql: { label: "SQL", color: "var(--code-sql)", lang: "text" },
  yml: { label: "YML", color: "var(--code-yml)", lang: "text" },
  yaml: { label: "YML", color: "var(--code-yml)", lang: "text" },
  toml: { label: "TML", color: "var(--code-yml)", lang: "text" },
  sh: { label: "SH", color: "var(--code-sh)", lang: "text" },
};

export function fileType(path: string): FileType {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return MAP[ext] ?? { label: "TXT", color: "var(--code-txt)", lang: "text" };
}

/** Caminho relativo seguro: sem "..", sem barra inicial, sem barras duplas. */
export function normalizePath(raw: string): string | null {
  const p = raw.trim().replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+/g, "/");
  if (!p || p.endsWith("/") || p.split("/").some((s) => s === ".." || s === "." || s === "")) return null;
  return p;
}

export function isChanged(f: { content: string; base_content: string | null; deleted: boolean }): boolean {
  return f.deleted ? f.base_content !== null : f.content !== f.base_content;
}
