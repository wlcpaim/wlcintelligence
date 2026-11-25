/** Detecta mensagens puramente conversacionais (ex.: "oi") que não devem disparar o time inteiro. */
const SMALL_TALK = /^(oi+|ol[aá]|opa|e\s*a[ií]|bom\s+dia|boa\s+(tarde|noite)|hello|hi|hey|tudo\s+(bem|bom)|obrigad[oa]|valeu|ok|blz|beleza|teste)[\s!.?,]*$/i;

export function isSmallTalk(request: string): boolean {
  const t = request.trim();
  if (!t) return true;
  return t.length <= 40 && SMALL_TALK.test(t);
}

export const SMALL_TALK_REPLY =
  "Olá! 👋 Sou o time WLC 1.9.9. Descreva o que quer construir (ex.: \"landing page de academia com planos, depoimentos e formulário\") e o time gera o código completo, pronto para compilar e publicar.";
