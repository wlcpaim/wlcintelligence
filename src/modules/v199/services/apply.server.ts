/**
 * Bots da 1.9.9 agem como scripts: injetam e editam arquivos de verdade no projeto.
 * Usa o mesmo padrão do write_file do orquestrador 1.7.1 (code_files + RLS).
 * Apply Guard: toda aplicação (individual ou lote) passa pelo QualityGate compartilhado.
 */

import type { Db } from "@/modules/integrations/core/runs.server";
import { openWorkspace } from "@/modules/orchestrator/tools.server";
import { redactSecrets } from "@/modules/integrations/github/services/repository.server";
import { GENERATED_APP_CLIENT_SOURCE } from "@/modules/engineering/generated-app-contract";
import {
  runQualityGate,
  canPersist,
  recordMetric,
  type QualityGateResult,
} from "@/modules/engineering/kernel";

export interface TeamChange { path: string; content: string }

export interface ApplyResult {
  projectId: string | null;
  projectName: string | null;
  written: string[];
  skipped: { path: string; reason: string }[];
  gate?: QualityGateResult;
  blocked?: boolean;
}

/** Grava cada change em code_files (insert ou update). Bloqueia conteúdo com segredo e erros críticos do QualityGate. */
export async function applyTeamChanges(
  db: Db,
  userId: string,
  changes: TeamChange[],
  target?: {
    projectId: string | null;
    projectName: string | null;
    request: string;
    /** Snapshot atual do projeto (para QualityGate). Se omitido, gate só valida secrets/sintaxe dos changes. */
    snapshot?: { path: string; content: string }[];
  },
): Promise<ApplyResult> {
  // Supply this dependency before validating/persisting any generated imports.
  if (changes.some(c => c.path === "database.manifest.json" || c.content.includes("createGeneratedAppClient"))) {
    changes = [...changes.filter(c => c.path !== "src/lib/generated-app-client.ts"), {
      path: "src/lib/generated-app-client.ts", content: GENERATED_APP_CLIENT_SOURCE,
    }];
  }
  const ws = target
    ? { projectId: target.projectId, projectName: target.projectName }
    : await openWorkspace(db, userId);
  const written: string[] = [];
  const skipped: { path: string; reason: string }[] = [];

  if (!ws.projectId && changes.length) {
    const name = target?.request.trim().replace(/\s+/g, " ").slice(0, 80) || "Projeto WLC";
    const { data, error } = await db.from("code_projects")
      .insert({ user_id: userId, name, source: "chat" }).select("id,name").single();
    if (error || !data) {
      recordMetric(userId, "apply_fail");
      return { projectId: null, projectName: null, written: [], skipped: changes.map((c) => ({
        path: c.path, reason: "Não foi possível criar o projeto para salvar os arquivos.",
      })) };
    }
    ws.projectId = data.id;
    ws.projectName = data.name;
  }
  if (!ws.projectId) {
    recordMetric(userId, "apply_fail");
    return {
      projectId: null,
      projectName: null,
      written: [],
      skipped: changes.map((c) => ({
        path: c.path,
        reason: "Nenhum projeto em Code. Crie ou abra um projeto primeiro.",
      })),
    };
  }

  // QualityGate unificado antes de persistir
  const snapshot = target?.snapshot ?? [];
  const gate = runQualityGate({
    snapshot,
    changes: changes.map((c) => ({ path: c.path, content: c.content ?? "" })),
    operation: "applyTeamChanges",
  });

  if (!canPersist(gate)) {
    recordMetric(userId, "gate_fail");
    recordMetric(userId, "apply_fail");
    return {
      projectId: ws.projectId,
      projectName: ws.projectName,
      written: [],
      skipped: changes.map((c) => ({
        path: c.path,
        reason: `QualityGate bloqueou: ${gate.blockedReasons.join(", ") || "erros críticos"}`,
      })),
      gate,
      blocked: true,
    };
  }
  recordMetric(userId, "gate_pass");

  const now = new Date().toISOString();
  for (const change of changes) {
    const path = change.path?.trim();
    const content = change.content ?? "";
    if (!path) {
      skipped.push({ path: "(vazio)", reason: "path inválido" });
      continue;
    }
    if (redactSecrets(content) !== content) {
      skipped.push({ path, reason: "conteúdo contém credencial" });
      continue;
    }
    try {
      const { data: cur } = await db
        .from("code_files")
        .select("id")
        .eq("project_id", ws.projectId)
        .eq("user_id", userId)
        .eq("path", path)
        .maybeSingle();

      const { error } = cur
        ? await db
            .from("code_files")
            .update({ content, deleted: false, updated_at: now })
            .eq("id", cur.id)
            .eq("user_id", userId)
        : await db.from("code_files").insert({
            project_id: ws.projectId,
            user_id: userId,
            path,
            content,
            base_content: null,
            updated_at: now,
          });

      if (error) {
        skipped.push({ path, reason: error.message });
      } else {
        written.push(path);
      }
    } catch (e) {
      skipped.push({
        path,
        reason: e instanceof Error ? e.message : "erro ao gravar",
      });
    }
  }

  // Touch no projeto para aparecer como atualizado
  if (written.length) {
    await db
      .from("code_projects")
      .update({ updated_at: now })
      .eq("id", ws.projectId)
      .eq("user_id", userId);
    recordMetric(userId, "apply_ok");
  } else if (skipped.length) {
    recordMetric(userId, "apply_fail");
  }

  return {
    projectId: ws.projectId,
    projectName: ws.projectName,
    written,
    skipped,
    gate,
    blocked: false,
  };
}

