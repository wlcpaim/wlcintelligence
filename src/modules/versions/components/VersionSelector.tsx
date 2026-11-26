import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, ChevronDown, BrainCircuit } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { versionsQuery } from "../queries";
import { syncChatVersions } from "../functions/versions.functions";
import { BASE_VERSION } from "../instructions";
import { PRO_SLUG, SYSTEM_SLUG, COPILOT_199_SLUG, setSelectedVersion, useSelectedVersion } from "../selected";

/** Auto-check a cada 1 minuto: busca versões novas/alteradas no repositório. */
export function useVersionsAutoSync() {
  const qc = useQueryClient();
  const sync = useServerFn(syncChatVersions);
  useEffect(() => {
    let alive = true;
    const run = () => sync().then(r => {
      if (alive && r.changed) void qc.invalidateQueries({ queryKey: ["chat-versions"] });
    }).catch(() => {});
    void run();
    const timer = setInterval(run, 60_000);
    return () => { alive = false; clearInterval(timer); };
  }, [qc, sync]);
}

export function VersionSelector() {
  useVersionsAutoSync();
  const { data = [] } = useQuery(versionsQuery);
  const selected = useSelectedVersion();
  const isPro = selected === PRO_SLUG;
  const isSystem = selected === SYSTEM_SLUG;
  const is199 = selected === COPILOT_199_SLUG;
  const current = data.find(v => v.id === selected);
  useEffect(() => { 
    if (selected && !isPro && !isSystem && !is199 && data.length && !current) {
      setSelectedVersion(null);
    }
  }, [selected, isPro, isSystem, is199, data, current]);

  const activeName = is199
    ? "Copilot Builder"
    : isPro
    ? "Scale Editor"
    : isSystem
    ? "Bypass"
    : (current?.name ?? "Prompt Maker");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1.5 font-mono text-xs" aria-label="Selecionar versão da IA" title="Versão da IA">
          <BrainCircuit className="h-4 w-4 text-primary" />
          {activeName}
          <ChevronDown className="opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Versão da IA</DropdownMenuLabel>
        
        {/* WLC 1.5.6 Prompt Maker */}
        <DropdownMenuItem onSelect={() => setSelectedVersion(null)}>
          <span className="flex-1">
            <span className="block font-mono text-sm">Prompt Maker</span>
            <span className="block text-xs text-muted-foreground">WLC 1.5.6 Lite</span>
          </span>
          {!current && !isPro && !isSystem && !is199 && <Check />}
        </DropdownMenuItem>

        {/* WLC 1.7.1 Lite */}
        <DropdownMenuItem onSelect={() => setSelectedVersion(PRO_SLUG)}>
          <span className="flex-1">
            <span className="block font-mono text-sm">Scale Editor</span>
            <span className="block text-xs text-muted-foreground">WLC 1.7.1 Lite</span>
          </span>
          {isPro && <Check />}
        </DropdownMenuItem>

        {/* WLC 1.1.0 Developers */}
        <DropdownMenuItem onSelect={() => setSelectedVersion(SYSTEM_SLUG)}>
          <span className="flex-1">
            <span className="block font-mono text-sm">Bypass</span>
            <span className="block text-xs text-muted-foreground">WLC 1.1.0 Lite</span>
          </span>
          {isSystem && <Check />}
        </DropdownMenuItem>

        {/* WLC 1.9.9 Copilot */}
        <DropdownMenuItem onSelect={() => setSelectedVersion(COPILOT_199_SLUG)}>
          <span className="flex-1">
            <span className="block font-mono text-sm">Copilot Builder</span>
            <span className="block text-xs text-muted-foreground">WLC 1.9.9 Lite</span>
          </span>
          {is199 && <Check />}
        </DropdownMenuItem>

        {data.length > 0 && <DropdownMenuSeparator />}
        {data.map(v => (
          <DropdownMenuItem key={v.id} onSelect={() => setSelectedVersion(v.id)}>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-mono text-sm">{v.name}</span>
              <span className="block text-xs text-muted-foreground">
                {v.rules.length} regra{v.rules.length === 1 ? "" : "s"} aprendida{v.rules.length === 1 ? "" : "s"}
              </span>
            </span>
            {current?.id === v.id && <Check />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
