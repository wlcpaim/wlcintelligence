/**
 * Gestão de APIs para a WLC 1.9.9.
 * Ideal: uma API por especialista. Mínimo recomendado: 2 APIs conectadas.
 * O pipeline continua funcionando com menos APIs (reutiliza as disponíveis).
 */

import type { GeminiKeyView } from "@/modules/integrations/gemini/types";
import type { SpecialistRole } from "../identity";

export interface DualKeyStatus {
  ok: boolean;
  count: number;
  keys: GeminiKeyView[];
  /** Mapeamento role → key (quando há chaves suficientes) */
  assignment: Partial<Record<SpecialistRole, GeminiKeyView>>;
  message?: string;
  /** Uso por chave nesta execução (para escolher a API menos usada). */
  usage?: Map<string, number>;
}

const ROLE_ORDER: SpecialistRole[] = [
  "architect",
  "design",
  "frontend",
  "backend",
  "dba",
  "qa",
  "devops",
  "code_analyst",
  "diagnostics",
];

/** Retorna status das chaves e tenta atribuir uma por papel. */
export function checkDualKeys(keys: GeminiKeyView[]): DualKeyStatus {
  const usable = keys.filter(
    (k) => k.enabled && k.status === "connected" && !k.cooldown_until,
  );

  if (usable.length === 0) {
    return {
      ok: false,
      count: 0,
      keys: [],
      assignment: {},
      message:
        "Nenhuma API Gemini conectada. Cadastre e diagnostique pelo menos 2 chaves em Configurações para a WLC 1.9.9 funcionar bem.",
    };
  }

  // Preferir primary primeiro, depois as demais na ordem de criação
  const ordered = [
    ...usable.filter((k) => k.is_primary),
    ...usable.filter((k) => !k.is_primary),
  ];

  const assignment: Partial<Record<SpecialistRole, GeminiKeyView>> = {};
  for (let i = 0; i < ROLE_ORDER.length; i++) {
    const role = ROLE_ORDER[i];
    const key = ordered[i % ordered.length];
    if (role && key) assignment[role] = key;
  }

  const ok = usable.length >= 2;
  return {
    ok,
    count: usable.length,
    keys: ordered,
    assignment,
    ...(ok
      ? {}
      : {
          message:
            "Recomendado: pelo menos 2 APIs Gemini conectadas. Com 1 API o pipeline ainda roda, mas os especialistas compartilham a mesma chave.",
        }),
  };
}

/** Retorna a chave atribuída a um papel (ou a primary se não houver). */
export function keyForRole(
  status: DualKeyStatus,
  role: SpecialistRole,
): GeminiKeyView | undefined {
  return status.assignment[role] ?? status.keys[0];
}
