import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { GitBranch, Github, FileCode2, Loader2, Search, Unplug, CheckCircle2 } from "lucide-react";
import { RepoTree } from "./RepoTree";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
  SheetTrigger,
} from "@/components/ui/sheet";
import { githubQuery, githubReposQuery } from "../queries";
import { prepareRepository } from "../functions/repository.functions";
import type { RepositoryPreview } from "../repository";

export function ChatGitMenu({
  attached,
  onAttach,
  onDetach,
  streaming,
  selected,
  onToggleFile,
  analyzed,
}: {
  selected: string[];
  onToggleFile: (path: string) => void;
  analyzed: boolean;
  attached: RepositoryPreview | null;
  onAttach: (preview: RepositoryPreview) => void;
  onDetach: () => void;
  streaming: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [loadingRepo, setLoadingRepo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const account = useQuery({ ...githubQuery, enabled: open });
  const repos = useQuery({ ...githubReposQuery, enabled: open && !!account.data?.account });
  const prepare = useServerFn(prepareRepository);
  const busy = !!loadingRepo || streaming;
  async function attach(repo: string) {
    if (busy) return;
    setLoadingRepo(repo);
    setError(null);
    try {
      const result = await prepare({ data: { repo } });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (!result.preview.files.some((f) => f.status === "included")) {
        setError("Nenhum arquivo de código disponível para análise.");
        return;
      }
      onAttach(result.preview);
    } catch {
      setError("Não foi possível conectar o repositório. Tente novamente.");
    } finally {
      setLoadingRepo(null);
    }
  }
  const filtered =
    repos.data?.filter((r) => r.full_name.toLowerCase().includes(search.toLowerCase())) ?? [];
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant={attached ? "secondary" : "ghost"} size="sm" aria-label="Abrir menu Git">
          <Github />
          Git
          {analyzed && (
            <span className="flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-xs font-medium text-success">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Repositório lido
            </span>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent
        side="left"
        className="flex w-[min(360px,90vw)] max-w-none flex-col gap-4 p-4 sm:max-w-none"
      >
        <div className="pr-7">
          <SheetTitle className="flex items-center gap-2">
            <Github className="h-5 w-5" />
            Git
          </SheetTitle>
          <SheetDescription>Repositórios</SheetDescription>
        </div>
        {(account.isPending || repos.isFetching) && (
          <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando repositórios…
          </div>
        )}
        {(account.isError || repos.isError) && (
          <div role="alert" className="text-sm text-destructive">
            Não foi possível carregar sua conexão GitHub.
            <Button
              variant="link"
              onClick={() => {
                void account.refetch();
                void repos.refetch();
              }}
            >
              Tentar novamente
            </Button>
          </div>
        )}
        {!account.isPending && !account.isError && !account.data?.account && (
          <Button asChild variant="outline">
            <Link to="/settings/github">
              <Github />
              Conectar GitHub
            </Link>
          </Button>
        )}
        {attached && (
          <div className="space-y-2 border-b pb-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="break-all text-sm font-medium">{attached.ref.repo}</p>
                <p className="mt-1 font-mono text-xs text-muted-foreground">
                  {attached.ref.commit.slice(0, 12)}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Desconectar repositório do chat"
                title="Desconectar repositório do chat"
                onClick={onDetach}
                disabled={busy}
              >
                <Unplug />
              </Button>
            </div>
            <p className="text-xs text-success">
              {attached.files.filter((f) => f.status === "included").length} arquivos incluídos
            </p>
            {attached.files.some((f) => f.status === "excluded") && (
              <p className="text-xs text-warning">
                {attached.files.filter((f) => f.status === "excluded").length} arquivos não
                incluídos
              </p>
            )}
            {attached.truncated && (
              <p role="alert" className="text-xs text-warning">
                O GitHub retornou uma estrutura incompleta.
              </p>
            )}
            <p className="flex items-center gap-1.5 text-sm font-medium text-success">
              <CheckCircle2 className="h-4 w-4" />
              Repositório vinculado
            </p>
            <p className="text-xs text-muted-foreground">
              Selecione arquivos para focar a próxima pergunta (opcional).
            </p>
            <div className="max-h-[45vh] overflow-auto rounded-md border p-1">
              <RepoTree files={attached.files} selected={selected} onToggle={onToggleFile} />
            </div>
          </div>
        )}
        {account.data?.account && (
          <>
            <div className="relative">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                aria-label="Buscar repositório"
                placeholder="Buscar repositório"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {filtered.map((repo) => (
                <Button
                  key={repo.id}
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void attach(repo.full_name)}
                  className="mb-1 h-auto min-h-16 w-full justify-start whitespace-normal px-2 py-3 text-left"
                >
                  {loadingRepo === repo.full_name ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <FileCode2 />
                  )}
                  <span className="min-w-0">
                    <span className="block break-all text-sm">{repo.full_name}</span>
                    <span className="mt-1 flex items-center gap-1 text-xs font-normal text-muted-foreground">
                      <GitBranch className="h-3 w-3" />
                      {repo.default_branch} · {repo.private ? "Privado" : "Público"}
                    </span>
                  </span>
                </Button>
              ))}
              {!repos.isFetching && !repos.isError && !filtered.length && (
                <p className="py-4 text-sm text-muted-foreground">Nenhum repositório encontrado.</p>
              )}
            </div>
          </>
        )}
        {loadingRepo && (
          <p role="status" className="text-sm text-muted-foreground">
            Lendo estrutura e arquivos…
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </SheetContent>
    </Sheet>
  );
}
