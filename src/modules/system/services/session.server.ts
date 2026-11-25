/** Estado da sessão System (projeto ativo + plano pendente de confirmação), salvo no banco. */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import type { CognitivePlan } from "../core/cognitive";

type Db = SupabaseClient<Database>;
export interface SystemSession { activeProjectId: string | null; pendingPlan: CognitivePlan | null }

export async function loadSession(db: Db, userId: string, key: string): Promise<SystemSession> {
  const { data } = await db.from("system_sessions").select("active_project_id,pending_plan").eq("user_id", userId).eq("session_key", key).maybeSingle();
  return { activeProjectId: data?.active_project_id ?? null, pendingPlan: (data?.pending_plan as unknown as CognitivePlan | null) ?? null };
}

export async function saveSession(db: Db, userId: string, key: string, s: SystemSession): Promise<void> {
  const { error } = await db.from("system_sessions").upsert({
    user_id: userId, session_key: key, active_project_id: s.activeProjectId,
    pending_plan: s.pendingPlan as unknown as Json, updated_at: new Date().toISOString(),
  }, { onConflict: "user_id,session_key" });
  if (error) throw new Error(`Não foi possível salvar a sessão: ${error.message}`);
}
