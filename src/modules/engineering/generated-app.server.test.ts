import { afterEach, expect, it, vi } from "vitest";
import type { Db } from "@/modules/integrations/core/runs.server";
import { provisionGeneratedDatabase } from "./generated-app.server";
import { GENERATED_APP_CLIENT_SOURCE } from "./generated-app-contract";

const files = [
  { path: "database.manifest.json", content: JSON.stringify({ version: 1, tables: [{ name: "products", columns: [{ name: "title", type: "text" }] }] }) },
  { path: "src/lib/generated-app-client.ts", content: GENERATED_APP_CLIENT_SOURCE },
  { path: "src/lib/supabase.ts", content: "createGeneratedAppClient(import.meta.env.VITE_WLC_PROJECT_ID)" },
  { path: "src/services/auth.ts", content: "supabase.auth.signInWithPassword(); supabase.rpc('claim_generated_app_admin'); supabase.rpc('generated_app_role');" },
];
afterEach(() => vi.unstubAllEnvs());
it("provisiona o banco correto e exige confirmação antes do deploy", async () => {
  vi.stubEnv("SUPABASE_PROJECT_ID", "test-db");
  const rpc = vi.fn().mockResolvedValue({ data: { ready: true }, error: null });
  expect((await provisionGeneratedDatabase({ rpc } as unknown as Db, "project", files, { url: "https://test-db.invalid", key: "public-test", projectId: "test-db" })).tables).toBe(1);
  expect(rpc).toHaveBeenCalledWith("provision_generated_app", expect.objectContaining({ p_project_id: "project" }));
  rpc.mockResolvedValue({ data: { ready: false }, error: null });
  await expect(provisionGeneratedDatabase({ rpc } as unknown as Db, "project", files, { url: "https://test-db.invalid", key: "public-test", projectId: "test-db" })).rejects.toThrow("não confirmado");
});
it("não migra no banco externo nem autoriza modo local quando faltam credenciais", async () => {
  vi.stubEnv("SUPABASE_PROJECT_ID", "owned-db");
  vi.stubEnv("SUPABASE_URL", "https://owned-db.invalid");
  const rpc = vi.fn();
  const db = { rpc } as unknown as Db;
  await expect(provisionGeneratedDatabase(db, "project", files, null)).rejects.toThrow("Configure o banco");
  await expect(provisionGeneratedDatabase(db, "project", files, { url: "https://other-db.invalid", key: "public-test", projectId: "other-db" })).rejects.toThrow("banco externo");
  expect(rpc).not.toHaveBeenCalled();
});
it("não provisiona quando serviços usam tabela ausente", async () => {
  vi.stubEnv("SUPABASE_PROJECT_ID", "test-db");
  const rpc = vi.fn();
  await expect(provisionGeneratedDatabase({ rpc } as unknown as Db, "project", [...files, { path: "src/services/data.ts", content: "supabase.from('orders').select()" }], { url: "https://test.invalid", key: "public-test", projectId: "test-db" })).rejects.toThrow("orders");
  expect(rpc).not.toHaveBeenCalled();
});