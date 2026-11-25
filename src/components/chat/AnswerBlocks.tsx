import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { categories, parseAnswer } from "@/services/engineering";
import { Markdown } from "./Markdown";

export function CopyMarkdown({
  text,
  label = "Copiar Markdown",
}: {
  text: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setFailed(false);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setFailed(true);
    }
  }
  return (
    <span className="flex items-center gap-1">
      {failed && (
        <span role="alert" className="text-xs text-destructive">
          Cópia indisponível
        </span>
      )}
      <Button
        variant="ghost"
        size="icon"
        aria-label={copied ? "Copiado" : label}
        title={copied ? "Copiado" : label}
        onClick={copy}
      >
        {copied ? <Check className="text-success" /> : <Copy />}
      </Button>
    </span>
  );
}

export function AnswerBlocks({ content }: { content: string }) {
  const blocks = parseAnswer(content);
  if (!blocks.length) return <Markdown>{content}</Markdown>;
  return (
    <div className="flex min-w-0 flex-col gap-4">
      {blocks.map((block) => (
        <section
          key={block.id}
          aria-label={`${categories[block.category]} ${block.id}`}
          className="min-w-0 overflow-hidden rounded-lg border bg-card"
        >
          <header className="flex min-h-11 items-center justify-between gap-2 border-b px-3">
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
              <span
                className={`font-mono text-xs ${block.category === "bg" ? "text-destructive" : "text-primary"}`}
              >
                {block.id}
              </span>
              <span className="text-xs text-muted-foreground">{categories[block.category]}</span>
            </div>
            <CopyMarkdown
              text={`${block.id} — ${categories[block.category]}\n\n${block.content}`}
            />
          </header>
          <div className="min-w-0 px-4 py-3">
            <Markdown>{block.content}</Markdown>
          </div>
        </section>
      ))}
    </div>
  );
}
