import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Botão de voltar padrão das telas abertas. */
export function BackButton({ to, label }: { to: "/code" | "/wlcia" | "/settings"; label: string }) {
  return (
    <Button asChild variant="ghost" size="icon-sm" aria-label={label} title={label} className="shrink-0">
      <Link to={to}><ArrowLeft /></Link>
    </Button>
  );
}
