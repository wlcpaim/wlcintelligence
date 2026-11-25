import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Redefinir senha — WLC IA" },
      { name: "description", content: "Defina uma nova senha para acessar sua conta WLC IA." },
      { property: "og:title", content: "Redefinir senha — WLC IA" },
      { property: "og:description", content: "Defina uma nova senha para acessar sua conta WLC IA." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || session) setReady(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (password.length < 6) {
      toast.error("A senha deve ter pelo menos 6 caracteres.");
      return;
    }
    if (password !== confirm) {
      toast.error("As senhas não coincidem.");
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success("Senha atualizada com sucesso.");
      navigate({ to: "/code", replace: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-2xl border bg-card p-6 space-y-4">
        <div className="space-y-1">
          <h1 className="text-lg font-semibold">Definir nova senha</h1>
          <p className="text-sm text-muted-foreground">
            Escolha uma nova senha para concluir o acesso à sua conta.
          </p>
        </div>
        {!ready ? (
          <p className="text-sm text-muted-foreground">
            Abra este link a partir do e-mail de redefinição enviado para sua caixa de entrada.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            <Input
              type="password"
              required
              minLength={6}
              autoComplete="new-password"
              placeholder="Nova senha (mín. 6 caracteres)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <Input
              type="password"
              required
              minLength={6}
              autoComplete="new-password"
              placeholder="Confirmar nova senha"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
            <Button type="submit" disabled={busy} className="w-full">
              {busy ? "Salvando..." : "Salvar nova senha"}
            </Button>
          </form>
        )}
      </div>
    </main>
  );
}