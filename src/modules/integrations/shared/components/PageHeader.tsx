import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
export function PageHeader({ title, back }: { title: string; back?: boolean }) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
      {back && (
        <Link
          to="/settings"
          aria-label="Voltar"
          className="text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
      )}
      <h1 className="text-sm font-semibold">{title}</h1>
    </header>
  );
}
