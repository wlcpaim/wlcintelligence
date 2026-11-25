import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { IntegrationCard } from "@/modules/integrations/shared/components/IntegrationCard";
import { GoogleMono } from "@/components/GoogleMono";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Cloud, Github } from "lucide-react";
import { QuickSetupButton } from "@/modules/integrations/quick-setup/QuickSetupButton";
import { cloudflareQuery } from "@/modules/integrations/cloudflare/queries";
import { geminiQuery } from "@/modules/integrations/gemini/queries";
import { githubQuery, githubReposQuery } from "@/modules/integrations/github/queries";

export const Route = createFileRoute("/_authenticated/settings/")({
  head: () => ({
    meta: [
      { title: "API — WLC IA" },
      {
        name: "description",
        content: "Central de integrações do WLC IA: Connect Gemini e Connect GitHub.",
      },
      { property: "og:title", content: "API — WLC IA" },
      { property: "og:description", content: "Gerencie Gemini e GitHub com segurança." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: IntegrationsHub,
});

function IntegrationsHub() {
  const g = useQuery(geminiQuery);
  const gh = useQuery(githubQuery);
  const repos = useQuery({ ...githubReposQuery, enabled: !!gh.data?.account });
  const cf = useQuery(cloudflareQuery);
  const cfa = cf.data?.account;
  const keys = g.data?.keys ?? [];
  const primary = keys.find((k) => k.is_primary);
  const gState =
    keys.length === 0 ? "not_configured" : primary?.enabled ? primary.status : "disabled";
  const acc = gh.data?.account;
  const lastG =
    keys
      .map((k) => k.last_checked_at)
      .filter(Boolean)
      .sort()
      .at(-1) ?? null;
  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="mx-auto grid max-w-4xl gap-4 md:grid-cols-2">
          <QuickSetupButton />
          <IntegrationCard
            to="/settings/gemini"
            icon={<GoogleMono className="h-5 w-5" />}
            title="Connect Gemini"
            state={g.isLoading ? "unknown" : gState}
            lastCheck={lastG}
            rows={[
              ["Provedor", "Google Gemini"],
              ["Projeto principal", primary?.google_project || primary?.label || "—"],
              ["Chaves", String(keys.length)],
              ["Modelo principal", primary?.model ?? "—"],
            ]}
          />
          <IntegrationCard
            to="/settings/github"
            icon={
              acc?.avatar_url ? (
                <Avatar className="h-10 w-10">
                  <AvatarImage src={acc.avatar_url} alt="" />
                  <AvatarFallback>GH</AvatarFallback>
                </Avatar>
              ) : (
                <Github className="h-5 w-5" />
              )
            }
            title="Connect GitHub"
            state={gh.isLoading ? "unknown" : acc ? acc.status : "not_configured"}
            lastCheck={acc?.last_checked_at ?? null}
            rows={[
              ["Conta", acc?.login ? `@${acc.login}` : "—"],
              ["Repositórios", acc ? (repos.data ? String(repos.data.length) : "…") : "—"],
              ["Repositório padrão", gh.data?.selected ?? "—"],
            ]}
          />
          <IntegrationCard
            to="/settings/cloudflare"
            icon={<Cloud className="h-5 w-5" />}
            title="Connect Cloudflare"
            state={cf.isLoading ? "unknown" : cfa ? "connected" : "not_configured"}
            lastCheck={cfa?.last_checked_at ?? null}
            rows={[
              ["Conta", cfa?.account_name ?? "—"],
              ["Serviço", "Cloudflare Pages"],
            ]}
          />
        </div>
      </div>
    </div>
  );
}
