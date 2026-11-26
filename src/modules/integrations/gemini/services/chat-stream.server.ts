// Abre o streaming do chat usando rotação de chaves + fallback de modelos.
// A troca de chave/modelo só ocorre ANTES do primeiro byte: depois disso não há
// nova tentativa (evita mensagens duplicadas). Enquanto tenta, o cliente continua
// em estado "carregando" até o primeiro delta chegar.
import { modelsForKey } from "@/config/app";
import { describeGeminiError } from "@/services/gemini.server";
import type { Db } from "../../core/runs.server";
import { logRun } from "../../core/runs.server";
import { loadUsableKeys, patchKey } from "./keys.server";
import { orderCandidates, isRecoverable, sharesQuota, cooldownMs, MAX_ATTEMPTS, failedStatus } from "./rotation";
import { geminiStream } from "./client.server";

export type OpenResult =
  | { ok: true; response: Response; keyId: string; model: string }
  | { ok: false; error: string; aborted: boolean };

export async function openChatStream(
  db: Db,
  userId: string,
  history: { role: string; content: string }[],
  signal: AbortSignal,
  engineeringMode = false,
  options?: { instruction: string; maxOutputTokens: number; responseMimeType?: string; preferredKeyId?: string; rotationStrategy?: "primary" | "least-recently-used" },
): Promise<OpenResult> {
  const keys = await loadUsableKeys(db, userId);
  if (keys.length === 0)
    return {
      ok: false,
      aborted: false,
      error:
        "Nenhuma chave Gemini cadastrada. Adicione uma em Configurações → API → Connect Gemini.",
    };

  const now = new Date();
  let candidates = orderCandidates(keys, now, options?.rotationStrategy);
  // Chave preferida (ex.: WLC 1.9.9 — uma API por especialista): vai na frente, as demais
  // continuam como fallback. Se a preferida estiver em cooldown/desativada, segue a rotação normal.
  const preferredId = options?.preferredKeyId;
  if (preferredId && candidates.some((k) => k.id === preferredId)) {
    candidates = [
      ...candidates.filter((k) => k.id === preferredId),
      ...candidates.filter((k) => k.id !== preferredId),
    ];
  }
  const exhaustedProjects = new Set<string>();
  let lastError = keys.find(k => k.enabled && k.last_error)?.last_error ?? "Nenhuma chave/modelo Gemini disponível no momento.";
  let tries = 0;

  for (const key of candidates) {
    if (signal.aborted)
      return { ok: false, error: "Interrompido pelo usuário.", aborted: true };
    if (tries >= MAX_ATTEMPTS) break;
    if (key.google_project && exhaustedProjects.has(key.google_project)) continue;

    // Para cada chave, tenta a cadeia de modelos (do mais free → menos free)
    const models = modelsForKey(key.model);
    let keyExhaustedByQuota = false;

    for (const model of models) {
      if (signal.aborted)
        return { ok: false, error: "Interrompido pelo usuário.", aborted: true };
      if (tries >= MAX_ATTEMPTS) break;

      tries++;
      let status = 0;
      let errorMsg = "";

      try {
        const res = await geminiStream(key.secret, model, history, signal, engineeringMode, options?.instruction, options?.maxOutputTokens, options?.responseMimeType);

        if (res.ok && res.body) {
          // Sucesso: marca chave como healthy e registra
          await patchKey(db, userId, key.id, {
            status: "connected",
            last_error: null,
            last_used_at: new Date().toISOString(),
            cooldown_until: null,
            model, // atualiza para o modelo que funcionou
          });
          await logRun(db, userId, {
            provider: "gemini",
            kind: "chat",
            ok: true,
            key_id: key.id,
            http_status: 200,
            detail: `${key.label} · ${model}`,
          });
          return { ok: true, response: res, keyId: key.id, model };
        }

        // Falhou
        const body = await res.text().catch(() => "");
        status = res.status;
        errorMsg = describeGeminiError(status, body);
      } catch (e) {
        if (signal.aborted)
          return { ok: false, error: "Interrompido pelo usuário.", aborted: true };
        status = 503;
        errorMsg = e instanceof Error ? e.message : String(e);
      }

      lastError = errorMsg;

      // Registra a falha desta tentativa
      await patchKey(db, userId, key.id, {
        status: failedStatus(status),
        is_primary: false,
        last_error: errorMsg,
        last_checked_at: new Date().toISOString(),
        cooldown_until: new Date(Date.now() + cooldownMs(status)).toISOString(),
      });
      await logRun(db, userId, {
        provider: "gemini",
        kind: "chat",
        ok: false,
        key_id: key.id,
        http_status: status,
        detail: `${errorMsg} (modelo: ${model})`,
      });

      // 400 / erros não recuperáveis: não adianta tentar outro modelo na mesma chave
      if (!isRecoverable(status)) return { ok: false, error: lastError, aborted: false };
      // 401/403: continua testando todos os modelos da cadeia antes de declarar falha.

      // 429 esgota o projeto Google inteiro
      if (sharesQuota(status)) {
        if (key.google_project) exhaustedProjects.add(key.google_project);
        // Persist shared cooldown so the next PRO phase does not retry a sibling key.
        for (const sibling of keys) {
          if (!key.google_project || sibling.id === key.id || sibling.google_project !== key.google_project) continue;
          await patchKey(db, userId, sibling.id, {
            status: failedStatus(status),
            last_error: errorMsg,
            cooldown_until: new Date(Date.now() + cooldownMs(status)).toISOString(),
          });
        }
        keyExhaustedByQuota = true;
        break; // sai do loop de modelos desta chave
      }

      // Caso contrário (503, 401, 403 etc.) tenta o próximo modelo da cadeia
    }

    if (keyExhaustedByQuota) continue;
  }

  return { ok: false, error: lastError, aborted: false };
}
