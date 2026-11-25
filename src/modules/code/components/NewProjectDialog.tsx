import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import JSZip from "jszip";
import { FileCode2, MessagesSquare, Github, FileArchive, ArrowLeft, Lock, Globe, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { conversationsQuery } from "@/services/chat.queries";
import { githubReposQuery } from "@/modules/integrations/github/queries";
import { importRepoProject, createRepoProject } from "../functions/code.functions";
import { normalizePath } from "../file-types";

type Step = "menu" | "empty" | "chat" | "git" | "git-new" | "git-existing" | "zip";

export function NewProjectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [step, setStep] = useState<Step>("menu");
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [priv, setPriv] = useState(true);
  const [filter, setFilter] = useState("");
  const navigate = useNavigate();
  const qc = useQueryClient();
  const importRepo = useServerFn(importRepoProject);
  const createRepo = useServerFn(createRepoProject);
  const chats = useQuery({ ...conversationsQuery, enabled: open && step === "chat" });
  const repos = useQuery({ ...githubReposQuery, enabled: open && step === "git-existing", retry: false });

  const reset = (o: boolean) => { onOpenChange(o); if (!o) { setStep("menu"); setName(""); setFilter(""); setBusy(false); } };
  const done = (id: string) => { qc.invalidateQueries({ queryKey: ["code-projects"] }); reset(false); navigate({ to: "/code/$projectId", params: { projectId: id } }); };
  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    try { done(await fn()); } catch (e) { toast.error(e instanceof Error ? e.message : "Falha ao criar projeto"); setBusy(false); }
  };

  const createLocal = async (projectName: string, source: "empty" | "zip", files: { path: string; content: string }[]) => {
    const { data: u } = await supabase.auth.getUser();
    const { data: p, error } = await supabase.from("code_projects").insert({ name: projectName, source, user_id: u.user!.id }).select("id").single();
    if (error) throw new Error(error.message);
    for (let i = 0; i < files.length; i += 200) {
      const { error: e } = await supabase.from("code_files").insert(files.slice(i, i + 200).map(f => ({ ...f, project_id: p.id, user_id: u.user!.id, base_content: null })));
      if (e) throw new Error(e.message);
    }
    return p.id;
  };

  const fromRepo = (repo: string, source: "git" | "chat") => run(async () => {
    const r = await importRepo({ data: { repo, source } });
    if (!r.ok) throw new Error(r.error);
    return r.id;
  });

  const onZip = (file: File) => run(async () => {
    const zip = await JSZip.loadAsync(file);
    const entries = Object.values(zip.files).filter(f => !f.dir && !/(^|\/)(node_modules|\.git|dist|build)\//.test(f.name) && !/__MACOSX/.test(f.name));
    // Remove a pasta raiz única, comum em ZIPs exportados.
    const roots = new Set(entries.map(e => e.name.split("/")[0]));
    const strip = roots.size === 1 && entries.every(e => e.name.includes("/"));
    const files: { path: string; content: string }[] = [];
    for (const e of entries.slice(0, 1500)) {
      const bytes = await e.async("uint8array");
      if (bytes.length > 500_000) continue;
      let content: string;
      try { content = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { continue; }
      if (content.includes("\0")) continue;
      const path = normalizePath(strip ? e.name.split("/").slice(1).join("/") : e.name);
      if (path) files.push({ path, content });
    }
    if (!files.length) throw new Error("Nenhum arquivo de texto encontrado no ZIP.");
    return createLocal(file.name.replace(/\.zip$/i, ""), "zip", files);
  });

  const chatRepos = (chats.data ?? []).map(c => ({ c, repo: typeof window !== "undefined" ? localStorage.getItem(`wlc.repo.${c.id}`) : null }));
  const Back = () => <Button variant="ghost" size="sm" className="-ml-2 mb-2 w-fit" onClick={() => setStep(step.startsWith("git-") ? "git" : "menu")} disabled={busy}><ArrowLeft />Voltar</Button>;
  const Option = ({ icon: Icon, title, desc, onClick }: { icon: typeof Github; title: string; desc: string; onClick: () => void }) => (
    <button onClick={onClick} className="flex items-start gap-3 rounded-lg border border-border bg-card p-4 text-left transition-colors hover:border-primary/60 hover:bg-accent">
      <Icon className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
      <span><span className="block font-medium">{title}</span><span className="text-sm text-muted-foreground">{desc}</span></span>
    </button>
  );
  const Visibility = () => (
    <div className="grid grid-cols-2 gap-2">
      {[{ v: true, l: "Privado", i: Lock }, { v: false, l: "Público", i: Globe }].map(o => (
        <Button key={o.l} type="button" variant={priv === o.v ? "default" : "outline"} onClick={() => setPriv(o.v)}><o.i />{o.l}</Button>
      ))}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-mono">Novo projeto</DialogTitle>
          <DialogDescription>Escolha como começar.</DialogDescription>
        </DialogHeader>
        {step === "menu" && <div className="grid gap-2">
          <Option icon={FileCode2} title="Empty" desc="Projeto em branco, sem arquivos." onClick={() => setStep("empty")} />
          <Option icon={MessagesSquare} title="Chats" desc="Importar o repositório aberto em um chat." onClick={() => setStep("chat")} />
          <Option icon={Github} title="Git" desc="Criar repositório novo ou abrir um existente." onClick={() => setStep("git")} />
          <Option icon={FileArchive} title="Zip" desc="Enviar um arquivo .zip do seu projeto." onClick={() => setStep("zip")} />
        </div>}
        {step === "empty" && <form className="grid gap-3" onSubmit={e => { e.preventDefault(); if (name.trim()) run(() => createLocal(name.trim(), "empty", [])); }}>
          <Back /><Label htmlFor="pn">Nome do projeto</Label>
          <Input id="pn" value={name} onChange={e => setName(e.target.value)} placeholder="meu-projeto" autoFocus maxLength={100} />
          <Button disabled={busy || !name.trim()}>{busy && <Loader2 className="animate-spin" />}Criar projeto</Button>
        </form>}
        {step === "chat" && <div className="grid gap-2"><Back />
          {chats.isLoading && <Loader2 className="mx-auto animate-spin" />}
          {chatRepos.filter(x => x.repo).length === 0 && !chats.isLoading && <p className="text-sm text-muted-foreground">Nenhum chat com repositório vinculado neste aparelho.</p>}
          <div className="max-h-80 space-y-1 overflow-y-auto">
            {chatRepos.filter(x => x.repo).map(({ c, repo }) => (
              <button key={c.id} disabled={busy} onClick={() => fromRepo(repo!, "chat")} className="flex w-full flex-col rounded-md border border-border px-3 py-2 text-left hover:bg-accent disabled:opacity-50">
                <span className="truncate text-sm font-medium">{c.title}</span><span className="font-mono text-xs text-muted-foreground">{repo}</span>
              </button>))}
          </div>
          {busy && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Importando arquivos…</p>}
        </div>}
        {step === "git" && <div className="grid gap-2"><Back />
          <Option icon={Github} title="Criar repositório" desc="Sempre vazio, sem README nem presets." onClick={() => setStep("git-new")} />
          <Option icon={FileCode2} title="Repositório existente" desc="Abre a estrutura completa de arquivos." onClick={() => setStep("git-existing")} />
        </div>}
        {step === "git-new" && <form className="grid gap-3" onSubmit={e => { e.preventDefault(); run(async () => { const r = await createRepo({ data: { name: name.trim(), private: priv } }); if (!r.ok) throw new Error(r.error); return r.id; }); }}>
          <Back /><Label htmlFor="rn">Nome do repositório</Label>
          <Input id="rn" value={name} onChange={e => setName(e.target.value.replace(/[^\w.-]/g, "-"))} placeholder="novo-projeto" autoFocus maxLength={100} />
          <Visibility />
          <Button disabled={busy || !name.trim()}>{busy && <Loader2 className="animate-spin" />}Criar repositório vazio</Button>
        </form>}
        {step === "git-existing" && <div className="grid gap-2"><Back />
          <Input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Buscar repositório…" />
          {repos.isLoading && <Loader2 className="mx-auto animate-spin" />}
          {repos.isError && <p className="text-sm text-destructive">Conecte o GitHub em Configurações → API.</p>}
          <div className="max-h-72 space-y-1 overflow-y-auto">
            {(repos.data ?? []).filter(r => r.full_name.toLowerCase().includes(filter.toLowerCase())).map(r => (
              <button key={r.id} disabled={busy} onClick={() => fromRepo(r.full_name, "git")} className="flex w-full items-center gap-2 rounded-md border border-border px-3 py-2 text-left hover:bg-accent disabled:opacity-50">
                {r.private ? <Lock className="h-3.5 w-3.5 text-muted-foreground" /> : <Globe className="h-3.5 w-3.5 text-muted-foreground" />}
                <span className="truncate font-mono text-sm">{r.full_name}</span>
              </button>))}
          </div>
          {busy && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Importando arquivos…</p>}
        </div>}
        {step === "zip" && <div className="grid gap-3"><Back />
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed border-border p-8 text-center hover:border-primary/60">
            {busy ? <Loader2 className="animate-spin" /> : <FileArchive className="h-8 w-8 text-primary" />}
            <span className="text-sm">{busy ? "Lendo arquivos…" : "Clique para escolher o .zip"}</span>
            <input type="file" accept=".zip" className="sr-only" disabled={busy} onChange={e => { const f = e.target.files?.[0]; if (f) onZip(f); }} />
          </label>
        </div>}
      </DialogContent>
    </Dialog>
  );
}
