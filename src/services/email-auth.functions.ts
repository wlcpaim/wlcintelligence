import { createServerFn } from "@tanstack/react-start";
import { setResponseHeader } from "@tanstack/react-start/server";
import { isValidEmail, normalizeEmail } from "@/lib/auth-email";

export interface EmailLookupResult {
  valid: boolean;
  exists: boolean;
  confirmed: boolean;
  hasPassword: boolean;
}

export const checkEmailAccount = createServerFn({ method: "POST" })
  .inputValidator((input: { email: string }) => input)
  .handler(async ({ data }): Promise<EmailLookupResult> => {
    setResponseHeader("Cache-Control", "no-store");

    const email = normalizeEmail(data.email ?? "");
    if (!isValidEmail(email)) {
      return { valid: false, exists: false, confirmed: false, hasPassword: false };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin.rpc("lookup_auth_email", {
      p_email: email,
    });

    if (error) {
      console.error("[checkEmailAccount] lookup failed:", error.message);
      throw new Error("Não foi possível verificar este e-mail agora.");
    }

    const row = Array.isArray(rows) ? rows[0] : undefined;
    if (!row?.exists_account) {
      return { valid: true, exists: false, confirmed: false, hasPassword: false };
    }

    return {
      valid: true,
      exists: true,
      confirmed: Boolean(row.confirmed),
      hasPassword: Boolean(row.has_password),
    };
  });