import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { StateBadge, fmtDate } from "../../shared/components/StateBadge";
import { DiagnosticResult } from "../../shared/components/DiagnosticResult";
import type { DiagnosticReport } from "../../core/types";
import { githubQuery, githubReposQuery } from "../queries";
import {
  connectGithub,
  disconnectGithub,
  refreshGithubAccount,
  selectDefaultRepo,
  diagnoseGithubConnection,
} from "../functions/github.functions";

const err = (e: unknown) => toast.error(e instanceof Error ? e.message : String(e));

export function GithubManager() {
  const qc = useQueryClient();
  const st = useQuery(githubQuery);
  const acc = st.data?.account;
  const repos = useQuery({ ...githubReposQuery, enabled: !!acc });
  const [connectOpen, setConnectOpen] = useState(false);
  const [token, setToken] = useState("");
  const [report, setReport] = useState<DiagnosticReport | null>(null);
  const [confirmOff, setConfirmOff] = useState(false);
  const [filter, setFilter] = useState("");
  const refresh = () => qc.invalidateQueries({ queryKey: ["integrations"] });

  const connect = useMutation({
    mutationFn: () => connectGithub({ data: { token } }),
    onSuccess: (r) => {
      if (r.ok) {
        toast.success(`Conectado como @${r.login}`);
        setConnectOpen(false);
        setToken("");
        refresh();
      } else toast.error(r.error);
    },
    onError: err,
  });
  const verify = useMutation({
    mutationFn: () => refreshGithubAccount(),
    onSuccess: (r) => {
      if (r.ok) toast.success("Conta verificada");
      else toast.error(r.error ?? "Falha");
      refresh();
    },
    onError: err,
  });
  const diag = useMutation({
    mutationFn: () => diagnoseGithubConnection(),
    onSuccess: (r) => {
      setReport(r);
      refresh();
    },
    onError: err,
  });
  const off = useMutation({
    mutationFn: () => disconnectGithub(),
    onSuccess: () => {
      toast.success("Conta desconectada");
      qc.removeQueries({ queryKey: ["integrations", "github", "repos"] });
      refresh();
    },
    onError: err,
  });
  const pick = useMutation({
    mutationFn: (repo: string) => selectDefaultRepo({ data: { repo } }),
    onSuccess: () => {
      toast.success("Repositório padrão definido");
      refresh();
    },
    onError: err,
  });

  if (st.isLoading) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  if (st.error) return <p className="text-sm text-destructive">{st.error.message}</p>;

  const connectDialog = (
    <Dialog open={connectOpen} onOpenChange={setConnectOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Conectar conta GitHub</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            connect.mutate();
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="ght">Personal Access Token</Label>
            <Input
              id="ght"
              type="password"
              autoComplete="off"
              required
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="github_pat_… ou ghp_…"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Crie em GitHub → Settings → Developer settings → Personal access tokens. O token é
            validado na API e guardado criptografado só no servidor.
          </p>
          <DialogFooter>
            <Button type="submit" disabled={connect.isPending}>
              {connect.isPending ? "Validando…" : "Conectar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );

  if (!acc)
    return (
      <div className="mx-auto max-w-xl">
        <Card>
          <CardContent className="space-y-3 p-6 text-center">
            <p className="font-medium">Nenhuma conta GitHub conectada</p>
            <p className="text-sm text-muted-foreground">
              Conecte para listar repositórios e verificar permissões reais.
            </p>
            <Button onClick={() => setConnectOpen(true)}>Conectar conta</Button>
          </CardContent>
        </Card>
        {connectDialog}
      </div>
    );

  const list = (repos.data ?? []).filter((r) =>
    r.full_name.toLowerCase().includes(filter.toLowerCase()),
  );
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <Avatar className="h-12 w-12">
              {acc.avatar_url && <AvatarImage src={acc.avatar_url} alt="" />}
              <AvatarFallback>GH</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="font-medium">{acc.display_name ?? acc.login}</p>
              {acc.html_url && (
                <a
                  href={acc.html_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-primary hover:underline"
                >
                  @{acc.login}
                </a>
              )}
            </div>
            <StateBadge state={acc.status} />
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
            <div>
              <dt className="text-muted-foreground">ID da conta</dt>
              <dd>{acc.account_id ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">E-mail</dt>
              <dd className="truncate">{acc.email ?? "Não autorizado/privado"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Autenticação</dt>
              <dd>
                Personal Access Token · <span className="font-mono">{acc.token_hint}</span>
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Permissões (scopes)</dt>
              <dd className="break-words">{acc.scopes || "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Validade do token</dt>
              <dd>
                {acc.token_expires_at ? fmtDate(acc.token_expires_at) : "Sem expiração informada"}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Conectado em</dt>
              <dd>{fmtDate(acc.connected_at)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Última verificação</dt>
              <dd>{fmtDate(acc.last_checked_at)}</dd>
            </div>
          </dl>
          {acc.last_error && (
            <p className="break-words text-xs text-destructive">{acc.last_error}</p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={diag.isPending}
              onClick={() => diag.mutate()}
            >
              {diag.isPending ? "Testando…" : "Diagnosticar"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={verify.isPending}
              onClick={() => verify.mutate()}
            >
              Verificar conexão
            </Button>
            <Button size="sm" variant="outline" onClick={() => setConnectOpen(true)}>
              Renovar token
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive"
              onClick={() => setConfirmOff(true)}
            >
              Desconectar
            </Button>
          </div>
        </CardContent>
      </Card>

      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">
            Repositórios autorizados {repos.data && `(${repos.data.length})`}
          </h3>
          <Input
            className="h-8 w-56"
            placeholder="Filtrar…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
        {repos.isLoading && (
          <p className="text-xs text-muted-foreground">Carregando repositórios…</p>
        )}
        {repos.error && <p className="text-xs text-destructive">{repos.error.message}</p>}
        <ul className="divide-y rounded-lg border">
          {list.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2 p-3 text-sm">
              <div className="min-w-0 flex-1">
                <a
                  href={r.html_url}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium hover:underline"
                >
                  {r.full_name}
                </a>
                <p className="truncate text-xs text-muted-foreground">
                  {r.description ?? "Sem descrição"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {r.private ? "Privado" : "Público"} · branch {r.default_branch} ·{" "}
                  {r.permissions.admin
                    ? "admin"
                    : r.permissions.push
                      ? "leitura e escrita"
                      : r.permissions.pull
                        ? "somente leitura"
                        : "sem permissão informada"}
                </p>
              </div>
              {st.data?.selected === r.full_name ? (
                <span className="text-xs font-medium text-primary">Padrão</span>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pick.isPending}
                  onClick={() => pick.mutate(r.full_name)}
                >
                  Definir padrão
                </Button>
              )}
            </li>
          ))}
        </ul>
      </section>

      {connectDialog}
      <Dialog open={!!report} onOpenChange={(o) => !o && setReport(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Diagnóstico GitHub</DialogTitle>
          </DialogHeader>
          {report && <DiagnosticResult report={report} />}
        </DialogContent>
      </Dialog>
      <Dialog open={confirmOff} onOpenChange={setConfirmOff}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Desconectar GitHub?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            O token criptografado e o repositório padrão serão apagados.
          </p>
          <DialogFooter>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirmOff(false);
                off.mutate();
              }}
            >
              Desconectar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
