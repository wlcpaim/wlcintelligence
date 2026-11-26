import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Plus, Pin, PinOff, Pencil, Trash2, MoreHorizontal, MessageSquare, Search, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { conversationsQuery } from "@/services/chat.queries";
import { createConversation, updateConversation, deleteConversation } from "@/services/chat.functions";
import type { Conversation } from "@/services/conversations";

/** Cria uma conversa nova e abre a tela dela. */
export function useNewChat(onOpen?: () => void) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  return useMutation({ mutationFn: () => createConversation(), onSuccess: async (c) => {
    await qc.invalidateQueries({ queryKey: ["conversations"] });
    onOpen?.();
    await navigate({ to: "/chat/$conversationId", params: { conversationId: c.id } });
  }, onError: (e) => toast.error(e.message) });
}

export function NewChatButton({ onOpen, label }: { onOpen?: () => void; label?: string }) {
  const create = useNewChat(onOpen);
  if (label) return <Button onClick={() => create.mutate()} disabled={create.isPending} className="rounded-full"><Plus />{create.isPending ? "Criando…" : label}</Button>;
  return <Button onClick={() => create.mutate()} disabled={create.isPending} size="icon" className="rounded-full" aria-label="Novo chat" title="Novo chat"><Plus /></Button>;
}

export function ConversationHistory({ onOpen }: { onOpen?: () => void }) {
  const { data } = useSuspenseQuery(conversationsQuery);
  const params = useParams({ strict: false });
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [rename, setRename] = useState<Conversation | null>(null);
  const [name, setName] = useState("");
  const [remove, setRemove] = useState<Conversation | null>(null);
  const [query, setQuery] = useState("");
  const update = useMutation({ mutationFn: (input: { id: string; title?: string; is_pinned?: boolean }) => updateConversation({ data: input }),
    onSuccess: async () => { setRename(null); await qc.invalidateQueries({ queryKey: ["conversations"] }); }, onError: e => toast.error(e.message) });
  const del = useMutation({ mutationFn: (id: string) => deleteConversation({ data: { id } }), onSuccess: async (_r, id) => {
    setRemove(null); qc.removeQueries({ queryKey: ["chat-history", id] });
    if (params.conversationId === id) await navigate({ to: "/code" });
    await qc.invalidateQueries({ queryKey: ["conversations"] });
  }, onError: e => toast.error(e.message) });
  const normalize = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const q = normalize(query.trim());
  const list = q ? data.filter(c => normalize(c.title).includes(q)) : data;
  const pinned = list.filter(c => c.is_pinned);
  const recent = list.filter(c => !c.is_pinned);
  const item = (c: Conversation) => <li key={c.id} className={`group flex min-w-0 items-center gap-1 rounded-xl border pr-1 transition-colors ${params.conversationId === c.id ? "border-primary/40 bg-accent" : "border-transparent hover:border-border hover:bg-accent/50"}`}>
    <Link to="/chat/$conversationId" params={{ conversationId: c.id }} onClick={onOpen} title={c.title} className="flex min-w-0 flex-1 items-center gap-3 px-3 py-3">
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${c.is_pinned ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}>
        {c.is_pinned ? <Pin className="h-4 w-4" /> : <MessageSquare className="h-4 w-4" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{c.title}</span>
        <span className="block text-xs text-muted-foreground">{relativeTime(c.updated_at)}</span>
      </span>
    </Link>
    <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={`Opções de ${c.title}`} title="Opções da conversa"><MoreHorizontal /></Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem disabled={update.isPending} onSelect={() => update.mutate({ id: c.id, is_pinned: !c.is_pinned })}>{c.is_pinned ? <PinOff /> : <Pin />}{c.is_pinned ? "Desafixar" : "Fixar chat"}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => { setRename(c); setName(c.title); }}><Pencil />Renomear</DropdownMenuItem>
        <DropdownMenuItem className="text-destructive" onSelect={() => setRemove(c)}><Trash2 />Excluir</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </li>;
  return <div className="flex min-h-0 flex-1 flex-col">
    {data.length > 0 && <div className="relative mb-4 shrink-0">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar conversas" aria-label="Buscar conversas" className="h-10 rounded-full pl-9 pr-9" />
      {query.trim() !== "" && (
        <button
          type="button"
          onClick={() => setQuery("")}
          className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-muted-foreground hover:text-foreground"
          aria-label="Limpar busca"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>}
    <div className="min-h-0 flex-1 overflow-y-auto pb-4">
      {data.length === 0 && <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground"><MessageSquare className="h-5 w-5" /></span>
        <p className="text-sm font-medium">Nenhuma conversa ainda</p>
        <p className="text-xs text-muted-foreground">Comece um novo chat para falar com a WLC IA.</p>
        <NewChatButton label="Novo chat" {...(onOpen ? { onOpen } : {})} />
      </div>}
      {data.length > 0 && list.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">Nenhuma conversa encontrada para “{query}”.</p>}
      {pinned.length > 0 && <section className="mb-4"><h2 className="mb-1.5 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Fixados</h2><ul className="space-y-1">{pinned.map(item)}</ul></section>}
      {recent.length > 0 && <section><h2 className="mb-1.5 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Recentes</h2><ul className="space-y-1">{recent.map(item)}</ul></section>}
    </div>
    <Dialog open={!!rename} onOpenChange={v => { if (!v) setRename(null); }}><DialogContent>
      <DialogHeader><DialogTitle>Renomear chat</DialogTitle></DialogHeader>
      <form onSubmit={e => { e.preventDefault(); if (rename && name.trim()) update.mutate({ id: rename.id, title: name.trim() }); }}>
        <Label htmlFor="chat-name">Nome</Label><Input id="chat-name" value={name} onChange={e => setName(e.target.value)} maxLength={80} autoFocus className="mt-2" />
        <DialogFooter className="mt-5"><Button type="button" variant="ghost" onClick={() => setRename(null)}>Cancelar</Button><Button type="submit" disabled={!name.trim() || update.isPending}>Salvar</Button></DialogFooter>
      </form>
    </DialogContent></Dialog>
    <AlertDialog open={!!remove} onOpenChange={v => { if (!v) setRemove(null); }}><AlertDialogContent>
      <AlertDialogHeader><AlertDialogTitle>Excluir este chat?</AlertDialogTitle><AlertDialogDescription>A conversa “{remove?.title}” e todas as suas mensagens serão excluídas permanentemente.</AlertDialogDescription></AlertDialogHeader>
      <AlertDialogFooter><AlertDialogCancel disabled={del.isPending}>Cancelar</AlertDialogCancel><AlertDialogAction className="bg-destructive text-destructive-foreground" disabled={del.isPending} onClick={e => { e.preventDefault(); if (remove) del.mutate(remove.id); }}>{del.isPending ? "Excluindo…" : "Excluir chat"}</AlertDialogAction></AlertDialogFooter>
    </AlertDialogContent></AlertDialog>
  </div>;
}

/** "agora", "há 5 min", "há 3 h", "ontem", "há 4 dias" ou data curta. */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const diff = Math.max(0, now - new Date(iso).getTime());
  const min = Math.floor(diff / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  if (d === 1) return "ontem";
  if (d < 7) return `há ${d} dias`;
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}
