/**
 * Auto-Heal pós-typecheck — exatamente uma tentativa automática por operação.
 * Nunca loop infinito. Segunda falha bloqueia publicação e preserva diagnóstico.
 */

import type { IntegrityFile } from "@/modules/code/edit-integrity";
import { runQualityGate, type QualityGateResult } from "./quality-gate";

export interface AutoHealContext {
  snapshot: IntegrityFile[];
  appliedChanges: IntegrityFile[];
  typecheckLog: string;
  /** Função que solicita correção cirúrgica ao motor PRO (1 tentativa). */
  requestSurgicalFix: (
    files: IntegrityFile[],
    problems: string[],
  ) => Promise<IntegrityFile[]>;
  /** Aplica o diff retornado (já validado pelo caller via QualityGate). */
  applyFix: (changes: IntegrityFile[]) => Promise<void>;
  /** Re-executa typecheck após correção. */
  reRunTypecheck: () => Promise<{ ok: boolean; log: string }>;
}

export interface AutoHealResult {
  attempted: boolean;
  success: boolean;
  gate: QualityGateResult | null;
  typecheckLog: string;
  message: string;
  blockedPublish: boolean;
}

/**
 * Fluxo P0.1:
 * 1. Captura log real do TypeScript
 * 2. Identifica arquivos envolvidos
 * 3. Envia erros ao motor PRO
 * 4. Solicita correção cirúrgica
 * 5. Valida novo diff com QualityGate
 * 6. Aplica somente se aprovado
 * 7. Re-executa typecheck
 * Limite: 1 tentativa.
 */
export async function runAutoHealOnce(ctx: AutoHealContext): Promise<AutoHealResult> {
  const problems = extractTypeScriptProblems(ctx.typecheckLog);
  if (problems.length === 0) {
    return {
      attempted: false,
      success: false,
      gate: null,
      typecheckLog: ctx.typecheckLog,
      message: "Nenhum erro TypeScript acionável no log.",
      blockedPublish: true,
    };
  }

  const involvedPaths = extractInvolvedPaths(ctx.typecheckLog, ctx.appliedChanges.map((c) => c.path));
  const filesForFix =
    involvedPaths.size > 0
      ? ctx.appliedChanges.filter((c) => involvedPaths.has(c.path.replace(/^\.\//, "")))
      : ctx.appliedChanges;

  let proposed: IntegrityFile[] = [];
  try {
    proposed = await ctx.requestSurgicalFix(filesForFix.length ? filesForFix : ctx.appliedChanges, problems);
  } catch (e) {
    return {
      attempted: true,
      success: false,
      gate: null,
      typecheckLog: ctx.typecheckLog,
      message: `Falha ao solicitar correção cirúrgica: ${e instanceof Error ? e.message : String(e)}`,
      blockedPublish: true,
    };
  }

  if (!proposed.length) {
    return {
      attempted: true,
      success: false,
      gate: null,
      typecheckLog: ctx.typecheckLog,
      message: "Motor PRO não retornou correções.",
      blockedPublish: true,
    };
  }

  const gate = runQualityGate({
    snapshot: ctx.snapshot,
    changes: proposed,
    remoteTypecheck: undefined,
  });

  if (!gate.ready) {
    return {
      attempted: true,
      success: false,
      gate,
      typecheckLog: ctx.typecheckLog,
      message: `QualityGate rejeitou a correção: ${gate.blockedReasons.join(", ")}`,
      blockedPublish: true,
    };
  }

  try {
    await ctx.applyFix(proposed);
  } catch (e) {
    return {
      attempted: true,
      success: false,
      gate,
      typecheckLog: ctx.typecheckLog,
      message: `Falha ao aplicar correção: ${e instanceof Error ? e.message : String(e)}`,
      blockedPublish: true,
    };
  }

  const second = await ctx.reRunTypecheck();
  if (!second.ok) {
    return {
      attempted: true,
      success: false,
      gate,
      typecheckLog: second.log,
      message:
        "Auto-heal: segunda falha de typecheck. Publicação bloqueada. Diagnóstico preservado.",
      blockedPublish: true,
    };
  }

  return {
    attempted: true,
    success: true,
    gate,
    typecheckLog: second.log,
    message: "Auto-heal bem-sucedido. Typecheck aprovado após uma correção.",
    blockedPublish: false,
  };
}

function extractTypeScriptProblems(log: string): string[] {
  const lines = log.split(/\r?\n/);
  const problems: string[] = [];
  for (const line of lines) {
    if (/\berror TS\d+/i.test(line) || /Found \d+ error/i.test(line)) {
      problems.push(line.trim().slice(0, 500));
    }
  }
  return problems.slice(0, 30);
}

function extractInvolvedPaths(log: string, knownPaths: string[]): Set<string> {
  const set = new Set<string>();
  const norm = (p: string) => p.replace(/^\.\//, "").replace(/\\/g, "/");
  const known = new Set(knownPaths.map(norm));
  for (const line of log.split(/\r?\n/)) {
    // common tsc: path(line,col): error TSxxxx
    const m = line.match(/([^\s(]+\.(tsx?|jsx?|mjs))\(/);
    if (m) {
      const p = norm(m[1]!);
      if (known.has(p) || known.size === 0) set.add(p);
    }
  }
  return set;
}
