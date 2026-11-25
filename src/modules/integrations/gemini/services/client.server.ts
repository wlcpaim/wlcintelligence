// Chamadas HTTP à API oficial do Gemini, recebendo a chave explicitamente.
import { GEMINI_BASE_URL } from "@/config/app";
import { ENGINEERING_INSTRUCTION, FREE_CHAT_INSTRUCTION } from "@/services/engineering";

const headers = (key: string) => ({ "x-goog-api-key": key, "content-type": "application/json" });

export function geminiGetModel(
  key: string,
  model: string,
  signal?: AbortSignal,
): Promise<Response> {
  return fetch(`${GEMINI_BASE_URL}/models/${encodeURIComponent(model)}`, {
    headers: headers(key),
    ...(signal ? { signal } : {}),
  });
}

export function geminiGenerate(key: string, model: string, text: string): Promise<Response> {
  return fetch(`${GEMINI_BASE_URL}/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: headers(key),
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text }] }],
      generationConfig: { maxOutputTokens: 8 },
    }),
  });
}

/**
 * Streaming do chat.
 * @param engineeringMode - true quando há repositório anexado (prompt rígido).
 *                          false = chat livre.
 */
export function geminiStream(
  key: string,
  model: string,
  contents: { role: string; content: string }[],
  signal: AbortSignal,
  engineeringMode = false,
  instruction?: string,
  maxOutputTokens = 80,
  responseMimeType?: string,
): Promise<Response> {
  const systemText = instruction ?? (engineeringMode ? ENGINEERING_INSTRUCTION : FREE_CHAT_INSTRUCTION);
  return fetch(
    `${GEMINI_BASE_URL}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
    {
      method: "POST",
      signal,
      headers: headers(key),
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemText }] },
        contents: contents.map((m) => ({ role: m.role, parts: [{ text: m.content }] })),
        ...(instruction ? { generationConfig: { maxOutputTokens, ...(responseMimeType ? { responseMimeType } : {}) } } : {}),
      }),
    },
  );
}
