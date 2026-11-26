import { z } from "zod";

const identifier = z.string().regex(/^[a-z][a-z0-9_]{0,25}$/);
const column = z.object({
  name: identifier.refine(n => !["id", "user_id", "created_at"].includes(n), "Coluna reservada"),
  type: z.enum(["text", "uuid", "numeric", "integer", "boolean", "timestamptz", "date", "jsonb"]),
  required: z.boolean().default(false),
  references: identifier.optional(),
}).strict();

export const generatedDatabaseManifest = z.object({
  version: z.literal(1),
  tables: z.array(z.object({
    name: identifier,
    publicRead: z.boolean().default(false),
    columns: z.array(column).min(1).max(50),
  }).strict()).min(1).max(40),
}).strict().superRefine((manifest, ctx) => {
  const names = manifest.tables.map(t => t.name);
  if (new Set(names).size !== names.length) ctx.addIssue({ code: "custom", message: "Tabelas duplicadas" });
  for (const table of manifest.tables) {
    const columns = table.columns.map(c => c.name);
    if (new Set(columns).size !== columns.length) ctx.addIssue({ code: "custom", message: `Colunas duplicadas: ${table.name}` });
    for (const c of table.columns) {
      if (c.references && (c.type !== "uuid" || !names.includes(c.references))) {
        ctx.addIssue({ code: "custom", message: `Referência inválida: ${table.name}.${c.name}` });
      }
    }
  }
});

export type GeneratedManifest = z.infer<typeof generatedDatabaseManifest>;
export interface GeneratedFile { path: string; content: string }

export function needsGeneratedDatabase(files: GeneratedFile[]) {
  return files.some(f => f.path === "database.manifest.json" || f.path === "schema.sql" ||
    /\.(?:tsx?|jsx?)$/.test(f.path) && /supabase\.from|\.auth\.(?:signIn|signUp)|src\/services/.test(f.content));
}

export function readGeneratedManifest(files: GeneratedFile[]): GeneratedManifest | null {
  if (!needsGeneratedDatabase(files)) return null;
  const file = files.find(f => f.path === "database.manifest.json");
  if (!file) throw new Error("Banco não provisionável: falta database.manifest.json. Regenere o contrato de dados antes de publicar.");
  let parsed: unknown;
  try { parsed = JSON.parse(file.content); } catch { throw new Error("Manifesto de banco inválido: JSON incompleto."); }
  const result = generatedDatabaseManifest.safeParse(parsed);
  if (!result.success) throw new Error(`Manifesto de banco inválido: ${result.error.issues.map(i => i.message).join("; ")}`);
  return result.data;
}

/** Required in every generator; the database enforces these rules independently of model output. */
export const GENERATED_APP_CONTRACT = `
CONTRATO OBRIGATÓRIO DE BANCO E ADMIN (APPS GERADOS):
- DBA entrega database.manifest.json, versão 1: {"version":1,"tables":[{"name":"products","publicRead":true,"columns":[{"name":"title","type":"text","required":true},{"name":"price","type":"numeric","required":true}]}]}.
- Liste TODAS as tabelas do domínio. Tipos: text, uuid, numeric, integer, boolean, timestamptz, date, jsonb. Nome snake_case de até 26 caracteres. Cada tabela já recebe id UUID, user_id UUID e created_at. Não redeclare essas colunas estruturais (id, user_id, created_at). Colunas de negócio como "role" (cargo/função) são permitidas. references opcional aponta para outra tabela do manifesto e exige uuid. publicRead só true para dados realmente públicos; gravações são exclusivas do admin.
- Não gere SQL executável, triggers em auth, roles em profiles, seeds de admin nem RPC exec_migration. O provisionador validado cria tabelas isoladas por projeto, GRANTs, RLS e funções antes do Deploy. schema.sql pode documentar o domínio, mas não é executado.
- Backend: src/lib/supabase.ts importa createGeneratedAppClient de './generated-app-client' e exporta supabase = createGeneratedAppClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY, import.meta.env.VITE_WLC_PROJECT_ID). Esse arquivo de suporte é fornecido pelo sistema; não o reimplemente.
- Use supabase.from('nome_do_manifesto') em TODOS os serviços. Nunca use cliente bruto para tabelas, SQL arbitrário ou outro projeto. A autenticação usa supabase.auth.signUp({email,password}) e signInWithPassword({email,password}); aguarde confirmação de e-mail e sessão real.
- Depois do login confirmado: supabase.rpc('claim_generated_app_admin'). Retorna 'admin' só ao primeiro usuário confirmado daquele app; demais recebem 'user'. Para cada acesso ao painel consulte supabase.rpc('generated_app_role'); usuário sem sessão/admin NÃO entra. RLS valida a mesma permissão no banco. Logout usa supabase.auth.signOut().
- Nunca autorize por localStorage, senha fictícia, e-mail pré-preenchido, falha de rede, tabela ausente ou fallback local. Erro de configuração bloqueia publicação; erro de autenticação bloqueia acesso.
- QA verifica cadastro confirmado, primeiro admin, segundo usuário recusado no painel e em gravações, reload, logout e CRUD persistido; não declarar 100% funcional sem esses testes reais.
`;

// Literal text, split to prevent Vite from replacing env references in generated source.
export const GENERATED_APP_CLIENT_SOURCE = `import { createClient } from '@supabase/supabase-js';
export function createGeneratedAppClient(url: string, key: string, projectId: string) {
  if (!url || !key || !/^[0-9a-f-]{36}$/i.test(projectId)) throw new Error('Configuração do app incompleta');
  const prefix = 'wlc_' + projectId.replace(/-/g, '') + '_';
  const client = createClient(url, key, { global: { fetch: (input, init) => {
    const headers = new Headers(init?.headers);
    if (key.startsWith('sb_') && headers.get('Authorization') === 'Bearer ' + key) headers.delete('Authorization');
    headers.set('apikey', key);
    return fetch(input, { ...init, headers });
  } } });
  return {
    auth: client.auth,
    from: (table: string) => {
      if (!/^[a-z][a-z0-9_]{0,25}$/.test(table)) throw new Error('Tabela inválida');
      return client.from(prefix + table);
    },
    rpc: (name: 'claim_generated_app_admin' | 'generated_app_role') => client.rpc(name, { p_project_id: projectId }),
  };
}
`;