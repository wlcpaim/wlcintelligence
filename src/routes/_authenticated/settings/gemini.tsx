import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/modules/integrations/shared/components/PageHeader";
import { GeminiManager } from "@/modules/integrations/gemini/components/GeminiManager";

export const Route = createFileRoute("/_authenticated/settings/gemini")({
  head: () => ({
    meta: [
      { title: "Connect Gemini — WLC IA" },
      {
        name: "description",
        content: "Gerenciamento e diagnóstico da integração Connect Gemini no WLC IA.",
      },
      { property: "og:title", content: "Connect Gemini — WLC IA" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      {
        property: "og:description",
        content: "Gerenciamento e diagnóstico da integração Connect Gemini.",
      },
    ],
  }),
  component: () => (
    <div className="flex h-full flex-col">
      <PageHeader title="Connect Gemini" back />
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <GeminiManager />
      </div>
    </div>
  ),
});
