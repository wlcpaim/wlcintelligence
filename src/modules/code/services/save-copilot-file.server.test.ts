import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import type { Database } from "@/integrations/supabase/types";
import { updateCopilotFile } from "./save-copilot-file.server";

describe("Copilot update transport", () => {
  it("sends SQL source in the body without losing owner and concurrency filters", async () => {
    let url = "";
    let body = "";
    const db = createClient<Database>("https://database.example.test", "test-key", {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: async (input, init) => {
        url = String(input); body = String(init?.body);
        return new Response(JSON.stringify({ id: "file", content: "SELECT * FROM code_files;" }), { headers: { "Content-Type": "application/json" } });
      } },
    });
    const sql = "SELECT * FROM code_files;";
    const result = await updateCopilotFile(db, "owner", { id: "file", updated_at: "2026-11-23T09:00:00Z" }, sql, "2026-11-23T09:15:00Z").select("id,content").single();
    const filters = new URL(url).searchParams;
    expect(filters.has("content")).toBe(false);
    expect(filters.get("id")).toBe("eq.file");
    expect(filters.get("user_id")).toBe("eq.owner");
    expect(filters.get("updated_at")).toBe("eq.2026-11-23T09:00:00Z");
    expect(filters.get("deleted")).toBe("eq.false");
    expect(JSON.parse(body)).toEqual({ content: sql, updated_at: "2026-11-23T09:15:00Z" });
    expect(result.data?.content).toBe(sql);
  });
  it("does not report success when the atomic timestamp filter matches no row", async () => {
    const db = createClient<Database>("https://database.example.test", "test-key", {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: async () => new Response(JSON.stringify({ code: "PGRST116", message: "No rows" }), {
        status: 406, headers: { "Content-Type": "application/json" },
      }) },
    });
    const result = await updateCopilotFile(db, "owner", { id: "file", updated_at: "stale" }, "SELECT 1;", "now").select("id").single();
    expect(result.data).toBeNull();
    expect(result.error?.code).toBe("PGRST116");
  });
});