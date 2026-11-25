// Versão escolhida no seletor (compartilhada entre Chat e Copilot).
import { useEffect, useState } from "react";
const KEY = "wlc.version";
const EVT = "wlc-version-change";
export function readSelectedVersion(): string | null {
  // Sem escolha salva → WLC 1.9.9 (time completo). Prompt Maker (1.5.6) é salvo explicitamente como BASE_SLUG.
  try {
    const v = localStorage.getItem(KEY);
    if (v === null) return COPILOT_199_SLUG;
    return v === BASE_SLUG ? null : v;
  } catch { return COPILOT_199_SLUG; }
}
export function setSelectedVersion(id: string | null) {
  try { localStorage.setItem(KEY, id ?? BASE_SLUG); } catch { /* sem storage */ }
  window.dispatchEvent(new Event(EVT));
}
export function useSelectedVersion(): string | null {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    const sync = () => setId(readSelectedVersion());
    sync();
    window.addEventListener(EVT, sync); window.addEventListener("storage", sync);
    return () => { window.removeEventListener(EVT, sync); window.removeEventListener("storage", sync); };
  }, []);
  return id;
}

/** Native versions are not database UUIDs. */
export const BASE_SLUG = "wlc-1.5.6";
export const PRO_SLUG = "wlc-1.7.1-pro";
export const SYSTEM_SLUG = "wlc-1.1.0-system";
export const COPILOT_199_SLUG = "wlc-1.9.9-copilot";
export const SYSTEM_GREETING =
  "Olá. Sou a WLC 1.1.0 System — ambiente Owner isolado. Não uso Gemini. Opero com sistema cognitivo próprio em TypeScript. Envie comandos ou descreva a alteração que deseja no sistema.";
export function customVersionId(id: string | null): string | null {
  return id && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) ? id : null;
}
export function copilotHistoryKey(ownerId: string, projectId: string, versionId: string | null): string {
  return `wlc.copilot.v2.${ownerId}.${projectId}.${versionId ?? BASE_SLUG}`;
}
export function readCustomVersionId(): string | null {
  return customVersionId(readSelectedVersion());
}
export function isProSelected(): boolean { return readSelectedVersion() === PRO_SLUG; }

export function isSystemSelected(): boolean {
  return readSelectedVersion() === SYSTEM_SLUG;
}

export function is199Selected(): boolean {
  return readSelectedVersion() === COPILOT_199_SLUG;
}
