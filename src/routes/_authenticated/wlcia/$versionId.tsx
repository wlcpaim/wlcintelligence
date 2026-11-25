import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowUp, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Markdown } from "@/components/chat/Markdown";
import { versionsQuery, trainingQuery } from "@/modules/versions/queries";
import { removeVersionRule, trainChatVersion } from "@/modules/versions/functions/versions.functions";
import { UploadVersionButton } from "@/modules/versions/components/VersionFileActions";

export const Route = createFileRoute("/_authenticated/wlcia/$versionId")({
  head: () => ({ meta: [
    { title: "Escola de treino — wlc.ia" }, { name: "description", content: "Treine uma versão da WLC IA com regras permanentes para o chat e o Copilot." },
    { property: "og:title", content: "Escola de treino — wlc.ia" }, { property: "og:description", content: "Treino permanente de versões da WLC IA." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }),
  loader: async ({ context, params }) => {
    await Promise.all([context.queryClient.ensureQueryData(versionsQuery), context.queryClient.ensureQueryData(trainingQuery(params.versionId))]);
  },
  component: TrainingPage,
});

function TrainingPage() {
  const { versionId } = Route.useParams();
  const { data: versions } = useSuspenseQuery(versionsQuery);
  const { data: history } = useSuspenseQuery(trainingQuery(versionId));
  const version = versions.find(v => v.id === versionId);
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [history.length, pending]);
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["chat-versions"] })]);
  const train = useMutation({ mutationFn: (message: string) => trainChatVersion({ data: { id: versionId, message } }),
    onMutate: m => { setPending(m); setText(""); },
    onSuccess: async (r, m) => {
      if (!r.ok) { toast.error(r.error); setText(m); }
      else {
        if (r.added) toast.success(`${r.added} regra${r.added > 1 ? "s" : ""} absorvida${r.added > 1 ? "s" : ""}.`);
        if (r.syncError) toast.warning(r.syncError);
      }
      await refresh(); setPending(null);
    }, onError: (e, m) => { toast.error(e.message); setText(m); setPending(null); } });
  const drop = useMutation({ mutationFn: (ruleId: string) => removeVersionRule({ data: { id: versionId, ruleId } }), onSuccess: refresh, onError: e => toast.error(e.message) });

  if (!version) return <div className="p-8"><p className="text-sm text-muted-foreground">Versão não encontrada.</p><Button asChild variant="link" className="px-0"><Link to="/wlcia">Voltar</Link></Button></div>;
  const send = () => { const m = text.trim(); if (m && !train.isPending) train.mutate(m); };

  return <div className="flex h-full min-h-0">
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border/60 px-3">
        <Button asChild variant="ghost" size="icon-sm" aria-label="Voltar às versões" title="Voltar"><Link to="/wlcia"><ArrowLeft /></Link></Button>
        <h1 className="truncate text-sm font-medium">{version.name}</h1>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto max-w-3xl space-y-6">
          {history.length === 0 && !pending && <div className="py-8 text-sm text-muted-foreground">
            <p className="mb-2 font-medium text-foreground">Ensine regras permanentes para {version.name}.</p>
            <p>Exemplo: “Sempre use TypeScript estrito. Nunca use any. Responda com exemplos curtos.” Cada regra vale no chat livre e no Copilot e é salva no repositório.</p>
          </div>}
          {history.map(m => <article key={m.id} className="min-w-0 break-words">
            <p className="mb-1 text-xs font-semibold text-muted-foreground">{m.role === "user" ? "Treinador" : "Supervisor de treino"}</p>
            <Markdown>{m.content}</Markdown>
          </article>)}
          {pending && <>
            <article><p className="mb-1 text-xs font-semibold text-muted-foreground">Treinador</p><Markdown>{pending}</Markdown></article>
            <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Absorvendo conhecimento…</p>
          </>}
          <div ref={end} />
        </div>
      </div>
      <form className="mx-auto flex w-full max-w-3xl items-end gap-1.5 px-3 py-3" onSubmit={e => { e.preventDefault(); send(); }}>
        <UploadVersionButton targetId={versionId} iconOnly label="Enviar arquivo da versão" className="shrink-0 text-muted-foreground" />
        <Textarea aria-label="Mensagem de treino" placeholder="Ensine uma regra: “tem que fazer assim…”" value={text} onChange={e => setText(e.target.value)} maxLength={20000} className="min-h-12 flex-1 rounded-2xl text-base" />
        <Button type="submit" size="icon" className="shrink-0 rounded-full" disabled={!text.trim() || train.isPending} aria-label="Enviar para treino" title="Enviar para treino">{train.isPending ? <Loader2 className="animate-spin" /> : <ArrowUp />}</Button>
      </form>
    </div>
    <aside className="hidden w-80 shrink-0 flex-col border-l bg-sidebar lg:flex">
      <h2 className="border-b px-4 py-3 text-sm font-medium">Regras aprendidas ({version.rules.length})</h2>
      <ol className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {version.rules.length === 0 && <li className="text-xs text-muted-foreground">Nenhuma regra ainda.</li>}
        {version.rules.map((r, i) => <li key={r.id} className="group rounded-md border bg-background p-3 text-xs">
          <div className="flex items-start gap-2"><span className="font-mono text-primary">{i + 1}.</span><p className="flex-1 text-sm">{r.rule}</p>
            <Button variant="ghost" size="icon-sm" aria-label="Remover regra" title="Remover regra" disabled={drop.isPending} onClick={() => drop.mutate(r.id)}><Trash2 /></Button></div>
          {r.chat && <p className="mt-2 text-muted-foreground"><span className="font-medium text-foreground">Chat:</span> {r.chat}</p>}
          {r.copilot && <p className="mt-1 text-muted-foreground"><span className="font-medium text-foreground">Copilot:</span> {r.copilot}</p>}
        </li>)}
      </ol>
    </aside>
  </div>;
}
