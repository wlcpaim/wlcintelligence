// Repositório de chaves Gemini: criptografa/descriptografa só no servidor; RLS isola por usuário.
import type { Db } from "../../core/runs.server";
import { seal, open, hintOf } from "../../core/crypto.server";
import type { GeminiKeyView } from "../types";

export const VIEW_COLS =
  "id,label,google_project,model,key_hint,is_primary,enabled,status,last_checked_at,last_used_at,last_error,cooldown_until,created_at" as const;
const aad = (userId: string) => `gemini:${userId}`;

export async function listKeys(db: Db, userId: string): Promise<GeminiKeyView[]> {
  const { data, error } = await db
    .from("gemini_keys")
    .select(VIEW_COLS)
    .eq("user_id", userId)
    .order("created_at");
  if (error) throw new Error(error.message);
  return data;
}

export async function addKey(
  db: Db,
  userId: string,
  input: { label: string; google_project: string; model: string; apiKey: string },
): Promise<GeminiKeyView> {
  const sealed = await seal(input.apiKey.trim(), aad(userId));
  const { count } = await db
    .from("gemini_keys")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  const { data, error } = await db
    .from("gemini_keys")
    .insert({
      user_id: userId,
      label: input.label,
      google_project: input.google_project,
      model: input.model,
      key_ciphertext: sealed.ciphertext,
      key_iv: sealed.iv,
      key_hint: hintOf(input.apiKey),
      is_primary: (count ?? 0) === 0,
    })
    .select(VIEW_COLS)
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function revealKey(db: Db, userId: string, id: string): Promise<string> {
  const { data, error } = await db
    .from("gemini_keys")
    .select("key_ciphertext,key_iv")
    .eq("user_id", userId)
    .eq("id", id)
    .single();
  if (error) throw new Error("Chave não encontrada.");
  return open({ ciphertext: data.key_ciphertext, iv: data.key_iv }, aad(userId));
}

export async function setPrimary(db: Db, userId: string, id: string): Promise<void> {
  const target = await db.from("gemini_keys").select("status").eq("user_id", userId).eq("id", id).single();
  if (target.error || target.data.status !== "connected") throw new Error("Somente uma chave funcionando pode ser principal. Execute Diagnosticar primeiro.");
  const clear = await db
    .from("gemini_keys")
    .update({ is_primary: false })
    .eq("user_id", userId)
    .eq("is_primary", true);
  if (clear.error) throw new Error(clear.error.message);
  const { error } = await db
    .from("gemini_keys")
    .update({ is_primary: true, enabled: true })
    .eq("user_id", userId)
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function patchKey(
  db: Db,
  userId: string,
  id: string,
  patch: Partial<{
    label: string;
    google_project: string;
    model: string;
    enabled: boolean;
    is_primary: boolean;
    status: string;
    last_error: string | null;
    last_checked_at: string;
    last_used_at: string;
    cooldown_until: string | null;
  }>,
): Promise<void> {
  const { error } = await db
    .from("gemini_keys")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteKey(db: Db, userId: string, id: string): Promise<void> {
  const { error } = await db.from("gemini_keys").delete().eq("user_id", userId).eq("id", id);
  if (error) throw new Error(error.message);
}

/** Chaves com segredo descriptografado, somente para uso interno do servidor. */
export async function loadUsableKeys(
  db: Db,
  userId: string,
): Promise<(GeminiKeyView & { secret: string })[]> {
  const { data, error } = await db
    .from("gemini_keys")
    .select(`${VIEW_COLS},key_ciphertext,key_iv`)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  const usable: (GeminiKeyView & { secret: string })[] = [];
  for (const { key_ciphertext, key_iv, ...k } of data) {
    if (!k.enabled) continue;
    try {
      usable.push({ ...k, secret: await open({ ciphertext: key_ciphertext, iv: key_iv }, aad(userId)) });
    } catch {
      await patchKey(db, userId, k.id, { status: "error", is_primary: false,
        last_error: "Credencial ilegível após alteração da chave mestra. Cadastre esta chave novamente.",
        last_checked_at: new Date().toISOString(), cooldown_until: new Date(Date.now() + 60_000).toISOString() });
    }
  }
  if (!usable.length && data.some(k => k.enabled)) throw new Error("As credenciais Gemini não puderam ser abertas. Cadastre-as novamente após trocar a chave mestra.");
  return usable;
}
