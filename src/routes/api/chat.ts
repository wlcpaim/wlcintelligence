// POST /api/chat — streaming do Gemini. Verifica o usuário pelo bearer token,
// persiste a mensagem do usuário e a resposta (inclusive parcial se interrompida).
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { textFromGeminiChunk } from "@/services/gemini.server";
import { openChatStream } from "@/modules/integrations/gemini/services/chat-stream.server";
import { z } from "zod";
import { getToken } from "@/modules/integrations/github/services/connection.server";
import { loadRepository } from "@/modules/integrations/github/services/repository.server";
import { repositoryContext } from "@/modules/integrations/github/repository";
import { generateChatTitle } from "@/services/chat-title.server";
import { revealKey } from "@/modules/integrations/gemini/services/keys.server";
import { shouldGenerateTitle } from "@/services/conversations";
import { agentsHeader, orchestratorInstruction, routeMessage } from "@/modules/orchestrator/orchestrator";
import { runBots } from "@/modules/orchestrator/runner.server";
import { chatInstructionFor, type VersionRule } from "@/modules/versions/instructions";
import { V199_PIPELINE_INSTRUCTION } from "@/modules/v199/identity";
import { listKeys } from "@/modules/integrations/gemini/services/keys.server";
import { checkDualKeys } from "@/modules/v199/core/keys";
import { runHybridTeam } from "@/modules/v199/services/runner.server";
import { projectFromHistory } from "@/modules/v199/core/sanitize";
import { wantsPublication } from "@/modules/v199/core/publication-intent";

const DEMAND_ERROR =
  "Alta demanda no WLC IA no momento. Por favor, tente novamente em alguns instantes.";
const chatInput = z.object({
  conversationId: z.string().uuid(),
  message: z.string().trim().min(1).max(100_000),
  repository: z
    .object({
      repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
      commit: z.string().regex(/^[a-f0-9]{40}$/),
    })
    .optional(),
  files: z.array(z.string().min(1).max(500)).max(20).default([]),
  full: z.boolean().default(false),
  versionId: z.string().uuid().optional(),
  mode: z.enum(["classic", "pro", "v199"]).default("classic"),

});

function userClient(token: string) {
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"]!;
  return createClient<Database>(process.env["SUPABASE_URL"]!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => {
        const h = new Headers(init?.headers);
        h.set("apikey", key);
        h.set("Authorization", `Bearer ${token}`);
        return fetch(input, { ...init, headers: h });
      },
    },
  });
}

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
        if (!token) return Response.json({ error: "Não autenticado" }, { status: 401 });
        const supabase = userClient(token);
        const { data: auth, error: authErr } = await supabase.auth.getUser(token);
        if (authErr || !auth.user)
          return Response.json({ error: "Sessão inválida" }, { status: 401 });
        const userId = auth.user.id;

        const parsed = chatInput.safeParse(await request.json().catch(() => null));
        if (!parsed.success)
          return Response.json({ error: "Mensagem ou repositório inválido." }, { status: 400 });
        const { message, conversationId, repository, files, full: fullRepo, versionId, mode } = parsed.data;
        let versionInstruction: string | null = null;
        const proPlan = mode === "pro" ? routeMessage(message) : null;
        if (proPlan) versionInstruction = orchestratorInstruction(proPlan);
        if (versionId && !proPlan && mode !== "v199") {
          const { data: version } = await supabase.from("chat_versions").select("name,chat_instruction,rules").eq("id", versionId).eq("user_id", userId).maybeSingle();
          if (version) versionInstruction = chatInstructionFor({ ...version, rules: version.rules as unknown as VersionRule[] });
        }

        // WLC 1.9.9 Hybrid Team — pipeline único (Arquiteto → especialistas → Análise → Diagnóstico)
        if (mode === "v199") {
          const keys = await listKeys(supabase, userId);
          const dual = checkDualKeys(keys);
          // Aviso suave se < 2 APIs, mas não bloqueia (reutiliza as disponíveis)
          if (keys.filter(k => k.enabled && k.status === "connected").length === 0) {
            return Response.json({ error: dual.message ?? "Cadastre pelo menos uma API Gemini para a WLC 1.9.9." }, { status: 400 });
          }
          versionInstruction = V199_PIPELINE_INSTRUCTION;
        }
        const { data: conv, error: convError } = await supabase.from("conversations")
          .select("id,title_generated,title_manual").eq("id", conversationId).eq("user_id", userId).single();
        if (convError || !conv) return Response.json({ error: "Chat não encontrado." }, { status: 404 });
        let repoContext = "";
        if (repository && (fullRepo || files.length)) {
          try {
            const snapshot = await loadRepository(
              await getToken(supabase, userId),
              repository.repo,
              repository.commit,
              request.signal,
            );
            repoContext = repositoryContext(snapshot, files, fullRepo);
          } catch {
            return Response.json(
              {
                error:
                  "Não foi possível ler os arquivos do repositório. Verifique a conexão GitHub e tente novamente.",
              },
              { status: 424 },
            );
          }
        }

        const convId = conv.id;

        const userIns = await supabase
          .from("messages")
          .insert({ conversation_id: convId, user_id: userId, role: "user", content: message });
        if (userIns.error) return Response.json({ error: userIns.error.message }, { status: 500 });

        const { data: history, error: hErr } = await supabase
          .from("messages")
          .select("role, content")
          .eq("conversation_id", convId)
          .eq("user_id", userId)
          .order("created_at", { ascending: true });
        if (hErr) return Response.json({ error: hErr.message }, { status: 500 });

        const upstreamAbort = new AbortController();
        request.signal.addEventListener("abort", () => upstreamAbort.abort());

        // ─── WLC 1.9.9: pipeline paralelo em segundo plano ─────────────────
        if (mode === "v199") {
          const encoder = new TextEncoder();
          let full = "";
          let saved = false;
          let modelId: string | null = null;
          const save = async () => {
            if (saved || !full) return;
            saved = true;
            const r = await supabase
              .from("messages")
              .insert({ conversation_id: convId, user_id: userId, role: "model", content: full })
              .select("id")
              .single();
            modelId = r.data?.id ?? null;
            await supabase.from("conversations").update({ updated_at: new Date().toISOString() }).eq("id", convId).eq("user_id", userId);
          };
          const stream = new ReadableStream<Uint8Array>({
            async start(controller) {
              const event = (value: unknown) =>
                controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`));
              try {
                const diary: string[] = [];
                // Cada conversa tem seu próprio projeto: conversa nova → projeto novo.
                const linkedId = projectFromHistory(history ?? []);
                let convWorkspace: { projectId: string | null; projectName: string | null } = { projectId: null, projectName: null };
                if (linkedId) {
                  const { data: lp } = await supabase.from("code_projects").select("id,name").eq("id", linkedId).eq("user_id", userId).maybeSingle();
                  if (lp) convWorkspace = { projectId: lp.id, projectName: lp.name };
                }
                const existingFiles: { path: string; content: string }[] = [];
                if (convWorkspace.projectId) {
                  const { redactSecrets } = await import("@/modules/integrations/github/services/repository.server");
                  const { data: rows, error } = await supabase.from("code_files").select("path,content").eq("project_id", convWorkspace.projectId).eq("user_id", userId).eq("deleted", false).limit(3000);
                  if (error) throw new Error("Não foi possível ler o projeto existente.");
                  existingFiles.push(...(rows ?? []).filter(f => redactSecrets(f.content) === f.content));
                }
                const team = await runHybridTeam(
                  supabase,
                  userId,
                  message,
                  upstreamAbort.signal,
                  (line) => {
                    diary.push(line);
                    full += line + "\n";
                    event({ type: "delta", text: line + "\n" });
                  },
                  { workspace: convWorkspace, existingFiles, existingPaths: existingFiles.map(f => f.path) },
                );
                const ws = { projectId: team.projectId ?? convWorkspace.projectId, projectName: team.projectName ?? convWorkspace.projectName };
                let publication = "";
                if (wantsPublication(message) && ws.projectId) {
                  const notify = (line: string) => { full += line + "\n"; event({ type: "delta", text: line + "\n" }); };
                  try {
                    if (team.qualityIssues?.length) throw new Error("Existem pendências de código; publicação não será tratada como sucesso.");
                    const { getCreds } = await import("@/modules/integrations/cloudflare/services/cloudflare.server");
                    await getCreds(supabase, userId);
                    const ghToken = await getToken(supabase, userId);
                    const { data: target } = await supabase.from("code_projects").select("id,name,repo_full_name").eq("id", ws.projectId).eq("user_id", userId).single();
                    if (!target) throw new Error("Destino da publicação não encontrado.");
                    if (!target.repo_full_name) {
                      const { ghCall } = await import("@/modules/code/services/github-write.server");
                      const repo = await ghCall<{ full_name: string; default_branch: string }>(ghToken, "POST", "/user/repos", { name: `wlc-${target.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 35)}-${target.id.slice(0, 8)}`, private: true, auto_init: false });
                      const { error } = await supabase.from("code_projects").update({ repo_full_name: repo.full_name, branch: repo.default_branch || "main" }).eq("id", target.id).eq("user_id", userId);
                      if (error) throw new Error("Repositório criado, mas não foi possível vinculá-lo.");
                      notify(`📦 Repositório privado criado: ${repo.full_name}`);
                    }
                    const { startValidatedPublish, monitorPublish } = await import("@/modules/v199/services/publish.server");
                    notify("☁️ Iniciando publicação validada e acompanhando o resultado real…");
                    const started = await startValidatedPublish(supabase, userId, ws.projectId);
                    const result = await monitorPublish(supabase, userId, ws.projectId, started, upstreamAbort.signal, notify);
                    publication = `\n\n**Publicação: ${result.state}** — ${result.message}\n${result.url}`;
                  } catch (e) { publication = `\n\n**Publicação não confirmada:** ${e instanceof Error ? e.message : "Falha"}`; }
                }
                const footer =
                  "\n\n---\n" +
                  team.summary +
                  (team.changes.length
                    ? `\n\n**Arquivos (${team.changes.length})** → projeto **${ws?.projectName ?? "—"}**\n` +
                      team.changes.map((c) => `- \`${c.path}\``).join("\n") +
                      (ws?.projectId ? `\n\n[Abrir no Code Studio](/code/${ws.projectId})` : "")
                    : "") + publication;
                full += footer;
                event({ type: "delta", text: footer });
                await save();
                event({ type: "complete", text: full, id: modelId });
                controller.close();
              } catch (error) {
                try { await save(); } catch { /* ignore */ }
                const msg = error instanceof Error ? error.message : "Falha no pipeline 1.9.9";
                event({ type: "error", error: msg });
                controller.close();
              }
            },
            async cancel() {
              upstreamAbort.abort();
            },
          });
          return new Response(stream, {
            headers: {
              "content-type": "application/x-ndjson; charset=utf-8",
              "cache-control": "no-store",
            },
          });
        }
        // ─── fim 1.9.9 ────────────────────────────────────────────────────

        let upstream: Response;
        let usedKeyId = "";
        let usedModel = "";
        let botLog = "";
        try {
          const modelHistory = [...history];
          if (proPlan) {
            const diary: string[] = [];
            const work = await runBots(supabase, userId, proPlan, message, upstreamAbort.signal, (l) => diary.push(l));
            botLog = `${diary.join("\n")}\n\n`;
            const last = modelHistory.at(-1);
            if (last) modelHistory[modelHistory.length - 1] = { ...last, content: `${last.content}\n\nTrabalho REAL executado pelos bots com suas ferramentas (consolide sem inventar):\n${work}` };
          }
          const lastMessage = modelHistory.at(-1);
          if (repoContext && lastMessage)
            modelHistory[modelHistory.length - 1] = {
              ...lastMessage,
              content: `${lastMessage.content}\n\n${repoContext}`,
            };
          // engineeringMode só quando há repositório: chat livre por padrão
          const opened = await openChatStream(
            supabase,
            userId,
            modelHistory,
            upstreamAbort.signal,
            false,
            ...(versionInstruction ? [{ instruction: versionInstruction, maxOutputTokens: 32_000 }] : []),
          );
          if (!opened.ok)
            return Response.json({ error: opened.error }, { status: opened.aborted ? 499 : 424 });
          upstream = opened.response;
          usedKeyId = opened.keyId;
          usedModel = opened.model;
        } catch (error) {
          if (upstreamAbort.signal.aborted) return new Response(null, { status: 499 });
          return Response.json({ error: error instanceof Error ? error.message : DEMAND_ERROR }, { status: 424 });
        }
        if (!upstream.body) return Response.json({ error: DEMAND_ERROR }, { status: 424 });

        const encoder = new TextEncoder();
        const decoder = new TextDecoder();
        let full = "";
        let saved = false;
        let modelId: string | null = null;
        const save = async (stopped: boolean) => {
          if (saved) return;
          saved = true;
          if (full) {
            const r = await supabase
              .from("messages")
              .insert({ conversation_id: convId, user_id: userId, role: "model", content: full })
              .select("id")
              .single();
            modelId = r.data?.id ?? null;
            if (r.error) throw new Error("Não foi possível salvar a resposta. Tente novamente.");
          }
          const updated = await supabase
            .from("conversations")
            .update({ updated_at: new Date().toISOString() })
            .eq("id", convId).eq("user_id", userId);
          if (updated.error) throw new Error("Não foi possível atualizar o histórico.");
          if (stopped) console.info("generation stopped by user");
        };

        const reader = upstream.body.getReader();
        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            const event = (value: unknown) =>
              controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`));
            let buf = "";
            try {
              if (proPlan) {
                const header = agentsHeader(proPlan) + botLog;
                full += header;
                event({ type: "delta", text: header });
              }
              for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                buf += decoder.decode(value, { stream: true });
                let idx: number;
                while ((idx = buf.indexOf("\n")) >= 0) {
                  const line = buf.slice(0, idx).trim();
                  buf = buf.slice(idx + 1);
                  if (!line.startsWith("data:")) continue;
                  const text = textFromGeminiChunk(line.slice(5).trim());
                  if (text) {
                    full += text;
                    event({ type: "delta", text });
                  }
                }
              }
              await save(false);
              if (full && shouldGenerateTitle(conv) && !upstreamAbort.signal.aborted) {
                try {
                  const title = await generateChatTitle(await revealKey(supabase, userId, usedKeyId), usedModel,
                    `Usuário: ${message}\nResposta: ${full.slice(0, 3000)}`, AbortSignal.any([upstreamAbort.signal, AbortSignal.timeout(8000)]));
                  if (title) {
                    const updated = await supabase.from("conversations").update({ title, title_generated: true })
                      .eq("id", convId).eq("user_id", userId).eq("title_manual", false).eq("title_generated", false);
                    if (updated.error) event({ type: "notice", text: "Resposta salva; título automático indisponível." });
                  }
                } catch { /* A resposta permanece salva; tenta título na próxima mensagem. */ }
              }
              event({ type: "complete", text: full, id: modelId });
              if (!full) event({ type: "error", error: DEMAND_ERROR });
              controller.close();
            } catch (error) {
              try { await save(true); } catch { /* erro de persistência será sinalizado abaixo */ }
              try {
                if (!upstreamAbort.signal.aborted) event({ type: "error", error: error instanceof Error ? error.message : DEMAND_ERROR });
                controller.close();
              } catch {
                // stream já encerrado
              }
            }
          },
          async cancel() {
            upstreamAbort.abort();
            await save(true);
          },
        });
        return new Response(stream, {
          headers: {
            "content-type": "application/x-ndjson; charset=utf-8",
            "cache-control": "no-store",
          },
        });
      },
    },
  },
});
