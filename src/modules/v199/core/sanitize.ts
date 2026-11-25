/**
 * Vacina de build para projetos gerados: corrige versões inexistentes e scripts frágeis
 * no package.json antes de gravar. Sem rede; regras fixas e testáveis.
 */
export interface SanitizeFile { path: string; content: string }

/** Versões conhecidas que existem no npm e mantêm ícones de marca (Github, Twitter...). */
export const PINNED_VERSIONS: Record<string, string> = {
  "lucide-react": "^0.460.0",
  "react-router-dom": "^6.28.0",
  "@supabase/supabase-js": "^2.48.0",
};

export function sanitizePackageJson(content: string): string {
  let pkg: Record<string, unknown>;
  try { pkg = JSON.parse(content) as Record<string, unknown>; } catch { return content; }
  for (const bag of ["dependencies", "devDependencies"] as const) {
    const deps = pkg[bag] as Record<string, string> | undefined;
    if (!deps || typeof deps !== "object") continue;
    for (const [name, version] of Object.entries(PINNED_VERSIONS)) {
      if (name in deps) deps[name] = version;
    }
  }
  const scripts = pkg["scripts"] as Record<string, string> | undefined;
  const build = scripts?.["build"];
  // tsc bloqueia o deploy por avisos de tipo em dados mockados; o Vite já compila TS.
  if (scripts && typeof build === "string" && /^tsc(\s+-b)?\s*&&\s*vite build/.test(build.trim())) {
    scripts["build"] = build.trim().replace(/^tsc(\s+-b)?\s*&&\s*/, "");
  }
  return JSON.stringify(pkg, null, 2) + "\n";
}

export function sanitizeChanges<T extends SanitizeFile>(changes: T[]): T[] {
  return changes.map((c) =>
    c.path.replace(/^\.?\//, "") === "package.json" ? { ...c, content: sanitizePackageJson(c.content) } : c,
  );
}

/** Projeto desta conversa: o último link "/code/<uuid>" que o chat já entregou. */
export function projectFromHistory(messages: { role: string; content: string }[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m || m.role !== "model") continue;
    const hit = /\/code\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(m.content);
    if (hit?.[1]) return hit[1];
  }
  return null;
}
