import { useRef, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { deliverFile } from "@/lib/download";
import { importChatVersion } from "../functions/versions.functions";
import { serializeVersion, type VersionFile } from "../instructions";

/** Baixa o arquivo .json de uma versão (mesmo formato salvo no repositório). */
export function downloadVersionFile(v: VersionFile) {
  void deliverFile(new Blob([serializeVersion(v)], { type: "application/json" }), `${v.slug}.json`);
}
export function downloadRawVersion(content: string, slug: string) {
  void deliverFile(new Blob([content], { type: "application/json" }), `${slug}.json`);
}

type Imported = Awaited<ReturnType<typeof importChatVersion>>;

/** Botão de upload: cria uma versão a partir de arquivo, ou substitui a versão `targetId`. */
export function UploadVersionButton({ targetId, onDone, label, iconOnly, className }: {
  targetId?: string; onDone?: (v: Imported) => void; label?: string; iconOnly?: boolean; className?: string; children?: ReactNode;
}) {
  const input = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  const upload = useMutation({
    mutationFn: async (file: File) => {
      if (file.size > 1_000_000) throw new Error("Arquivo grande demais (máximo 1 MB).");
      const content = await file.text();
      return importChatVersion({ data: targetId ? { content, id: targetId } : { content } });
    },
    onSuccess: async v => {
      await qc.invalidateQueries({ queryKey: ["chat-versions"] });
      if (v.sync_error) toast.warning(v.sync_error);
      else toast.success(targetId ? `Arquivo aplicado em ${v.name}.` : `${v.name} criada a partir do arquivo.`);
      onDone?.(v);
    },
    onError: e => toast.error(e.message),
  });
  const text = label ?? "Upload";
  return <>
    <input ref={input} type="file" accept=".json,application/json" className="hidden" aria-label="Arquivo da versão"
      onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; if (f) upload.mutate(f); }} />
    <Button type="button" variant={iconOnly ? "ghost" : "outline"} size={iconOnly ? "icon" : "sm"} className={className}
      disabled={upload.isPending} onClick={() => input.current?.click()} aria-label={text} title={text}>
      {upload.isPending ? <Loader2 className="animate-spin" /> : <Upload />}{!iconOnly && text}
    </Button>
  </>;
}
