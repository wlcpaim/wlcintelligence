import { createFileRoute, Link, Outlet, useLocation } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/settings")({
  component: SettingsLayout,
});

const tab = "rounded-md px-3 py-1.5 text-sm transition-colors";
const on = "bg-primary text-primary-foreground";
const off = "text-muted-foreground hover:text-foreground";

function SettingsLayout() {
  const path = useLocation({ select: (l) => l.pathname });
  const isDb = path.startsWith("/settings/database");
  const isProfile = path.startsWith("/settings/profile");
  const isSys = path.startsWith("/settings/sistema");
  const isDep = path.startsWith("/settings/deploy");
  const isRepos = path.startsWith("/settings/repositories");
  const isBackup = path.startsWith("/settings/backup");
  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2">
        <h1 className="mr-2 text-sm font-semibold">Configurações</h1>
        <nav aria-label="Seções de configurações" className="flex flex-wrap gap-1">
          <Link to="/settings" className={cn(tab, isDb || isProfile || isSys || isDep || isRepos || isBackup ? off : on)}>
            API
          </Link>
          <Link to="/settings/database" className={cn(tab, isDb ? on : off)}>
            Banco de Dados
          </Link>
          <Link to="/settings/deploy" className={cn(tab, isDep ? on : off)}>
            Deploy
          </Link>
          <Link to="/settings/repositories" className={cn(tab, isRepos ? on : off)}>
            Repositórios
          </Link>
          <Link to="/settings/backup" className={cn(tab, isBackup ? on : off)}>
            Backups
          </Link>
          <Link to="/settings/sistema" className={cn(tab, isSys ? on : off)}>
            Sistema
          </Link>
          <Link to="/settings/profile" className={cn(tab, isProfile ? on : off)}>
            Perfil
          </Link>
        </nav>
      </header>
      <div className="min-h-0 flex-1">
        <Outlet />
      </div>
    </div>
  );
}
