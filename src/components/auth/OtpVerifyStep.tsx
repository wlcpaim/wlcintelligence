import { useEffect, useState } from "react";
import { Check, Copy, Eye, EyeOff, KeyRound, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { extractOtpDigits } from "@/lib/auth-email";

interface OtpVerifyStepProps {
  email: string;
  isNewAccount: boolean;
  generatedPassword: string | null;
  canUsePassword: boolean;
  verifying: boolean;
  resending: boolean;
  cooldown: number;
  onVerify: (code: string) => void;
  onResend: () => void;
  onSwitchToPassword: () => void;
}

export function OtpVerifyStep({
  email,
  isNewAccount,
  generatedPassword,
  canUsePassword,
  verifying,
  resending,
  cooldown,
  onVerify,
  onResend,
  onSwitchToPassword,
}: OtpVerifyStepProps) {
  const [code, setCode] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (code.length === 6 && !verifying) {
      onVerify(code);
    }
  }, [code, verifying, onVerify]);

  async function copyPassword() {
    if (!generatedPassword) return;
    try {
      await navigator.clipboard.writeText(generatedPassword);
      setCopied(true);
      toast.success("Senha copiada.");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Não foi possível copiar.");
    }
  }

  return (
    <div className="space-y-4 animate-in fade-in-0 slide-in-from-bottom-1 duration-200">
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">
          {isNewAccount ? "Confirme sua nova conta" : "Digite o código de 6 dígitos"}
        </p>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Enviamos um código de verificação para <span className="text-foreground">{email}</span>.
        </p>
      </div>

      <div className="flex justify-center py-1">
        <InputOTP
          maxLength={6}
          value={code}
          onChange={(val) => setCode(extractOtpDigits(val))}
          disabled={verifying}
          autoFocus
          inputMode="numeric"
        >
          <InputOTPGroup className="gap-1.5">
            {[0, 1, 2, 3, 4, 5].map((idx) => (
              <InputOTPSlot
                key={idx}
                index={idx}
                className="h-11 w-10 rounded-lg border border-border bg-secondary/70 font-mono text-base font-semibold text-foreground first:rounded-lg last:rounded-lg"
              />
            ))}
          </InputOTPGroup>
        </InputOTP>
      </div>

      {verifying && (
        <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-foreground" />
          <span>Validando código...</span>
        </div>
      )}

      {generatedPassword && (
        <div className="rounded-xl border border-border bg-secondary/40 p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-foreground">
              <KeyRound className="h-3.5 w-3.5 text-success" />
              Senha gerada automaticamente
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setShowPass((v) => !v)}
                aria-label={showPass ? "Ocultar senha" : "Mostrar senha"}
                className="rounded-md p-1 text-muted-foreground hover:text-foreground transition-colors"
              >
                {showPass ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
              <button
                type="button"
                onClick={copyPassword}
                aria-label="Copiar senha"
                className="rounded-md p-1 text-muted-foreground hover:text-foreground transition-colors"
              >
                {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>
          <p className="font-mono text-xs tracking-wider text-foreground bg-background/70 rounded-md px-2.5 py-1.5 select-all break-all">
            {showPass ? generatedPassword : "•".repeat(generatedPassword.length)}
          </p>
          <p className="text-[11px] text-muted-foreground leading-snug">
            Guarde esta senha para futuros acessos — você poderá alterá-la depois quando quiser.
          </p>
        </div>
      )}

      <Button
        type="button"
        disabled={verifying || code.length !== 6}
        onClick={() => onVerify(code)}
        className="w-full"
      >
        {verifying ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Verificando...
          </>
        ) : (
          "Verificar e entrar"
        )}
      </Button>

      <div className="flex items-center justify-between gap-2 pt-1 text-xs">
        <button
          type="button"
          disabled={resending || cooldown > 0}
          onClick={onResend}
          className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors"
        >
          <RefreshCw className={`h-3 w-3 ${resending ? "animate-spin" : ""}`} />
          {cooldown > 0 ? `Reenviar em ${cooldown}s` : resending ? "Reenviando..." : "Reenviar código"}
        </button>

        {canUsePassword && (
          <button
            type="button"
            onClick={onSwitchToPassword}
            className="text-muted-foreground hover:text-foreground underline-offset-4 hover:underline transition-colors"
          >
            Entrar com senha
          </button>
        )}
      </div>
    </div>
  );
}