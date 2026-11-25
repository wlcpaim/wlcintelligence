import { Badge } from "@/components/ui/badge";

const MAP: Record<
  string,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  connected: { label: "Conectado", variant: "default" },
  error: { label: "Erro", variant: "destructive" },
  quota_exhausted: { label: "Cota esgotada", variant: "destructive" },
  disabled: { label: "Desativado", variant: "outline" },
  not_configured: { label: "Não configurado", variant: "outline" },
  unknown: { label: "Não verificado", variant: "secondary" },
};
export function StateBadge({ state }: { state: string }) {
  const s = MAP[state] ?? { label: "Não verificado", variant: "secondary" as const };
  return <Badge variant={s.variant}>{s.label}</Badge>;
}
export function fmtDate(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleString("pt-BR") : "—";
}
