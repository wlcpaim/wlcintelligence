import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { FolderOpen, Github, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { NewProjectDialog } from "@/modules/code/components/NewProjectDialog";
import { deleteProject } from "@/modules/code/functions/code.functions";
import { CenterAction } from "@/components/nav/CenterAction";
import { relativeTime } from "@/components/chat/ConversationHistory";

export const Route = createFileRoute("/_authenticated/code/")({
  head: () => ({ meta: [
    { title: "WLC IA Code — Projetos" }, { name: "description", content: "Crie, importe e edite projetos em um editor profissional." },
    { property: "og:title", content: "WLC IA Code" }, { property: "og:description", content: "Editor de código profissional da WLC IA." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }),
  component: CodeHome,
});

function CodeHome() {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const qc = useQueryClient();
  const remove = useServerFn(deleteProject);

  const { data } = useQuery({
    queryKey: ["code-projects"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("code_projects")
        .select("id,name,source,repo_full_name,updated_at")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      const r = await remove({ data: { projectId: pendingDelete.id } });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(`Projeto “${pendingDelete.name}” removido do histórico`);
      setPendingDelete(null);
      await qc.invalidateQueries({ queryKey: ["code-projects"] });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <CenterAction label="Novo projeto" onClick={() => setOpen(true)} corner={
        <Sheet open={list} onOpenChange={setList}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="h-10 w-10 text-muted-foreground [&_svg]:size-6" aria-label="Projetos salvos" title="Projetos salvos"><FolderOpen /></Button>
          </SheetTrigger>
          <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-sm">
            <SheetHeader className="px-4 pb-2 pt-4">
              <SheetTitle className="text-sm font-medium">Projetos</SheetTitle>
              <p className="text-xs text-muted-foreground">Histórico local. Excluir remove arquivos e backups da WLC (não apaga o repo no GitHub).</p>
            </SheetHeader>
            <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-4">
              {!data?.length && <li className="px-3 py-10 text-center text-sm text-muted-foreground">Nenhum projeto ainda.</li>}
              {data?.map(p => (
                <li key={p.id} className="group flex items-stretch gap-0.5 rounded-xl hover:bg-accent">
                  <Link
                    to="/code/$projectId"
                    params={{ projectId: p.id }}
                    onClick={() => setList(false)}
                    className="min-w-0 flex-1 rounded-xl px-3 py-2.5 transition-colors"
                  >
                    <span className="block truncate text-sm font-medium">{p.name}</span>
                    <span className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                      {p.repo_full_name ? (
                        <>
                          <Github className="h-3 w-3 shrink-0" />
                          <span className="truncate">{p.repo_full_name}</span>
                          <span>·</span>
                        </>
                      ) : null}
                      {relativeTime(p.updated_at)}
                    </span>
                  </Link>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="my-auto mr-1 h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                    aria-label={`Excluir projeto ${p.name}`}
                    title="Excluir do histórico"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setPendingDelete({ id: p.id, name: p.name });
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
          </SheetContent>
        </Sheet>
      } />
      <NewProjectDialog open={open} onOpenChange={setOpen} />

      <AlertDialog open={!!pendingDelete} onOpenChange={(o) => { if (!o && !deleting) setPendingDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir projeto?</AlertDialogTitle>
            <AlertDialogDescription>
              “{pendingDelete?.name}” será removido do histórico da WLC, com arquivos e backups.
              O repositório no GitHub (se houver) <strong>não</strong> será apagado.
              Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault();
                void confirmDelete();
              }}
            >
              {deleting ? <Loader2 className="animate-spin" /> : <Trash2 />}
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
