import { useEffect, useRef, useState, type ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import { VersionSelector } from "@/modules/versions/components/VersionSelector";
import { customVersionId, copilotHistoryKey, useSelectedVersion, PRO_SLUG, SYSTEM_SLUG, COPILOT_199_SLUG } from "@/modules/versions/selected";
import { supabase } from "@/integrations/supabase/client";
import type { SystemConnection } from "@/modules/system/core/connection";
import { ArrowUp, Check, Code2, FileCode2, Loader2, Square, X, RotateCcw, PlugZap, GitCommit, Wand2, SlidersHorizontal, Terminal, Rocket, FileText, Copy, Brush } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PromptInput, PromptInputFooter, PromptInputSubmit, PromptInputTextarea } from "@/components/ai-elements/prompt-input";
import { Markdown } from "@/components/chat/Markdown";
import { useAutoTxt } from "@/hooks/use-auto-txt";
import { SystemCommandCard } from "@/modules/system/components/SystemCommandCard";
import { askCopilot, applyCopilotFile } from "../functions/copilot.functions";
import { revertProjectBackup } from "../functions/backup.functions";
import type { CopilotAnswer, CopilotChange } from "../copilot";

type Entry = {
  id: string;
  role: "user" | "model" | "commit";
  content: string;
  answer?: CopilotAnswer;
  resolved?: string[];
  commitData?: {
    sha: string;
    message: string;
    count: number;
    backupId: string | null;
    reverted?: boolean;
  };
};
type AppliedFile = { id: string; path: string; content: string; base_content: string | null; deleted: boolean; updated_at: string };

type CopilotPanelProps = {
  projectId: string; ownerId: string; activePath: string | null;
  beforeSend: () => Promise<void>; onFocus: () => void; onApplied: (file: AppliedFile) => void;
  overlay?: ReactNode;
};

export function CopilotPanel(props: CopilotPanelProps) {
  const selectedVersion = useSelectedVersion();
  const storageKey = copilotHistoryKey(props.ownerId, props.projectId, selectedVersion);
  return <VersionCopilotPanel key={storageKey} {...props} selectedVersion={selectedVersion} storageKey={storageKey} />;
}

function VersionCopilotPanel({ projectId, activePath, beforeSend, onFocus, onApplied, overlay, selectedVersion, storageKey }: CopilotPanelProps & { selectedVersion: string | null; storageKey: string }) {
  const ask = useServerFn(askCopilot);
  const apply = useServerFn(applyCopilotFile);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [text, setText] = useState("");
  const autoTxt = useAutoTxt(1000);
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState<string | null>(null);
  const [revertingId, setRevertingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [connection, setConnection] = useState<SystemConnection | null>(null);
  const abort = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries, busy]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail) return;
      const commitEntry: Entry = {
        id: crypto.randomUUID(),
        role: "commit",
        content: detail.message || "Commit realizado",
        commitData: {
          sha: detail.sha,
          message: detail.message,
          count: detail.count,
          backupId: detail.backupId,
          reverted: false,
        },
      };
      setEntries(prev => [...prev, commitEntry]);
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    };
    window.addEventListener("wlc-commit-success", handler);
    return () => window.removeEventListener("wlc-commit-success", handler);
  }, []);
  const isPro = selectedVersion === PRO_SLUG;
  const isSystem = selectedVersion === SYSTEM_SLUG;
  const is199 = selectedVersion === COPILOT_199_SLUG;
  const versionId = customVersionId(selectedVersion);
  const copilotName = is199
    ? "WLC 1.9.9 Copilot"
    : isPro
    ? "WLC 1.7.1 Lite"
    : isSystem
    ? "WLC 1.1.0 Developers"
    : versionId
    ? "Copilot WLC"
    : "WLC 1.5.6 Prompt Maker";
  const isPromptMaker = !is199 && !isPro && !isSystem && !versionId;

  useEffect(() => {
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
      // Stored history is display-only; proposals are deliberately not restored as executable actions.
      if (Array.isArray(stored)) setEntries(stored.filter((e): e is Entry =>
        e !== null && typeof e === "object" && typeof e.id === "string" && typeof e.content === "string" && (e.role === "user" || e.role === "model" || e.role === "commit")
      ));
    } catch { /* Unavailable browser storage does not prevent editing. */ }
    setReady(true);
    return () => abort.current?.abort();
  }, [storageKey]);

  useEffect(() => {
    if (!ready) return;
    try { localStorage.setItem(storageKey, JSON.stringify(entries.slice(-30).map(({ id, role, content, commitData }) => ({ id, role, content, commitData })))); }
    catch { /* Keep the active conversation usable if storage is full. */ }
  }, [entries, ready, storageKey]);

  // Shared project channel: commands sent by other sources (e.g. the orchestrator agent) appear here live.
  useEffect(() => {
    if (!isSystem && !is199) return;
    const channel = supabase
      .channel(`system-events-${projectId}-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "system_events", filter: `project_id=eq.${projectId}` }, (payload) => {
        const row = payload.new as { id: string; source: string; role: string; content: string };
        if (row.source === "wlc-code") return;
        const content = row.role === "user" ? `[${row.source}] ${row.content}` : row.content;
        setEntries(e => e.some(x => x.id === row.id) ? e : [...e, { id: row.id, role: row.role === "user" ? "user" : "model", content }]);
        window.dispatchEvent(new CustomEvent("wlc-reload-files"));
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [isSystem, is199, projectId]);

  const send = async () => {
    const prompt = autoTxt.buildPayload(text.trim());
    if (!prompt || busy || applying) return;
    onFocus(); setBusy(true); setError(null);
    const controller = new AbortController(); abort.current = controller;
    const entry = { id: crypto.randomUUID(), role: "user" as const, content: prompt };
    setEntries(e => [...e, entry]); setText("");
      autoTxt.clearAttachments();
    try {
      await beforeSend();
      if (controller.signal.aborted) return;
      // 1.9.9: "diagnosticar deploy/build" ou "compilar/build" → build e testes no GitHub Actions (WLC Runner).
      const wantsDiagnostics = is199 && /^\s*((diagnosticar|diagn[oó]stico)\s+(de\s+)?(deploy|build|compila[cç][aã]o|github)|(compilar|build)(\s+(o\s+)?(projeto|app|no\s+github))?)\s*[.!]?\s*$/i.test(prompt);
      const isSystemCommand = !wantsDiagnostics && (isSystem || (is199 && (
        /^(wlc:~\$|\$|\/)/.test(prompt) ||
        /^(help|ajuda|status|connect|conectar|link|projects|projetos|use|ls|tree|read|cat|create|edit|delete|rm|rename|mv|search|grep|analyze|diagnose|fix|diff|test|commit|run|deploy|versions|repo|bridge|confirmar|cancelar)\b/i.test(prompt)
      )));
      if (isSystemCommand) {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) throw new Error("Sessão expirada.");
        const response = await fetch("/api/system/command", {
          method: "POST", signal: controller.signal,
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify({ sourceBot: "wlc-code", command: prompt, meta: { projectId, sessionKey: `project:${projectId}` } }),
        });
        const result = await response.json() as {
          ok?: boolean;
          reply?: string;
          error?: string;
          data?: {
            connection?: SystemConnection;
            sha?: string;
            count?: number;
            backupId?: string | null;
            message?: string;
          };
        };
        if (!response.ok || !result.ok) {
          setConnection(null);
          setError(result.reply ?? result.error ?? "Falha no System."); setText(prompt); return;
        }
        setEntries(e => [...e, { id: crypto.randomUUID(), role: "model", content: result.reply ?? "" }]);
        if (result.data?.connection) setConnection(result.data.connection);
        if (result.data?.sha && result.data?.backupId) {
          window.dispatchEvent(new CustomEvent("wlc-commit-success", {
            detail: {
              sha: result.data.sha,
              message: result.data.message || prompt,
              count: result.data.count,
              backupId: result.data.backupId,
            }
          }));
        }
        window.dispatchEvent(new CustomEvent("wlc-reload-files"));
        return;
      }
      const result = await ask({ data: { projectId, message: prompt, activePath,
        history: entries.filter(e => e.role === "user" || e.role === "model").slice(-6).map(e => ({ role: e.role, content: e.content.slice(0, 2000) })),
        ...(is199 ? { v199: true, ...(wantsDiagnostics ? { diagnose: true } : {}) } : isPro ? { pro: true } : versionId ? { versionId } : {}),
      }, signal: controller.signal });

      if (controller.signal.aborted) return;
      if (!result.ok) { setError(result.error); setText(prompt); return; }
      setEntries(e => [...e, { id: crypto.randomUUID(), role: "model", content: result.answer.summary, answer: result.answer }]);
    } catch {
      setConnection(null);
      if (!controller.signal.aborted) { setError("Não foi possível concluir. Sua mensagem foi preservada para tentar novamente."); setText(prompt); }
    } finally {
      if (abort.current === controller) { setBusy(false); abort.current = null; }
    }
  };

  const clearChat = () => {
    if (busy) return;
    setEntries([]);
    setError(null);
    setConnection(null);
    try { localStorage.removeItem(storageKey); } catch { /* ignore */ }
  };

  const resolve = (id: string, path: string) => setEntries(e => e.map(item => item.id === id ? { ...item, resolved: [...(item.resolved ?? []), path] } : item));
  const applyChange = async (id: string, change: CopilotChange) => {
    if (applying || busy) return;
    setApplying(change.path); setError(null);
    try {
      await beforeSend();
      const result = await apply({ data: { projectId, change } });
      if (!result.ok) { setError(result.error); return; }
      onApplied(result.file); resolve(id, change.path);
    } catch { setError("Não foi possível aplicar o arquivo. Sua proposta continua disponível."); }
    finally { setApplying(null); }
  };

  const applyAll = async (entry: Entry) => {
    if (applying || busy) return;
    const pending = (entry.answer?.changes ?? []).filter(c => !entry.resolved?.includes(c.path));
    if (!pending.length) return;
    setApplying("__all__"); setError(null);
    try {
      await beforeSend();
      // Arquivos diferentes: grava em paralelo (lotes de 6) em vez de um por vez.
      const failed: string[] = [];
      for (let i = 0; i < pending.length; i += 6) {
        const results = await Promise.all(pending.slice(i, i + 6).map(async change => {
          try { return { change, result: await apply({ data: { projectId, change } }) }; }
          catch { return { change, result: { ok: false as const, error: "falha de rede" } }; }
        }));
        for (const { change, result } of results) {
          if (result.ok) { onApplied(result.file); resolve(entry.id, change.path); }
          else failed.push(`${change.path}: ${result.error}`);
        }
      }
      if (failed.length) setError(`${failed.length} arquivo(s) não aplicado(s): ${failed.slice(0, 3).join(" · ")}`);
    } finally { setApplying(null); }
  };

  return <div className="flex h-full min-h-0 flex-col">
    <div className="relative min-h-0 flex-1">
    <div className="h-full overflow-y-auto px-4 py-6" aria-label="Conversa do Copilot WLC">
      <div className="mx-auto max-w-3xl space-y-7">
                {isSystem && (
          <div className="mb-4">
            <SystemCommandCard onSelectCommand={(cmd) => {
              setText(cmd);
              requestAnimationFrame(() => {
                const el = document.querySelector<HTMLTextAreaElement>('[aria-label="Mensagem para Copilot WLC"]');
                el?.focus();
                if (cmd.endsWith(" ")) {
                  const len = cmd.length;
                  el?.setSelectionRange(len, len);
                }
              });
            }} />
          </div>
        )}
{entries.length === 0 && (
          <div className="py-8 space-y-5">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 grid h-10 w-10 place-items-center rounded-xl border border-border bg-muted/50 text-primary">
                {is199 ? <Rocket className="h-5 w-5" /> : isPro ? <SlidersHorizontal className="h-5 w-5" /> : isSystem ? <Terminal className="h-5 w-5" /> : isPromptMaker ? <Wand2 className="h-5 w-5" /> : <Code2 className="h-5 w-5" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="font-mono text-xl font-semibold tracking-tight">{copilotName}</h1>
                  <span className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    {is199 ? "Copilot" : isPro ? "Lite" : isSystem ? "Developers" : isPromptMaker ? "Prompt Maker" : "Custom"}
                  </span>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {is199
                    ? "Constrói a aplicação completa do zero: rotas reais, banco Supabase, painel admin isolado e deploy na Cloudflare. Cole o Prompt Mestre do 1.5.6 ou descreva o produto."
                    : isPro
                    ? "Editor cirúrgico para projetos já gerados. Peça mudanças pontuais de cor, texto, seções, campos ou componentes — ele localiza e aplica sem reescrever o app inteiro."
                    : isSystem
                    ? "Terminal cognitivo avançado para desenvolvedores. Comandos técnicos, inspeção de arquivos, diagnóstico e operações de baixo nível no projeto."
                    : isPromptMaker
                    ? "Transforma sua ideia bruta em um Prompt Mestre estruturado (6 blocos) otimizado para o WLC 1.9.9 gerar a aplicação sem falhas de arquitetura."
                    : "Copilot especializado na versão selecionada."}
                </p>
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-3">
              {(is199
                ? [
                    "Criar um sistema de barbearia com agendamento e painel admin",
                    "Diagnosticar deploy",
                    "Loja online com catálogo, carrinho e área restrita",
                  ]
                : isPro
                ? [
                    "Mudar a cor primária para indigo e os botões para rounded-full",
                    "Adicionar campo de telefone no formulário de contato",
                    "Incluir seção de depoimentos na landing page",
                  ]
                : isSystem
                ? [
                    "listar arquivos do projeto",
                    "inspecionar src/App.tsx",
                    "status do repositório",
                  ]
                : isPromptMaker
                ? [
                    "Sistema de clínica com agendamento de consultas",
                    "Marketplace de serviços locais com painel do prestador",
                    "App de delivery com cardápio e pedidos em tempo real",
                  ]
                : [
                    "Explique a estrutura do projeto",
                    "Sugira melhorias de UX",
                    "Liste os componentes principais",
                  ]
              ).map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => {
                    setText(suggestion);
                    // Foco no textarea após inserir a sugestão
                    requestAnimationFrame(() => {
                      const el = document.querySelector<HTMLTextAreaElement>('[aria-label="Mensagem para Copilot WLC"]');
                      el?.focus();
                    });
                  }}
                  className="rounded-xl border border-border/80 bg-card px-3 py-2.5 text-left text-xs leading-snug text-muted-foreground transition-colors hover:border-primary/40 hover:bg-muted/40 hover:text-foreground"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}
        {entries.map(entry => <article key={entry.id} className="min-w-0 break-words">
          {entry.role === "commit" ? (
            <div className="rounded-lg border border-border/60 bg-card p-4 shadow-sm space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="grid h-7 w-7 place-items-center rounded-md bg-muted text-primary">
                    <RotateCcw className="h-4 w-4" />
                  </div>
                  <span className="font-medium text-sm">Commit realizado</span>
                </div>
                <div className="flex items-center gap-1.5">
                  {entry.commitData?.sha && (
                    <span className="rounded-md bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground">
                      {entry.commitData.sha.slice(0, 7)}
                    </span>
                  )}
                  {entry.commitData?.count !== undefined && (
                    <span className="rounded-md bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">
                      {entry.commitData.count} arq(s)
                    </span>
                  )}
                </div>
              </div>
              <p className="text-xs text-muted-foreground">{entry.content}</p>
              {entry.commitData?.backupId && (
                <div className="flex items-center justify-between pt-1">
                  {entry.commitData.reverted ? (
                    <div className="flex w-full items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-success">
                        <Check className="h-3.5 w-3.5" /> Revertido com sucesso
                      </span>
                      <Button
                        size="sm"
                        variant="default"
                        className="h-7 gap-1.5 text-xs"
                        onClick={() => {
                          window.dispatchEvent(new CustomEvent("wlc-open-commit-dialog"));
                        }}
                      >
                        <GitCommit className="h-3.5 w-3.5" /> Commit
                      </Button>
                    </div>
                  ) : (
                    <Button size="sm" variant="outline" className="h-8 gap-1.5" disabled={revertingId === entry.id} onClick={async () => {
                      if (!entry.commitData?.backupId) return;
                      setRevertingId(entry.id);
                      try {
                        const { toast } = await import("sonner");
                        const r = await revertProjectBackup({ data: { backupId: entry.commitData.backupId } });
                        if (r.ok) {
                          toast.success("Projeto revertido para o commit com sucesso");
                          setEntries(e => e.map(item => item.id === entry.id && item.commitData ? { ...item, commitData: { ...item.commitData, reverted: true } } : item));
                          window.dispatchEvent(new CustomEvent("wlc-reload-files"));
                        } else {
                          toast.error(r.error);
                        }
                      } finally {
                        setRevertingId(null);
                      }
                    }}>
                      {revertingId === entry.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                      {revertingId === entry.id ? "Revertendo…" : "Fazer Rollback"}
                    </Button>
                  )}
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                {entry.role === "model" && <Code2 className="h-3.5 w-3.5 text-primary" />}{entry.role === "user" ? "Você" : copilotName}
              </div>
              <Markdown>{entry.content}</Markdown>
              {(isPromptMaker || (entry.answer && entry.answer.changes.length === 0)) && entry.role === "model" && (
                <div className="mt-3">
                  <Button
                    size="sm"
                    variant="secondary"
                    className="gap-1.5"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(entry.content);
                        setCopiedPrompt(true);
                        setTimeout(() => setCopiedPrompt(false), 2000);
                      } catch { /* clipboard indisponível */ }
                    }}
                  >
                    {copiedPrompt ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    {copiedPrompt ? "Copiado" : "Copiar Prompt Mestre"}
                  </Button>
                </div>
              )}
              {entry.answer && entry.answer.changes.length > 0 && <>
              <div className="mt-3 flex flex-wrap items-center gap-2"><p className="flex-1 text-xs text-muted-foreground">Contexto: {entry.answer.coverage.read} de {entry.answer.coverage.total} arquivos lidos</p>
                {entry.answer.changes.length > 1 && entry.answer.changes.some(c => !entry.resolved?.includes(c.path)) && <Button size="sm" variant="outline" disabled={!!applying || busy} onClick={() => void applyAll(entry)}>{applying === "__all__" ? <Loader2 className="animate-spin" /> : <Check />}Aplicar tudo ({entry.answer.changes.filter(c => !entry.resolved?.includes(c.path)).length})</Button>}</div>
              <div className="mt-3 space-y-3">{entry.answer.changes.map(change => <div key={change.path} className="overflow-hidden rounded-md border border-border">
                <div className="flex min-w-0 flex-wrap items-center gap-2 bg-sidebar px-3 py-2">
                  <FileCode2 className="h-4 w-4 shrink-0 text-primary" /><span className="min-w-0 flex-1 truncate font-mono text-xs" title={change.path}>{change.path}</span>
                  {entry.resolved?.includes(change.path) ? <Check className="h-4 w-4 text-success" /> : <>
                    <Button variant="ghost" size="icon-sm" title="Descartar proposta" aria-label={`Descartar ${change.path}`} disabled={!!applying || busy} onClick={() => resolve(entry.id, change.path)}><X /></Button>
                    <Button size="sm" disabled={!!applying || busy} onClick={() => void applyChange(entry.id, change)}>{applying === change.path ? <Loader2 className="animate-spin" /> : <Check />}Aplicar</Button>
                  </>}
                </div>
                <details className="px-3 py-2 text-xs">
                  <summary className="cursor-pointer text-muted-foreground">Revisar alteração</summary>
                  <div className="mt-2 grid min-w-0 gap-3 md:grid-cols-2">
                    <div className="min-w-0"><p className="mb-1 text-muted-foreground">Atual</p><pre className="max-h-64 overflow-auto bg-muted p-2 font-mono text-xs">{change.before ?? "Arquivo novo"}</pre></div>
                    <div className="min-w-0"><p className="mb-1 text-success">Proposta</p><pre className="max-h-64 overflow-auto bg-success/5 p-2 font-mono text-xs">{change.content}</pre></div>
                  </div>
                </details>
                            </div>)}</div>
            </>}
          </>
        )}
      </article>)}
        {busy && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{is199 ? "Time multi-agente construindo…" : isPro ? "Lite aplicando ajuste cirúrgico…" : isSystem ? "Processando comando…" : isPromptMaker ? "Montando Prompt Mestre…" : "Preparando proposta…"}</p>}
        <div ref={bottomRef} />
      </div>
    </div>
    {overlay}
    </div>
    <div className="relative z-30 shrink-0 border-t border-border/70 bg-background pb-[max(0.35rem,env(safe-area-inset-bottom))] pt-1.5">
      <div className="mx-auto w-full max-w-3xl px-3 pb-1">
        {isSystem && connection && <div role="status" className="mb-2 flex min-w-0 items-center gap-2 font-mono text-xs text-success" title={`Sessão verificada em ${connection.checkedAt}; agente externo ainda não pareado`}><PlugZap className="h-3.5 w-3.5 shrink-0" /><span className="shrink-0">CANAL PRONTO</span><span className="truncate">{connection.projectName}</span></div>}
        {error && <p role="status" className="mb-2 flex items-start gap-2 text-xs text-muted-foreground"><span className="flex-1">{error}</span><Button variant="ghost" size="icon-sm" title="Dispensar aviso" aria-label="Dispensar aviso" onClick={() => setError(null)}><X /></Button></p>}
        <PromptInput
          onSubmit={() => void send()}
          className="rounded-2xl border border-border/80 bg-card shadow-sm ring-1 ring-black/5 transition-[box-shadow,border-color] focus-within:border-primary/40 focus-within:shadow-md dark:ring-white/10"
        >
          {autoTxt.attachments.length > 0 && (
            <div className="mb-1 flex flex-wrap gap-1.5 px-1 pt-1">
              {autoTxt.attachments.map((a) => (
                <span key={a.id} title={`${a.name} — ${a.size.toLocaleString("pt-BR")} caracteres`}
                  className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border bg-muted/60 px-2.5 py-1 font-mono text-xs">
                  <FileText className="h-3.5 w-3.5 shrink-0 text-primary" />
                  <span className="max-w-[160px] truncate font-medium">{a.name}</span>
                  <span className="text-muted-foreground">({a.size.toLocaleString("pt-BR")} chars)</span>
                  <button type="button" aria-label={`Remover ${a.name}`} className="rounded p-0.5 hover:text-destructive" onClick={() => autoTxt.removeAttachment(a.id)}>
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
          <PromptInputTextarea aria-label="Mensagem para Copilot WLC" placeholder={
              autoTxt.attachments.length
                ? "Instrução adicional (texto longo já anexado como .txt)..."
                : isSystem ? "wlc:~$ Digite um comando ou instrução técnica..."
                : isPro ? "Ex: Mudar a cor do botão, adicionar campo no formulário..."
                : is199 ? "Cole o prompt do Prompt Maker ou descreva a aplicação completa..."
                : isPromptMaker ? "Cole seu prompt ou descreva sua ideia bruta aqui..."
                : "O que vamos criar neste projeto?"
            } value={text} maxLength={isSystem ? 100_000 : 100_000}
            onChange={e => autoTxt.handleChange(e.target.value, setText)}
            onPaste={e => autoTxt.handlePaste(e, text, setText)}
            className={`min-h-[2.75rem] px-1 text-base leading-relaxed ${isSystem ? "font-mono text-sm" : ""}`} />
          <PromptInputFooter className="items-center gap-1.5 px-1 pb-0.5 pt-0">
            <span className="min-w-0 flex-1"><VersionSelector /></span>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
              title="Limpar chat"
              aria-label="Limpar chat"
              disabled={busy || entries.length === 0}
              onClick={clearChat}
            >
              <Brush className="h-3.5 w-3.5" />
            </Button>
            <PromptInputSubmit
              status={busy ? "streaming" : "ready"}
              className="size-9 shrink-0 rounded-xl"
              disabled={!busy && ((!text.trim() && autoTxt.attachments.length === 0) || !!applying)}
              onStop={() => { abort.current?.abort(); setConnection(null); setError(isSystem ? "Resposta interrompida; confira status e diff antes de repetir a ação." : "Comando interrompido; nenhum arquivo foi alterado."); }}
              aria-label={busy ? "Parar Copilot" : "Enviar ao Copilot"}
              title={busy ? "Parar Copilot" : "Enviar ao Copilot"}
            >
              {busy ? <Square className="size-3.5 fill-current" /> : <ArrowUp className="size-4" />}
            </PromptInputSubmit>
          </PromptInputFooter>
        </PromptInput>
      </div>
    </div>
  </div>;
}