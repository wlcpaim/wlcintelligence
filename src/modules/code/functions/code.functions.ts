import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getToken } from "@/modules/integrations/github/services/connection.server";
import { ghCall, loadEditableRepo } from "../services/github-write.server";
import { commitPending } from "../services/commit.server";

const repoRe = /^[\w.-]+\/[\w.-]+$/;
const msg = (e: unknown) => (e instanceof Error ? e.message : "Erro inesperado");

/** Cria um projeto a partir de um repositório existente e grava seus arquivos. */
export const importRepoProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ repo: z.string().regex(repoRe), source: z.enum(["git", "chat"]) }).parse(d))
  .handler(async ({ data, context }): Promise<{ ok: true; id: string } | { ok: false; error: string }> => {
    try {
      const token = await getToken(context.supabase, context.userId);
      const loaded = await loadEditableRepo(token, data.repo);
      const { data: p, error } = await context.supabase.from("code_projects").insert({
        user_id: context.userId, name: data.repo.split("/")[1]!, source: data.source,
        repo_full_name: data.repo, branch: loaded.branch, base_sha: loaded.sha,
      }).select("id").single();
      if (error) throw new Error(error.message);
      for (let i = 0; i < loaded.files.length; i += 200) {
        const rows = loaded.files.slice(i, i + 200).map((f) => ({ project_id: p.id, user_id: context.userId, path: f.path, content: f.content, base_content: f.content }));
        const { error: e2 } = await context.supabase.from("code_files").insert(rows);
        if (e2) throw new Error(e2.message);
      }
      return { ok: true, id: p.id };
    } catch (e) { return { ok: false, error: msg(e) }; }
  });

/** Cria um repositório vazio (sem README/presets) e o projeto vinculado. */
export const createRepoProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ name: z.string().trim().regex(/^[\w.-]{1,100}$/, "Nome inválido"), private: z.boolean() }).parse(d))
  .handler(async ({ data, context }): Promise<{ ok: true; id: string } | { ok: false; error: string }> => {
    try {
      const token = await getToken(context.supabase, context.userId);
      const r = await ghCall<{ full_name: string; default_branch?: string }>(token, "POST", "/user/repos", { name: data.name, private: data.private, auto_init: false });
      const { data: p, error } = await context.supabase.from("code_projects").insert({
        user_id: context.userId, name: data.name, source: "git", repo_full_name: r.full_name, branch: r.default_branch || "main", base_sha: null,
      }).select("id").single();
      if (error) throw new Error(error.message);
      return { ok: true, id: p.id };
    } catch (e) { return { ok: false, error: msg(e) }; }
  });

/** Vincula um projeto local (Empty/ZIP) a um repositório novo vazio. */
export const linkNewRepo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ projectId: z.string().uuid(), name: z.string().trim().regex(/^[\w.-]{1,100}$/, "Nome inválido"), private: z.boolean() }).parse(d))
  .handler(async ({ data, context }): Promise<{ ok: true } | { ok: false; error: string }> => {
    try {
      const token = await getToken(context.supabase, context.userId);
      const r = await ghCall<{ full_name: string; default_branch?: string }>(token, "POST", "/user/repos", { name: data.name, private: data.private, auto_init: false });
      const { error } = await context.supabase.from("code_projects").update({ repo_full_name: r.full_name, branch: r.default_branch || "main", base_sha: null }).eq("id", data.projectId);
      if (error) throw new Error(error.message);
      await context.supabase.from("code_files").update({ base_content: null }).eq("project_id", data.projectId);
      return { ok: true };
    } catch (e) { return { ok: false, error: msg(e) }; }
  });

/** Envia todas as alterações salvas em um único commit, na ordem em que foram feitas. */
export const commitProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ projectId: z.string().uuid(), message: z.string().trim().min(1).max(500) }).parse(d))
  .handler(async ({ data, context }): Promise<{ ok: true; sha: string; count: number; backupId?: string | null; message?: string } | { ok: false; error: string }> => {
    try {
      const r = await commitPending(context.supabase, context.userId, data.projectId, data.message);
      if (!r) return { ok: false, error: "Nenhuma alteração para enviar." };
      return { ok: true, ...r };
    } catch (e) { return { ok: false, error: msg(e) }; }
  });

/** Gera uma descrição inteligente de commit no padrão Conventional Commits. */
export const generateCommitMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ projectId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<{ ok: true; message: string } | { ok: false; error: string }> => {
    try {
      const db = context.supabase;
      const { data: files, error } = await db
        .from("code_files")
        .select("path, content, base_content, deleted")
        .eq("project_id", data.projectId)
        .eq("user_id", context.userId);
      if (error) throw new Error(error.message);

      const changed = (files ?? []).filter((f) => (f.deleted ? f.base_content !== null : f.content !== f.base_content));
      if (!changed.length) return { ok: false, error: "Nenhuma alteração pendente" };

      const paths = changed.map((f) => f.path);
      const firstPath = paths[0] ?? "app";
      const parts = firstPath.split("/");
      const moduleName = parts.length > 1 ? parts[1] : parts[0] || "core";

      let type = "feat";
      if (paths.some((p) => /fix|bug|patch/i.test(p))) type = "fix";
      else if (paths.some((p) => /test|spec/i.test(p))) type = "test";
      else if (paths.some((p) => /config|vite|tailwind|package/i.test(p))) type = "chore";

      const action = changed.some((f) => f.deleted) ? "remove" : changed.some((f) => f.base_content === null) ? "adiciona" : "atualiza";
      const fileSummary = paths.length === 1 ? paths[0]?.split("/").pop() : `${paths.length} arquivos`;

      const message = `${type}(${moduleName}): ${action} ${fileSummary}`;
      return { ok: true, message };
    } catch (e) { return { ok: false, error: msg(e) }; }
  });

/** Sincroniza o projeto com o repositório remoto (pull do GitHub). */
export const pullRepoProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ projectId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<{ ok: true; count: number } | { ok: false; error: string }> => {
    try {
      const db = context.supabase;
      const { data: p, error } = await db.from("code_projects").select("repo_full_name, branch").eq("id", data.projectId).single();
      if (error || !p) throw new Error("Projeto não encontrado.");
      if (!p.repo_full_name) return { ok: true, count: 0 };

      const token = await getToken(db, context.userId);
      const loaded = await loadEditableRepo(token, p.repo_full_name);

      const { data: existingFiles, error: efError } = await db.from("code_files").select("id, path, content, deleted").eq("project_id", data.projectId);
      if (efError) throw new Error(efError.message);

      const existingMap = new Map(existingFiles?.map(f => [f.path, f]) ?? []);
      const remotePaths = new Set(loaded.files.map(f => f.path));
      const now = new Date().toISOString();

      for (const rf of loaded.files) {
        const current = existingMap.get(rf.path);
        if (current) {
          if (current.content !== rf.content || current.deleted) {
            await db.from("code_files").update({ content: rf.content, base_content: rf.content, deleted: false, updated_at: now }).eq("id", current.id);
          }
        } else {
          await db.from("code_files").insert({
            project_id: data.projectId,
            user_id: context.userId,
            path: rf.path,
            content: rf.content,
            base_content: rf.content,
            deleted: false,
          });
        }
      }

      for (const [path, current] of existingMap.entries()) {
        if (!remotePaths.has(path) && !current.deleted) {
          await db.from("code_files").update({ deleted: true, updated_at: now }).eq("id", current.id);
        }
      }

      await db.from("code_projects").update({ base_sha: loaded.sha }).eq("id", data.projectId);

      return { ok: true, count: loaded.files.length };
    } catch (e) { return { ok: false, error: msg(e) }; }
  });
