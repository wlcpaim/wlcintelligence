import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { ExternalLink, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { listCloudflareDeployments, deleteCloudflareDeployment } from "@/modules/integrations/cloudflare/functions/cloudflare.functions";

export const Route = createFileRoute("/_authenticated/settings/deploy")({
  head: () => ({
    meta: [
      { title: "Deploy — WLC IA" },
      { name: "description", content: "Todos os deploys da sua conta Cloudflare, com opção de excluir." },
      { property: "og:title", content: "Deploy — WLC IA" },
      { property: "og:description", content: "Lista e exclusão de deploys da Cloudflare Pages." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DeployPage,
});

type Item = { id: string; project: string; url: string; branch: string | null; message: string | null; env: string; stage: string; status: string; createdAt: string };

function DeployPage() {
  const list = useServerFn(listCloudflareDeployments);
  const del = useServerFn(deleteCloudflareDeployment);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["cloudflare", "deployments"], queryFn: () => list(), staleTime: 30_000 });
  const [target, setTarget] = useState<Item | null>(null);
  const [busy, setBusy] = useState(false);

  const confirmDelete = async () => {
    if (!target) return;
    const item = target;
    setBusy(true);
    try {
      const r = await del({ data: { project: item.project, id: item.id } });
      if (!r.ok) { toast.error(r.error); return; }
      // Remove o item da lista na hora (a Cloudflare pode demorar a propagar).
      qc.setQueryData<{ ok: boolean; items: Item[] } | undefined>(["cloudflare", "deployments"], (old) =>
        old ? { ...old, items: old.items.filter((d) => d.id !== item.id) } : old);
      toast.success("Deploy excluído");
      // Revalida em segundo plano para confirmar o estado real da conta.
      setTimeout(() => void qc.invalidateQueries({ queryKey: ["cloudflare", "deployments"] }), 3000);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao excluir o deploy.");
    } finally {
      setBusy(false);
      setTarget(null);
    }
  };

  const items = q.data?.items ?? [];
  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="mx-auto grid max-w-3xl gap-3">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">{q.isLoading ? "Carregando…" : `${items.length} deploys`}</p>
          <Button variant="outline" size="sm" onClick={() => q.refetch()} disabled={q.isFetching}>
            <RefreshCw className={q.isFetching ? "animate-spin" : ""} /> Atualizar
          </Button>
        </div>
        {q.data && !q.data.ok && <p className="rounded-lg border border-destructive/50 p-3 text-sm text-destructive">{q.data.error}</p>}
        {items.map((d) => (
          <div key={d.id} className="flex items-start gap-3 rounded-xl border border-border/60 p-3 text-sm">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{d.project}</span>
                <Badge variant={d.status === "success" ? "default" : d.status === "failure" ? "destructive" : "secondary"}>{d.status === "success" ? "Sucesso" : d.status === "failure" ? "Falhou" : d.stage}</Badge>
                <span className="text-xs text-muted-foreground">{d.env === "production" ? "Produção" : "Prévia"}</span>
              </div>
              {d.message && <p className="truncate text-muted-foreground">{d.message}</p>}
              <p className="text-xs text-muted-foreground">{new Date(d.createdAt).toLocaleString("pt-BR")}{d.branch ? ` · ${d.branch}` : ""}</p>
              <a href={d.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">{d.url} <ExternalLink className="h-3 w-3" /></a>
            </div>
            <Button variant="ghost" size="icon" aria-label="Excluir deploy" onClick={() => setTarget(d)}><Trash2 /></Button>
          </div>
        ))}
      </div>
      <AlertDialog open={!!target} onOpenChange={(o) => !o && setTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir este deploy?</AlertDialogTitle>
            <AlertDialogDescription>O deploy de <b>{target?.project}</b> ({target && new Date(target.createdAt).toLocaleString("pt-BR")}) será apagado da Cloudflare permanentemente. Se for o deploy ativo, o site pode sair do ar.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); void confirmDelete(); }} disabled={busy}>{busy && <Loader2 className="animate-spin" />}Excluir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
