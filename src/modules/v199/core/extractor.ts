/**
 * Extrator puro de estrutura a partir do texto de planejamento.
 * Não interfere no chat — apenas analisa a resposta da IA de planejamento
 * e devolve itens acionáveis para o pipeline de criação.
 */

export interface ExtractedStructure {
  folders: string[];
  files: string[];
  components: string[];
  palette: { name: string; hex: string }[];
  tokens: string[];
  categories: string[];
  rawHints: string[];
}

const FOLDER_RE = /(?:pasta|diretório|folder|dir)[:\s]*[`"]?([a-zA-Z0-9_./-]+)[`"]?/gi;
const FILE_RE = /(?:arquivo|file|path)[:\s]*[`"]?([a-zA-Z0-9_./-]+\.[a-zA-Z0-9]+)[`"]?/gi;
const COMPONENT_RE = /(?:componente|component)[:\s]*[`"]?([A-Z][a-zA-Z0-9]+)[`"]?/gi;
const HEX_RE = /#([0-9a-fA-F]{3,8})\b/g;
const PALETTE_LINE_RE = /(?:cor|color|palette|paleta)[:\s-]*([^\n#]*?)(#([0-9a-fA-F]{3,8}))/gi;

/** Extrai estrutura de um texto de planejamento sem alterar o chat. */
export function extractStructureFromPlan(text: string): ExtractedStructure {
  const folders = new Set<string>();
  const files = new Set<string>();
  const components = new Set<string>();
  const palette: { name: string; hex: string }[] = [];
  const tokens = new Set<string>();
  const categories = new Set<string>();
  const rawHints: string[] = [];

  let m: RegExpExecArray | null;

  // Pastas
  while ((m = FOLDER_RE.exec(text)) !== null) {
    const raw = m[1];
    if (!raw) continue;
    const p = raw.replace(/\/$/, "");
    if (p.length > 1) folders.add(p);
  }

  // Arquivos
  while ((m = FILE_RE.exec(text)) !== null) {
    if (m[1]) files.add(m[1]);
  }

  // Componentes
  while ((m = COMPONENT_RE.exec(text)) !== null) {
    if (m[1]) components.add(m[1]);
  }

  // Paleta
  while ((m = PALETTE_LINE_RE.exec(text)) !== null) {
    const name = (m[1] || "cor").trim().replace(/[:\-–—]+$/, "").trim() || "cor";
    const hex = `#${m[3]}`;
    if (!palette.some(p => p.hex.toLowerCase() === hex.toLowerCase())) {
      palette.push({ name, hex });
    }
  }
  // Fallback: qualquer hex solto
  if (palette.length === 0) {
    const seen = new Set<string>();
    while ((m = HEX_RE.exec(text)) !== null) {
      const hex = `#${m[1]}`;
      if (!seen.has(hex.toLowerCase())) {
        seen.add(hex.toLowerCase());
        palette.push({ name: `cor-${palette.length + 1}`, hex });
      }
    }
  }

  // Categorias mencionadas
  const catMap: Record<string, string> = {
    arquitet: "architect",
    design: "design",
    frontend: "frontend",
    backend: "backend",
    dba: "dba",
    banco: "dba",
    qa: "qa",
    teste: "qa",
    devops: "devops",
    deploy: "devops",
  };
  for (const [k, v] of Object.entries(catMap)) {
    if (new RegExp(k, "i").test(text)) categories.add(v);
  }

  // Hints de estrutura em listas
  const listLines = text.split("\n").filter(l => /^\s*[-*•]\s+/.test(l) || /^\s*\d+\.\s+/.test(l));
  for (const line of listLines) {
    const clean = line.replace(/^\s*[-*•\d.]+\s+/, "").trim();
    if (clean.length > 3 && clean.length < 120) rawHints.push(clean);
  }

  return {
    folders: [...folders],
    files: [...files],
    components: [...components],
    palette,
    tokens: [...tokens],
    categories: [...categories],
    rawHints: rawHints.slice(0, 40),
  };
}

/** Serializa a estrutura extraída para injetar no contexto do Modo Criar. */
export function structureToContext(s: ExtractedStructure): string {
  const parts: string[] = ["### Estrutura extraída automaticamente do plano"];
  if (s.folders.length) parts.push(`Pastas: ${s.folders.join(", ")}`);
  if (s.files.length) parts.push(`Arquivos: ${s.files.join(", ")}`);
  if (s.components.length) parts.push(`Componentes: ${s.components.join(", ")}`);
  if (s.palette.length) {
    parts.push("Paleta:");
    for (const p of s.palette) parts.push(`  - ${p.name}: ${p.hex}`);
  }
  if (s.categories.length) parts.push(`Categorias ativas: ${s.categories.join(", ")}`);
  if (s.rawHints.length) {
    parts.push("Hints:");
    for (const h of s.rawHints.slice(0, 15)) parts.push(`  - ${h}`);
  }
  return parts.join("\n");
}
