import { Settings, BrainCircuit, Code2 } from "lucide-react";

/** Lista única de destinos do rodapé de navegação. */
export const NAV_ITEMS = [
  { to: "/code", label: "Code", icon: Code2 },
  { to: "/wlcia", label: "WLC.IA", icon: BrainCircuit },
  { to: "/settings", label: "Config", icon: Settings },
] as const;

/** Telas de menu (mostram o rodapé). Telas abertas (projeto, treino) usam botão de voltar. */
export function isMenuPath(pathname: string): boolean {
  const p = pathname.replace(/\/+$/, "") || "/";
  return p === "/code" || p === "/wlcia" || p === "/settings" || p.startsWith("/settings/");
}
