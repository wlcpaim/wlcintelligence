import { CheckCircle2, XCircle } from "lucide-react";
import type { DiagnosticReport } from "../../core/types";
import { fmtDate } from "./StateBadge";

export function DiagnosticResult({ report }: { report: DiagnosticReport }) {
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">Executado em {fmtDate(report.ranAt)}</p>
      {report.checks.map((c) => (
        <div key={c.name} className="flex gap-2 text-sm">
          {c.ok ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          ) : (
            <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          )}
          <div className="min-w-0">
            <p className="font-medium">{c.name}</p>
            <p className="break-words text-xs text-muted-foreground">{c.detail}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
