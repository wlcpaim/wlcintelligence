import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
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
import { geminiQuery } from "../queries";
import {
  addGeminiKeysBulk,
  updateGeminiKey,
  toggleGeminiKey,
  makePrimaryGeminiKey,
  deleteGeminiKey,
  diagnoseGeminiKey,
} from "../functions/gemini.functions";
import type { GeminiKeyView } from "../types";
import { parseKeys } from "../parse-keys";
import { Textarea } from "@/components/ui/textarea";
import { GoogleMono } from "@/components/GoogleMono";

type Form = { id?: string; label: string; google_project: string; model: string; apiKey: string };
const err = (e: unknown) => toast.error(e instanceof Error ? e.message : String(e));

export function GeminiManager() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery(geminiQuery);
  const [form, setForm] = useState<Form | null>(null);
  const [report, setReport] = useState<{ key: string; r: DiagnosticReport } | null>(null);
  const [confirmDel, setConfirmDel] = useState<GeminiKeyView | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["integrations"] });
  const act = useMutation({
    mutationFn: (f: () => Promise<unknown>) => f(),
    onSuccess: refresh,
    onError: err,
  });
  const [bulk, setBulk] = useState<string | null>(null);
  const detected = bulk ? parseKeys(bulk) : [];
  const addBulk = useMutation({
    mutationFn: async (keys: string[]) => {
      const { ids } = await addGeminiKeysBulk({ data: { keys } });
      const results = await Promise.all(
        ids.map((id) => diagnoseGeminiKey({ data: { id } }).then((r) => r.ok, () => false)),
      );
      return { total: ids.length, ok: results.filter(Boolean).length };
    },
    onSuccess: ({ total, ok }) => {
      toast.success(`${total} chave(s) adicionada(s) · ${ok} funcionando`);
      setBulk(null);
      refresh();
    },
    onError: (e) => {
      err(e);
      refresh();
    },
  });
  const save = useMutation({
    mutationFn: async (f: Form): Promise<unknown> => {
      if (!f.id) throw new Error("Chave não encontrada.");
      return updateGeminiKey({ data: { id: f.id, label: f.label, google_project: f.google_project, model: f.model } });
    },
    onSuccess: () => {
      toast.success("Chave salva");
      setForm(null);
      refresh();
    },
    onError: err,
  });
  const diag = useMutation({
    mutationFn: (k: GeminiKeyView) => diagnoseGeminiKey({ data: { id: k.id } }),
    onSuccess: (r, k) => {
      setReport({ key: k.label, r });
      refresh();
    },
    onError: err,
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  if (error || !data) return <p className="text-sm text-destructive">{error?.message ?? "Erro"}</p>;
  const keyName = (id: string | null) => data.keys.find((k) => k.id === id)?.label ?? "—";

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-start gap-2">
          <GoogleMono className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
          <h2 className="font-semibold">Chaves Google Gemini</h2>
          <p className="text-xs text-muted-foreground">
            A principal é usada primeiro; as reservas entram em erros recuperáveis.
          </p>
          </div>
        </div>
        <Button onClick={() => setBulk("")}>Adicionar chaves</Button>
      </div>
      {data.keys.length === 0 && (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Nenhuma chave cadastrada. O chat precisa de pelo menos uma.
          </CardContent>
        </Card>
      )}
      {data.keys.map((k) => (
        <Card key={k.id}>
          <CardContent className="space-y-3 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{k.label}</span>
              {k.is_primary && k.status === "connected" ? (
                <span className="rounded bg-primary/10 px-1.5 text-xs text-primary">Principal</span>
              ) : (
                <span className="rounded bg-muted px-1.5 text-xs">Reserva</span>
              )}
              <StateBadge state={k.enabled ? k.status : "disabled"} />
              <div className="ml-auto flex items-center gap-2 text-xs">
                <span>Ativa</span>
                <Switch
                  checked={k.enabled}
                  onCheckedChange={(v) =>
                    act.mutate(() => toggleGeminiKey({ data: { id: k.id, enabled: v } }))
                  }
                />
              </div>
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
              <div>
                <dt className="text-muted-foreground">Projeto Google</dt>
                <dd>{k.google_project || "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Modelo</dt>
                <dd className="font-mono">{k.model}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Chave</dt>
                <dd className="font-mono">{k.key_hint}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Conectada em</dt>
                <dd>{fmtDate(k.created_at)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Última verificação</dt>
                <dd>{fmtDate(k.last_checked_at)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Último uso</dt>
                <dd>{fmtDate(k.last_used_at)}</dd>
              </div>
            </dl>
            {k.last_error && <p className="break-words text-xs text-destructive">{k.last_error}</p>}
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={diag.isPending}
                onClick={() => diag.mutate(k)}
              >
                {diag.isPending && diag.variables?.id === k.id ? "Testando…" : "Diagnosticar"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setForm({
                    id: k.id,
                    label: k.label,
                    google_project: k.google_project,
                    model: k.model,
                    apiKey: "",
                  })
                }
              >
                Editar
              </Button>
              {!k.is_primary && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => act.mutate(() => makePrimaryGeminiKey({ data: { id: k.id } }))}
                >
                  Tornar principal
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive"
                onClick={() => setConfirmDel(k)}
              >
                Excluir
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
      <section>
        <h3 className="mb-2 text-sm font-semibold">Histórico técnico</h3>
        {data.runs.length === 0 ? (
          <p className="text-xs text-muted-foreground">Sem execuções registradas.</p>
        ) : (
          <ul className="divide-y rounded-lg border text-xs">
            {data.runs.map((r) => (
              <li key={r.id} className="flex flex-wrap gap-x-3 p-2">
                <span className={r.ok ? "text-primary" : "text-destructive"}>
                  {r.ok ? "OK" : "Falha"}
                </span>
                <span>{r.kind === "chat" ? "Chat" : "Diagnóstico"}</span>
                <span>{keyName(r.key_id)}</span>
                {r.http_status && <span>HTTP {r.http_status}</span>}
                <span className="ml-auto text-muted-foreground">{fmtDate(r.created_at)}</span>
                {r.detail && (
                  <span className="w-full break-words text-muted-foreground">{r.detail}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {form?.id ? "Editar identificação" : "Adicionar chave Gemini"}
            </DialogTitle>
          </DialogHeader>
          {form && (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                save.mutate(form);
              }}
            >
              <div className="space-y-1">
                <Label htmlFor="gl">Nome</Label>
                <Input
                  id="gl"
                  required
                  maxLength={80}
                  value={form.label}
                  onChange={(e) => setForm({ ...form, label: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="gp">Projeto Google</Label>
                <Input
                  id="gp"
                  maxLength={120}
                  placeholder="ex.: wlc-ia-prod"
                  value={form.google_project}
                  onChange={(e) => setForm({ ...form, google_project: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="gm">Modelo</Label>
                <Input
                  id="gm"
                  required
                  value={form.model}
                  onChange={(e) => setForm({ ...form, model: e.target.value })}
                />
              </div>
              {!form.id && (
                <div className="space-y-1">
                  <Label htmlFor="gk">Chave de API</Label>
                  <Input
                    id="gk"
                    type="password"
                    autoComplete="off"
                    required
                    minLength={20}
                    value={form.apiKey}
                    onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                  />
                  <p className="text-xs text-muted-foreground">
                    Criptografada no servidor. Depois de salva, só o final fica visível.
                  </p>
                </div>
              )}
              <DialogFooter>
                <Button type="submit" disabled={save.isPending}>
                  {save.isPending ? "Salvando…" : "Salvar"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={bulk !== null} onOpenChange={(o) => !o && !addBulk.isPending && setBulk(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adicionar chaves Gemini</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (detected.length) addBulk.mutate(detected);
            }}
          >
            <Label htmlFor="gk-bulk">Cole uma ou várias chaves (uma por linha)</Label>
            <Textarea
              id="gk-bulk"
              rows={8}
              autoComplete="off"
              spellCheck={false}
              className="font-mono text-xs"
              placeholder="AQ.…"
              value={bulk ?? ""}
              onChange={(e) => setBulk(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {detected.length} chave(s) detectada(s). O nome é automático; a primeira vira
              principal e as outras ficam de reserva. Cada uma é testada ao salvar.
            </p>
            <DialogFooter>
              <Button type="submit" disabled={addBulk.isPending || detected.length === 0}>
                {addBulk.isPending ? "Adicionando e testando…" : `Adicionar ${detected.length}`}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={!!report} onOpenChange={(o) => !o && setReport(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Diagnóstico · {report?.key}</DialogTitle>
          </DialogHeader>
          {report && <DiagnosticResult report={report.r} />}
        </DialogContent>
      </Dialog>
      <Dialog open={!!confirmDel} onOpenChange={(o) => !o && setConfirmDel(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir “{confirmDel?.label}”?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            A chave criptografada será apagada permanentemente.
          </p>
          <DialogFooter>
            <Button
              variant="destructive"
              onClick={() => {
                const k = confirmDel;
                setConfirmDel(null);
                if (k) act.mutate(() => deleteGeminiKey({ data: { id: k.id } }));
              }}
            >
              Excluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
