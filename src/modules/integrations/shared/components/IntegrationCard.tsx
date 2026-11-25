import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StateBadge, fmtDate } from "./StateBadge";

export function IntegrationCard(props: {
  to: "/settings/gemini" | "/settings/github" | "/settings/cloudflare";
  icon: ReactNode;
  title: string;
  state: string;
  lastCheck: string | null;
  rows: [string, ReactNode][];
}) {
  return (
    <Card className="flex flex-col">
      <CardHeader className="flex flex-row items-center gap-3 space-y-0">
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-muted">{props.icon}</div>
        <CardTitle className="flex-1 text-base">{props.title}</CardTitle>
        <StateBadge state={props.state} />
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          {props.rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="min-w-0 truncate text-right">{v}</dd>
            </div>
          ))}
          <dt className="text-muted-foreground">Última verificação</dt>
          <dd className="text-right">{fmtDate(props.lastCheck)}</dd>
        </dl>
        <Button asChild className="mt-auto">
          <Link to={props.to}>Gerenciar</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
