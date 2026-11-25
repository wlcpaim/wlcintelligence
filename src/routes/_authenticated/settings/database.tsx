import { createFileRoute } from "@tanstack/react-router";
import { DatabasePanel } from "@/components/settings/DatabasePanel";

export const Route = createFileRoute("/_authenticated/settings/database")({
  head: () => ({
    meta: [
      { title: "Banco de Dados — WLC IA" },
      { name: "description", content: "Tabelas, estrutura e estado do banco de dados do WLC IA." },
      { property: "og:title", content: "Banco de Dados — WLC IA" },
      { property: "og:description", content: "Estrutura e estado do banco de dados do WLC IA." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <div className="h-full overflow-y-auto overflow-x-hidden p-4">
      <DatabasePanel />
    </div>
  ),
});
