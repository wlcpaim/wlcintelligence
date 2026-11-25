import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { FolderOpen, Github } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { NewProjectDialog } from "@/modules/code/components/NewProjectDialog";
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
  const { data } = useQuery({
    queryKey: ["code-projects"],
    queryFn: async () => { const { data, error } = await supabase.from("code_projects").select("id,name,source,repo_full_name,updated_at").order("updated_at", { ascending: false }); if (error) throw error; return data; },
  });
  return (
    <>
      <CenterAction label="Novo projeto" onClick={() => setOpen(true)} corner={
        <Sheet open={list} onOpenChange={setList}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="h-10 w-10 text-muted-foreground [&_svg]:size-6" aria-label="Projetos salvos" title="Projetos salvos"><FolderOpen /></Button>
          </SheetTrigger>
          <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-sm">
            <SheetHeader className="px-4 pb-2 pt-4"><SheetTitle className="text-sm font-medium">Projetos</SheetTitle></SheetHeader>
            <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-4">
              {!data?.length && <li className="px-3 py-10 text-center text-sm text-muted-foreground">Nenhum projeto ainda.</li>}
              {data?.map(p => <li key={p.id}>
                <Link to="/code/$projectId" params={{ projectId: p.id }} onClick={() => setList(false)} className="block rounded-xl px-3 py-2.5 transition-colors hover:bg-accent">
                  <span className="block truncate text-sm font-medium">{p.name}</span>
                  <span className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">{p.repo_full_name ? <><Github className="h-3 w-3 shrink-0" /><span className="truncate">{p.repo_full_name}</span> · </> : null}{relativeTime(p.updated_at)}</span>
                </Link>
              </li>)}
            </ul>
          </SheetContent>
        </Sheet>
      } />
      <NewProjectDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
