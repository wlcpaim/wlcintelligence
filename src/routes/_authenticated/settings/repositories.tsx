import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { ExternalLink, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { githubQuery, githubReposQuery } from "@/modules/integrations/github/queries";
import { deleteGithubRepo } from "@/modules/integrations/github/functions/github.functions";
import type { GithubRepoView } from "@/modules/integrations/github/types";

export const Route = createFileRoute("/_authenticated/settings/repositories")({
  head: () => ({ meta: [
    { title: "Repositórios — WLC IA" },
    { name: "description", content: "Repositórios da conta GitHub conectada à WLC IA." },
    { property: "og:title", content: "Repositórios — WLC IA" },
    { property: "og:description", content: "Gerencie e exclua seus repositórios GitHub com confirmação." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  loader: ({ context }) => context.queryClient.ensureQueryData(githubQuery),
  component: RepositoriesPage,
});

function RepositoriesPage() {
  const { data } = useSuspenseQuery(githubQuery);
  return <div className="h-full overflow-y-auto p-4"><div className="mx-auto grid max-w-3xl gap-3">
    {data.account ? <RepositoryList /> : <p className="text-sm text-muted-foreground">Nenhuma conta GitHub conectada. <Link to="/settings/github" className="text-primary underline">Conectar GitHub</Link></p>}
  </div></div>;
}

function RepositoryList() {
  const qc = useQueryClient();
  const q = useSuspenseQuery(githubReposQuery);
  const del = useServerFn(deleteGithubRepo);
  const [target, setTarget] = useState<GithubRepoView | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [removed, setRemoved] = useState<number[]>([]);
  const items = q.data.filter((repo) => !removed.includes(repo.id));
  const confirmDelete = async () => {
    if (!target || confirmation !== target.full_name || busy) return;
    const repo = target;
    setBusy(true);
    try {
      const result = await del({ data: { repo: repo.full_name, confirmation } });
      if (!result.ok) { toast.error(result.error); return; }
      setRemoved((old) => [...old, repo.id]);
      qc.setQueryData<GithubRepoView[]>(githubReposQuery.queryKey, (old) => old?.filter((item) => item.id !== repo.id));
      void qc.invalidateQueries({ queryKey: githubQuery.queryKey });
      toast.success("Repositório excluído do GitHub");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao excluir o repositório.");
    } finally {
      setBusy(false);
      setTarget(null);
      setConfirmation("");
    }
  };
  return <>
    <div className="flex items-center justify-between gap-3">
      <p className="text-sm text-muted-foreground">{items.length} repositórios</p>
      <Button variant="outline" size="sm" onClick={() => void q.refetch()} disabled={q.isFetching}><RefreshCw className={q.isFetching ? "animate-spin" : ""} />Atualizar</Button>
    </div>
    {q.error && <p role="alert" className="text-sm text-destructive">{q.error.message}</p>}
    {items.length === 0 && <p className="text-sm text-muted-foreground">Nenhum repositório encontrado.</p>}
    {items.map((repo) => <div key={repo.id} className="flex items-start gap-3 rounded-lg border border-border p-3 text-sm">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2"><a href={repo.html_url} target="_blank" rel="noreferrer" className="break-all font-medium text-primary hover:underline">{repo.full_name} <ExternalLink className="inline h-3 w-3" /></a><Badge variant="secondary">{repo.private ? "Privado" : "Público"}</Badge></div>
        {repo.description && <p className="break-words text-muted-foreground">{repo.description}</p>}
        <p className="text-xs text-muted-foreground">{repo.default_branch} · {new Date(repo.updated_at).toLocaleString("pt-BR")}</p>
      </div>
      <Button variant="ghost" size="icon" disabled={!repo.permissions.admin || busy} title={repo.permissions.admin ? "Excluir repositório" : "Exige acesso de administrador"} aria-label={`Excluir ${repo.full_name}`} onClick={() => { setConfirmation(""); setTarget(repo); }}><Trash2 /></Button>
    </div>)}
    <AlertDialog open={!!target} onOpenChange={(open) => { if (!open && !busy) { setTarget(null); setConfirmation(""); } }}>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>Excluir repositório?</AlertDialogTitle><AlertDialogDescription className="break-words">O repositório {target?.full_name}, seus arquivos, issues e histórico serão excluídos do GitHub. Esta ação não pode ser desfeita aqui e pode afetar sites conectados.</AlertDialogDescription></AlertDialogHeader>
        <label className="grid gap-2 text-sm">Digite o nome completo para confirmar: <span className="break-all font-medium">{target?.full_name}</span><Input aria-label="Nome completo do repositório" value={confirmation} disabled={busy} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" /></label>
        <AlertDialogFooter><AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel><AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" disabled={busy || confirmation !== target?.full_name} onClick={(event) => { event.preventDefault(); void confirmDelete(); }}>{busy && <Loader2 className="animate-spin" />}Excluir</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>;
}