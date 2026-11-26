import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

// Opt-in: uses real verified test accounts and rolls back every domain-table fixture.
// Never changes production email-confirmation settings or an existing account's role.
describe.skipIf(process.env['RUN_GENERATED_APP_DB_TESTS'] !== '1')("generated apps — real database", () => {
  const sql = postgres(process.env['SUPABASE_DB_URL'] ?? '', { max: 1 });
  const admin = createClient(process.env['SUPABASE_URL'] ?? '', process.env['SUPABASE_SERVICE_ROLE_KEY'] ?? '', { auth: { persistSession: false } });
  const users: string[] = [];
  const manifest = { version: 1, tables: [{ name: "orders", publicRead: false, columns: [{ name: "title", type: "text", required: true }] }] };
  beforeAll(async () => {
    for (let i = 0; i < 2; i++) {
      const created = await admin.auth.admin.createUser({ email: `wlc-audit-${randomUUID()}@example.com`, email_confirm: true });
      if (created.error || !created.data.user) throw new Error("Could not create temporary verified test account");
      users.push(created.data.user.id);
    }
  });
  afterAll(async () => {
    for (const user of users) await admin.auth.admin.deleteUser(user);
    await sql.end();
  });
  class RollbackFixture extends Error {}
  async function fixture(check: (tx: postgres.TransactionSql, project: string, owner: string, second: string) => Promise<void>) {
    const owner = users[0]; const second = users[1];
    if (!owner || !second) throw new Error("Temporary accounts missing");
    try {
      await sql.begin(async tx => {
        const project = randomUUID();
        await tx`INSERT INTO public.code_projects(id,user_id,name,source) VALUES(${project},${owner},'WLC rollback audit','chat')`;
        await tx`SELECT set_config('request.jwt.claims',${JSON.stringify({ sub: owner, role: "authenticated" })},true)`;
        await tx`SET LOCAL ROLE authenticated`;
        const result = await tx`SELECT public.provision_generated_app(${project}::uuid,${JSON.stringify(manifest)}::jsonb) AS result`;
        expect(result[0]?.['result']?.ready).toBe(true);
        await check(tx, project, owner, second);
        throw new RollbackFixture();
      });
    } catch (error) { if (!(error instanceof RollbackFixture)) throw error; }
  }
  it("first verified account becomes admin; second account cannot become admin", async () => {
    await fixture(async (tx, project, owner, second) => {
      expect((await tx`SELECT public.claim_generated_app_admin(${project}::uuid) AS role`)[0]?.['role']).toBe("admin");
      await tx`SELECT set_config('request.jwt.claims',${JSON.stringify({ sub: second, role: "authenticated" })},true)`;
      expect((await tx`SELECT public.claim_generated_app_admin(${project}::uuid) AS role`)[0]?.['role']).toBe("user");
      await tx`SELECT set_config('request.jwt.claims',${JSON.stringify({ sub: owner, role: "authenticated" })},true)`;
      expect((await tx`SELECT public.generated_app_role(${project}::uuid) AS role`)[0]?.['role']).toBe("admin");
    });
  });
  it("only admin can write and private records are not visible to another account", async () => {
    await fixture(async (tx, project, _owner, second) => {
      await tx`SELECT public.claim_generated_app_admin(${project}::uuid)`;
      const table = `wlc_${project.replace(/-/g, '')}_orders`;
      await tx`INSERT INTO public.${tx(table)}(title) VALUES('real audit record')`;
      expect((await tx`SELECT title FROM public.${tx(table)}`)[0]?.['title']).toBe("real audit record");
      await tx`SELECT set_config('request.jwt.claims',${JSON.stringify({ sub: second, role: "authenticated" })},true)`;
      await tx`SELECT public.claim_generated_app_admin(${project}::uuid)`;
      expect(await tx`SELECT title FROM public.${tx(table)}`).toHaveLength(0);
      await expect(tx.savepoint(async nested => { await nested`INSERT INTO public.${nested(table)}(title) VALUES('denied')`; })).rejects.toThrow();
      await expect(tx.savepoint(async nested => { await nested`UPDATE public.generated_app_user_roles SET role = 'admin' WHERE project_id = ${project}::uuid`; })).rejects.toThrow();
    });
  });
  it("repeat publication preserves the first admin and existing domain records", async () => {
    await fixture(async (tx, project) => {
      await tx`SELECT public.claim_generated_app_admin(${project}::uuid)`;
      const table = `wlc_${project.replace(/-/g, '')}_orders`;
      await tx`INSERT INTO public.${tx(table)}(title) VALUES('keep through redeploy')`;
      const result = await tx`SELECT public.provision_generated_app(${project}::uuid,${JSON.stringify(manifest)}::jsonb) AS result`;
      expect(result[0]?.['result']?.reused).toBe(true);
      expect((await tx`SELECT public.generated_app_role(${project}::uuid) AS role`)[0]?.['role']).toBe("admin");
      expect((await tx`SELECT title FROM public.${tx(table)}`)[0]?.['title']).toBe("keep through redeploy");
    });
  });
  it("commit reservation blocks a second request and preserves a concurrent edit", async () => {
    await fixture(async (tx, project, owner) => {
      const file = randomUUID();
      await tx`INSERT INTO public.code_files(id,project_id,user_id,path,content,base_content) VALUES(${file},${project},${owner},'src/a.ts','accepted snapshot','old')`;
      const lease = (await tx`SELECT public.begin_project_commit(${project}::uuid) AS lease`)[0]?.['lease'];
      expect(typeof lease).toBe("string");
      await expect(tx.savepoint(async nested => { await nested`SELECT public.begin_project_commit(${project}::uuid)`; })).rejects.toThrow("Commit em andamento");
      await tx`UPDATE public.code_files SET content = 'newer edit' WHERE id = ${file}::uuid`;
      await tx`SELECT public.complete_project_commit(${project}::uuid,${lease}::uuid,'abcdef1234567',${JSON.stringify([{ id: file, content: "accepted snapshot", deleted: false }])}::jsonb)`;
      const row = (await tx`SELECT content,base_content FROM public.code_files WHERE id = ${file}::uuid`)[0];
      expect(row?.['content']).toBe("newer edit");
      expect(row?.['base_content']).toBe("accepted snapshot");
    });
  });
});