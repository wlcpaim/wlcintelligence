import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { ChatMessage } from "@/types/chat";
import { isProSelected, isSystemSelected, is199Selected, readCustomVersionId } from "@/modules/versions/selected";
import type { RepoRef } from "@/modules/integrations/github/repository";
import { revealCount } from "./typing";
import type { SystemConnection } from "@/modules/system/core/connection";

/** Envia mensagens para /api/chat e lê a resposta em streaming. */
export function useChat(initial: ChatMessage[], conversationId: string) {
  const [messages, setMessages] = useState<ChatMessage[]>(initial);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connection, setConnection] = useState<SystemConnection | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  async function send(
    text: string,
    repository?: RepoRef,
    context?: { files: string[]; full: boolean },
  ) {
    if (abortRef.current) return;
    setError(null);
    const now = new Date().toISOString();
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
      created_at: now,
    };
    const modelId = crypto.randomUUID();
    const systemMode = isSystemSelected();
    if (!systemMode) setConnection(null);
    let completed = false;
    setMessages((m) => [...m, userMsg]);
    setStreaming(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    let acc = "";
    let visible = "";
    let timer: ReturnType<typeof setInterval> | undefined;
    let lastTick = Date.now();
    const paint = () => {
      const now = Date.now();
      const count = revealCount(now - lastTick);
      if (!count) return;
      lastTick = now;
      if (visible.length < acc.length) {
        visible = acc.slice(0, visible.length + count);
        setMessages(m => m.map(x => x.id === modelId ? { ...x, content: visible } : x));
      }
    };
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("Sessão expirada. Entre novamente.");

      // WLC 1.1.0 System — endpoint isolado, zero Gemini
      const endpoint = systemMode ? "/api/system/chat" : "/api/chat";
      const body = systemMode
        ? { conversationId, message: text }
        : {
            conversationId,
            message: text,
            ...(readCustomVersionId() ? { versionId: readCustomVersionId() } : {}),
            ...(isProSelected() ? { mode: "pro" } : {}),
            ...(is199Selected() ? { mode: "v199" } : {}),
            ...(repository ? { repository, files: context?.files ?? [], full: context?.full ?? false } : {}),
          };

      const res = await fetch(endpoint, {
        method: "POST",
        signal: ctrl.signal,
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      if (!res.ok || !res.body) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(j?.error ?? `Erro ${res.status}`);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buffer = "";
      setMessages((m) => [...m, { id: modelId, role: "model", content: "", created_at: now }]);
      lastTick = Date.now();
      timer = setInterval(paint, 32);
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += dec.decode(value, { stream: true });
        let newline: number;
        while ((newline = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          if (!line.trim()) continue;
          const event = JSON.parse(line) as {
            type: string;
            text?: string;
            id?: string | null;
            error?: string;
            connection?: SystemConnection;
          };
          if (event.type === "error")
            throw new Error(
              event.error ?? "Alta demanda no WLC IA. Tente novamente em alguns instantes.",
            );
          if (event.type === "delta") acc += event.text ?? "";
          if (event.type === "complete") {
            if (event.connection) setConnection(event.connection);
            acc = event.text ?? acc;
            completed = true;
          }
        }
      }
      // Drena a fila visual sem despejar de uma vez o texto recebido em blocos.
      while (visible.length < acc.length && !ctrl.signal.aborted) {
        await new Promise(resolve => setTimeout(resolve, 32));
      }
      if (!completed)
        throw new Error(
          "A resposta do WLC IA foi interrompida. Tente novamente em alguns instantes.",
        );
    } catch (e) {
      setConnection(null);
      if ((e as Error).name !== "AbortError") setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (timer) clearInterval(timer);
      setMessages((m) =>
        m
          .filter((x) => !(x.id === modelId && x.content === ""))
      );
      setStreaming(false);
      abortRef.current = null;
    }
  }

  function stop() {
    abortRef.current?.abort();
  }

  return { messages, streaming, error, send, stop, connection };
}
