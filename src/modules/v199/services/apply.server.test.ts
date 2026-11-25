import { createClient } from "@supabase/supabase-js";
import { expect, it, vi } from "vitest";
import type { Database } from "@/integrations/supabase/types";
import { applyTeamChanges } from "./apply.server";

vi.mock("@/modules/orchestrator/tools.server", () => ({ openWorkspace: vi.fn() }));

it("cria um único projeto e salva todos os arquivos nele quando o chat não tem destino", async () => {
  const projectBodies: unknown[] = [];
  const fileBodies: Record<string, unknown>[] = [];
  const db = createClient<Database>("https://database.example.test", "test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("code_projects") && init?.method === "POST") {
        projectBodies.push(JSON.parse(String(init.body)));
        return Response.json({ id: "created", name: "Criar um PDV" });
      }
      if (url.pathname.endsWith("code_files") && init?.method === "GET") return Response.json(null);
      if (url.pathname.endsWith("code_files") && init?.method === "POST") {
        fileBodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      }
      return new Response(null, { status: 204 });
    } },
  });
  const result = await applyTeamChanges(db, "owner", [
    { path: "src/App.tsx", content: "export default function App() {}" },
    { path: "package.json", content: "{}" },
  ], { projectId: null, projectName: null, request: "Criar um PDV" });
  expect(projectBodies).toEqual([{ user_id: "owner", name: "Criar um PDV", source: "chat" }]);
  expect(fileBodies.map((f) => [f["project_id"], f["user_id"]])).toEqual([["created", "owner"], ["created", "owner"]]);
  expect(result.written).toEqual(["src/App.tsx", "package.json"]);
  expect(result.skipped).toEqual([]);
});