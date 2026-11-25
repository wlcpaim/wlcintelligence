import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { safeMessage } from "./errors";

export type Db = SupabaseClient<Database>;

export async function logRun(
  db: Db,
  userId: string,
  row: {
    provider: "gemini" | "github";
    kind: string;
    ok: boolean;
    key_id?: string | null;
    http_status?: number | null;
    detail?: string | null;
  },
): Promise<void> {
  const { error } = await db.from("integration_runs").insert({
    user_id: userId,
    provider: row.provider,
    kind: row.kind,
    ok: row.ok,
    key_id: row.key_id ?? null,
    http_status: row.http_status ?? null,
    detail: row.detail ? safeMessage(row.detail) : null,
  });
  if (error) console.error("integration_runs insert failed:", error.message);
}
