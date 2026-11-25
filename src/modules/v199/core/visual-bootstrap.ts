import type { ContractFile, ContractIssue } from "./contracts";

export function visualBootstrap(files: ContractFile[]): { changes: ContractFile[]; issues: ContractIssue[] } {
  const changes: ContractFile[] = [], issues: ContractIssue[] = [];
  const pkg = files.find(f => f.path === "package.json");
  if (!pkg) return { changes, issues };
  let deps: Record<string, string>;
  try {
    const p = JSON.parse(pkg.content);
    deps = { ...p.dependencies, ...p.devDependencies };
  } catch { return { changes, issues }; }
  const version = deps["tailwindcss"];
  if (!version) return { changes, issues };
  const major = version.match(/\d+/)?.[0];
  const css = files.filter(f => f.path.endsWith(".css") && !/\.(test|spec)\.[tj]sx?$/.test(f.path) && !/(^|\/)(tests?|__tests__)\//.test(f.path));
  if (major === "3") {
    const config = files.find(f => /^tailwind\.config\.(js|cjs|mjs|ts)$/.test(f.path));
    if (!config) {
      changes.push({ path: "tailwind.config.js", content: `export default {\n  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],\n  darkMode: "class",\n  theme: { extend: {} },\n  plugins: [],\n};\n` });
    } else if (!/content\s*:/.test(config.content) || !/src\/\*\*/.test(config.content)) {
      issues.push({ path: config.path, message: "Tailwind v3 precisa varrer os arquivos em src/** no content." });
    }
    if (!files.some(f => /^postcss\.config\./.test(f.path) && /tailwindcss/.test(f.content))) issues.push({ path: "postcss.config.js", message: "Tailwind v3 sem processamento PostCSS configurado." });
    if (!css.some(f => /@tailwind\s+utilities/.test(f.content))) issues.push({ path: "src/index.css", message: "CSS sem diretivas utilitárias do Tailwind v3." });
  } else if (major === "4") {
    if (!css.some(f => /@import\s+["']tailwindcss["']/.test(f.content))) issues.push({ path: "src/index.css", message: "Tailwind v4 exige @import 'tailwindcss', não diretivas legadas @tailwind." });
    const wired = files.some(f => /^vite\.config\./.test(f.path) && /@tailwindcss\/vite/.test(f.content)) || files.some(f => /^postcss\.config\./.test(f.path) && /@tailwindcss\/postcss/.test(f.content));
    if (!wired) issues.push({ path: "vite.config.ts", message: "Tailwind v4 sem plugin Vite/PostCSS configurado." });
  } else issues.push({ path: "package.json", message: "Versão Tailwind não reconhecida; confirmar configuração antes de publicar." });
  const entry = files.find(f => /^src\/(main|index)\.[jt]sx?$/.test(f.path));
  if (entry && css.length && !/import\s+["'][^"']+\.css["']/.test(entry.content)) issues.push({ path: entry.path, message: "Entrada React não importa o CSS principal." });
  return { changes, issues };
}