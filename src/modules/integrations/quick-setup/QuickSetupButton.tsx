import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, XCircle, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { quickSetupAll, type QuickStep } from "./quick-setup.functions";

export function QuickSetupButton() {
  const fn = useServerFn(quickSetupAll);
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState<QuickStep[] | null>(null);
  const go = async () => {
    setBusy(true);
    try { setSteps((await fn()).steps); }
    catch (e) { setSteps([{ name: "Erro", ok: false, detail: e instanceof Error ? e.message : String(e) }]); }
    finally { setBusy(false); void qc.invalidateQueries(); }
  };
  return (
    <section className="rounded-xl border bg-card p-4 md:col-span-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">Check & Preencher Gemini</h2>
          <p className="text-sm text-muted-foreground">Gemini em um clique.</p>
        </div>
        <Button onClick={go} disabled={busy}><Zap className="h-4 w-4" />{busy ? "Verificando…" : "Check"}</Button>
      </div>
      {steps && (
        <ul className="mt-3 space-y-1 text-sm">
          {steps.map((s) => (
            <li key={s.name} className="flex items-start gap-2">
              {s.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />}
              <span><b>{s.name}:</b> {s.detail}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
