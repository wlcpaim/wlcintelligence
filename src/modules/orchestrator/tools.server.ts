// Execução real das ferramentas dos bots, sempre como o próprio usuário (RLS).
import type { Db } from "@/modules/integrations/core/runs.server";
import { getCreds, getDeployment, listAllDeployments } from "@/modules/integrations/cloudflare/services/cloudflare.server";
import { redactSecrets } from "@/modules/integrations/github/services/repository.server";
import type { AgentRole } from "./orchestrator";
import { canWrite, type ToolName } from "./tools";
import { getToken } from "@/modules/integrations/github/services/connection.server";
import { commitPending } from "@/modules/code/services/commit.server";
import { ensureRunner, runCommand, runLogs, runStatus } from "./runner-actions.server";
import { checkCommand } from "./runner-commands";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export interface Workspace { db: Db; userId: string; projectId: string | null; projectName: string | null }

export async function openWorkspace(db: Db, userId: string): Promise<Workspace> {
  const { data } = await db.from("code_projects").select("id,name").eq("user_id", userId).order("updated_at", { ascending: false }).limit(1).maybeSingle();
  return { db, userId, projectId: data?.id ?? null, projectName: data?.name ?? null };
}

const cut = (s: string, n = 20_000) => (s.length > n ? `${s.slice(0, n)}\n…[cortado]` : s);

export async function runTool(ws: Workspace, role: AgentRole, tool: ToolName, args: Record<string, string>): Promise<string> {
  const { db, userId, projectId } = ws;
  const needProject = () => { if (!projectId) throw new Error("Nenhum projeto em Code. Crie ou importe um projeto primeiro."); return projectId; };
  switch (tool) {
    case "list_files": {
      const { data, error } = await db.from("code_files").select("path").eq("project_id", needProject()).eq("user_id", userId).eq("deleted", false).order("path").limit(1500);
      if (error) throw new Error("Não foi possível listar os arquivos.");
      return data.map((f) => f.path).join("\n") || "(projeto vazio)";
    }
    case "read_file": {
      const { data } = await db.from("code_files").select("content").eq("project_id", needProject()).eq("user_id", userId).eq("path", args["path"] ?? "").eq("deleted", false).maybeSingle();
      if (!data) return "Arquivo não existe.";
      return cut(redactSecrets(data.content));
    }
    case "write_file": {
      const path = args["path"] ?? "";
      const content = args["content"] ?? "";
      if (!canWrite(role, path)) return `Bloqueado: ${path} está fora da área de trabalho deste bot.`;
      if (redactSecrets(content) !== content) return "Bloqueado: o conteúdo contém credencial.";
      const pid = needProject();
      const now = new Date().toISOString();
      const { data: cur } = await db.from("code_files").select("id").eq("project_id", pid).eq("user_id", userId).eq("path", path).maybeSingle();
      const { error } = cur
        ? await db.from("code_files").update({ content, deleted: false, updated_at: now }).eq("id", cur.id).eq("user_id", userId)
        : await db.from("code_files").insert({ project_id: pid, user_id: userId, path, content, base_content: null, updated_at: now });
      if (error) throw new Error("Não foi possível gravar o arquivo.");
      return `Gravado ${path} (${content.length} caracteres).`;
    }
    case "inspect_schema": {
      const { data, error } = await db.rpc("inspect_schema");
      if (error) throw new Error("Não foi possível ler o banco.");
      return cut(JSON.stringify(data));
    }
    case "apply_migration": {
      let sql = args["sql"] ?? "";
      const path = args["path"];
      if (!sql && path) {
        const { data } = await db.from("code_files").select("content").eq("project_id", needProject()).eq("user_id", userId).eq("path", path).eq("deleted", false).maybeSingle();
        if (!data) return `Erro: arquivo de migração ${path} não encontrado no projeto.`;
        sql = data.content;
      }
      if (!sql) return "Erro: nenhum SQL fornecido para migração.";
      const { data, error } = await supabaseAdmin.rpc("exec_migration", { p_sql: sql });
      if (error) throw new Error(`Falha ao aplicar migração: ${error.message}`);
      return `Migração aplicada com sucesso. Resultado: ${JSON.stringify(data)}`;
    }
    case "list_deploys": {
      const { token, accountId } = await getCreds(db, userId);
      const items = await listAllDeployments(token, accountId);
      return items.slice(0, 10).map((d) => `${d.createdAt} ${d.project} ${d.env} ${d.stage}:${d.status} ${d.message ?? ""}`).join("\n") || "Sem deploys.";
    }
    case "deploy_logs": {
      const { token, accountId } = await getCreds(db, userId);
      const items = await listAllDeployments(token, accountId);
      const target = items.find((d) => d.status === "failure") ?? items[0];
      if (!target) return "Sem deploys.";
      const d = await getDeployment(token, accountId, target.project, target.id);
      return `${target.project} ${d.stage} ${d.state}\n${d.logs.join("\n") || "(sem logs de falha)"}`;
    }
    case "setup_runner":
    case "run_command":
    case "run_status":
    case "run_logs": {
      const { data: p } = await db.from("code_projects").select("id,repo_full_name,branch").eq("id", needProject()).eq("user_id", userId).maybeSingle();
      if (!p?.repo_full_name || !p.branch) return "Projeto sem repositório GitHub vinculado: vincule um repositório em Code.";
      const token = await getToken(db, userId);
      if (tool === "setup_runner") return await ensureRunner(token, p.repo_full_name, p.branch);
      if (tool === "run_status") return await runStatus(token, p.repo_full_name, args["run_id"] ?? "");
      if (tool === "run_logs") return await runLogs(token, p.repo_full_name, args["run_id"] || undefined);
      const command = args["command"] ?? "";
      const bad = checkCommand(command);
      if (bad) return bad;
      const sent = await commitPending(db, userId, p.id, `WLC bots: preparar execução de \`${command.slice(0, 60)}\``);
      const out = await runCommand(token, p.repo_full_name, p.branch, command);
      return `${sent ? `(${sent.count} arquivo(s) enviados antes de executar)\n` : ""}$ ${command}\n${out.text}`;
    }
  }
}
