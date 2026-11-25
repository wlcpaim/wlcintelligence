import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/modules/integrations/shared/components/PageHeader";
import { CloudflareManager } from "@/modules/integrations/cloudflare/components/CloudflareManager";

export const Route = createFileRoute("/_authenticated/settings/cloudflare")({
  head: () => ({
    meta: [
      { title: "Connect Cloudflare — WLC IA" },
      { name: "description", content: "Configure a Cloudflare para publicar projetos do WLC IA Code." },
      { property: "og:title", content: "Connect Cloudflare — WLC IA" },
      { property: "og:description", content: "Account ID e API Token para o Deploy." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <div className="flex h-full flex-col">
      <PageHeader title="Connect Cloudflare" back />
      <div className="min-h-0 flex-1 overflow-y-auto p-4"><CloudflareManager /></div>
    </div>
  ),
});
