import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/modules/integrations/shared/components/PageHeader";
import { GithubManager } from "@/modules/integrations/github/components/GithubManager";

export const Route = createFileRoute("/_authenticated/settings/github")({
  head: () => ({
    meta: [
      { title: "Connect GitHub — WLC IA" },
      {
        name: "description",
        content: "Gerenciamento e diagnóstico da integração Connect GitHub no WLC IA.",
      },
      { property: "og:title", content: "Connect GitHub — WLC IA" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      {
        property: "og:description",
        content: "Gerenciamento e diagnóstico da integração Connect GitHub.",
      },
    ],
  }),
  component: () => (
    <div className="flex h-full flex-col">
      <PageHeader title="Connect GitHub" back />
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <GithubManager />
      </div>
    </div>
  ),
});
