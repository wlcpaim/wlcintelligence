// WLC 1.7.1 PRO — orquestrador multi-agente (regras puras, sem I/O).
// Classifica a intenção da mensagem, escolhe os bots especialistas e monta
// a instrução de orquestração usada pelo motor de IA do usuário.

export const PRO_VERSION = { slug: "wlc-ia-pro-171", name: "WLC IA PRO" } as const;

export type AgentRole = "architect" | "frontend" | "backend" | "dba" | "qa" | "devops" | "systems";
export type Intent =
  | "NEW_FEATURE"
  | "FIX_BUG"
  | "DATABASE_CHANGE"
  | "DEPLOY_INFRA"
  | "UI_IMPROVEMENT"
  | "REFACTOR"
  | "SYSTEMS"
  | "QUALITY"
  | "GENERAL";

export interface Agent { role: AgentRole; name: string; languages: string; mission: string }

export const AGENTS: Record<AgentRole, Agent> = {
  architect: { role: "architect", name: "Arquiteto (Principal)", languages: "TypeScript / Arquitetura", mission: "Principal Architect: contratos, rotas, entidades, bootstrap e diferencial de produto; analisa divergências e só então distribui." },
  frontend: { role: "frontend", name: "Frontend (Staff)", languages: "TypeScript / React / Tailwind CSS", mission: "Staff FE: Mobile First, react-router-dom, CRUD real, auth real, JSX sempre fechado, zero botão morto." },
  backend: { role: "backend", name: "Backend (Staff)", languages: "TypeScript / Supabase / Zod", mission: "Staff BE: services tipados, supabase oficial, auth claim_generated_app_admin, zero SQL arbitrário." },
  dba: { role: "dba", name: "DBA (Staff)", languages: "SQL / PostgreSQL", mission: "Staff Data: manifest + schema coerentes, RLS, colunas de negócio permitidas, zero DDL inventada perigosa." },
  qa: { role: "qa", name: "QA & Debugger (Staff)", languages: "Vitest / Playwright", mission: "Staff QA: causa-raiz, testes úteis, rejeita sintaxe inválida e features ocas." },
  devops: { role: "devops", name: "DevOps (Staff)", languages: "Vite / Cloudflare / Bash", mission: "Staff Platform: package.json sincronizado, _redirects SPA, deploy zero-downtime." },
  systems: { role: "systems", name: "Sistemas Críticos (Staff)", languages: "Go / Rust", mission: "Staff Systems: concorrência, latência, criptografia e limites explícitos." },
};

const RULES: { intent: Intent; pattern: RegExp; agents: AgentRole[]; weight: number }[] = [
  { intent: "FIX_BUG", pattern: /\b(bug|erro|error|falha|quebr|crash|n[aã]o funciona|exception|stack ?trace|corrig)/i, agents: ["qa", "backend", "frontend"], weight: 10 },
  { intent: "DEPLOY_INFRA", pattern: /\b(deploy|cloudflare|build|docker|ci\/?cd|pipeline|wrangler|vari[aá]vel de ambiente|\benv\b|bash|shell|commit)/i, agents: ["devops", "qa"], weight: 9 },
  { intent: "DATABASE_CHANGE", pattern: /\b(tabela|banco|database|sql|postgres|migra[cç]|rls|[ií]ndice|query|schema)/i, agents: ["dba", "backend"], weight: 9 },
  { intent: "SYSTEMS", pattern: /\b(golang|\bgo\b|rust|alta performance|concorr|lat[eê]ncia|throughput|criptograf|websocket|microsservi)/i, agents: ["systems", "architect"], weight: 8 },
  { intent: "QUALITY", pattern: /\b(teste|test|playwright|vitest|qa|seguran[cç]a|vulnerab|xss|csrf)/i, agents: ["qa", "backend"], weight: 8 },
  { intent: "REFACTOR", pattern: /\b(refator|refactor|reorganiz|arquitetur|modulariz|clean code|d[eé]bito t[eé]cnico)/i, agents: ["architect", "backend", "frontend", "qa"], weight: 9 },
  { intent: "UI_IMPROVEMENT", pattern: /\b(tela|layout|bot[aã]o|design|interface|css|tailwind|responsiv|componente|cor|estilo|ui|ux|moderniz|identidade visual|tema|dark mode)/i, agents: ["frontend"], weight: 8 },
  { intent: "NEW_FEATURE", pattern: /\b(cri(e|ar|a)|constru|desenvolv|implement|fa[cç]a um|novo app|aplicativo|sistema|site|plataforma|funcionalidade|feature|admin|dashboard|checkout|autentica)/i, agents: ["architect", "dba", "backend", "frontend", "qa", "devops"], weight: 7 },
];

export interface RoutePlan { intent: Intent; agents: Agent[]; secondary: Intent[] }

/** Escolhe intenção por score de regras; big-build aciona esteira completa. */
export function routeMessage(message: string): RoutePlan {
  const text = message.slice(0, 4000);
  const full = RULES.find((r) => r.intent === "NEW_FEATURE")!;
  const isBigBuild = full.pattern.test(text) && /\b(app|aplicativo|sistema|site|plataforma|completo)/i.test(text);
  if (isBigBuild) {
    return { intent: "NEW_FEATURE", agents: full.agents.map((role) => AGENTS[role]), secondary: [] };
  }

  const scored = RULES
    .map((r) => ({ r, score: r.pattern.test(text) ? r.weight : 0 }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) return { intent: "GENERAL", agents: [AGENTS.architect], secondary: [] };

  const primary = scored[0]!.r;
  const secondary = scored.slice(1, 3).map((s) => s.r.intent);
  // Merge agents: primary first, then unique from secondary hits (cap 5)
  const roles: AgentRole[] = [];
  for (const r of [primary, ...scored.slice(1, 3).map((s) => s.r)]) {
    for (const role of r.agents) {
      if (!roles.includes(role) && roles.length < 5) roles.push(role);
    }
  }
  return { intent: primary.intent, agents: roles.map((role) => AGENTS[role]), secondary };
}

/** Linha visível no início da resposta indicando os bots acionados. */
export function agentsHeader(plan: RoutePlan): string {
  const extra = plan.secondary.length ? ` (também: ${plan.secondary.join(", ")})` : "";
  return `> **${PRO_VERSION.name}** acionou: ${plan.agents.map((a) => a.name).join(" ➜ ")}${extra}\n\n`;
}

/** Instrução de orquestração: cada bot contribui na ordem, e o maestro consolida a entrega. */
export function orchestratorInstruction(plan: RoutePlan): string {
  const team = plan.agents.map((a, i) => `${i + 1}. Bot ${a.name} (${a.languages}): ${a.mission}`).join("\n");
  return `Você é a ${PRO_VERSION.name} (WLC IA PRO) — maestro no padrão Fellow / Distinguished Engineer. Responda em português do Brasil.
Padrão: precisão sintática, contratos estáveis, zero botão morto, auth real, divergências explícitas, código deploy-ready.
Intenção detectada: ${plan.intent}${plan.secondary.length ? ` (+ ${plan.secondary.join(", ")})` : ""}.
Bots acionados, nesta ordem:
${team}
Trabalhe como esteira de Staff Engineers: cada bot usa o resultado do anterior, fecha JSX/chaves e respeita os mesmos nomes de rotas/services/tabelas.
Organize a resposta em seções "### Bot <nome>" e termine com "### Entrega WLC IA PRO" (o que mudou, riscos, próximos passos).
Pergunta simples → resposta curta sem forçar seções.
Nunca invente testes/deploys executados. Antes de mudanças amplas, liste arquivos impactados e riscos de regressão.`;
}
