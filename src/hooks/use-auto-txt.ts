import { useCallback, useState, type ClipboardEvent } from "react";

/** Anexo virtual .txt gerado automaticamente a partir de textos longos. */
export type TextAttachment = {
  id: string;
  name: string;
  content: string;
  size: number;
  createdAt: number;
};

const AUTO_TXT_THRESHOLD = 1000;

function makeName(content: string, index: number): string {
  const first = content.trim().slice(0, 28).replace(/\s+/g, "_").replace(/[^\w\-]/g, "") || "anexo";
  return `prompt_${first}_${index + 1}.txt`.slice(0, 64);
}

/** Junta mensagem curta + anexos TXT em um único payload para a API. */
export function composeMessageWithAttachments(
  message: string,
  attachments: TextAttachment[],
): string {
  if (!attachments.length) return message;
  const blocks = attachments.map(
    (a) =>
      `[ARQUIVO ANEXO: ${a.name} (${a.size.toLocaleString("pt-BR")} caracteres)]\n\`\`\`text\n${a.content}\n\`\`\``,
  );
  const body = message.trim();
  return body ? `${blocks.join("\n\n")}\n\n${body}` : blocks.join("\n\n");
}

/**
 * Converte textos > 1000 caracteres em anexos .txt virtuais.
 * Mantém o textarea livre para instruções curtas.
 */
export function useAutoTxt(threshold = AUTO_TXT_THRESHOLD) {
  const [attachments, setAttachments] = useState<TextAttachment[]>([]);

  const addFromText = useCallback(
    (raw: string): { keptText: string; added: TextAttachment | null } => {
      if (raw.length <= threshold) return { keptText: raw, added: null };
      const att: TextAttachment = {
        id: crypto.randomUUID(),
        name: makeName(raw, attachments.length),
        content: raw,
        size: raw.length,
        createdAt: Date.now(),
      };
      setAttachments((prev) => [...prev, att]);
      return { keptText: "", added: att };
    },
    [attachments.length, threshold],
  );

  const handleChange = useCallback(
    (value: string, setText: (v: string) => void) => {
      if (value.length > threshold) {
        const { keptText } = addFromText(value);
        setText(keptText);
        return;
      }
      setText(value);
    },
    [addFromText, threshold],
  );

  const handlePaste = useCallback(
    (e: ClipboardEvent<HTMLTextAreaElement>, current: string, setText: (v: string) => void) => {
      const pasted = e.clipboardData.getData("text");
      if (!pasted || pasted.length <= threshold) return;
      e.preventDefault();
      // Se o textarea já tem pouco texto, o paste longo vira anexo e o campo fica livre
      const combined = current + pasted;
      if (combined.length > threshold) {
        const { keptText } = addFromText(pasted);
        setText(current.trim() ? current : keptText);
      }
    },
    [addFromText, threshold],
  );

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const clearAttachments = useCallback(() => setAttachments([]), []);

  const buildPayload = useCallback(
    (message: string) => composeMessageWithAttachments(message, attachments),
    [attachments],
  );

  return {
    attachments,
    handleChange,
    handlePaste,
    removeAttachment,
    clearAttachments,
    buildPayload,
    threshold,
  };
}
