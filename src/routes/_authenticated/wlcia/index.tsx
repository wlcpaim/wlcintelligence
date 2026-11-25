import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AlertTriangle, BadgeCheck, ChevronRight, Download, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { versionsQuery } from "@/modules/versions/queries";
import { createChatVersion, deleteChatVersion, getBaseVersionFile } from "@/modules/versions/functions/versions.functions";
import { BASE_VERSION } from "@/modules/versions/instructions";
import { useVersionsAutoSync } from "@/modules/versions/components/VersionSelector";
import { UploadVersionButton, downloadRawVersion, downloadVersionFile } from "@/modules/versions/components/VersionFileActions";
import { setSelectedVersion, readSelectedVersion } from "@/modules/versions/selected";

export const Route = createFileRoute("/_authenticated/wlcia/")({
  head: () => ({ meta: [
    { title: "Versões — wlc.ia" }, { name: "description", content: "Versão oficial da WLC IA e suas versões, com download e upload de arquivos." },
    { property: "og:title", content: "Versões — wlc.ia" }, { property: "og:description", content: "Versões da WLC IA." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }),
  loader: ({ context }) => context.queryClient.ensureQueryData(versionsQuery),
  component: VersionsPage,
});

function VersionsPage() {
  useVersionsAutoSync();
  const { data } = useSuspenseQuery(versionsQuery);
  const official = useQuery({ queryKey: ["chat-versions", "official-file"], queryFn: () => getBaseVersionFile(), staleTime: Infinity });
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [remove, setRemove] = useState<{ id: string; name: string } | null>(null);
  const create = useMutation({ mutationFn: (n: string) => createChatVersion({ data: { name: n } }), onSuccess: async v => {
    await qc.invalidateQueries({ queryKey: ["chat-versions"] }); setOpen(false); setName("");
    if (v.sync_error) toast.warning(v.sync_error); else toast.success(`${v.name} criada.`);
    await navigate({ to: "/wlcia/$versionId", params: { versionId: v.id } });
  }, onError: e => toast.error(e.message) });
  const del = useMutation({ mutationFn: (id: string) => deleteChatVersion({ data: { id } }), onSuccess: async (r, id) => {
    if (r.githubError) { toast.error(`Não foi possível apagar no GitHub: ${r.githubError}`); return; }
    if (readSelectedVersion() === id) setSelectedVersion(null);
    setRemove(null); await qc.invalidateQueries({ queryKey: ["chat-versions"] }); toast.success("Versão apagada.");
  }, onError: e => toast.error(e.message) });

  const row = "flex min-h-14 items-center gap-1 rounded-2xl px-3 py-2 transition-colors hover:bg-accent/60";
  return <div className="h-full overflow-y-auto">
    <div className="mx-auto flex min-h-full max-w-xl flex-col px-4 pb-8 pt-6">
      <div className="mb-6 flex items-center justify-between gap-2">
        <h1 className="text-lg font-semibold tracking-tight">Versões</h1>
        <div className="flex items-center gap-1.5">
          <UploadVersionButton label="Upload" onDone={v => navigate({ to: "/wlcia/$versionId", params: { versionId: v.id } })} className="rounded-full" />
          <Button size="sm" className="rounded-full" onClick={() => setOpen(true)}><Plus />Nova versão</Button>
        </div>
      </div>

      <ul className="space-y-1">
        <li className={row}>
          <BadgeCheck className="mr-2 h-5 w-5 shrink-0 text-foreground" strokeWidth={1.5} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{BASE_VERSION.name}</p>
            <p className="text-xs text-muted-foreground">Oficial</p>
          </div>
          <Button variant="ghost" size="icon" className="text-muted-foreground" aria-label={`Baixar ${BASE_VERSION.name}`} title="Baixar arquivo"
            disabled={!official.data} onClick={() => official.data && downloadRawVersion(official.data.content, BASE_VERSION.slug)}><Download /></Button>
        </li>
        {data.map(v => <li key={v.id} className={row}>
          {v.sync_error
            ? <span title={v.sync_error}><AlertTriangle className="mr-2 h-5 w-5 shrink-0 text-warning" strokeWidth={1.5} /></span>
            : <span className="mr-2 h-5 w-5 shrink-0" aria-hidden />}
          <Link to="/wlcia/$versionId" params={{ versionId: v.id }} className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{v.name}</p>
            <p className="truncate text-xs text-muted-foreground">{v.rules.length} regra{v.rules.length === 1 ? "" : "s"}</p>
          </Link>
          <Button variant="ghost" size="icon" className="text-muted-foreground" aria-label={`Baixar ${v.name}`} title="Baixar arquivo"
            onClick={() => downloadVersionFile({ name: v.name, slug: v.slug, base_version: v.base_version, chat_instruction: v.chat_instruction, copilot_instruction: v.copilot_instruction, rules: v.rules })}><Download /></Button>
          <Button variant="ghost" size="icon" className="text-muted-foreground" aria-label={`Apagar ${v.name}`} title="Apagar versão" onClick={() => setRemove({ id: v.id, name: v.name })}><Trash2 /></Button>
          <Link to="/wlcia/$versionId" params={{ versionId: v.id }} aria-label={`Abrir ${v.name}`} className="text-subtle"><ChevronRight className="h-4 w-4" /></Link>
        </li>)}
      </ul>
      {data.length === 0 && <p className="mt-10 text-center text-sm text-muted-foreground">Crie uma versão pelo chat ou envie um arquivo.</p>}
    </div>

    <Dialog open={open} onOpenChange={setOpen}><DialogContent>
      <DialogHeader><DialogTitle>Nova versão</DialogTitle><DialogDescription>Começa como cópia da versão oficial. Depois você ensina regras pelo chat.</DialogDescription></DialogHeader>
      <form onSubmit={e => { e.preventDefault(); if (name.trim().length >= 2) create.mutate(name.trim()); }}>
        <Label htmlFor="version-name">Nome</Label>
        <Input id="version-name" value={name} onChange={e => setName(e.target.value)} placeholder="WLC 1.6 Lite" maxLength={60} autoFocus className="mt-2" />
        <DialogFooter className="mt-5"><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button><Button type="submit" disabled={name.trim().length < 2 || create.isPending}>{create.isPending ? "Criando…" : "Criar"}</Button></DialogFooter>
      </form>
    </DialogContent></Dialog>
    <AlertDialog open={!!remove} onOpenChange={v => { if (!v) setRemove(null); }}><AlertDialogContent>
      <AlertDialogHeader><AlertDialogTitle>Apagar {remove?.name}?</AlertDialogTitle><AlertDialogDescription>A versão, suas regras e o treino serão apagados aqui e o arquivo será removido do repositório GitHub.</AlertDialogDescription></AlertDialogHeader>
      <AlertDialogFooter><AlertDialogCancel disabled={del.isPending}>Cancelar</AlertDialogCancel><AlertDialogAction className="bg-destructive text-destructive-foreground" disabled={del.isPending} onClick={e => { e.preventDefault(); if (remove) del.mutate(remove.id); }}>{del.isPending ? "Apagando…" : "Apagar"}</AlertDialogAction></AlertDialogFooter>
    </AlertDialogContent></AlertDialog>
  </div>;
}
