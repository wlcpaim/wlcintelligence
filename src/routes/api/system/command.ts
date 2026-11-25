/**
 * POST /api/system/command
 * Canal de bridge: outros bots enviam comandos diretos para a System (Owner).
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { handleBridgeCommand, bridgeCommandSchema } from "@/modules/system/bridge/command-bridge";
import { SYSTEM_VERSION } from "@/modules/system/identity";

function userClient(token: string) {
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"]!;
  return createClient<Database>(process.env["SUPABASE_URL"]!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => {
        const h = new Headers(init?.headers);
        h.set("apikey", key);
        h.set("Authorization", `Bearer ${token}`);
        return fetch(input, { ...init, headers: h });
      },
    },
  });
}

export const Route = createFileRoute("/api/system/command")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
        if (!token) return Response.json({ error: "Não autenticado" }, { status: 401 });

        const supabase = userClient(token);
        const { data: auth, error: authErr } = await supabase.auth.getUser(token);
        if (authErr || !auth.user) {
          return Response.json({ error: "Sessão inválida" }, { status: 401 });
        }

        const body = await request.json().catch(() => null);
        const parsed = bridgeCommandSchema.safeParse(body);
        if (!parsed.success) {
          return Response.json(
            { error: "Payload de bridge inválido", details: parsed.error.flatten() },
            { status: 400 },
          );
        }

        try {
          const result = await handleBridgeCommand(parsed.data, auth.user.id, token, supabase);
          return Response.json(
            {
              ...result,
              system: SYSTEM_VERSION.slug,
            },
            {
              status: result.ok ? 200 : 422,
              headers: {
                "cache-control": "no-store",
                "x-wlc-version": SYSTEM_VERSION.slug,
                "x-wlc-pure": "1",
              },
            },
          );
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Falha no bridge.";
          return Response.json({ error: msg }, { status: 500 });
        }
      },
    },
  },
});
