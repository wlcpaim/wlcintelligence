import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Database, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveCloudflareDatabase } from "../functions/cloudflare.functions";

interface Props { url: string | null; dbKey: string | null; projectId: string | null }

/** Banco de dados que os sites publicados pelo Deploy usam (endereço + chave pública). */
export function CloudflareDatabase({ url: savedUrl, dbKey, projectId: savedId }: Props) {
  const qc = useQueryClient();
  const save = useServerFn(saveCloudflareDatabase);
  const [url, setUrl] = useState(savedUrl ?? "");
  const [key, setKey] = useState(dbKey ?? "");
  const [projectId, setProjectId] = useState(savedId ?? "");
  const [busy, setBusy] = useState(false);
  useEffect(() => { setUrl(savedUrl ?? ""); setKey(dbKey ?? ""); setProjectId(savedId ?? ""); }, [savedUrl, dbKey, savedId]);

  const useCurrent = () => {
    setUrl(import.meta.env["VITE_SUPABASE_URL"] ?? "");
    setKey(import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"] ?? "");
    setProjectId(import.meta.env["VITE_SUPABASE_PROJECT_ID"] ?? "");
  };
  const submit = async (cfg: { url: string; key: string; projectId?: string } | null) => {
    setBusy(true);
    const r = await save({ data: cfg });
    setBusy(false);
    if (!r.ok) { toast.error(r.error); return; }
    toast.success(cfg ? "Banco de dados salvo. Vale no próximo Deploy." : "Banco de dados removido do Deploy.");
    await qc.invalidateQueries({ queryKey: ["cloudflare"] });
  };
  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void submit({ url: url.trim(), key: key.trim(), ...(projectId.trim() ? { projectId: projectId.trim() } : {}) });
  };

  return (
    <form onSubmit={onSubmit} className="grid gap-3 rounded-xl border border-border/60 p-4">
      <div className="flex items-center gap-2">
        <Database className="h-4 w-4 text-muted-foreground" />
        <p className="text-sm font-medium">Banco de dados do site publicado</p>
      </div>
      <p className="text-xs text-muted-foreground">
        Enviado à Cloudflare a cada Deploy para o site compilado conectar no login e nos dados. Use só a chave pública — a chave de serviço nunca é aceita.
      </p>
      <Button type="button" variant="outline" size="sm" className="justify-self-start" onClick={useCurrent}>Usar banco do WLC IA</Button>
      <Label htmlFor="cf-db-url">Endereço do banco</Label>
      <Input id="cf-db-url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://..." className="font-mono text-xs" />
      <Label htmlFor="cf-db-key">Chave pública</Label>
      <Input id="cf-db-key" value={key} onChange={e => setKey(e.target.value)} placeholder="Chave anon / publishable" className="font-mono text-xs" />
      <Label htmlFor="cf-db-id">ID do projeto (opcional)</Label>
      <Input id="cf-db-id" value={projectId} onChange={e => setProjectId(e.target.value)} placeholder="Detectado pelo endereço quando possível" className="font-mono text-xs" />
      <div className="flex gap-2">
        <Button disabled={busy || !url || !key}>{busy && <Loader2 className="animate-spin" />}Salvar banco</Button>
        {savedUrl && <Button type="button" variant="ghost" disabled={busy} onClick={() => void submit(null)}>Remover</Button>}
      </div>
    </form>
  );
}
