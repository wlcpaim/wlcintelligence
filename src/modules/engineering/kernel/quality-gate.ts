/**
 * Shared Engineering Kernel — QualityGate (fonte única de verdade)
 * Consumido por 1.7.1 PRO e 1.9.9. Não duplicar validações nos motores.
 *
 * Recebe snapshot + alterações e retorna estrutura tipada pronta para
 * Apply Guard, Publish Guard e Delivery Report.
 */

import {
  type IntegrityFile,
  type IntegrityIssue,
  findBrokenLocalImports,
  findSyntaxIssues,
  validateEditBatch,
  buildValidationReport,
} from "@/modules/code/edit-integrity";
import { redactSecrets } from "@/modules/integrations/github/services/repository.server";

export type QualityStatus =
  | "analyzing"
  | "pending_changes"
  | "ready_to_apply"
  | "validation_failed"
  | "applied_and_validated"
  | "typecheck_passed"
  | "ready_to_publish"
  | "publish_blocked";

export interface QualityCheckResult {
  imports: { ok: boolean; issues: IntegrityIssue[] };
  syntax: { ok: boolean; issues: IntegrityIssue[] };
  routes: { ok: boolean; issues: IntegrityIssue[] };
  secrets: { ok: boolean; issues: IntegrityIssue[] };
  types: { ok: boolean; issues: IntegrityIssue[]; log?: string | undefined };
  integrity: { ok: boolean; issues: IntegrityIssue[] };
}

export interface QualityGateInput {
  snapshot: IntegrityFile[];
  changes: IntegrityFile[];
  modifiedPaths?: string[];
  dependencies?: string[];
  operation?: string;
  /** Se true, trata warnings de secrets/rotas como errors críticos */
  strict?: boolean;
  /** Resultado de typecheck remoto já executado (opcional) */
  remoteTypecheck?: { ok: boolean; log: string } | undefined;
}

export interface QualityGateResult {
  ready: boolean;
  status: QualityStatus;
  errors: IntegrityIssue[];
  warnings: IntegrityIssue[];
  checks: QualityCheckResult;
  summary: string;
  blockedReasons: string[];
  timestamp: string;
}

const ROUTE_HINTS = [
  /src\/routes\//,
  /app\/.*\/page\./,
  /pages\//,
  /router\./,
];

function detectSecretLeaks(files: IntegrityFile[]): IntegrityIssue[] {
  const issues: IntegrityIssue[] = [];
  for (const f of files) {
    if (redactSecrets(f.content) !== f.content) {
      issues.push({
        path: f.path,
        message: "Conteúdo contém possível credencial/segredo",
        severity: "error",
      });
    }
  }
  return issues;
}

function detectRouteIssues(files: IntegrityFile[]): IntegrityIssue[] {
  const issues: IntegrityIssue[] = [];
  for (const f of files) {
    const isRoute = ROUTE_HINTS.some((re) => re.test(f.path));
    if (!isRoute) continue;
    if (!f.content.trim()) {
      issues.push({
        path: f.path,
        message: "Arquivo de rota vazio",
        severity: "error",
      });
    }
    // Export default rough check for route modules
    if (/\.(tsx?|jsx?)$/.test(f.path) && !/export\s+(default|const|function|\{)/.test(f.content)) {
      issues.push({
        path: f.path,
        message: "Rota sem export aparente",
        severity: "warning",
      });
    }
  }
  return issues;
}

/**
 * QualityGate unificado — validação antes de persistir alterações.
 * Bloqueia erros críticos; warnings permitem confirmação consciente.
 */
export function runQualityGate(input: QualityGateInput): QualityGateResult {
  const {
    snapshot,
    changes,
    remoteTypecheck,
    strict = false,
  } = input;

  const importIssues = findBrokenLocalImports(
    (() => {
      const map = new Map(snapshot.map((f) => [f.path.replace(/^\.\//, ""), f]));
      for (const c of changes) map.set(c.path.replace(/^\.\//, ""), c);
      return [...map.values()];
    })(),
  );

  const syntaxIssues = findSyntaxIssues(changes);
  const secretIssues = detectSecretLeaks(changes);
  const routeIssues = detectRouteIssues(changes);
  const integrityIssues = validateEditBatch(snapshot, changes);

  // Types: usa remote se fornecido; caso contrário marca como não executado
  const typeIssues: IntegrityIssue[] = [];
  let typesOk = true;
  let typeLog: string | undefined;
  if (remoteTypecheck) {
    typesOk = remoteTypecheck.ok;
    typeLog = remoteTypecheck.log;
    if (!remoteTypecheck.ok) {
      typeIssues.push({
        path: "(typecheck)",
        message: "Typecheck remoto falhou",
        severity: "error",
      });
    }
  }

  const checks: QualityCheckResult = {
    imports: {
      ok: importIssues.filter((i) => i.severity === "error").length === 0,
      issues: importIssues,
    },
    syntax: {
      ok: syntaxIssues.filter((i) => i.severity === "error").length === 0,
      issues: syntaxIssues,
    },
    routes: {
      ok: routeIssues.filter((i) => i.severity === "error").length === 0,
      issues: routeIssues,
    },
    secrets: {
      ok: secretIssues.length === 0,
      issues: secretIssues,
    },
    types: {
      ok: typesOk,
      issues: typeIssues,
      log: typeLog,
    },
    integrity: {
      ok: integrityIssues.filter((i) => i.severity === "error").length === 0,
      issues: integrityIssues,
    },
  };

  const allIssues = [
    ...importIssues,
    ...syntaxIssues,
    ...secretIssues,
    ...routeIssues,
    ...typeIssues,
    ...integrityIssues,
  ];
  // Dedup by path+message
  const seen = new Set<string>();
  const unique = allIssues.filter((i) => {
    const k = `${i.path}|${i.message}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const errors = unique.filter((i) => i.severity === "error");
  const warnings = unique.filter((i) => i.severity === "warning");

  const blockedReasons: string[] = [];
  if (!checks.imports.ok) blockedReasons.push("imports quebrados");
  if (!checks.syntax.ok) blockedReasons.push("sintaxe inválida");
  if (!checks.secrets.ok) blockedReasons.push("segredos detectados");
  if (!checks.routes.ok) blockedReasons.push("rotas inválidas");
  if (!checks.types.ok) blockedReasons.push("typecheck falhou");
  if (!checks.integrity.ok) blockedReasons.push("integridade comprometida");

  const ready = errors.length === 0 && (strict ? warnings.length === 0 : true);

  let status: QualityStatus;
  if (!ready) {
    status = "validation_failed";
  } else if (remoteTypecheck && remoteTypecheck.ok) {
    status = "typecheck_passed";
  } else if (changes.length > 0) {
    status = "ready_to_apply";
  } else {
    status = "pending_changes";
  }

  const report = buildValidationReport(unique);
  const summaryParts = [
    report.summary,
    remoteTypecheck
      ? `Typecheck: ${remoteTypecheck.ok ? "ok" : "falhou"}`
      : "Typecheck: não executado nesta passagem",
  ];

  return {
    ready,
    status,
    errors,
    warnings,
    checks,
    summary: summaryParts.join("\n"),
    blockedReasons,
    timestamp: new Date().toISOString(),
  };
}

/** Helper: aplica QualityGate e decide se pode persistir. */
export function canPersist(result: QualityGateResult, allowWarnings = true): boolean {
  if (!result.ready) return false;
  if (!allowWarnings && result.warnings.length > 0) return false;
  return true;
}

/** Status unificado para o editor. */
export function deriveEditorQualityStatus(
  gate: QualityGateResult | null,
  applied: boolean,
  published: boolean,
): QualityStatus {
  if (!gate) return "analyzing";
  if (published && gate.ready) return "ready_to_publish";
  if (gate.status === "validation_failed") return "publish_blocked";
  if (applied && gate.checks.types.ok) return "typecheck_passed";
  if (applied) return "applied_and_validated";
  return gate.status;
}
