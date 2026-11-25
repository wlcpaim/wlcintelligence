import { useEffect, useState, type FormEvent } from "react";
import { ArrowRight, Check, Loader2, Mail } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { isValidEmail, normalizeEmail } from "@/lib/auth-email";

interface SmartEmailAuthProps {
  onSuccess?: () => void;
}

/**
 * Compact, account-agnostic email access: the same confirmation is sent
 * whether the address already has an account or not.
 */
export function SmartEmailAuth(_props: SmartEmailAuthProps) {
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = window.setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => window.clearInterval(id);
  }, [cooldown]);

  async function send() {
    const normalized = normalizeEmail(email);
    if (!isValidEmail(normalized)) {
      toast.error("Informe um e-mail válido.");
      return;
    }
    setEmail(normalized);
    setSending(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: normalized,
        options: { shouldCreateUser: true, emailRedirectTo: window.location.origin },
      });
      if (error && error.status === 429) {
        toast.error("Aguarde alguns instantes antes de tentar novamente.");
        return;
      }
      setSent(true);
      setCooldown(60);
    } finally {
      setSending(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void send();
  }

  if (sent) {
    return (
      <div className="flex w-full max-w-sm flex-col items-center gap-1.5 animate-in fade-in-0 duration-200">
        <div className="flex h-12 w-full items-center gap-3 rounded-full border border-border bg-secondary/60 px-4 backdrop-blur-md">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Check className="h-3.5 w-3.5" />
          </span>
          <p className="truncate text-sm text-foreground">Enviamos uma confirmação em seu e-mail</p>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="max-w-[160px] truncate">{email}</span>
          <span>·</span>
          <button
            type="button"
            disabled={cooldown > 0 || sending}
            onClick={() => void send()}
            className="hover:text-foreground disabled:opacity-50"
          >
            {cooldown > 0 ? `Reenviar em ${cooldown}s` : "Reenviar"}
          </button>
          <span>·</span>
          <button type="button" onClick={() => setSent(false)} className="hover:text-foreground">
            Trocar
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="w-full max-w-sm animate-in fade-in-0 zoom-in-95 duration-200">
      <label htmlFor="smart-email-input" className="sr-only">Seu e-mail</label>
      <div className="flex h-12 items-center rounded-full border border-border bg-secondary/60 pl-4 pr-1.5 backdrop-blur-md transition-colors focus-within:border-foreground/40">
        <Mail className="pointer-events-none h-4 w-4 shrink-0 text-muted-foreground" />
        <input
          id="smart-email-input"
          type="email"
          required
          autoFocus
          autoComplete="email"
          placeholder="nome@exemplo.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="h-full min-w-0 flex-1 bg-transparent px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
        <button
          type="submit"
          aria-label="Enviar"
          disabled={sending || !isValidEmail(normalizeEmail(email))}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-all hover:opacity-90 disabled:opacity-30"
        >
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
        </button>
      </div>
    </form>
  );
}
