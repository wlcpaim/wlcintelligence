import wlcLogo from "@/assets/wlc-logo.png.asset.json";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import { customVersionId, copilotHistoryKey, useSelectedVersion, setSelectedVersion, PRO_SLUG, SYSTEM_SLUG, COPILOT_199_SLUG } from "@/modules/versions/selected";
import { supabase } from "@/integrations/supabase/client";
import type { SystemConnection } from "@/modules/system/core/connection";
import { ArrowUp, Check, Code2, FileCode2, Loader2, Square, X, RotateCcw, PlugZap, GitCommit, Wand2, SlidersHorizontal, Terminal, Rocket, FileText, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PromptInput, PromptInputFooter, PromptInputSubmit, PromptInputTextarea } from "@/components/ai-elements/prompt-input";
import { Markdown } from "@/components/chat/Markdown";
import { useAutoTxt } from "@/hooks/use-auto-txt";
import { SystemCommandCard } from "@/modules/system/components/SystemCommandCard";
import { askCopilot, applyCopilotFile, validateAfterCopilotApply } from "../functions/copilot.functions";
import { revertProjectBackup } from "../functions/backup.functions";
import type { CopilotAnswer, CopilotChange } from "../copilot";

type Entry = {
  id: string;
  role: "user" | "model" | "commit";
  content: string;
  answer?: CopilotAnswer;
  resolved?: string[];
  /** Metadados do WLC 1.1.0 System (ações clicáveis). */
  system?: {
    requiresConfirm?: boolean;
    intent?: string;
    confirmed?: boolean;
    cancelled?: boolean;
  };
  commitData?: {
    sha: string;
    message: string;
    count: number;
    backupId: string | null;
    reverted?: boolean;
  };
};
type AppliedFile = { id: string; path: string; content: string; base_content: string | null; deleted: boolean; updated_at: string };

const PENDING_PROMPT_KEY = "wlc.copilot.pendingPrompt";

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
  const validateApply = useServerFn(validateAfterCopilotApply);
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
    ? "Copilot Builder"
    : isPro
    ? "Scale Editor"
    : isSystem
    ? "Bypass"
    : versionId
    ? "Copilot WLC"
    : "Prompt Maker";
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

  // Prompt Mestre enviado pelo botão Copilot do Prompt Maker: cola no Copilot Builder.
  useEffect(() => {
    if (!is199) return;
    try {
      const pending = sessionStorage.getItem(PENDING_PROMPT_KEY);
      if (pending) { sessionStorage.removeItem(PENDING_PROMPT_KEY); setText(pending); }
    } catch { /* sem storage */ }
  }, [is199]);

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

  const send = async (override?: string) => {
    const prompt = override?.trim() || autoTxt.buildPayload(text.trim());
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
            requiresConfirm?: boolean;
            intent?: string;
          };
        };
        if (!response.ok || !result.ok) {
          setConnection(null);
          setError(result.reply ?? result.error ?? "Falha no System."); setText(prompt); return;
        }
        const requiresConfirm = Boolean(result.data && (result.data as { requiresConfirm?: boolean }).requiresConfirm);
        const intent = typeof (result.data as { intent?: unknown } | undefined)?.intent === "string"
          ? String((result.data as { intent?: string }).intent)
          : undefined;
        setEntries(e => [...e, {
          id: crypto.randomUUID(),
          role: "model",
          content: result.reply ?? "",
          ...(isSystem ? { system: { requiresConfirm, ...(intent !== undefined ? { intent } : {}) } } : {}),
        }]);
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

  useEffect(() => {
    const h = () => clearChat();
    window.addEventListener("wlc-clear-chat", h);
    return () => window.removeEventListener("wlc-clear-chat", h);
  });

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
      else {
        // Pós-apply: validação local + typecheck remoto (se GitHub vinculado)
        try {
          const v = await validateApply({ data: { projectId, withRemote: true } });
          if (v.ok && v.report) {
            const note = v.report.summary.slice(0, 1200);
            if (!v.report.local.ok || !v.report.remote.ok) {
              setError(note);
            } else {
              // feedback positivo no histórico via entry de sistema leve
              setEntries(prev => [...prev, {
                id: crypto.randomUUID(),
                role: "model" as const,
                content: note,
              }]);
            }
          } else if (!v.ok) {
            setError(v.error ?? "Validação pós-edição falhou");
          }
        } catch {
          /* validação é best-effort; apply já concluiu */
        }
      }
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
          <div className="py-8 space-y-6">
            <div className="flex flex-col items-center gap-3 text-center">
              <img src={wlcLogo.url} alt="WLC IA" className="h-20 w-20 object-contain" />
              <h1 className="font-display text-sm font-semibold uppercase tracking-[0.25em] text-muted-foreground">WLC IA <span className="text-primary">_&lt;</span></h1>
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
              {isSystem && entry.role === "model" && entry.system && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {entry.system.requiresConfirm && !entry.system.confirmed && !entry.system.cancelled ? (
                    <>
                      <Button
                        size="sm"
                        className="h-8 gap-1.5 bg-emerald-600 text-white hover:bg-emerald-500"
                        disabled={busy}
                        onClick={() => {
                          setEntries(e => e.map(item =>
                            item.id === entry.id && item.system
                              ? { ...item, system: { ...item.system, confirmed: true, requiresConfirm: false } }
                              : item,
                          ));
                          void send("confirmar");
                        }}
                      >
                        <Check className="h-3.5 w-3.5" />
                        Confirmar
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 gap-1.5"
                        disabled={busy}
                        onClick={() => {
                          setEntries(e => e.map(item =>
                            item.id === entry.id && item.system
                              ? { ...item, system: { ...item.system, cancelled: true, requiresConfirm: false } }
                              : item,
                          ));
                          void send("cancelar");
                        }}
                      >
                        <X className="h-3.5 w-3.5" />
                        Cancelar
                      </Button>
                    </>
                  ) : entry.system.confirmed ? (
                    <span className="rounded-md border border-emerald-800/50 bg-emerald-950/40 px-2 py-1 font-mono text-[10px] text-emerald-400">
                      Confirmado
                    </span>
                  ) : entry.system.cancelled ? (
                    <span className="rounded-md border border-border bg-muted/40 px-2 py-1 font-mono text-[10px] text-muted-foreground">
                      Cancelado
                    </span>
                  ) : null}
                  {/* Atalhos de produção — sempre disponíveis nas respostas System */}
                  {!entry.system.requiresConfirm && (
                    <>
                      <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs" disabled={busy} onClick={() => void send("status")}>
                        status
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs" disabled={busy} onClick={() => void send("ls")}>
                        ls
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs" disabled={busy} onClick={() => void send("diff")}>
                        diff
                      </Button>
                      <Button size="sm" variant="secondary" className="h-7 gap-1 px-2 text-xs" disabled={busy} onClick={() => void send("commit")}>
                        <GitCommit className="h-3 w-3" />
                        commit
                      </Button>
                    </>
                  )}
                </div>
              )}
              {(isPromptMaker || (entry.answer && entry.answer.changes.length === 0)) && entry.role === "model" && (
                <div className="mt-3">
                  {isPromptMaker ? (
                    <Button
                      size="sm"
                      className="gap-1.5"
                      onClick={async () => {
                        const block = /```(?:text)?\n([\s\S]*?)```/.exec(entry.content)?.[1]?.trim() || entry.content;
                        try { await navigator.clipboard.writeText(block); } catch { /* clipboard indisponível */ }
                        // O painel remonta ao trocar de versão: o prompt segue pelo sessionStorage.
                        try { sessionStorage.setItem(PENDING_PROMPT_KEY, block); } catch { setText(block); }
                        setSelectedVersion(COPILOT_199_SLUG);
                      }}
                    >
                      <Rocket className="h-3.5 w-3.5" />
                      Copilot
                    </Button>
                  ) : (
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
                      {copiedPrompt ? "Copiado" : "Copiar"}
                    </Button>
                  )}
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
                : isSystem ? "CMD"
                : isPro ? "Otimização"
                : is199 ? "Cole seu Prompt"
                : isPromptMaker ? "Qual sua ideia?"
                : "O que vamos criar neste projeto?"
            } value={text} maxLength={isSystem ? 100_000 : 100_000}
            onChange={e => autoTxt.handleChange(e.target.value, setText)}
            onPaste={e => autoTxt.handlePaste(e, text, setText)}
            className={`min-h-[2.75rem] px-1 text-base leading-relaxed ${isSystem ? "font-mono text-sm" : ""}`} />
          <PromptInputFooter className="items-center gap-1.5 px-1 pb-0.5 pt-0">
            <span className="flex-1" />
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