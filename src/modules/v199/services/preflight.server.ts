import type { Db } from "@/modules/integrations/core/runs.server";
import { redactSecrets } from "@/modules/integrations/github/services/repository.server";
import { findSyntaxIssues } from "@/modules/code/edit-integrity";
import { GENERATED_APP_CLIENT_SOURCE } from "../../engineering/generated-app-contract";
import { inspectContracts, type ContractFile } from "../core/contracts";
import { diagnoseBuildReadiness } from "../core/bootstrap";
import { findMissingLocalImports } from "../core/gaps";
import { reconcileMissingDependencies } from "../core/dependencies";
import { visualBootstrap } from "../core/visual-bootstrap";
import { proposeSurgicalRepair } from "./quality.server";

export function publicationIssues(files: ContractFile[]): string[] {
  return [...new Set([
    ...inspectContracts(files).issues.map(i => `${i.path}: ${i.message}`),
    ...diagnoseBuildReadiness(files).map(i => `${i.path}: ${i.message}`),
    ...findMissingLocalImports(files).map(i => `${i.importer}: falta ${i.target}`),
    // Sintaxe local (delimitadores/JSX) também bloqueia publicação e dispara autocorreção
    ...findSyntaxIssues(files).filter(i => i.severity === "error").map(i => `${i.path}: ${i.message}`),
  ])];
}

/** Reescreve o cliente isolado oficial quando ausente ou com sintaxe quebrada (cura determinística, sem LLM). */
function healBrokenGeneratedClient(files: ContractFile[]): ContractFile[] {
  const path = "src/lib/generated-app-client.ts";
  const existing = files.find(f => f.path === path || f.path === "src/lib/generated-app-client");
  if (!existing) {
    return [{ path, content: GENERATED_APP_CLIENT_SOURCE }];
  }
  const syntax = findSyntaxIssues([existing]);
  if (syntax.some(i => i.severity === "error")) {
    return [{ path, content: GENERATED_APP_CLIENT_SOURCE }];
  }
  // Conteúdo divergente do contrato oficial (IA reescreveu) — restaura canônico
  const normalized = existing.content.replace(/\s+/g, " ").trim();
  const canonical = GENERATED_APP_CLIENT_SOURCE.replace(/\s+/g, " ").trim();
  if (!normalized.includes("createGeneratedAppClient") || normalized.length < canonical.length * 0.5) {
    return [{ path, content: GENERATED_APP_CLIENT_SOURCE }];
  }
  return [];
}

/** Minimal deterministic stubs for missing local modules (pages/components) so preflight can unblock. */
function stubMissingLocalImports(files: ContractFile[]): ContractFile[] {
  const missing = findMissingLocalImports(files);
  const existing = new Set(files.map(f => f.path));
  const stubs: ContractFile[] = [];
  const seen = new Set<string>();
  for (const m of missing) {
    if (existing.has(m.target) || seen.has(m.target)) continue;
    seen.add(m.target);

    // Auto-cura do cliente isolado de banco de dados
    if (m.target === "src/lib/generated-app-client.ts" || m.target === "src/lib/generated-app-client") {
      stubs.push({ path: "src/lib/generated-app-client.ts", content: GENERATED_APP_CLIENT_SOURCE });
      continue;
    }

    const isPage = /\/pages?\//.test(m.target) || /\/routes?\//.test(m.target);
    const isComponent = /\/components?\//.test(m.target);
    const baseName = m.target.split("/").pop()?.replace(/\.(tsx?|jsx?)$/, "") || "Missing";
    const componentName =
      baseName
        .replace(/(^|[-_])(\w)/g, (_, __, c: string) => c.toUpperCase())
        .replace(/[^A-Za-z0-9]/g, "") || "MissingPage";
    let content: string;
    if (isPage || isComponent) {
      content = `export default function ${componentName}() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold">${componentName}</h1>
      <p className="text-muted-foreground mt-2">Página gerada automaticamente para desbloquear a publicação.</p>
    </div>
  );
}
export { ${componentName} };
`;
    } else if (m.target.endsWith(".ts") || m.target.endsWith(".js")) {
      content = `// Stub gerado automaticamente (módulo ausente: ${m.target})
export {};
export default {};
`;
    } else {
      content = `export default function ${componentName}() {
  return <div>${componentName}</div>;
}
export { ${componentName} };
`;
    }
    stubs.push({ path: m.target, content });
  }
  return stubs;
}

/** Bounded preflight healing: no provider commit until all blocking checks pass. */
export async function healPreflightIntegrity(db: Db, userId: string, projectId: string, baseSha: string | null, signal: AbortSignal) {
  const rows: { id: string; path: string; content: string; updated_at: string }[] = [];
  for (let from = 0; ; from += 1000) {
    const result = await db.from("code_files").select("id,path,content,updated_at").eq("project_id", projectId).eq("user_id", userId).eq("deleted", false).range(from, from + 999);
    if (result.error || !result.data) throw new Error("Não foi possível ler os arquivos para corrigir a publicação.");
    rows.push(...result.data);
    if (result.data.length < 1000) break;
  }
  const map = new Map<string, ContractFile>(rows.map(f => [f.path, { path: f.path, content: f.content }]));
  const apply = (changes: ContractFile[]) => { for (const c of changes) map.set(c.path, c); };

  const runDeterministicHeals = () => {
    apply(visualBootstrap([...map.values()]).changes);
    apply(reconcileMissingDependencies([...map.values()]));
    apply(healBrokenGeneratedClient([...map.values()]));
    apply(stubMissingLocalImports([...map.values()]));
    const current = [...map.values()];
    const readiness = diagnoseBuildReadiness(current);
    if (readiness.some(i => i.path === "public/_redirects") && !map.has("public/_redirects")) {
      apply([{ path: "public/_redirects", content: "/* /index.html 200\n" }]);
    }
  };

  // Rodadas gerais de integridade (imports, contratos, sintaxe)
  for (let round = 0; round < 3; round++) {
    signal.throwIfAborted();
    runDeterministicHeals();
    const current = [...map.values()];
    const issues = publicationIssues(current);
    if (!issues.length) break;
    const missing = findMissingLocalImports(current);
    const readiness = diagnoseBuildReadiness(current);
    const syntaxBroken = findSyntaxIssues(current).filter(i => i.severity === "error").map(i => i.path);
    const allowed = new Set([
      ...inspectContracts(current).issues.flatMap(i => i.target ? [i.path, i.target] : [i.path]),
      ...readiness.map(i => i.path),
      ...missing.flatMap(m => [m.importer, m.target]),
      ...syntaxBroken,
      "package.json", "vite.config.ts", "src/lib/supabase.ts", "src/lib/generated-app-client.ts",
      "src/App.tsx", "src/main.tsx",
    ]);
    try {
      const changes = await proposeSurgicalRepair(db, userId, current, issues, allowed, signal);
      if (!changes.length) {
        // Sem diff: se ainda há sintaxe quebrada, continua para a fase dedicada abaixo
        if (!syntaxBroken.length) break;
        continue;
      }
      apply(changes);
    } catch (e) {
      signal.throwIfAborted();
      // Não aborta o pré-voo inteiro na 1ª falha de API — tenta fase de sintaxe
      if (round === 2) {
        throw new Error(`Autocorreção não concluída: ${redactSecrets(e instanceof Error ? e.message : "erro desconhecido")}`);
      }
    }
  }

  // Fase dedicada: time cirúrgico focado só em arquivos com delimitadores/JSX inválidos
  for (let syntaxRound = 0; syntaxRound < 2; syntaxRound++) {
    signal.throwIfAborted();
    runDeterministicHeals();
    const current = [...map.values()];
    const syntaxErrors = findSyntaxIssues(current).filter(i => i.severity === "error");
    if (!syntaxErrors.length) break;
    const brokenPaths = [...new Set(syntaxErrors.map(i => i.path))];
    const problems = [
      "ERRO DE SINTAXE BLOQUEANDO DEPLOY — corrija com content (arquivo completo) se o trecho estiver truncado.",
      ...syntaxErrors.map(i => `${i.path}: ${i.message}`),
      "Feche todas as chaves, parênteses, colchetes e tags JSX. Não deixe template strings ou objetos incompletos.",
    ];
    const allowed = new Set([
      ...brokenPaths,
      "src/App.tsx",
      "src/main.tsx",
      "src/lib/supabase.ts",
      "src/lib/generated-app-client.ts",
      "package.json",
    ]);
    try {
      const changes = await proposeSurgicalRepair(db, userId, current, problems, allowed, signal);
      if (!changes.length) break;
      apply(changes);
    } catch (e) {
      signal.throwIfAborted();
      if (syntaxRound === 1) {
        throw new Error(`Time de correção não conseguiu fechar a sintaxe: ${redactSecrets(e instanceof Error ? e.message : "erro")}`);
      }
    }
  }

  const files = [...map.values()];
  const remaining = publicationIssues(files);
  if (remaining.length) {
    throw new Error(`Publicação bloqueada após autocorreção: ${remaining.slice(0, 5).join("; ")}`);
  }
  const changes = files.filter(f => rows.find(r => r.path === f.path)?.content !== f.content);
  if (!changes.length) return { files, repaired: 0 };
  if (changes.some(c => redactSecrets(c.content) !== c.content) || rows.some(r => redactSecrets(r.content) !== r.content)) throw new Error("Conteúdo sensível detectado; correção automática cancelada.");
  const backup = await db.from("code_project_backups").insert({ project_id: projectId, user_id: userId, commit_sha: baseSha, parent_sha: baseSha, message: "backup: antes da autocorreção pré-voo", files_count: rows.length, files_snapshot: rows.map(r => ({ path: r.path, content: r.content })) });
  if (backup.error) throw new Error("Não foi possível preservar o backup; correção cancelada.");
  for (const c of changes) {
    const original = rows.find(r => r.path === c.path);
    if (original) {
      const saved = await db.from("code_files").update({ content: c.content, updated_at: new Date().toISOString() }).eq("id", original.id).eq("user_id", userId).eq("updated_at", original.updated_at).select("id");
      if (saved.error || saved.data?.length !== 1) throw new Error("Arquivo mudou durante a correção; publicação cancelada e backup preservado.");
    } else {
      const saved = await db.from("code_files").insert({ project_id: projectId, user_id: userId, path: c.path, content: c.content });
      if (saved.error) throw new Error("Não foi possível salvar a correção; publicação cancelada.");
    }
  }
  return { files, repaired: changes.length };
}
