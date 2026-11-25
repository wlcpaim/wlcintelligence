import { Link, useLocation } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { NAV_ITEMS, isMenuPath } from "./nav-items";

/** Rodapé fixo e minimalista com atalho para cada menu; some dentro de telas abertas. */
export function BottomNav() {
  const pathname = useLocation({ select: l => l.pathname });
  if (!isMenuPath(pathname)) return null;
  return (
    <nav aria-label="Menu principal" className="shrink-0 border-t border-border/60 bg-background">
      <ul className="mx-auto grid max-w-md grid-cols-4">
        {NAV_ITEMS.map(item => {
          const active = pathname === item.to || pathname.startsWith(`${item.to}/`);
          const Icon = item.icon;
          return (
            <li key={item.to}>
              <Link to={item.to} aria-current={active ? "page" : undefined}
                className={cn("flex h-14 flex-col items-center justify-center gap-1 text-[10px] tracking-wide transition-colors",
                  active ? "text-foreground" : "text-subtle hover:text-foreground")}>
                <Icon className="h-5 w-5" strokeWidth={active ? 2 : 1.5} />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
