/**
 * WLC 1.9.9 Hybrid Team — ponto de entrada do módulo isolado.
 * Pipeline único e paralelo:
 * Arquiteto → especialistas em paralelo → Análise + testes → Diagnóstico se Deploy falhar.
 */

export {
  V199_VERSION,
  V199_GREETING,
  V199_PIPELINE_INSTRUCTION,
  V199_ARCHITECT_INSTRUCTION,
  V199_ANTI_SPAM_RULE,
  SPECIALISTS,
  type SpecialistRole,
  type Specialist,
} from "./identity";

export { extractStructureFromPlan, structureToContext, type ExtractedStructure } from "./core/extractor";
export { checkDualKeys, keyForRole, type DualKeyStatus } from "./core/keys";
export {
  missingBootstrapFiles,
  extractPackageName,
  findMissingDependencies,
  diagnoseBuildReadiness,
  buildDevOpsBootstrapTask,
  type BootstrapFile,
  type MissingDep,
  type BuildIssue,
} from "./core/bootstrap";
export {
  normalizeDistribution,
  mergePlanWithExtraction,
  planToSpecialistContext,
  type DistributionItem,
  type PipelinePlan,
  type PipelineContracts,
} from "./core/pipeline";

export {
  runHybridTeam,
  type TeamEvent,
  type TeamChange,
  type SpecialistResult,
  type TeamRunResult,
} from "./services/runner.server";

export { applyTeamChanges, type ApplyResult } from "./services/apply.server";
