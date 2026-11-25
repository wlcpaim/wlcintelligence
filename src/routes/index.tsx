import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Code2, Mail, ShieldCheck, Sparkles, Zap } from "lucide-react";
import { lovable } from "@/integrations/lovable";
import { supabase } from "@/integrations/supabase/client";
import { APP_VERSION } from "@/config/app";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { GoogleMono } from "@/components/GoogleMono";
import { SmartEmailAuth } from "@/components/auth/SmartEmailAuth";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "WLC IA — Studio de Inteligência & Código" },
      { name: "description", content: "Engenharia de software acelerada por IA. Code Studio profissional, Copilot nativo nível Cursor e sincronização segura com GitHub." },
      { property: "og:title", content: "WLC IA — Studio de Inteligência & Código" },
      { property: "og:description", content: "Engenharia de software acelerada por IA. Code Studio profissional, Copilot nativo e sincronização segura com GitHub." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Landing,
});

function Landing() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [emailAuthOpen, setEmailAuthOpen] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/code", replace: true });
    });
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") {
        navigate({ to: "/reset-password", replace: true });
        return;
      }
      if (session) navigate({ to: "/code", replace: true });
    });
    return () => data.subscription.unsubscribe();
  }, [navigate]);

  async function signIn() {
    setBusy(true);
    const result = await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin });
    if (result.error) {
      toast.error(`Falha: ${result.error.message}`);
      setBusy(false);
      return;
    }
    if (!result.redirected) {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-black text-zinc-100 selection:bg-zinc-800 overflow-x-hidden">
      {/* subtle top gradient */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-gradient-to-b from-zinc-900/40 to-transparent" />

      <header className="relative w-full max-w-7xl mx-auto px-6 py-8 flex items-center justify-between">
        <div className="text-xl font-bold tracking-tight text-white">WLC / IA</div>
        <Badge variant="outline" className="border-zinc-800 bg-zinc-900/60 text-zinc-400 text-xs font-mono">
          v{APP_VERSION} Beta
        </Badge>
      </header>

      <section className="relative w-full max-w-4xl mx-auto px-6 pt-16 pb-20 text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900/50 px-3 py-1 text-xs text-zinc-400 mb-8">
          <Sparkles className="h-3.5 w-3.5 text-zinc-300" />
          Novo: Copilot Cursor Agent
        </div>

        <h1 className="text-5xl sm:text-6xl font-semibold tracking-tight text-white leading-[1.1] mb-6">
          Engenharia de software
          <br />
          <span className="text-zinc-500">acelerada por IA.</span>
        </h1>

        <p className="text-lg sm:text-xl text-zinc-400 mb-10 max-w-2xl mx-auto leading-relaxed">
          Code Studio profissional com editor, Copilot multi-agente nativo e sincronização segura com GitHub e banco de dados.
        </p>

        <div className="flex flex-col items-center gap-3">
          <div className="flex w-full flex-wrap items-center justify-center gap-3">
            <Button
              onClick={signIn}
              disabled={busy}
              className="h-12 px-8 bg-white hover:bg-zinc-200 text-black font-medium rounded-full transition-all duration-200 shadow-lg shadow-white/5"
            >
              <GoogleMono className="w-4 h-4 mr-2" />
              {busy ? "Conectando..." : "Continuar com Google"}
            </Button>
            {!emailAuthOpen ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => setEmailAuthOpen(true)}
                className="h-12 px-6 border-zinc-800 bg-zinc-950/70 text-zinc-200 hover:bg-zinc-900 rounded-full"
              >
                <Mail className="w-4 h-4 mr-2" />
                Entrar com e-mail
              </Button>
            ) : (
              <SmartEmailAuth onSuccess={() => navigate({ to: "/code", replace: true })} />
            )}
          </div>
        </div>
      </section>

      {/* Code preview card */}
      <section className="relative w-full max-w-5xl mx-auto px-6 pb-20">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950/80 backdrop-blur-sm overflow-hidden shadow-2xl shadow-black/50">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800/80">
            <div className="flex gap-1.5">
              <div className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
              <div className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
              <div className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
            </div>
            <div className="ml-4 text-xs font-mono text-zinc-500">CopilotPanel.tsx</div>
          </div>
          <div className="p-6 sm:p-8 text-sm font-mono text-zinc-400 space-y-1">
            <p><span className="text-zinc-600">{"//"}</span> Agente de programação profissional</p>
            <p>export function <span className="text-zinc-200">CopilotPanel</span>() {"{"}</p>
            <p className="pl-4 text-zinc-300">return &lt;Agent /&gt;</p>
            <p>{"}"}</p>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="relative w-full max-w-6xl mx-auto px-6 pb-24 grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {[
          {
            icon: Code2,
            title: "Copilot Cursor Agent",
            desc: "Gera e edita código com qualidade de produção. Estruturas modernas, limpas e prontas para review.",
          },
          {
            icon: Zap,
            title: "Code Studio",
            desc: "Editor profissional com árvore de projeto, multi-agente 1.9.9 e deploy automatizado na Cloudflare.",
          },
          {
            icon: ShieldCheck,
            title: "Segurança real",
            desc: "Criptografia AES-256-GCM, isolamento por usuário e commits explícitos no GitHub.",
          },
        ].map((item) => (
          <div
            key={item.title}
            className="group p-6 rounded-2xl border border-zinc-800/70 bg-zinc-900/20 hover:bg-zinc-900/40 hover:border-zinc-700 transition-all duration-300"
          >
            <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900/60 text-zinc-300 group-hover:text-white transition-colors">
              <item.icon className="h-5 w-5" />
            </div>
            <h3 className="text-white font-medium mb-2 tracking-tight">{item.title}</h3>
            <p className="text-zinc-400 text-sm leading-relaxed">{item.desc}</p>
          </div>
        ))}
      </section>

      <footer className="relative border-t border-zinc-900/80 py-12 text-center text-zinc-600 text-xs font-mono">
        © {new Date().getFullYear()} WLC IA. Todos os direitos reservados.
      </footer>
    </main>
  );
}
