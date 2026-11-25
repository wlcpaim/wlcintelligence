const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWER = "abcdefghijkmnopqrstuvwxyz";
const DIGITS = "23456789";
const SYMBOLS = "!@#$%&*";
const ALL_CHARS = UPPER + LOWER + DIGITS + SYMBOLS;

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function isValidEmail(value: string): boolean {
  const normalized = normalizeEmail(value);
  return normalized.length <= 254 && EMAIL_REGEX.test(normalized);
}

export function extractOtpDigits(value: string): string {
  return value.replace(/\D/g, "").slice(0, 6);
}

function pickChar(alphabet: string, byte: number): string {
  return alphabet[byte % alphabet.length] ?? alphabet[0]!;
}

/**
 * Generates a cryptographically strong 14-char password containing at least one
 * uppercase letter, lowercase letter, digit, and symbol.
 */
export function generateSecurePassword(length = 14): string {
  const safeLength = Math.max(12, Math.min(length, 32));
  const bytes = new Uint8Array(safeLength + 4);
  crypto.getRandomValues(bytes);

  const chars: string[] = [
    pickChar(UPPER, bytes[0] ?? 0),
    pickChar(LOWER, bytes[1] ?? 0),
    pickChar(DIGITS, bytes[2] ?? 0),
    pickChar(SYMBOLS, bytes[3] ?? 0),
  ];

  for (let i = 4; i < safeLength; i++) {
    chars.push(pickChar(ALL_CHARS, bytes[i] ?? 0));
  }

  // Fisher-Yates shuffle using crypto bytes
  for (let i = chars.length - 1; i > 0; i--) {
    const j = (bytes[i] ?? 0) % (i + 1);
    const tmp = chars[i]!;
    chars[i] = chars[j]!;
    chars[j] = tmp;
  }

  return chars.join("");
}