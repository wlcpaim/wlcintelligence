import { useEffect, useRef, useState } from "react";
import { ArrowDown } from "lucide-react";
import type { ChatMessage } from "@/types/chat";
import { Button } from "@/components/ui/button";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";

import { CopyMarkdown } from "./AnswerBlocks";

export function MessageList({ messages, pending }: { messages: ChatMessage[]; pending: boolean }) {
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [away, setAway] = useState(false);
  const check = () => {
    const el = viewport.current;
    if (el) setAway(el.scrollHeight - el.scrollTop - el.clientHeight > 70);
  };
  useEffect(() => {
    const observer = new ResizeObserver(check);
    if (content.current) observer.observe(content.current);
    check();
    return () => observer.disconnect();
  }, []);
  // Sem scroll automático: nem respostas novas, nem a escrita movem a leitura.
  return <div className="relative min-h-0 flex-1">
    <div ref={viewport} onScroll={check} className="h-full overflow-y-auto overflow-x-hidden [overflow-anchor:none]" data-chat-scroll>
      <div ref={content} className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-6 px-4 py-6">
        {messages.length === 0 && !pending && (
  <div className="grid flex-1 place-content-center justify-items-center text-muted-foreground">
    <p className="font-mono text-lg">wlc.ia</p>
  </div>
)}
        {messages.map((m, i) => <Message key={m.id} from={m.role === "model" ? "assistant" : "user"} className={m.role === "model" ? "max-w-full" : "max-w-[85%]"}>
          <MessageContent className="text-base leading-relaxed">
            {m.role === "user" ? <div className="whitespace-pre-wrap break-words">{m.content}</div> :
              <MessageResponse isAnimating={pending && i === messages.length - 1} className="prose-chat min-w-0 break-words">{m.content}</MessageResponse>}
          </MessageContent>
          {m.role === "model" && m.content && !(pending && i === messages.length - 1) && <CopyMarkdown text={m.content} label="Copiar resposta" />}
        </Message>)}
        {pending && !messages.at(-1)?.content && <div role="status" aria-label="WLC IA está processando" className="h-5 w-5 animate-pulse rounded-full border-2 border-primary motion-reduce:animate-none" />}
        {pending && messages.at(-1)?.role === "user" && <div role="status" aria-label="WLC IA está processando" className="h-5 w-5 animate-pulse rounded-full border-2 border-primary motion-reduce:animate-none" />}
      </div>
    </div>
    {away && <Button size="icon" variant="outline" aria-label="Ir para o final do chat" title="Ir para o final do chat" className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full shadow-lg"
      onClick={() => { const el = viewport.current; if (el) el.scrollTo({ top: el.scrollHeight, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" }); }}><ArrowDown /></Button>}
  </div>;
}