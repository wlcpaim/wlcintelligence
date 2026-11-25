import { createElement } from "react";
import { FolderOpen, Pencil, Search, Rocket, Terminal } from "lucide-react";
import { COMMAND_CATALOG, type CommandCatalogItem } from "../core/cognitive";

const CATEGORIES: {
  id: CommandCatalogItem["category"];
  title: string;
  icon: typeof FolderOpen;
}[] = [
  { id: "explore", title: "Exploração & Workspace", icon: FolderOpen },
  { id: "files", title: "Manipulação de Arquivos", icon: Pencil },
  { id: "quality", title: "Qualidade & Auditoria", icon: Search },
  { id: "devops", title: "DevOps & Repositório", icon: Rocket },
];

type Props = {
  onSelectCommand: (command: string) => void;
};

export function SystemCommandCard({ onSelectCommand }: Props) {
  return (
    <div className="mx-auto w-full max-w-3xl rounded-xl border border-emerald-900/40 bg-zinc-950/90 p-4 shadow-lg shadow-black/20">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Terminal className="h-4 w-4 text-emerald-400" />
          <span className="rounded-md border border-emerald-800/60 bg-emerald-950/50 px-2 py-0.5 font-mono text-[10px] font-semibold tracking-wide text-emerald-300">
            WLC 1.1.0 CMD · OWNER ISOLADO
          </span>
        </div>
        <span className="inline-flex items-center gap-1.5 font-mono text-[10px] text-emerald-500/90">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]" />
          ENGINE: DETERMINÍSTICO (SEM IA EXTERNA)
        </span>
      </div>

      <p className="mb-4 text-xs leading-relaxed text-zinc-400">
        Modo terminal estrito. Apenas comandos da tabela abaixo são aceitos — linguagem natural é rejeitada.
        Clique para preencher o input.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        {CATEGORIES.map((cat) => {
          const items = COMMAND_CATALOG.filter((c) => c.category === cat.id);
          return (
            <div key={cat.id} className="space-y-2">
              <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                {createElement(cat.icon, { className: "h-3.5 w-3.5" })}
                {cat.title}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {items.map((item) => (
                  <button
                    key={item.cmd}
                    type="button"
                    title={item.label}
                    onClick={() => onSelectCommand(item.needsArg ? `${item.cmd} ` : item.cmd)}
                    className="rounded-md border border-zinc-800 bg-zinc-900/80 px-2 py-1 font-mono text-[11px] text-zinc-300 transition-colors hover:border-emerald-700/60 hover:bg-emerald-950/30 hover:text-emerald-300"
                  >
                    {item.syntax}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
