/**
 * Parsing e plano de reserva do Arquiteto (WLC 1.9.9). Puro: sem rede nem banco, fácil de testar.
 */
import { z } from "zod";
import { SPECIALISTS } from "../identity";
import { recoverCompleteChanges } from "./recover-changes";

export const architectSchema = z.object({
  intent: z.string().default(""),
  structure: z
    .object({
      folders: z.array(z.string()).default([]),
      files: z.array(z.string()).default([]),
    })
    .default({ folders: [], files: [] }),
  contracts: z
    .object({
      shared_types: z.array(z.string()).default([]),
      design_tokens: z.array(z.object({ name: z.string(), hex: z.string() })).default([]),
      routes: z.array(z.object({ path: z.string(), page: z.string() })).default([]),
      integrations: z.array(z.string()).default([]),
      modules: z.array(z.object({ path: z.string(), exports: z.array(z.string()), signatures: z.array(z.string()).default([]) })).default([]),
    })
    .default({ shared_types: [], design_tokens: [], routes: [], integrations: [], modules: [] }),
  palette_hints: z
    .array(z.object({ name: z.string(), hex: z.string() }))
    .default([]),
  distribution: z
    .array(
      z.object({
        role: z.string(),
        task: z.string(),
        owns: z.array(z.string()).optional(),
        connects_to: z.array(z.string()).optional(),
        priority: z.number().optional(),
      }),
    )
    .default([]),
  notes: z.string().optional(),
});


export type ArchitectPlan = z.infer<typeof architectSchema>;

export function parseJsonLoose(raw: string, recoverChanges = false): unknown {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  try {
    if (start < 0 || end <= start) throw new Error("JSON inválido");
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch (error) {
    const changes = recoverChanges ? recoverCompleteChanges(cleaned) : [];
    if (!changes.length) throw error;
    return {
      summary: "Resposta interrompida: recuperados somente arquivos completos; entrega parcial precisa de revisão.",
      changes,
      recovered: true,
    };
  }
}

/**
 * Lê a resposta do Arquiteto. Devolve null se o JSON/esquema for inválido OU se nenhuma tarefa
 * aponta para um especialista que existe — nesses casos vale pedir de novo antes de usar o plano padrão.
 */
export function parseArchitectPlan(raw: string): ArchitectPlan | null {
  try {
    const parsed = architectSchema.parse(parseJsonLoose(raw));
    return parsed.distribution.some((d) => d.role in SPECIALISTS) ? parsed : null;
  } catch {
    return null;
  }
}

/** Plano mínimo de reserva, só usado se o Arquiteto falhar também na segunda tentativa. */
export function fallbackArchitectPlan(request: string): ArchitectPlan {
  return {
    intent: request.slice(0, 200),
    structure: {
      folders: ["src", "src/pages", "src/lib", "src/services", "public"],
      files: [
        "package.json", "tsconfig.json", "index.html", "src/main.tsx", "src/App.tsx",
        "public/_redirects", "src/lib/supabase.ts", "schema.sql",
      ],
    },
    contracts: {
      shared_types: [],
      design_tokens: [],
      routes: [
        { path: "/", page: "src/pages/Home.tsx" },
        { path: "/admin", page: "src/pages/Admin.tsx" },
      ],
      integrations: [],
      modules: [],
    },
    palette_hints: [],
    distribution: [
      { role: "design", task: "Definir paleta e tokens visuais compartilhados", owns: [], connects_to: ["Frontend consome os tokens"], priority: 1 },
      {
        role: "frontend",
        task: "Criar interfaces Mobile First com react-router-dom (BrowserRouter + Routes). Rota / = vitrine pública sem links de admin; /admin = painel isolado. Proibido useState para páginas mestras e botões de admin na vitrine.",
        owns: ["src/App.tsx", "src/pages/Home.tsx", "src/pages/Admin.tsx"],
        connects_to: ["Consome tokens do Design e rotas do contrato"],
        priority: 1,
      },
      {
        role: "backend",
        task: "Criar src/lib/supabase.ts (createClient com VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY/ANON_KEY) e serviços que usam supabase.from().select()/insert() com fallback local",
        owns: ["src/lib/supabase.ts", "src/services"],
        connects_to: ["Frontend consome os serviços; DBA fornece schema.sql"],
        priority: 2,
      },
      {
        role: "dba",
        task: "Gerar schema.sql na raiz com CREATE TABLE IF NOT EXISTS, PKs UUID, RLS e seed de dados iniciais",
        owns: ["schema.sql"],
        connects_to: ["Backend usa as tabelas via Supabase"],
        priority: 2,
      },
      {
        role: "devops",
        task: "Garantir bootstrap de runtime (package.json com react-router-dom e @supabase/supabase-js, tsconfig.json, index.html, src/main.tsx, vite.config.ts, public/_redirects com /* /index.html 200) pronto para compilar e subir no deploy",
        owns: ["package.json", "tsconfig.json", "index.html", "src/main.tsx", "vite.config.ts", "public/_redirects"],
        connects_to: ["Alinhado com todos os imports gerados por Frontend, Design e Backend"],
        priority: 1,
      },
    ],
  };
}

export const ARCHITECT_RETRY_NOTE =
  "ATENÇÃO: a resposta anterior não era um plano válido. Responda APENAS com JSON válido, com 'distribution' contendo pelo menos uma tarefa com role válido.";
