// Conexão GitHub por usuário: token criptografado, identidade real obtida da API.
import type { Db } from "../../core/runs.server";
import { seal, open, hintOf } from "../../core/crypto.server";
import { gh, type GhUser } from "./api.server";
import type { GithubAccountView } from "../types";

const aad = (userId: string) => `github:${userId}`;
export const ACCOUNT_COLS =
  "login,display_name,avatar_url,html_url,account_id,email,auth_type,token_hint,scopes,token_expires_at,status,connected_at,last_checked_at,last_error" as const;

export async function identify(token: string) {
  const { data: u, headers } = await gh<GhUser>(token, "/user");
  const exp = headers.get("github-authentication-token-expiration");
  const rawScopes = headers.get("x-oauth-scopes");
  const scopes = rawScopes
    ? rawScopes.split(",").map((s) => s.trim()).filter(Boolean)
    : ["fine-grained (por repositório)"];
  return {
    account_id: u.id,
    login: u.login,
    display_name: u.name,
    avatar_url: u.avatar_url,
    html_url: u.html_url,
    email: u.email,
    // Literal de array do Postgres: aceito tanto por colunas text quanto text[].
    scopes: `{${scopes.map((v) => `"${v.replace(/["\\]/g, "")}"`).join(",")}}`,
    token_expires_at: exp
      ? new Date(exp.replace(" UTC", "Z").replace(" ", "T")).toISOString()
      : null,
  };
}

export async function connect(db: Db, userId: string, token: string): Promise<GithubAccountView> {
  const ident = await identify(token); // falha aqui = token inválido; nada é salvo
  const sealed = await seal(token, aad(userId));
  const now = new Date().toISOString();
  const { data, error } = await db
    .from("github_connections")
    .upsert({
      user_id: userId,
      auth_type: "pat",
      token_ciphertext: sealed.ciphertext,
      token_iv: sealed.iv,
      token_hint: hintOf(token),
      ...ident,
      status: "connected",
      last_checked_at: now,
      last_error: null,
      connected_at: now,
      updated_at: now,
    })
    .select(ACCOUNT_COLS)
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function getAccount(db: Db, userId: string): Promise<GithubAccountView | null> {
  const { data, error } = await db
    .from("github_connections")
    .select(ACCOUNT_COLS)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function getToken(db: Db, userId: string): Promise<string> {
  const { data } = await db
    .from("github_connections")
    .select("token_ciphertext,token_iv")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) throw new Error("Conta GitHub não conectada.");
  return open({ ciphertext: data.token_ciphertext, iv: data.token_iv }, aad(userId));
}

export async function patchAccount(
  db: Db,
  userId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const { error } = await db
    .from("github_connections")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
}

export async function disconnect(db: Db, userId: string): Promise<void> {
  const a = await db.from("github_connections").delete().eq("user_id", userId);
  if (a.error) throw new Error(a.error.message);
  await db.from("github_selection").delete().eq("user_id", userId);
}
