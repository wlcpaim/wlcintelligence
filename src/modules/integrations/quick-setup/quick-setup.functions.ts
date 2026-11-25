import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { GEMINI_MODEL } from "@/config/app";
function getPresetGeminiKeys(): string[] {
  const raw = process.env["GEMINI_API_KEY"] || process.env["GEMINI_API_KEYS"] || "";
  return raw
    .split(/[,;\n]/)
    .map((k) => k.trim())
    .filter(Boolean);
}
import { listKeys, addKey } from "../gemini/services/keys.server";
import { hintOf } from "../core/crypto.server";
import { safeMessage } from "../core/errors";

export interface QuickStep { name: string; ok: boolean; detail: string }

/** Check + preenchimento em 1 clique: Gemini, GitHub, Cloudflare e banco dos deploys. */
export const quickSetupAll = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = context.supabase, uid = context.userId;
    const steps: QuickStep[] = [];
    const run = async (name: string, fn: () => Promise<string>) => {
      try { steps.push({ name, ok: true, detail: await fn() }); }
      catch (e) { steps.push({ name, ok: false, detail: safeMessage(e) }); }
    };
    await run("Gemini", async () => {
      const presetKeys = getPresetGeminiKeys();
      if (presetKeys.length === 0) {
        return "Nenhuma chave pré-configurada no servidor. Cadastre suas chaves em Configurações → Gemini.";
      }
      const existing = await listKeys(db, uid);
      const have = new Set(existing.map((k) => k.key_hint));
      let n = existing.length, added = 0;
      for (const apiKey of presetKeys) {
        if (have.has(hintOf(apiKey))) continue;
        n += 1; added += 1;
        await addKey(db, uid, { label: `Gemini #${n}`, google_project: "", model: GEMINI_MODEL, apiKey });
      }
      return `${added} adicionadas, ${presetKeys.length - added} já existiam`;
    });

    return { steps };
  });
