import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { History, Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { listProjectBackups, revertProjectBackup } from "@/modules/code/functions/backup.functions";

export const Route = createFileRoute("/_authenticated/settings/backup")({
  head: () => ({ meta: [
    { title: "Backups — WLC IA" },
    { name: "description", content: "Histórico de backups automáticos e reversão de commits." },
    { property: "og:title", content: "Backups — WLC IA" },
    { property: "og:description", content: "Histórico de backups automáticos e reversão de commits dos projetos WLC IA." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: BackupPage,
});

function BackupPage() {
  const qc = useQueryClient();
  const projectsQuery = useQuery({
    queryKey: ["code-projects-list"],
    queryFn: async () => {
      const { data, error } = await supabase.from("code_projects").select("id, name").order("updated_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const [projectId, setProjectId] = useState<string | null>(null);
  const activeProject = projectId ?? projectsQuery.data?.[0]?.id ?? null;

  const listBackupsFn = useServerFn(listProjectBackups);
  const revertFn = useServerFn(revertProjectBackup);

  const backupsQuery = useQuery({
    queryKey: ["code-backups", activeProject],
    queryFn: async () => {
      if (!activeProject) return [];
      const r = await listBackupsFn({ data: { projectId: activeProject } });
      if (!r.ok) throw new Error(r.error);
      return r.items;
    },
    enabled: !!activeProject,
  });

  const [targetBackup, setTargetBackup] = useState<{ id: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const handleRevert = async () => {
    if (!targetBackup) return;
    setBusy(true);
    try {
      const r = await revertFn({ data: { backupId: targetBackup.id } });
      if (!r.ok) { toast.error(r.error); return; }
      toast.success("Estado revertido com sucesso!", { description: "O projeto foi restaurado para o backup selecionado." });
      await backupsQuery.refetch();
      qc.invalidateQueries({ queryKey: ["code-project"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao reverter backup.");
    } finally {
      setBusy(false);
      setTargetBackup(null);
    }
  };

  const projects = projectsQuery.data ?? [];
  const backups = backupsQuery.data ?? [];

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Backups Automáticos & Reversão</h2>
            <p className="text-xs text-muted-foreground">Cada commit gera um snapshot automático de segurança de todos os arquivos.</p>
          </div>
          {projects.length > 0 && (
            <Select value={activeProject ?? ""} onValueChange={setProjectId}>
              <SelectTrigger className="w-56">
                <SelectValue placeholder="Selecione um projeto" />
              </SelectTrigger>
              <SelectContent>
                {projects.map(p => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {projectsQuery.isLoading && <p className="text-sm text-muted-foreground">Carregando projetos…</p>}
        {!projectsQuery.isLoading && projects.length === 0 && (
          <p className="text-sm text-muted-foreground">Nenhum projeto encontrado. Crie um projeto no editor Code.</p>
        )}

        {activeProject && (
          <div className="space-y-3">
            {backupsQuery.isLoading && <div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div>}
            {!backupsQuery.isLoading && backups.length === 0 && (
              <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
                <History className="mx-auto mb-2 h-8 w-8 opacity-40" />
                Nenhum backup registrado para este projeto ainda. Faça um commit para criar o primeiro snapshot.
              </div>
            )}
            {backups.map(b => (
              <div key={b.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-border/60 p-4">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-sm">{b.message}</span>
                    {b.commit_sha && <Badge variant="outline" className="font-mono text-[10px]">{b.commit_sha.slice(0, 7)}</Badge>}
                    <Badge variant="secondary" className="text-[10px]">{b.files_count} arquivo(s)</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{new Date(b.created_at).toLocaleString("pt-BR")}</p>
                </div>
                <Button size="sm" variant="outline" className="h-9 shrink-0 gap-1.5" onClick={() => setTargetBackup({ id: b.id, message: b.message })}>
                  <RotateCcw className="h-3.5 w-3.5" /> Reverter para este estado
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      <AlertDialog open={!!targetBackup} onOpenChange={o => !o && setTargetBackup(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reverter para este backup?</AlertDialogTitle>
            <AlertDialogDescription>
              O projeto será restaurado exatamente para o estado do commit <b>"{targetBackup?.message}"</b>. Os arquivos atuais serão substituídos e um novo commit de rollback será enviado ao GitHub.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={e => { e.preventDefault(); void handleRevert(); }}>
              {busy && <Loader2 className="animate-spin mr-1" />} Reverter agora
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
