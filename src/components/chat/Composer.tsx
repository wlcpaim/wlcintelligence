import { useEffect, useState } from "react";
import { ArrowUp, Square, FileCode2, FileText, X, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PromptInput, PromptInputTextarea, PromptInputFooter, PromptInputSubmit } from "@/components/ai-elements/prompt-input";
import { useAutoTxt } from "@/hooks/use-auto-txt";

export function Composer({ onSend, onStop, streaming, files = [], onRemoveFile, systemMode = false, draftCommand }: {
  onSend: (t: string) => void; onStop: () => void; streaming: boolean;
  files?: string[]; onRemoveFile?: (path: string) => void;
  systemMode?: boolean;
  draftCommand?: string | null;
}) {
  const [text, setText] = useState("");
  const autoTxt = useAutoTxt(1000);

  useEffect(() => {
    if (draftCommand != null && draftCommand !== "") setText(draftCommand);
  }, [draftCommand]);

  return (
    <div className="mx-auto w-full max-w-3xl px-3 pb-2 sm:pb-3 pb-[env(safe-area-inset-bottom)]">
      {(files.length > 0 || autoTxt.attachments.length > 0) && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {files.map((f) => (
            <span
              key={f}
              title={f}
              className="inline-flex max-w-full items-center gap-1 rounded-md border bg-secondary px-2 py-1 font-mono text-xs text-secondary-foreground"
            >
              <FileCode2 className="h-3 w-3 shrink-0" />
              <span className="truncate">{f.split("/").pop()}</span>
              {onRemoveFile && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remover ${f}`}
                  title={`Remover ${f}`}
                  onClick={() => onRemoveFile(f)}
                >
                  <X />
                </Button>
              )}
            </span>
          ))}
          {autoTxt.attachments.map((a) => (
            <span
              key={a.id}
              title={`${a.name} — ${a.size.toLocaleString("pt-BR")} caracteres`}
              className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border bg-muted/60 px-2.5 py-1 font-mono text-xs"
            >
              <FileText className="h-3.5 w-3.5 shrink-0 text-primary" />
              <span className="max-w-[160px] truncate font-medium">{a.name}</span>
              <span className="text-muted-foreground">({a.size.toLocaleString("pt-BR")} chars)</span>
              <button
                type="button"
                aria-label={`Remover ${a.name}`}
                title="Remover anexo"
                className="rounded p-0.5 hover:text-destructive"
                onClick={() => autoTxt.removeAttachment(a.id)}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <PromptInput
        onSubmit={() => {
          const message = text.trim();
          if ((!message && autoTxt.attachments.length === 0) || streaming) return;
          onSend(autoTxt.buildPayload(message));
          setText("");
          autoTxt.clearAttachments();
        }}
      >
        <div className={`flex items-start gap-0 ${systemMode ? "rounded-md border border-zinc-800 bg-zinc-950" : ""}`}>
          {systemMode && (
            <span className="select-none pl-3 pt-3 font-mono text-sm font-bold text-emerald-500">wlc:~$</span>
          )}
          <PromptInputTextarea
            value={text}
            onChange={(e) => autoTxt.handleChange(e.target.value, setText)}
            onPaste={(e) => autoTxt.handlePaste(e, text, setText)}
            placeholder={
              autoTxt.attachments.length
                ? "Instrução adicional (o texto longo já está em anexo .txt)..."
                : systemMode
                  ? "digite um comando (help, ls, tree, commit)..."
                  : "Mensagem para wlc.ia"
            }
            aria-label="Mensagem"
            className={`min-h-12 text-base ${systemMode ? "border-0 bg-transparent font-mono text-sm focus-visible:ring-0" : ""}`}
          />
        </div>
        <PromptInputFooter className="justify-end">
          <PromptInputSubmit
            status={streaming ? "streaming" : "ready"}
            disabled={!streaming && !text.trim() && autoTxt.attachments.length === 0}
            onStop={onStop}
            aria-label={streaming ? "Parar geração" : "Enviar"}
            title={streaming ? "Parar geração" : "Enviar"}
          >
            {streaming ? <Square className="fill-current" /> : systemMode ? <Terminal className="h-4 w-4" /> : <ArrowUp />}
          </PromptInputSubmit>
        </PromptInputFooter>
      </PromptInput>
    </div>
  );
}
