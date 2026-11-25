import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

/** Source belongs in the POST body, never a URL filter; timestamps keep the update atomic. */
export function updateCopilotFile(
  db: SupabaseClient<Database>, userId: string,
  current: { id: string; updated_at: string }, content: string, now: string,
) {
  return db.from("code_files").update({ content, updated_at: now })
    .eq("id", current.id).eq("user_id", userId)
    .eq("updated_at", current.updated_at).eq("deleted", false);
}