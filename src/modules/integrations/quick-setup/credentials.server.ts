// Lê credenciais opcionais exclusivamente de variáveis de ambiente do servidor (nunca hardcoded).
export function getPresetGeminiKeys(): string[] {
  const raw = process.env["QUICK_SETUP_GEMINI_KEYS"]?.trim();
  if (!raw) return [];
  if (raw.startsWith("[")) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.filter((v): v is string => typeof v === "string" && v.trim().length > 0).map((v) => v.trim());
      }
    } catch {
      return [];
    }
  }
  return raw
    .split(/[\n,]+/)
    .map((v) => v.trim())
    .filter(Boolean);
}