/**
 * Shared Engineering Kernel
 * Contratos e mecanismos de qualidade compartilhados por 1.7.1 PRO e 1.9.9.
 * Não unifica interfaces de UI nem motores específicos.
 */

export {
  runQualityGate,
  canPersist,
  deriveEditorQualityStatus,
  type QualityGateInput,
  type QualityGateResult,
  type QualityCheckResult,
  type QualityStatus,
} from "./quality-gate";

export {
  buildDeliveryReport,
  formatDeliveryReport,
  type DeliveryReport,
} from "./delivery-report";

export {
  runAutoHealOnce,
  type AutoHealContext,
  type AutoHealResult,
} from "./auto-heal";

export {
  recordMetric,
  getMetrics,
  resetMetrics,
  type EngineeringMetric,
} from "./telemetry";
