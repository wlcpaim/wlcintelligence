import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { LogOut } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

export const Route = createFileRoute("/_authenticated/settings/profile")({
  head: () => ({
    meta: [
      { title: "Perfil — WLC IA" },
      { name: "description", content: "Sua conta no WLC IA." },
      { property: "og:title", content: "Perfil — WLC IA" },
      { property: "og:description", content: "Dados da conta e saída segura." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ProfilePage,
});

function ProfilePage() {
  const { user } = Route.useRouteContext();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const meta = user.user_metadata as Record<string, string | undefined>;
  const name = meta["full_name"] ?? meta["name"] ?? user.email ?? "Usuário";
  const avatar = meta["avatar_url"] ?? meta["picture"];

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/", replace: true });
  }

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="mx-auto max-w-md space-y-6 rounded-2xl border bg-card p-6">
        <div className="flex items-center gap-4">
          <Avatar className="h-14 w-14">
            {avatar && <AvatarImage src={avatar} alt="" />}
            <AvatarFallback>{name.slice(0, 2).toUpperCase()}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate font-semibold">{name}</p>
            <p className="truncate text-sm text-muted-foreground">{user.email}</p>
          </div>
        </div>
        <Button variant="destructive" className="w-full" onClick={() => void signOut()}>
          <LogOut className="mr-2 h-4 w-4" /> Sair da conta
        </Button>
      </div>
    </div>
  );
}
