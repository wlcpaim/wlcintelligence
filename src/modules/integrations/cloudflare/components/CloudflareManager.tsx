import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cloudflareQuery } from "../queries";
import { connectCloudflare, disconnectCloudflare } from "../functions/cloudflare.functions";
import { CloudflareDatabase } from "./CloudflareDatabase";

export function CloudflareManager() {
  const q = useQuery(cloudflareQuery);
  const qc = useQueryClient();
  const connect = useServerFn(connectCloudflare);
  const disconnect = useServerFn(disconnectCloudflare);
  const [accountId, setAccountId] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const acc = q.data?.account;

  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true);
    const r = await connect({ data: { accountId, token } });
    setBusy(false);
    if (!r.ok) { toast.error(r.error); return; }
    setToken(""); toast.success("Cloudflare conectada");
    await qc.invalidateQueries({ queryKey: ["cloudflare"] });
  };
  const remove = async () => {
    if (!confirm("Desconectar a Cloudflare? O token salvo será apagado.")) return;
    await disconnect(); await qc.invalidateQueries({ queryKey: ["cloudflare"] });
  };

  return (
    <div className="mx-auto grid max-w-xl gap-6">
      {acc && <div className="rounded-xl border border-border/60 p-4 text-sm">
        <p className="font-medium">{acc.account_name ?? "Conta Cloudflare"}</p>
        <p className="font-mono text-xs text-muted-foreground">{acc.account_id} · token {acc.token_hint}</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={remove}>Desconectar</Button>
      </div>}
      {acc && <CloudflareDatabase url={acc.db_url} dbKey={acc.db_key} projectId={acc.db_project_id} />}
      <form onSubmit={save} className="grid gap-3">
        <p className="text-sm text-muted-foreground">Crie um token em Cloudflare → My Profile → API Tokens com a permissão <b>Account · Cloudflare Pages · Edit</b>. O Account ID aparece na página inicial da conta.</p>
        <Label htmlFor="cf-acc">Account ID</Label>
        <Input id="cf-acc" value={accountId} onChange={e => setAccountId(e.target.value.trim())} placeholder="32 caracteres" className="font-mono" />
        <Label htmlFor="cf-tok">API Token</Label>
        <Input id="cf-tok" type="password" value={token} onChange={e => setToken(e.target.value)} placeholder="Token da Cloudflare" className="font-mono" />
        <Button disabled={busy || !accountId || !token}>{busy && <Loader2 className="animate-spin" />}{acc ? "Substituir" : "Conectar"}</Button>
      </form>
    </div>
  );
}
