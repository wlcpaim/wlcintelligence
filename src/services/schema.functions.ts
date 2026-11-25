import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface SchemaColumn { name: string; type: string; nullable: boolean; default: string | null }
export interface SchemaConstraint { name: string; type: "p" | "f" | "u" | "c" | string; definition: string }
export interface SchemaIndex { name: string; definition: string }
export interface SchemaPolicy { name: string; command: string; roles: string[]; using: string | null; check: string | null }
export interface SchemaTable {
  name: string; comment: string | null; rls_enabled: boolean; estimated_rows: number;
  columns: SchemaColumn[]; constraints: SchemaConstraint[]; indexes: SchemaIndex[]; policies: SchemaPolicy[];
}
export interface SchemaInfo { database: string; version: string; tables: SchemaTable[] }

/** Estrutura real do banco (somente leitura) + contagem de registros do próprio usuário. */
export const inspectDatabase = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.rpc("inspect_schema");
    if (error) return { connected: false as const, error: error.message };
    const info = data as unknown as SchemaInfo;
    const counts: Record<string, number | null> = {};
    await Promise.all(info.tables.map(async (t) => {
      const { count, error: e } = await context.supabase.from(t.name as "messages").select("*", { count: "exact", head: true });
      counts[t.name] = e ? null : (count ?? 0);
    }));
    return { connected: true as const, info, myRowCounts: counts };
  });
