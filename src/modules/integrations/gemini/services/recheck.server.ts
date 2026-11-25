// Revalidação em segundo plano das chaves recusadas (roda a cada 1 minuto via agendamento).
// Chave que volta a funcionar entra como ÚLTIMA da fila (last_checked_at = agora).
import { activeModel } from "@/config/app";
import type { Db } from "../../core/runs.server";
import { open } from "../../core/crypto.server";
import { safeMessage } from "../../core/errors";
import { logRun } from "../../core/runs.server";
import { diagnoseKey } from "./diagnostics.server";
import { failedStatus } from "./rotation";

const MAX_PER_RUN = 25;

export async function recheckFailedKeys(admin: Db): Promise<{ checked: number; recovered: number }> {
  const { data, error } = await admin
    .from("gemini_keys")
    .select("id,user_id,model,key_ciphertext,key_iv")
    .eq("enabled", true)
    .in("status", ["error", "quota_exhausted"])
    .order("last_checked_at", { ascending: true, nullsFirst: true })
    .limit(MAX_PER_RUN);
  if (error) throw new Error(error.message);
  let recovered = 0;
  for (const row of data) {
    const now = new Date().toISOString();
    let ok = false;
    let detail = "";
    let resolvedModel = activeModel(row.model);
    let httpStatus: number | null = null;
    try {
      const secret = await open(
        { ciphertext: row.key_ciphertext, iv: row.key_iv },
        `gemini:${row.user_id}`,
      );
      const report = await diagnoseKey(secret, row.model);
      ok = report.ok;
      httpStatus = report.httpStatus;
      resolvedModel = report.resolvedModel ?? resolvedModel;
      detail = report.checks.find((c) => !c.ok)?.detail ?? `Chave voltou a responder · ${resolvedModel}`;
    } catch (e) {
      detail = safeMessage(e);
    }
    await admin
      .from("gemini_keys")
      .update({
        status: ok ? "connected" : failedStatus(httpStatus),
        is_primary: false,
        last_error: ok ? null : detail,
        last_checked_at: now,
        cooldown_until: ok ? null : new Date(Date.now() + 60_000).toISOString(),
        // Atualiza para o modelo que realmente funcionou
        ...(ok ? { model: resolvedModel } : {}),
        updated_at: now,
      })
      .eq("id", row.id);
    if (ok) {
      recovered++;
      await logRun(admin, row.user_id, {
        provider: "gemini",
        kind: "recheck",
        ok: true,
        key_id: row.id,
        http_status: 200,
        detail,
      });
    }
  }
  return { checked: data.length, recovered };
}
