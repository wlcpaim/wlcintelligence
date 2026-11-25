/**
 * POST /api/system/chat
 * Endpoint exclusivo da WLC 1.1.0 System.
 * Não passa por Gemini. Usa o sistema cognitivo próprio.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { z } from "zod";
import { handleSystemMessage } from "@/modules/system/services/system-chat.server";
import { SYSTEM_VERSION } from "@/modules/system/identity";

const inputSchema = z.object({
  conversationId: z.string().uuid().optional(),
  message: z.string().trim().min(1).max(100_000),
  confirm: z.boolean().optional(),
});

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

export const Route = createFileRoute("/api/system/chat")({
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
        const userId = auth.user.id;

        const body = await request.json().catch(() => null);
        const parsed = inputSchema.safeParse(body);
        if (!parsed.success) {
          return Response.json({ error: "Mensagem inválida." }, { status: 400 });
        }

        const { message, conversationId, confirm } = parsed.data;

        try {
          const output = await handleSystemMessage({
            message,
            userId,
            conversationId,
            confirm,
            authToken: token,
            db: supabase,
          });

          // Resposta em formato compatível com o streaming do chat normal
          // (o frontend System não precisa de stream, mas mantemos NDJSON simples)
          const modelId = crypto.randomUUID();
          const events = [
            { type: "delta", text: output.reply },
            {
              type: "complete",
              text: output.reply,
              id: modelId,
              version: SYSTEM_VERSION.slug,
              pure: true,
              connection: output.result.data?.["connection"],
            },
          ];

          const stream = new ReadableStream({
            start(controller) {
              const enc = new TextEncoder();
              for (const ev of events) {
                controller.enqueue(enc.encode(JSON.stringify(ev) + "\n"));
              }
              controller.close();
            },
          });

          return new Response(stream, {
            headers: {
              "content-type": "application/x-ndjson; charset=utf-8",
              "cache-control": "no-store",
              "x-wlc-version": SYSTEM_VERSION.slug,
              "x-wlc-pure": "1",
            },
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Falha no System.";
          return Response.json({ error: msg }, { status: 500 });
        }
      },
    },
  },
});
