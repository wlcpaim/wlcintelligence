import type { ReactNode } from "react";
import { BottomNav } from "./BottomNav";

/**
 * Shell principal: área de conteúdo + rodapé de navegação nas telas de menu.
 * Telas abertas (conversa, projeto, treino) ficam em tela cheia com botão de voltar.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="fixed inset-0 flex min-h-0 flex-col overflow-hidden bg-background text-foreground antialiased pt-safe pb-safe">
      <main className="min-h-0 min-w-0 flex-1 overflow-hidden">{children}</main>
      <BottomNav />
    </div>
  );
}
