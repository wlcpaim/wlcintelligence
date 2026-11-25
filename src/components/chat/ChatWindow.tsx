import { AlertCircle, PlugZap } from "lucide-react";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { prepareRepository } from "@/modules/integrations/github/functions/repository.functions";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { conversationsQuery } from "@/services/chat.queries";
import { useChat } from "@/hooks/use-chat";
import { MessageList } from "./MessageList";
import { Composer } from "./Composer";
import type { ChatMessage } from "@/types/chat";
import { VersionSelector } from "@/modules/versions/components/VersionSelector";
import { BackButton } from "@/components/nav/BackButton";
import { ChatGitMenu } from "@/modules/integrations/github/components/ChatGitMenu";
import type { RepositoryPreview } from "@/modules/integrations/github/repository";
import { useSelectedVersion, SYSTEM_SLUG } from "@/modules/versions/selected";
import { SystemCommandCard } from "@/modules/system/components/SystemCommandCard";

export function ChatWindow({ id, title, initial }: { id: string; title: string; initial: ChatMessage[] }) {
  const { messages, streaming, error, send, stop, connection } = useChat(initial, id);
  const selectedVersion = useSelectedVersion();
  const qc = useQueryClient();
  const { data: conversations } = useSuspenseQuery(conversationsQuery);
  const currentTitle = conversations.find(c => c.id === id)?.title ?? title;
  const [attached, setAttached] = useState<RepositoryPreview | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [analyzed, setAnalyzed] = useState(false);
  const [draftCommand, setDraftCommand] = useState<string | null>(null);
  const prepare = useServerFn(prepareRepository);
  const storeKey = `wlc.repo.${id}`;
  useEffect(() => {
    const repo = localStorage.getItem(storeKey);
    if (!repo) return;
    let alive = true;
    prepare({ data: { repo } }).then(r => { if (alive && r.ok) { setAttached(r.preview); setAnalyzed(true); } }).catch(() => {});
    return () => { alive = false; };
  }, [storeKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (path: string) => setSelected(s => s.includes(path) ? s.filter(p => p !== path) : [...s, path].slice(0, 20));
  return <div className="flex h-full min-h-0 flex-col">
    <header className="flex h-12 shrink-0 items-center justify-between gap-2 border-b px-2 sm:px-4">
      <div className="flex min-w-0 items-center gap-1.5"><BackButton to="/code" label="Voltar ao Code Studio" /><VersionSelector /><h1 title={currentTitle} className="min-w-0 truncate text-sm font-medium text-muted-foreground">{currentTitle}</h1></div>
      <ChatGitMenu attached={attached} streaming={streaming} selected={selected} onToggleFile={toggle} analyzed={analyzed}
        onDetach={() => { localStorage.removeItem(storeKey); setAttached(null); setSelected([]); setAnalyzed(false); }}
        onAttach={preview => { localStorage.setItem(storeKey, preview.ref.repo); setAttached(preview); setSelected([]); setAnalyzed(true); }} />
    </header>
    {connection && selectedVersion === SYSTEM_SLUG && <div role="status" title={`Sessão verificada em ${connection.checkedAt}; agente externo ainda não pareado`} className="flex min-w-0 items-center gap-2 border-b border-border px-4 py-2 font-mono text-xs text-success"><PlugZap className="h-3.5 w-3.5 shrink-0" /><span className="shrink-0">CANAL PRONTO</span><span className="truncate">{connection.projectName}</span></div>}
    {selectedVersion === SYSTEM_SLUG && (
      <div className="border-b border-border px-3 py-3">
        <SystemCommandCard onSelectCommand={(cmd) => setDraftCommand(cmd + (cmd.endsWith(" ") ? "" : ""))} />
      </div>
    )}
    <MessageList messages={messages} pending={streaming} />
    {error && <div role="alert" className="mx-auto mb-2 flex w-full max-w-3xl items-start gap-2 px-4 text-sm text-destructive"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span className="break-words">{error}</span></div>}
    <Composer
      systemMode={selectedVersion === SYSTEM_SLUG}
      draftCommand={draftCommand}
      onSend={text => {
        setDraftCommand(null);
        void send(text, attached?.ref, { files: selected, full: analyzed }).finally(() => {
          void qc.invalidateQueries({ queryKey: ["conversations"] });
          void qc.invalidateQueries({ queryKey: ["chat-history", id], refetchType: "none" });
          void qc.invalidateQueries({ queryKey: ["integrations"] });
        }); setSelected([]);
      }} files={selected} onRemoveFile={toggle} onStop={stop} streaming={streaming} />
  </div>;
}