import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ChevronDown, ChevronRight, Code2, FilePlus, GitCommitHorizontal, Github, Loader2, Trash2, X, Check, Circle, Lock, Globe, PanelLeft, PanelsTopLeft, Rocket, ExternalLink, RefreshCw, Sparkles, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { fileType, normalizePath, isChanged } from "@/modules/code/file-types";
import { commitProject, linkNewRepo, pullRepoProject, generateCommitMessage } from "@/modules/code/functions/code.functions";
import { deployProject, deployStatus, repairFailedDeploy } from "@/modules/integrations/cloudflare/functions/cloudflare.functions";
import { STAGE_LABEL } from "@/modules/integrations/cloudflare/build";
import { CopilotPanel } from "@/modules/code/components/CopilotPanel";
import { extractZipEntries, computeZipDiff } from "@/modules/code/services/zip-diff";

const CodeEditor = lazy(() => import("@/modules/code/components/CodeEditor"));

export const Route = createFileRoute("/_authenticated/code/$projectId")({
  head: () => ({ meta: [
    { title: "Editor — WLC IA Code" }, { name: "description", content: "Editor de código profissional da WLC IA." },
    { property: "og:title", content: "Editor — WLC IA Code" }, { property: "og:description", content: "Edite e faça commit dos seus projetos." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }),
  component: EditorPage,
});

interface CFile { id: string; path: string; content: string; base_content: string | null; deleted: boolean; updated_at: string }
type Node = { name: string; path: string; children?: Map<string, Node> };

function buildTree(files: CFile[]): Node {
  const root: Node = { name: "", path: "", children: new Map() };
  for (const f of files) {
    const parts = f.path.split("/");
    let cur = root;
    parts.forEach((part, i) => {
      const p = parts.slice(0, i + 1).join("/");
      if (!cur.children) return;
      if (!cur.children.has(part)) cur.children.set(part, i === parts.length - 1 ? { name: part, path: p } : { name: part, path: p, children: new Map() });
      const next = cur.children.get(part);
      if (next) cur = next;
    });
  }
  return root;
}

function FileBadge({ path }: { path: string }) {
  const t = fileType(path);
  return <span className="w-7 shrink-0 text-center font-mono text-[9px] font-bold" style={{ color: t.color }}>{t.label}</span>;
}

function EditorPage() {
  const { projectId } = Route.useParams();
  const qc = useQueryClient();
  const project = useQuery({ queryKey: ["code-project", projectId], queryFn: async () => { const { data, error } = await supabase.from("code_projects").select("*").eq("id", projectId).single(); if (error) throw error; return data; } });
  const p = project.data;
  const [files, setFiles] = useState<CFile[] | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [tabs, setTabs] = useState<string[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [newFile, setNewFile] = useState<string | null>(null);
  const [commitOpen, setCommitOpen] = useState(false);
  const [explorerOpen, setExplorerOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [stage, setStage] = useState<string | null>(null);
  const [uploadingZip, setUploadingZip] = useState(false);
  const zipInputRef = useRef<HTMLInputElement>(null);
  const deploy = useServerFn(deployProject);
  const status = useServerFn(deployStatus);
  const repairDeploy = useServerFn(repairFailedDeploy);
  const pull = useServerFn(pullRepoProject);
  const reloadFiles = async () => {
    const { data } = await supabase.from("code_files").select("id,path,content,base_content,deleted,updated_at").eq("project_id", projectId).order("path");
    if (data) setFiles(data);
  };
  useEffect(() => {
    const handleReload = () => {
      void reloadFiles();
      void qc.invalidateQueries({ queryKey: ["code-project", projectId] });
    };
    const handleOpenCommit = () => {
      void flush().then(() => setCommitOpen(true)).catch(() => setCommitOpen(true));
    };
    window.addEventListener("wlc-reload-files", handleReload);
    window.addEventListener("wlc-open-commit-dialog", handleOpenCommit);
    return () => {
      window.removeEventListener("wlc-reload-files", handleReload);
      window.removeEventListener("wlc-open-commit-dialog", handleOpenCommit);
    };
  }, [projectId]);

  const syncFiles = async () => {
    const { data } = await supabase.from("code_files").select("id,path,content,base_content,deleted,updated_at").eq("project_id", projectId).order("path");
    if (data) setFiles(data);
  };
  const synchronize = async () => {
    setSyncing(true);
    try {
      if (p?.repo_full_name) {
        const r = await pull({ data: { projectId } });
        if (!r.ok) { toast.error(r.error); return; }
        toast.success("Sincronizado com o GitHub");
      }
      await reloadFiles();
      qc.invalidateQueries({ queryKey: ["code-project", projectId] });
    } finally {
      setSyncing(false);
    }
  };
  const runDeploy = async () => {
    setDeploying(true); setStage("Enviando ao GitHub");
    try {
      await flush();
      const r = await deploy({ data: { projectId } });
      if (!r.ok) { toast.error(r.error, { duration: 12000 }); return; }
      if (r.committed > 0) await reloadFiles();
      qc.invalidateQueries({ queryKey: ["code-project", projectId] });
      const started = Date.now();
      let deploymentId = r.deploymentId;
      while (Date.now() - started < 20 * 60_000) {
        await new Promise(res => setTimeout(res, 5000));
        const s = await status({ data: { cfProject: r.cfProject, deploymentId } });
        if (!s.ok) { toast.error(s.error); return; }
        setStage(STAGE_LABEL[s.stage] ?? "Compilando");
        if (s.state === "success") {
          await reloadFiles();
          await qc.invalidateQueries({ queryKey: ["code-project", projectId] });
          toast.success("Publicação concluída; funcionamento ainda precisa ser validado", { action: { label: "Abrir", onClick: () => window.open(s.url || r.url, "_blank") } });
          return;
        }
        if (s.state === "failure") {
          setStage("Corrigindo falha com segurança");
          const fixed = await repairDeploy({ data: { projectId, deploymentId, rootId: r.deploymentId } });
          if (fixed.ok && fixed.state === "retry" && fixed.deploymentId) { deploymentId = fixed.deploymentId; await reloadFiles(); continue; }
          if (fixed.ok && fixed.state === "running") { setStage("Correção em andamento"); continue; }
          if (!fixed.ok) toast.error(fixed.error);
          else toast.message(fixed.message, { duration: 12000 });
          toast.error(`O build falhou na etapa "${STAGE_LABEL[s.stage] ?? s.stage}"`, { description: (s.logs.filter(l => /error|failed|cannot|not found/i.test(l)).slice(-6).join("\n") || s.logs.slice(-6).join("\n")) || "Veja os detalhes no painel da Cloudflare.", duration: 20000 });
          return;
        }
      }
      toast.message("O build continua na Cloudflare. Abra o site em alguns minutos.");
    } catch { toast.error("Não foi possível publicar."); } finally { setDeploying(false); setStage(null); }
  };
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const writes = useRef(new Map<string, Promise<void>>());
  const filesRef = useRef(files);
  filesRef.current = files;

  useEffect(() => {
    let alive = true;
    (async () => {
      const all: CFile[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase.from("code_files").select("id,path,content,base_content,deleted,updated_at").eq("project_id", projectId).order("path").range(from, from + 999);
        if (error) { toast.error(error.message); break; }
        all.push(...data); if (data.length < 1000) break;
      }
      if (alive) setFiles(all);
    })();
    return () => { alive = false; };
  }, [projectId]);

  const visible = useMemo(() => (files ?? []).filter(f => !f.deleted), [files]);
  const tree = useMemo(() => buildTree(visible), [visible]);
  const pending = useMemo(() => (files ?? []).filter(isChanged).sort((a, b) => a.updated_at.localeCompare(b.updated_at)), [files]);
  const current = visible.find(f => f.path === active) ?? null;

  const persist = useCallback((id: string, content: string): Promise<void> => {
    setSaving("saving");
    const previous = writes.current.get(id) ?? Promise.resolve();
    const write = previous.catch(() => {}).then(async () => {
      const { error } = await supabase.from("code_files").update({ content, updated_at: new Date().toISOString() }).eq("id", id);
      setSaving(error ? "error" : "saved");
      if (error) throw new Error("Não foi possível salvar o arquivo.");
    });
    writes.current.set(id, write);
    void write.catch(() => { setSaving("error"); });
    return write;
  }, []);

  const flush = useCallback(async () => {
    for (const [id, t] of timers.current) { clearTimeout(t); const f = filesRef.current?.find(x => x.id === id); if (f) void persist(id, f.content); }
    timers.current.clear();
    await Promise.all(writes.current.values());
  }, [persist]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); void flush().catch(() => toast.error("Não foi possível salvar.")); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flush]);
  useEffect(() => () => { for (const t of timers.current.values()) clearTimeout(t); }, []);

  const onEdit = (value: string) => {
    if (!current) return;
    const id = current.id;
    const now = new Date().toISOString();
    setFiles(fs => (fs ?? []).map(f => f.id === id ? { ...f, content: value, updated_at: now } : f));
    setSaving("saving");
    const prev = timers.current.get(id); if (prev) clearTimeout(prev);
    timers.current.set(id, setTimeout(() => { timers.current.delete(id); void persist(id, value).catch(() => {}); }, 700));
  };

  const openFile = (path: string) => { setTabs(t => t.includes(path) ? t : [...t, path]); setActive(path); setEditorOpen(true); if (window.matchMedia("(max-width: 639px)").matches) setExplorerOpen(false); };
  const closeTab = (path: string) => { setTabs(t => { const n = t.filter(x => x !== path); if (active === path) setActive(n[n.length - 1] ?? null); return n; }); };

  const createFile = async (raw: string) => {
    const path = normalizePath(raw);
    if (!path) { toast.error("Caminho inválido"); return; }
    if (!files) return;
    const existing = files.find(f => f.path === path);
    if (existing && !existing.deleted) { toast.error("Arquivo já existe"); return; }
    if (existing) {
      const { error } = await supabase.from("code_files").update({ deleted: false, content: "", updated_at: new Date().toISOString() }).eq("id", existing.id);
      if (error) { toast.error(error.message); return; }
      setFiles(fs => (fs ?? []).map(f => f.id === existing.id ? { ...f, deleted: false, content: "" } : f));
    } else {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) { toast.error("Entre novamente para criar arquivos."); return; }
      const { data, error } = await supabase.from("code_files").insert({ project_id: projectId, user_id: u.user.id, path, content: "", base_content: null }).select("id,path,content,base_content,deleted,updated_at").single();
      if (error) { toast.error(error.message); return; }
      setFiles(fs => [...(fs ?? []), data].sort((a, b) => a.path.localeCompare(b.path)));
    }
    setOpen(o => { const n = new Set(o); path.split("/").slice(0, -1).forEach((_, i, a) => n.add(a.slice(0, i + 1).join("/"))); return n; });
    setNewFile(null); openFile(path);
  };

  const removeFile = async (f: CFile) => {
    if (!confirm(`Excluir ${f.path}?`)) return;
    const q = f.base_content === null ? supabase.from("code_files").delete().eq("id", f.id) : supabase.from("code_files").update({ deleted: true, updated_at: new Date().toISOString() }).eq("id", f.id);
    const { error } = await q;
    if (error) { toast.error(error.message); return; }
    setFiles(fs => f.base_content === null ? (fs ?? []).filter(x => x.id !== f.id) : (fs ?? []).map(x => x.id === f.id ? { ...x, deleted: true, updated_at: new Date().toISOString() } : x));
    closeTab(f.path);
  };

  /** Smart ZIP import: only create/update files that actually differ. Local-only files are preserved. */
  const handleZipUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset input so the same file can be selected again
    e.target.value = "";
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".zip") && file.type !== "application/zip" && file.type !== "application/x-zip-compressed") {
      toast.error("Selecione um arquivo .zip válido.");
      return;
    }
    if (!files) {
      toast.error("Aguarde o carregamento dos arquivos do projeto.");
      return;
    }

    setUploadingZip(true);
    try {
      await flush();

      const { entries, skippedJunk } = await extractZipEntries(file);
      if (entries.length === 0) {
        toast.error("O ZIP não contém arquivos de texto utilizáveis.");
        return;
      }

      const { toCreate, toUpdate, ignored } = computeZipDiff(entries, files);
      if (toCreate.length === 0 && toUpdate.length === 0) {
        toast.success(`Nenhuma alteração necessária (${ignored} arquivo${ignored === 1 ? "" : "s"} idêntico${ignored === 1 ? "" : "s"}).`);
        return;
      }

      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) {
        toast.error("Entre novamente para importar arquivos.");
        return;
      }

      const now = new Date().toISOString();
      const created: CFile[] = [];
      const updatedIds = new Set<string>();

      // Batch updates
      for (const item of toUpdate) {
        const { error } = await supabase
          .from("code_files")
          .update({ content: item.content, deleted: false, updated_at: now })
          .eq("id", item.id);
        if (error) {
          toast.error(`Falha ao atualizar ${item.path}: ${error.message}`);
          continue;
        }
        updatedIds.add(item.id);
      }

      // Batch inserts (in chunks to stay under typical payload limits)
      const CHUNK = 50;
      for (let i = 0; i < toCreate.length; i += CHUNK) {
        const chunk = toCreate.slice(i, i + CHUNK);
        const rows = chunk.map((item) => ({
          project_id: projectId,
          user_id: auth.user!.id,
          path: item.path,
          content: item.content,
          base_content: null as string | null,
        }));
        const { data, error } = await supabase
          .from("code_files")
          .insert(rows)
          .select("id,path,content,base_content,deleted,updated_at");
        if (error) {
          toast.error(`Falha ao criar arquivos: ${error.message}`);
          continue;
        }
        if (data) created.push(...data);
      }

      // Apply to local state
      setFiles((prev) => {
        const list = prev ?? [];
        const byId = new Map(list.map((f) => [f.id, f]));
        for (const item of toUpdate) {
          const existing = byId.get(item.id);
          if (existing) {
            byId.set(item.id, { ...existing, content: item.content, deleted: false, updated_at: now });
          }
        }
        for (const c of created) byId.set(c.id, c);
        return [...byId.values()].sort((a, b) => a.path.localeCompare(b.path));
      });

      const parts: string[] = [];
      if (created.length) parts.push(`${created.length} criado${created.length === 1 ? "" : "s"}`);
      if (updatedIds.size) parts.push(`${updatedIds.size} atualizado${updatedIds.size === 1 ? "" : "s"}`);
      if (ignored) parts.push(`${ignored} ignorado${ignored === 1 ? "" : "s"}`);
      if (skippedJunk) parts.push(`${skippedJunk} lixo filtrado`);
      toast.success(`ZIP aplicado: ${parts.join(", ")}.`);
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "Não foi possível processar o ZIP.");
    } finally {
      setUploadingZip(false);
    }
  };

  const renderNode = (node: Node, depth: number): React.ReactNode =>
    [...(node.children?.values() ?? [])].sort((a, b) => (a.children ? 0 : 1) - (b.children ? 0 : 1) || a.name.localeCompare(b.name)).map(n => {
      const pad = { paddingLeft: 8 + depth * 12 };
      if (n.children) {
        const isOpen = open.has(n.path);
        return <div key={n.path}>
          <Button variant="ghost" style={pad} className="flex h-6 w-full justify-start gap-1 rounded-none pr-1 text-left text-[13px] font-normal text-muted-foreground" onClick={() => setOpen(o => { const s = new Set(o); if (isOpen) s.delete(n.path); else s.add(n.path); return s; })}>
            {isOpen ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}<span className="truncate">{n.name}</span>
          </Button>
          {isOpen && renderNode(n, depth + 1)}
        </div>;
      }
      const f = visible.find(x => x.path === n.path);
      if (!f) return null;
      return <div key={n.path} style={pad} className={`group flex h-6 items-center pr-1 text-[13px] hover:bg-accent ${active === n.path ? "bg-accent text-foreground" : "text-muted-foreground"}`}>
        <Button variant="ghost" className="flex h-6 min-w-0 flex-1 justify-start gap-1 rounded-none p-0 text-left font-normal" onClick={() => openFile(n.path)}>
          <FileBadge path={n.path} /><span className={`truncate ${isChanged(f) ? "text-primary" : ""}`}>{n.name}</span>
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label={`Excluir ${n.name}`} className="h-5 w-5 text-muted-foreground hover:text-destructive md:opacity-0 md:group-hover:opacity-100" onClick={() => removeFile(f)}><Trash2 className="h-3 w-3" /></Button>
      </div>;
    });

  return (
    <div className="flex h-full flex-col bg-[var(--code-editor)] text-foreground">
      <header className="shrink-0 border-b border-border">
        {/* Linha 1 — ações principais: Commit + Deploy */}
        <div className="flex h-11 min-w-0 items-center gap-2 px-3">
          <Button asChild variant="ghost" size="icon-sm" aria-label="Projetos" className="shrink-0">
            <Link to="/code"><ArrowLeft /></Link>
          </Button>
          <Code2 className="hidden h-4 w-4 shrink-0 text-primary sm:block" />
          <span className="min-w-0 flex-1 truncate font-mono text-xs">
            <span className="text-muted-foreground">/</span>
            <span className="ml-1">{p?.name}</span>
            {p?.repo_full_name && (
              <span className="ml-2 hidden items-center gap-1 text-muted-foreground sm:inline-flex">
                <Github className="h-3 w-3" />{p.repo_full_name}:{p.branch}
              </span>
            )}
          </span>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              size="sm"
              className="h-8 gap-1.5 px-3"
              onClick={() => {
                void flush()
                  .then(() => setCommitOpen(true))
                  .catch(() => toast.error("Salve os arquivos antes do commit."));
              }}
            >
              <GitCommitHorizontal className="h-4 w-4" />
              Commit
              {pending.length > 0 && (
                <span className="rounded bg-primary-foreground/20 px-1.5 text-[11px]">{pending.length}</span>
              )}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 px-3"
              disabled={deploying}
              onClick={runDeploy}
            >
              {deploying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
              {deploying && stage ? <span className="max-w-28 truncate">{stage}…</span> : "Deploy"}
            </Button>
          </div>
        </div>

        {/* Linha 2 — visualizadores + ações secundárias menores */}
        <div className="flex h-9 min-w-0 items-center gap-1 border-t border-border/60 bg-muted/20 px-3">
          <div className="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon-sm"
              className="h-7 w-7"
              title={explorerOpen ? "Recolher explorador" : "Abrir explorador"}
              aria-label={explorerOpen ? "Recolher explorador" : "Abrir explorador"}
              aria-expanded={explorerOpen}
              onClick={() => setExplorerOpen(v => !v)}
            >
              <PanelLeft className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              className="h-7 w-7"
              title={editorOpen ? "Recolher editor de código" : "Abrir editor de código"}
              aria-label={editorOpen ? "Recolher editor de código" : "Abrir editor de código"}
              aria-expanded={editorOpen}
              onClick={() => setEditorOpen(v => !v)}
            >
              <PanelsTopLeft className="h-3.5 w-3.5" />
            </Button>
          </div>

          <div className="ml-auto flex items-center gap-1">
            <Button
              size="icon-sm"
              variant="ghost"
              className="h-7 w-7"
              disabled={syncing}
              onClick={synchronize}
              title="Atualizar / sincronizar com o GitHub"
              aria-label="Atualizar / sincronizar com o GitHub"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
            </Button>
            {p?.deploy_url ? (
              <Button
                asChild
                size="icon-sm"
                variant="ghost"
                className="h-7 w-7"
                title={p.deploy_url}
                aria-label="Abrir site publicado"
              >
                <a href={p.deploy_url} target="_blank" rel="noreferrer">
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </Button>
            ) : (
              <Button
                size="icon-sm"
                variant="ghost"
                className="h-7 w-7 opacity-40"
                disabled
                title="Publique com Deploy para liberar o link do site"
                aria-label="Site ainda não publicado"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </Button>
            )}
            <input
              ref={zipInputRef}
              type="file"
              accept=".zip,application/zip,application/x-zip-compressed"
              className="hidden"
              onChange={handleZipUpload}
            />
            <Button
              size="icon-sm"
              variant="ghost"
              className="h-7 w-7"
              disabled={uploadingZip || syncing || deploying}
              onClick={() => zipInputRef.current?.click()}
              title="Upload ZIP — aplicar alterações no projeto"
              aria-label="Upload ZIP"
            >
              {uploadingZip ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Upload className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>
        </div>
      </header>
      <div className="min-h-0 flex-1">
        {p ? <CopilotPanel key={projectId} projectId={projectId} ownerId={p.user_id} activePath={active} beforeSend={flush}
          onFocus={() => { setExplorerOpen(false); setEditorOpen(false); setNewFile(null); }}
          onApplied={file => {
            setFiles(fs => [...(fs ?? []).filter(f => f.path !== file.path), file].sort((a, b) => a.path.localeCompare(b.path)));
            setSaving("saved");
          }} overlay={<>
        {explorerOpen && <aside aria-label="Explorador de arquivos" className="absolute inset-y-0 left-0 z-20 flex w-56 max-w-full flex-col border-r border-border bg-sidebar shadow-lg md:w-64">
          <div className="flex h-8 items-center justify-between px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Explorador<Button variant="ghost" size="icon-sm" aria-label="Novo arquivo" title="Novo arquivo" onClick={() => setNewFile("")}><FilePlus className="h-4 w-4" /></Button>
          </div>
          {newFile !== null && <form className="px-2 pb-1" onSubmit={e => { e.preventDefault(); void createFile(newFile); }}>
            <Input autoFocus value={newFile} onChange={e => setNewFile(e.target.value)} onBlur={() => !newFile && setNewFile(null)} onKeyDown={e => e.key === "Escape" && setNewFile(null)} placeholder="src/index.ts" className="h-7 font-mono text-xs" />
          </form>}
          <div className="min-h-0 flex-1 overflow-y-auto pb-4">
            {files === null ? <Loader2 className="mx-auto mt-6 h-4 w-4 animate-spin" /> : visible.length === 0 ? <p className="px-3 py-4 text-xs text-muted-foreground">Projeto vazio. Crie o primeiro arquivo.</p> : renderNode(tree, 0)}
          </div>
        </aside>}
        {editorOpen && <section aria-label="Editor de código" className={`absolute inset-0 z-10 flex min-w-0 flex-col bg-[var(--code-editor)] ${explorerOpen ? "sm:left-56 md:left-64" : ""}`}>
          <div className="flex h-9 shrink-0 overflow-x-auto border-b border-border bg-sidebar">
            {tabs.map(t => <div key={t} className={`group flex shrink-0 items-center gap-1 border-r border-border px-3 text-xs ${t === active ? "border-t-2 border-t-primary bg-[var(--code-editor)] text-foreground" : "text-muted-foreground"}`}>
              <Button variant="ghost" className="h-8 gap-1 rounded-none p-0 text-xs font-normal" onClick={() => setActive(t)}><FileBadge path={t} />{t.split("/").pop()}</Button>
              <Button variant="ghost" size="icon-sm" aria-label="Fechar aba" className="h-6 w-6 opacity-60 hover:opacity-100" onClick={() => closeTab(t)}><X className="h-3 w-3" /></Button>
            </div>)}
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            {current ? <Suspense fallback={<Loader2 className="m-6 h-4 w-4 animate-spin" />}><CodeEditor key={current.id} path={current.path} value={current.content} onChange={onEdit} /></Suspense>
              : <div className="grid h-full place-items-center text-center text-sm text-muted-foreground"><div><Code2 className="mx-auto mb-3 h-10 w-10 opacity-40" />Abra um arquivo no explorador</div></div>}
          </div>
        </section>}
        </>} /> : <Loader2 className="m-6 h-4 w-4 animate-spin" />}
      </div>
      <footer className="flex h-6 shrink-0 items-center gap-2 border-t border-border bg-primary/10 px-3 font-mono text-[10px] text-muted-foreground sm:gap-4 sm:text-[11px]">
        <span className="flex items-center gap-1">{saving === "saving" ? <><Loader2 className="h-3 w-3 animate-spin" />Salvando…</> : saving === "error" ? <span className="text-destructive">Erro ao salvar</span> : <><Check className="h-3 w-3 text-primary" />Salvo automaticamente</>}</span>
        <span className="flex items-center gap-1"><Circle className="h-2 w-2 fill-current" />{pending.length} alteração(ões) pendente(s)</span>
        {current && <span className="ml-auto" style={{ color: fileType(current.path).color }}>{fileType(current.path).label}</span>}
      </footer>
      {p && <CommitDialog open={commitOpen} onOpenChange={setCommitOpen} project={p} pending={pending} onDone={async (commitInfo?: { sha: string; count: number; backupId?: string | null; message: string }) => {
        await reloadFiles();
        qc.invalidateQueries({ queryKey: ["code-project", projectId] }); qc.invalidateQueries({ queryKey: ["code-projects"] });
        if (commitInfo) {
          const event = new CustomEvent("wlc-commit-success", { detail: commitInfo });
          window.dispatchEvent(event);
        }
      }} />}
    </div>
  );
}

function CommitDialog({ open, onOpenChange, project, pending, onDone }: {
  open: boolean; onOpenChange: (o: boolean) => void; project: { id: string; name: string; repo_full_name: string | null };
  pending: CFile[]; onDone: (info?: { sha: string; count: number; backupId?: string | null; message: string }) => Promise<void>;
}) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [repoName, setRepoName] = useState(project.name.replace(/[^\w.-]/g, "-"));
  const [priv, setPriv] = useState(true);
  const commit = useServerFn(commitProject);
  const link = useServerFn(linkNewRepo);
  const genMsg = useServerFn(generateCommitMessage);
  const qc = useQueryClient();

  const status = (f: CFile) => f.deleted ? { l: "D", c: "text-destructive" } : f.base_content === null ? { l: "A", c: "text-primary" } : { l: "M", c: "text-[var(--code-json)]" };

  const handleAutoGenerate = async () => {
    if (generating) return;
    setGenerating(true);
    try {
      const res = await genMsg({ data: { projectId: project.id } });
      if (res.ok) {
        setMessage(res.message);
      }
    } finally {
      setGenerating(false);
    }
  };

  useEffect(() => {
    if (open && !message && pending.length > 0) {
      void handleAutoGenerate();
    }
  }, [open]);

  const doLink = async () => {
    setBusy(true);
    const r = await link({ data: { projectId: project.id, name: repoName, private: priv } });
    setBusy(false);
    if (!r.ok) { toast.error(r.error); return; }
    toast.success("Repositório vazio criado e vinculado");
    await qc.invalidateQueries({ queryKey: ["code-project", project.id] }); await onDone();
  };
  const doCommit = async () => {
    setBusy(true);
    await new Promise(r => setTimeout(r, 800));
    const trimmedMsg = message.trim();
    const r = await commit({ data: { projectId: project.id, message: trimmedMsg } });
    setBusy(false);
    if (!r.ok) { toast.error(r.error); return; }
    toast.success(`Commit ${r.sha.slice(0, 7)} enviado com ${r.count} arquivo(s)`);
    setMessage(""); onOpenChange(false); await onDone({ sha: r.sha, count: r.count, backupId: r.backupId ?? null, message: trimmedMsg });
  };

  return <Dialog open={open} onOpenChange={o => !busy && onOpenChange(o)}>
    <DialogContent className="max-w-lg">
      <DialogHeader><DialogTitle className="font-mono">Commit</DialogTitle>
        <DialogDescription>{project.repo_full_name ? `Envia as alterações para ${project.repo_full_name}, na ordem em que foram feitas.` : "Este projeto ainda não tem repositório."}</DialogDescription></DialogHeader>
      {!project.repo_full_name ? <div className="grid gap-3">
        <Input value={repoName} onChange={e => setRepoName(e.target.value.replace(/[^\w.-]/g, "-"))} placeholder="nome-do-repositorio" />
        <div className="grid grid-cols-2 gap-2">
          <Button variant={priv ? "default" : "outline"} onClick={() => setPriv(true)}><Lock />Privado</Button>
          <Button variant={!priv ? "default" : "outline"} onClick={() => setPriv(false)}><Globe />Público</Button>
        </div>
        <Button disabled={busy || !repoName} onClick={doLink}>{busy && <Loader2 className="animate-spin" />}Criar repositório vazio e vincular</Button>
      </div> : <>
        <div className="max-h-56 overflow-y-auto rounded-md border border-border">
          {pending.length === 0 ? <p className="p-3 text-sm text-muted-foreground">Nenhuma alteração pendente.</p> : pending.map((f, i) => { const s = status(f); return (
            <div key={f.id} className="flex items-center gap-2 border-b border-border px-3 py-1.5 font-mono text-xs last:border-0">
              <span className="w-4 text-muted-foreground">{i + 1}</span><span className={`w-3 font-bold ${s.c}`}>{s.l}</span><span className="truncate">{f.path}</span>
              <span className="ml-auto shrink-0 text-muted-foreground">{new Date(f.updated_at).toLocaleTimeString("pt-BR")}</span>
            </div>); })}
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Mensagem do commit</span>
            <Button size="sm" variant="ghost" className="h-6 gap-1 px-2 text-xs" disabled={generating || busy} onClick={handleAutoGenerate}>
              {generating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3 text-primary" />} Sugerir com IA
            </Button>
          </div>
          <Textarea value={message} onChange={e => setMessage(e.target.value)} placeholder="Descreva as alterações (ex.: feat: adiciona tela de login)" maxLength={500} rows={3} />
        </div>
        <DialogFooter><Button disabled={busy || !message.trim() || pending.length === 0} onClick={doCommit}>{busy && <Loader2 className="animate-spin" />}<GitCommitHorizontal />Fazer commit</Button></DialogFooter>
      </>}
    </DialogContent>
  </Dialog>;
}