/**
 * Executor Owner da WLC 1.1.0 System.
 * Executa operações reais nos arquivos do projeto aberto no WLC Code (tabela code_files)
 * e no GitHub (commit / WLC Runner). Isolado — não chama Gemini.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { CognitivePlan } from "./cognitive";
import { helpText, statusText } from "./cognitive";
import { SYSTEM_VERSION } from "../identity";
import { connectionHandshake } from "./connection";
import {
  analyze, applyEditBody, changeState, diagnose, lineDiff, listDir, normalizePath,
  relatedFiles, renderTree, searchFiles, type WsFile,
} from "./workspace";

type Db = SupabaseClient<Database>;

export interface ExecutionContext {
  userId: string;
  conversationId?: string | undefined;
  authToken?: string | undefined;
  confirmed?: boolean;
  db?: Db | undefined;
  /** Projeto ativo da sessão (System). */
  projectId?: string | null | undefined;
  sessionKey?: string | undefined;
}

export interface ExecutionResult {
  ok: boolean;
  text: string;
  data?: Record<string, unknown>;
  requiresConfirm?: boolean;
  confirmToken?: string;
  /** Novo projeto ativo escolhido por `use`. */
  activeProjectId?: string;
}

const fail = (text: string): ExecutionResult => ({ ok: false, text });
const code = (s: string, lang = "") => `\`\`\`${lang}\n${s}\n\`\`\``;
const langOf = (p: string) => p.split(".").pop() ?? "";

interface Project { id: string; name: string; repo_full_name: string | null; branch: string | null }

async function loadProject(ctx: ExecutionContext): Promise<Project> {
  const db = ctx.db;
  if (!db) throw new Error("Sem acesso aos dados nesta chamada.");
  let q = db.from("code_projects").select("id,name,repo_full_name,branch").eq("user_id", ctx.userId);
  q = ctx.projectId ? q.eq("id", ctx.projectId) : q.order("updated_at", { ascending: false });
  const { data, error } = await q.limit(1);
  if (error) throw new Error(error.message);
  const p = data?.[0];
  if (!p) throw new Error("Nenhum projeto no WLC Code. Crie ou importe um projeto em Code e depois use `projects`.");
  return p;
}

async function loadFiles(db: Db, projectId: string): Promise<WsFile[]> {
  const out: WsFile[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("code_files").select("id,path,content,base_content,deleted,updated_at")
      .eq("project_id", projectId).order("path").range(from, from + 999);
    if (error) throw new Error(`Não foi possível ler os arquivos: ${error.message}`);
    out.push(...data);
    if (data.length < 1000) return out;
  }
}

function confirmPrompt(plan: CognitivePlan, preview = ""): ExecutionResult {
  return {
    ok: true,
    text: `⚠️ **${plan.summary}** requer confirmação.\n${preview}\nResponda \`confirmar\` para executar ou \`cancelar\`.`,
    requiresConfirm: true,
    confirmToken: `${plan.intent}:${Date.now()}`,
    data: { plan },
  };
}

export async function execute(plan: CognitivePlan, ctx: ExecutionContext): Promise<ExecutionResult> {
  switch (plan.intent) {
    case "HELP": return { ok: true, text: helpText() };
    case "STATUS": {
      if (!ctx.db) return { ok: true, text: statusText() };
      try {
        const p = await loadProject(ctx);
        const files = await loadFiles(ctx.db, p.id);
        const pending = files.filter((f) => changeState(f) !== "unchanged").length;
        return { ok: true, text: `${statusText()}\n\n**Sessão**\n- Projeto: \`${p.name}\`\n- GitHub: ${p.repo_full_name ? `\`${p.repo_full_name}@${p.branch}\`` : "não vinculado"}\n- Arquivos: ${files.filter((f) => !f.deleted).length}\n- Alterações locais não enviadas: ${pending}` };
      } catch (e) { return { ok: true, text: `${statusText()}\n\n${(e as Error).message}` }; }
    }
    case "LIST_VERSIONS":
      return { ok: true, text: `Versões nativas:\n- **WLC 1.5.6** (Lite)\n- **WLC 1.7.1** (Pro)\n- **${SYSTEM_VERSION.fullName}** (System / Owner) ← você está aqui` };
    case "BRIDGE_COMMAND":
      return { ok: true, text: "Canal de bridge ativo em `POST /api/system/command`." };
    case "UNKNOWN":
      return fail(typeof plan.params["error"] === "string" ? plan.params["error"] : "Comando não reconhecido. Digite `help`.");
    case "CREATE_VERSION":
      return fail("Criação de versões é feita na tela Versões. O System não cria versões sozinho.");
    case "DEPLOY":
      return fail("Deploy pelo terminal ainda não está disponível. Use o botão Deploy na tela Code.");
    default: break;
  }

  if (!ctx.db) return fail("Sem acesso aos dados nesta chamada.");
  const db = ctx.db;
  try {
    if (plan.intent === "PROJECTS") {
      const { data, error } = await db.from("code_projects").select("id,name,repo_full_name,updated_at").eq("user_id", ctx.userId).order("updated_at", { ascending: false });
      if (error) throw new Error(error.message);
      if (!data.length) return { ok: true, text: "Nenhum projeto no WLC Code ainda." };
      const active = ctx.projectId ?? data[0]!.id;
      return { ok: true, text: code(data.map((p) => `${p.id === active ? "*" : " "} ${p.name.padEnd(28)} ${p.repo_full_name ?? "(sem GitHub)"}`).join("\n")) + "\n`*` = projeto ativo. Troque com `use <nome>`." };
    }
    if (plan.intent === "USE_PROJECT") {
      const name = String(plan.params["project"]);
      const { data, error } = await db.from("code_projects").select("id,name").eq("user_id", ctx.userId);
      if (error) throw new Error(error.message);
      const p = data.find((x) => x.id === name) ?? data.find((x) => x.name.toLowerCase() === name.toLowerCase()) ?? data.find((x) => x.name.toLowerCase().includes(name.toLowerCase()));
      if (!p) return fail(`Projeto "${name}" não encontrado. Use \`projects\`.`);
      return { ok: true, text: `Projeto ativo: \`${p.name}\``, activeProjectId: p.id };
    }

    const project = await loadProject(ctx);
    if (plan.intent === "CONNECT") {
      if (!ctx.authToken) return fail("Conexão recusada: sessão autenticada necessária.");
      const { data: auth, error } = await db.auth.getUser(ctx.authToken);
      if (error || !auth.user || auth.user.id !== ctx.userId) return fail("Conexão recusada: sessão inválida.");
      const connection = connectionHandshake(project, ctx.sessionKey ?? ctx.conversationId ?? "default");
      return {
        ok: true, activeProjectId: project.id, data: { connection },
        text: [
          `**${SYSTEM_VERSION.fullName} — CONNECT**`,
          "", "**CANAL PRONTO · sessão autenticada**",
          `- Projeto: \`${project.name}\``,
          `- Repositório: ${project.repo_full_name ? `\`${project.repo_full_name}\`` : "não vinculado"} · branch: ${project.branch ? `\`${project.branch}\`` : "não definida"}`,
          "- Autoridade: Owner do próprio projeto (regras de acesso preservadas)",
          "- Canal: `POST /api/system/command`",
          "- Agente externo: aguardando chamada autenticada; sem pareamento automático",
          "- Produção: não verificada; deploy pelo terminal indisponível",
          "", "**Contexto para o agente**", "", code(connection.agentInstructions, "text"),
        ].join("\n"),
      };
    }
    const files = await loadFiles(db, project.id);
    const byPath = new Map(files.map((f) => [f.path, f]));
    const live = (p: string) => { const f = byPath.get(p); return f && !f.deleted ? f : undefined; };
    const pathParam = (k: string) => normalizePath(String(plan.params[k] ?? ""));
    const now = () => new Date().toISOString();

    switch (plan.intent) {
      case "LIST_FILES": {
        const dir = plan.params["path"] ? pathParam("path") : "";
        if (dir === null) return fail("Caminho inválido.");
        const entries = listDir(files, dir);
        if (!entries.length) return fail(dir ? `Pasta vazia ou inexistente: ${dir}` : "Projeto sem arquivos.");
        return { ok: true, text: `\`${project.name}/${dir}\`\n${code(entries.join("\n"))}` };
      }
      case "TREE": {
        const dir = plan.params["path"] ? pathParam("path") : "";
        if (dir === null) return fail("Caminho inválido.");
        return { ok: true, text: code(renderTree(files, dir)) };
      }
      case "READ_FILE": {
        const p = pathParam("path");
        const f = p ? live(p) : undefined;
        if (!f) return fail(`Arquivo não encontrado: ${p ?? ""}`);
        const n = f.content.split("\n").length;
        const shown = f.content.length > 60_000 ? `${f.content.slice(0, 60_000)}\n… (cortado)` : f.content;
        return { ok: true, text: `\`${f.path}\` · ${n} linhas · ${changeState(f)}\n${code(shown, langOf(f.path))}` };
      }
      case "SEARCH": {
        const hits = searchFiles(files, String(plan.params["term"]));
        if (!hits.length) return { ok: true, text: `Nenhuma ocorrência de "${plan.params["term"]}".` };
        return { ok: true, text: `${hits.length}${hits.length >= 100 ? "+" : ""} ocorrência(s):\n${code(hits.map((h) => `${h.path}:${h.line}  ${h.text}`).join("\n"))}` };
      }
      case "ANALYZE": {
        const a = analyze(files);
        return { ok: true, text: [
          `**Análise de \`${project.name}\`**`,
          `- ${a.files} arquivos, ${a.lines} linhas`,
          `- Alterações locais não enviadas: ${a.changes}`,
          `- Tipos: ${a.byExt.slice(0, 8).map(([e, n]) => `${e} (${n})`).join(", ")}`,
          `- Pastas: ${a.top.slice(0, 10).map(([d, n]) => `${d} (${n})`).join(", ")}`,
          a.scripts.length ? `- Scripts: ${a.scripts.join(", ")}` : "- Sem package.json/scripts",
          a.deps.length ? `- Dependências (${a.deps.length}): ${a.deps.slice(0, 20).join(", ")}${a.deps.length > 20 ? "…" : ""}` : "",
        ].filter(Boolean).join("\n") };
      }
      case "DIAGNOSE":
      case "FIX": {
        const issues = diagnose(files);
        if (!issues.length) return { ok: true, text: "Diagnóstico estático: nenhum import quebrado, conflito de merge ou JSON inválido encontrado.\nPara erros de compilação use `test npm run build`." };
        const list = issues.slice(0, 80).map((i) => `${i.path}:${i.line}  ${i.message}${i.fix ? `  → ${i.fix}` : ""}`).join("\n");
        const tail = plan.intent === "FIX"
          ? "\nO System não reescreve código por conta própria. Corrija cada item com `edit <arquivo>` (blocos <<< === >>>) — as sugestões acima indicam o arquivo provável."
          : "\nUse `fix` para ver sugestões ou `read <arquivo>` para inspecionar.";
        return { ok: true, text: `${issues.length} problema(s):\n${code(list)}${tail}` };
      }
      case "DIFF": {
        const one = plan.params["path"] ? pathParam("path") : null;
        const changed = files.filter((f) => changeState(f) !== "unchanged" && (!one || f.path === one));
        if (!changed.length) return { ok: true, text: "Nenhuma alteração local pendente." };
        const parts = changed.slice(0, 10).map((f) => {
          const s = changeState(f);
          return `**${s}** \`${f.path}\`\n${code(s === "deleted" ? "(arquivo excluído)" : lineDiff(f.base_content ?? "", f.content), "diff")}`;
        });
        return { ok: true, text: `${changed.length} arquivo(s) alterado(s) localmente — ainda **não** enviados ao GitHub:\n\n${parts.join("\n")}${changed.length > 10 ? "\n…" : ""}` };
      }
      case "CREATE_FILE": {
        const p = pathParam("path");
        if (!p) return fail("Caminho inválido.");
        if (live(p)) return fail(`\`${p}\` já existe. Use \`edit ${p}\`.`);
        const content = String(plan.params["body"] ?? "");
        const old = byPath.get(p);
        const r = old
          ? await db.from("code_files").update({ content, deleted: false, updated_at: now() }).eq("id", old.id)
          : await db.from("code_files").insert({ project_id: project.id, user_id: ctx.userId, path: p, content, base_content: null });
        if (r.error) throw new Error(r.error.message);
        return { ok: true, text: `✔ Criado \`${p}\` (${content.split("\n").length} linhas) — alteração **local**, use \`commit\` para enviar ao GitHub.` };
      }
      case "WRITE_FILE": {
        const p = pathParam("path");
        const f = p ? live(p) : undefined;
        if (!p || !f) return fail(`Arquivo não encontrado: ${p ?? ""}. Use \`create\` para arquivos novos.`);
        const next = applyEditBody(f.content, String(plan.params["body"] ?? ""));
        if (next === f.content) return { ok: true, text: "Nada mudou: o conteúdo novo é igual ao atual." };
        if (!ctx.confirmed) return confirmPrompt(plan, `\n${code(lineDiff(f.content, next, 80), "diff")}`);
        const r = await db.from("code_files").update({ content: next, updated_at: now() }).eq("id", f.id).eq("updated_at", f.updated_at).select("id");
        if (r.error) throw new Error(r.error.message);
        if (!r.data.length) return fail("O arquivo mudou desde o pedido (editado em outro lugar). Rode o comando de novo.");
        return { ok: true, text: `✔ Editado \`${p}\` — alteração **local**. Veja com \`diff ${p}\` e envie com \`commit\`.` };
      }
      case "DELETE_FILE": {
        const p = pathParam("path");
        const f = p ? live(p) : undefined;
        if (!f) return fail(`Arquivo não encontrado: ${p ?? ""}`);
        if (!ctx.confirmed) return confirmPrompt(plan, `\nO arquivo \`${f.path}\` (${f.content.split("\n").length} linhas) será excluído.`);
        const r = f.base_content === null
          ? await db.from("code_files").delete().eq("id", f.id)
          : await db.from("code_files").update({ deleted: true, updated_at: now() }).eq("id", f.id);
        if (r.error) throw new Error(r.error.message);
        return { ok: true, text: `✔ Excluído \`${f.path}\` — alteração **local**, use \`commit\` para enviar.` };
      }
      case "RENAME_FILE": {
        const from = pathParam("from"), to = pathParam("to");
        const f = from ? live(from) : undefined;
        if (!f || !to) return fail(`Arquivo não encontrado ou destino inválido.`);
        if (live(to)) return fail(`Destino \`${to}\` já existe.`);
        if (!ctx.confirmed) return confirmPrompt(plan, `\n\`${from}\` → \`${to}\``);
        const target = byPath.get(to);
        const ins = target
          ? await db.from("code_files").update({ content: f.content, deleted: false, updated_at: now() }).eq("id", target.id)
          : await db.from("code_files").insert({ project_id: project.id, user_id: ctx.userId, path: to, content: f.content, base_content: null });
        if (ins.error) throw new Error(ins.error.message);
        const del = f.base_content === null
          ? await db.from("code_files").delete().eq("id", f.id)
          : await db.from("code_files").update({ deleted: true, updated_at: now() }).eq("id", f.id);
        if (del.error) throw new Error(del.error.message);
        const refs = searchFiles(files.filter((x) => x.id !== f.id), from!.replace(/\.\w+$/, "").split("/").pop()!, 20);
        return { ok: true, text: `✔ Renomeado \`${from}\` → \`${to}\` — alteração **local**.${refs.length ? `\nPossíveis imports a atualizar:\n${code(refs.map((h) => `${h.path}:${h.line}  ${h.text}`).join("\n"))}` : ""}` };
      }
      case "COMMIT": {
        const changed = files.filter((f) => changeState(f) !== "unchanged");
        if (!changed.length) return { ok: true, text: "Nada para enviar: nenhuma alteração local." };
        if (!project.repo_full_name) return fail("Este projeto não tem repositório GitHub vinculado. Vincule na tela Code.");
        if (!ctx.confirmed) return confirmPrompt(plan, `\nEnviar ${changed.length} arquivo(s) para \`${project.repo_full_name}@${project.branch}\`:\n${code(changed.map((f) => `${changeState(f).padEnd(9)} ${f.path}`).join("\n"))}`);
        const { commitPending } = await import("@/modules/code/services/commit.server");
        const r = await commitPending(db, ctx.userId, project.id, String(plan.params["message"]));
        if (!r) return { ok: true, text: "Nada para enviar." };
        return {
          ok: true,
          text: `✔ Commit \`${r.sha.slice(0, 7)}\` enviado ao GitHub (${r.count} arquivo(s)) — alterações **persistidas**.${r.backupId ? `\nPara reverter, use o botão Rollback ou digite \`rollback\`.` : ""}`,
          data: { sha: r.sha, count: r.count, backupId: r.backupId, message: r.message }
        };
      }
      case "ROLLBACK": {
        if (!project.repo_full_name) return fail("Este projeto não tem repositório GitHub vinculado.");
        const explicitId = String(plan.params["backupId"] ?? "").trim();
        let backupId = explicitId;
        if (!backupId) {
          const { listBackups } = await import("@/modules/code/services/backup.server");
          const backups = await listBackups(db, ctx.userId, project.id);
          const latest = backups[0];
          if (!latest) return fail("Nenhum backup de commit encontrado para este projeto.");
          backupId = latest.id;
        }
        const { data: targetBackup } = await db.from("code_project_backups").select("id, message, commit_sha, created_at").eq("id", backupId).single();
        if (!targetBackup) return fail(`Backup ${backupId} não encontrado.`);
        const targetRef = targetBackup.commit_sha ? targetBackup.commit_sha.slice(0, 7) : targetBackup.id.slice(0, 7);
        if (!ctx.confirmed) {
          return confirmPrompt(plan, `\nRestaurar projeto para o backup \`${targetRef}\` ("${targetBackup.message}").\nOs arquivos atuais serão substituídos e um novo commit de rollback será enviado ao GitHub.`);
        }
        const { revertBackup } = await import("@/modules/code/services/backup.server");
        const res = await revertBackup(db, ctx.userId, backupId);
        const shaShort = res.sha ? res.sha.slice(0, 7) : "local";
        return {
          ok: true,
          text: `✔ Rollback concluído: projeto restaurado para o backup \`${targetRef}\` (commit \`${shaShort}\`).`,
          data: { revertedBackupId: backupId, newCommitSha: res.sha }
        };
      }
      case "TEST":
      case "RUN_COMMAND": {
        const cmd = String(plan.params["command"] ?? "");
        const { checkCommand } = await import("@/modules/orchestrator/runner-commands");
        const bad = checkCommand(cmd);
        if (bad) return fail(bad);
        if (!project.repo_full_name || !project.branch) return fail("Comandos rodam no GitHub Actions do repositório vinculado. Vincule um repositório na tela Code.");
        const pending = files.filter((f) => changeState(f) !== "unchanged").length;
        if (!ctx.confirmed) return confirmPrompt(plan, `\nRodar \`${cmd}\` no WLC Runner de \`${project.repo_full_name}\`.${pending ? `\nAtenção: ${pending} alteração(ões) local(is) não enviada(s) — o Runner usa o código do GitHub.` : ""}`);
        const { getToken } = await import("@/modules/integrations/github/services/connection.server");
        const { runCommand } = await import("@/modules/orchestrator/runner-actions.server");
        const token = await getToken(db, ctx.userId);
        const r = await runCommand(token, project.repo_full_name, project.branch, cmd);
        return { ok: true, text: r.text.length > 12_000 ? `${r.text.slice(0, 12_000)}\n…` : r.text };
      }
      case "REPO_STATUS": {
        const changed = files.filter((f) => changeState(f) !== "unchanged");
        return { ok: true, text: project.repo_full_name
          ? `\`${project.repo_full_name}@${project.branch}\`\n- Alterações locais não enviadas: ${changed.length}${changed.length ? ` (use \`diff\`)` : ""}`
          : "Projeto sem repositório GitHub vinculado." };
      }
      case "MUTATE_SYSTEM": {
        const raw = String(plan.params["raw"] ?? "");
        const rel = relatedFiles(files, raw);
        const issues = diagnose(files).length;
        return { ok: true, text: [
          `**Plano para:** ${raw.length > 300 ? `${raw.slice(0, 300)}…` : raw}`,
          "",
          `Projeto: \`${project.name}\` (${files.filter((f) => !f.deleted).length} arquivos, ${issues} problema(s) no diagnóstico)`,
          rel.length ? `Arquivos provavelmente envolvidos:\n${code(rel.map((r) => r.path).join("\n"))}` : "Não encontrei arquivos relacionados às palavras do pedido.",
          "Próximos passos:",
          rel[0] ? `1. \`read ${rel[0].path}\` para inspecionar` : "1. `tree` para ver a estrutura",
          "2. `edit <arquivo>` com as alterações (mostro o diff antes de gravar)",
          "3. `diff` para revisar e `commit` para enviar ao GitHub",
          "",
          "O System é determinístico e não gera código sozinho; para gerar código automaticamente use o Copilot PRO na tela Code.",
        ].join("\n") };
      }
      default:
        return fail("Comando não reconhecido. Digite `help`.");
    }
  } catch (e) {
    return fail(`✖ ${e instanceof Error ? e.message : "Falha na operação."}`);
  }
}
