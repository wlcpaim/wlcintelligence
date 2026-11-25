import type { ReactNode } from "react";
import { Loader2, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

/** Tela de menu minimalista: botão de ação centralizado com ícone antes do texto. */
export function CenterAction({ label, onClick, pending, corner }: { label: string; onClick: () => void; pending?: boolean; corner?: ReactNode }) {
  return (
    <div className="relative flex h-full w-full items-center justify-center px-6">
      {corner && <div className="absolute right-3 top-3 flex items-center gap-1">{corner}</div>}
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className={cn(
          "group inline-flex items-center gap-3 rounded-full bg-primary px-6 py-3.5 text-primary-foreground shadow-soft outline-none",
          "transition-all duration-200 hover:opacity-95 active:scale-95",
          "focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 translate-y-[100px]"
        )}
      >
        {pending ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : (
          <Plus className="h-5 w-5 transition-transform duration-200 group-hover:rotate-90" strokeWidth={2} />
        )}
        <span className="text-base font-medium tracking-tight">
          {pending ? "Criando…" : label}
        </span>
      </button>
    </div>
  );
}
