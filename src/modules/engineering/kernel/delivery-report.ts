/**
 * Delivery Report — relatório estruturado ao final de cada operação.
 * Separar verificações executadas das não executadas.
 */

import type { QualityGateResult, QualityStatus } from "./quality-gate";
import type { IntegrityIssue } from "@/modules/code/edit-integrity";

export interface DeliveryReport {
  objective: string;
  modifiedFiles: string[];
  changesSummary: string;
  checksExecuted: {
    imports: boolean;
    syntax: boolean;
    routes: boolean;
    secrets: boolean;
    types: boolean;
    integrity: boolean;
    tests: boolean;
  };
  checksNotExecuted: string[];
  typecheck: { executed: boolean; ok: boolean | null; log?: string | undefined };
  tests: { executed: boolean; ok: boolean | null; log?: string | undefined };
  errors: IntegrityIssue[];
  warnings: IntegrityIssue[];
  autoHeal: {
    attempted: boolean;
    success: boolean | null;
    details?: string | undefined;
  };
  publishStatus: QualityStatus | "not_requested";
  pending: string[];
  gate: QualityGateResult | null;
  timestamp: string;
}

export function buildDeliveryReport(opts: {
  objective: string;
  modifiedFiles: string[];
  changesSummary?: string;
  gate: QualityGateResult | null;
  typecheckLog?: string;
  typecheckOk?: boolean;
  testsExecuted?: boolean;
  testsOk?: boolean;
  testsLog?: string;
  autoHealAttempted?: boolean;
  autoHealSuccess?: boolean | null;
  autoHealDetails?: string;
  publishStatus?: QualityStatus | "not_requested";
  pending?: string[];
}): DeliveryReport {
  const gate = opts.gate;
  const checksExecuted = {
    imports: true,
    syntax: true,
    routes: true,
    secrets: true,
    types: opts.typecheckOk !== undefined || !!opts.typecheckLog,
    integrity: true,
    tests: !!opts.testsExecuted,
  };

  const checksNotExecuted: string[] = [];
  if (!checksExecuted.types) checksNotExecuted.push("typecheck remoto");
  if (!checksExecuted.tests) checksNotExecuted.push("testes automatizados");

  return {
    objective: opts.objective,
    modifiedFiles: opts.modifiedFiles,
    changesSummary: opts.changesSummary ?? `${opts.modifiedFiles.length} arquivo(s) alterado(s)`,
    checksExecuted,
    checksNotExecuted,
    typecheck: {
      executed: checksExecuted.types,
      ok: opts.typecheckOk ?? null,
      log: opts.typecheckLog,
    },
    tests: {
      executed: checksExecuted.tests,
      ok: opts.testsOk ?? null,
      log: opts.testsLog,
    },
    errors: gate?.errors ?? [],
    warnings: gate?.warnings ?? [],
    autoHeal: {
      attempted: !!opts.autoHealAttempted,
      success: opts.autoHealSuccess ?? null,
      details: opts.autoHealDetails,
    },
    publishStatus: opts.publishStatus ?? "not_requested",
    pending: opts.pending ?? [],
    gate,
    timestamp: new Date().toISOString(),
  };
}

export function formatDeliveryReport(report: DeliveryReport): string {
  const lines: string[] = [
    `📋 Delivery Report — ${report.timestamp}`,
    `Objetivo: ${report.objective}`,
    `Arquivos: ${report.modifiedFiles.join(", ") || "(nenhum)"}`,
    `Resumo: ${report.changesSummary}`,
    "",
    "Verificações executadas:",
    `  imports: ${report.checksExecuted.imports ? "✓" : "—"}`,
    `  sintaxe: ${report.checksExecuted.syntax ? "✓" : "—"}`,
    `  rotas: ${report.checksExecuted.routes ? "✓" : "—"}`,
    `  secrets: ${report.checksExecuted.secrets ? "✓" : "—"}`,
    `  types: ${report.checksExecuted.types ? (report.typecheck.ok ? "✓ ok" : "✗ falhou") : "não executado"}`,
    `  integridade: ${report.checksExecuted.integrity ? "✓" : "—"}`,
    `  testes: ${report.checksExecuted.tests ? (report.tests.ok ? "✓" : "✗") : "não executado"}`,
  ];

  if (report.checksNotExecuted.length) {
    lines.push(`Não executadas: ${report.checksNotExecuted.join(", ")}`);
  }

  if (report.errors.length) {
    lines.push("", "Erros:");
    for (const e of report.errors.slice(0, 15)) {
      lines.push(`  ❌ ${e.path}: ${e.message}`);
    }
  }
  if (report.warnings.length) {
    lines.push("", "Avisos:");
    for (const w of report.warnings.slice(0, 8)) {
      lines.push(`  ⚠️ ${w.path}: ${w.message}`);
    }
  }

  if (report.autoHeal.attempted) {
    lines.push(
      "",
      `Auto-heal: ${report.autoHeal.success ? "sucesso" : "falhou"}` +
        (report.autoHeal.details ? ` — ${report.autoHeal.details}` : ""),
    );
  }

  lines.push(`Publicação: ${report.publishStatus}`);
  if (report.pending.length) {
    lines.push(`Pendências: ${report.pending.join("; ")}`);
  }

  return lines.join("\n");
}
