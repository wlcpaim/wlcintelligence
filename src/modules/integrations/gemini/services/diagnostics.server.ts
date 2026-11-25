// Diagnóstico real de uma chave: modelo, autenticação, comunicação e cota.
// Sempre usa activeModel() para evitar modelos descontinuados (ex: 2.0-flash-lite).
import { activeModel, modelsForKey } from "@/config/app";
import { describeGeminiError } from "@/services/gemini.server";
import type { DiagnosticReport, DiagnosticCheck } from "../../core/types";
import { safeMessage } from "../../core/errors";
import { geminiGetModel, geminiGenerate } from "./client.server";

export async function diagnoseKey(
  secret: string,
  model: string,
): Promise<DiagnosticReport & { httpStatus: number | null; resolvedModel?: string }> {
  const checks: DiagnosticCheck[] = [];
  let httpStatus: number | null = null;
  // Sempre começa pelo modelo atualizado (evita 404 de modelos mortos)
  const candidates = modelsForKey(model);
  let resolvedModel = candidates[0] ?? activeModel(model);

  try {
    let lastBody = "";
    let found = false;

    for (const tryModel of candidates) {
      const m = await geminiGetModel(secret, tryModel);
      httpStatus = m.status;
      const body = await m.text();
      lastBody = body;

      const authOk =
        m.status !== 401 && m.status !== 403 && !(m.status === 400 && /API key/i.test(body));

      // Chave inválida: não adianta tentar outros modelos
      if (!authOk) {
        checks.push({ name: "Comunicação com a API", ok: true, detail: `HTTP ${m.status}` });
        checks.push({
          name: "Validade e autenticação da chave",
          ok: false,
          detail: describeGeminiError(m.status, body),
        });
        return { ok: false, ranAt: new Date().toISOString(), checks, httpStatus };
      }

      if (m.ok) {
        resolvedModel = tryModel;
        found = true;
        checks.push({ name: "Comunicação com a API", ok: true, detail: `HTTP ${m.status}` });
        checks.push({
          name: "Validade e autenticação da chave",
          ok: true,
          detail: "Chave aceita pelo Google",
        });
        checks.push({
          name: `Disponibilidade do modelo ${tryModel}`,
          ok: true,
          detail: "Modelo disponível",
        });
        break;
      }
    }

    if (!found) {
      checks.push({ name: "Comunicação com a API", ok: true, detail: `HTTP ${httpStatus}` });
      checks.push({
        name: "Validade e autenticação da chave",
        ok: true,
        detail: "Chave aceita pelo Google",
      });
      checks.push({
        name: `Disponibilidade do modelo`,
        ok: false,
        detail: describeGeminiError(httpStatus ?? 404, lastBody),
      });
      return { ok: false, ranAt: new Date().toISOString(), checks, httpStatus, resolvedModel };
    }

    // Teste de geração mínima no modelo que funcionou
    const g = await geminiGenerate(secret, resolvedModel, "ping");
    httpStatus = g.status;
    const gb = g.ok ? "" : await g.text();
    checks.push({
      name: "Cota e limites (geração mínima)",
      ok: g.ok,
      detail: g.ok ? `Geração concluída · modelo ${resolvedModel}` : describeGeminiError(g.status, gb),
    });
  } catch (e) {
    checks.push({ name: "Comunicação com a API", ok: false, detail: safeMessage(e) });
  }

  return {
    ok: checks.every((c) => c.ok),
    ranAt: new Date().toISOString(),
    checks,
    httpStatus,
    resolvedModel,
  };
}
