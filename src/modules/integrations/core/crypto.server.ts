// AES-256-GCM com WebCrypto (compatível com Workers). A chave mestra vem só do secret INTEGRATIONS_MASTER_KEY.
export interface Sealed {
  ciphertext: string;
  iv: string;
}

const b64 = (u: Uint8Array): string => btoa(String.fromCharCode(...u));
const unb64 = (s: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function deriveKey(master: string): Promise<CryptoKey> {
  if (master.length < 16) throw new Error("Chave mestra de criptografia ausente ou fraca.");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(master));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

function masterKey(): string {
  const k = process.env["INTEGRATIONS_MASTER_KEY"];
  if (!k) throw new Error("INTEGRATIONS_MASTER_KEY não configurada no servidor.");
  return k;
}

/** additionalData amarra o segredo ao dono (impede reutilização entre usuários). */
export async function seal(
  plain: string,
  aad: string,
  master: string = masterKey(),
): Promise<Sealed> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(master);
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(aad) },
    key,
    new TextEncoder().encode(plain),
  );
  return { ciphertext: b64(new Uint8Array(ct)), iv: b64(iv) };
}

export async function open(s: Sealed, aad: string, master: string = masterKey()): Promise<string> {
  const key = await deriveKey(master);
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: unb64(s.iv), additionalData: new TextEncoder().encode(aad) },
    key,
    unb64(s.ciphertext),
  );
  return new TextDecoder().decode(pt);
}

/** Identificador parcial seguro: nunca mais que 4 caracteres finais. */
export function hintOf(secret: string): string {
  const t = secret.trim();
  return t.length < 12 ? "••••" : `${t.slice(0, 3)}…${t.slice(-4)}`;
}
