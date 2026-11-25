/**
 * Helpers do pipeline colaborativo da WLC 1.9.9.
 * O Arquiteto entrega plano concreto + contratos; cada tarefa já nasce conectada.
 */

import { SPECIALISTS, type SpecialistRole } from "../identity";
import type { ExtractedStructure } from "./extractor";

export interface DistributionItem {
  role: SpecialistRole;
  task: string;
  /** Arquivos que este bot pode criar/editar */
  owns?: string[];
  /** Como se liga ao resto do plano */
  connects_to?: string[];
  priority?: number;
}

export interface PipelineContracts {
  shared_types: string[];
  design_tokens: { name: string; hex: string }[];
  routes: { path: string; page: string }[];
  integrations: string[];
  modules?: { path: string; exports: string[]; signatures: string[] }[];
}

export interface PipelinePlan {
  intent: string;
  structure: { folders: string[]; files: string[] };
  contracts: PipelineContracts;
  palette_hints: { name: string; hex: string }[];
  distribution: DistributionItem[];
  notes?: string;
}

/** Filtra só roles válidos e ordena por fase + prioridade. */
export function normalizeDistribution(items: DistributionItem[]): DistributionItem[] {
  const valid = items.filter((i) => i.role in SPECIALISTS && i.task.trim().length > 0);
  return valid.sort((a, b) => {
    const pa = SPECIALISTS[a.role].phase;
    const pb = SPECIALISTS[b.role].phase;
    if (pa !== pb) return pa - pb;
    return (a.priority ?? 99) - (b.priority ?? 99);
  });
}

/** Junta o plano do Arquiteto com a estrutura extraída do texto. */
export function mergePlanWithExtraction(
  plan: PipelinePlan | null,
  extracted: ExtractedStructure,
): PipelinePlan {
  if (!plan) {
    return {
      intent: "pedido do usuário",
      structure: {
        folders: extracted.folders,
        files: extracted.files,
      },
      contracts: {
        shared_types: [],
        design_tokens: extracted.palette,
        routes: [],
        integrations: [],
      },
      palette_hints: extracted.palette,
      distribution: extracted.categories
        .filter((c): c is SpecialistRole => c in SPECIALISTS)
        .map((role, i) => ({
          role,
          task: `Implementar a parte de ${SPECIALISTS[role].name} conforme o pedido, respeitando a estrutura e conectando ao todo`,
          priority: i + 1,
        })),
      notes: extracted.rawHints.slice(0, 5).join("; "),
    };
  }

  const folders = [...new Set([...plan.structure.folders, ...extracted.folders])];
  const files = [...new Set([...plan.structure.files, ...extracted.files])];
  const palette =
    plan.contracts.design_tokens.length
      ? plan.contracts.design_tokens
      : plan.palette_hints.length
        ? plan.palette_hints
        : extracted.palette;

  return {
    ...plan,
    structure: { folders, files },
    contracts: {
      ...plan.contracts,
      design_tokens: palette,
    },
    palette_hints: palette,
    distribution: normalizeDistribution(plan.distribution),
  };
}

/** Texto de contexto rico para injetar nos especialistas (com contratos). */
export function planToSpecialistContext(plan: PipelinePlan, role: SpecialistRole): string {
  const item = plan.distribution.find((d) => d.role === role);
  const lines = [
    `### Contexto do time WLC 1.9.9 — você é o ${SPECIALISTS[role].name}`,
    `Resultado final desejado: ${plan.intent}`,
    item ? `Sua tarefa: ${item.task}` : `Missão padrão: ${SPECIALISTS[role].mission}`,
  ];
  if (item?.owns?.length) {
    lines.push(`Arquivos sob sua responsabilidade: ${item.owns.join(", ")}`);
  }
  if (item?.connects_to?.length) {
    lines.push(`Conexões obrigatórias:`);
    for (const c of item.connects_to) lines.push(`  - ${c}`);
  }
  if (plan.structure.folders.length) {
    lines.push(`Pastas do plano: ${plan.structure.folders.join(", ")}`);
  }
  if (plan.structure.files.length) {
    lines.push(`Arquivos do plano: ${plan.structure.files.join(", ")}`);
  }
  const c = plan.contracts;
  if (c.shared_types.length) {
    lines.push(`Tipos/contratos compartilhados:`);
    for (const t of c.shared_types) lines.push(`  - ${t}`);
  }
  if (c.design_tokens.length) {
    lines.push(`Tokens de design:`);
    for (const t of c.design_tokens) lines.push(`  - ${t.name}: ${t.hex}`);
  }
  if (c.routes.length) {
    lines.push(`Rotas (obrigatório usar react-router-dom; proibido useState para páginas mestras):`);
    for (const r of c.routes) lines.push(`  - ${r.path} → ${r.page}`);
    lines.push(`  - Vitrine pública em / não deve expor links/CTAs de admin; /admin é isolado.`);
  }
  if (c.integrations.length) {
    lines.push(`Integrações entre partes:`);
    for (const i of c.integrations) lines.push(`  - ${i}`);
  }
  if (role === "backend" || role === "dba") {
    lines.push(`Persistência: criar/usar src/lib/supabase.ts + schema.sql; serviços com supabase.from().select()/insert() e fallback local.`);
  }
  if (plan.notes) lines.push(`Notas do Arquiteto: ${plan.notes}`);
  return lines.join("\n");
}
