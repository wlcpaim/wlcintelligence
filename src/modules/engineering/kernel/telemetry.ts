/**
 * Telemetria de engenharia — métricas por usuário, sem conteúdo de secrets.
 */

export type EngineeringMetric =
  | "apply_ok"
  | "apply_fail"
  | "gate_pass"
  | "gate_fail"
  | "tsc_ok"
  | "tsc_fail"
  | "autoheal_success"
  | "autoheal_failure"
  | "publish_success"
  | "publish_blocked";

type CounterMap = Map<string, number>;

const store = new Map<string, CounterMap>(); // userId -> metrics

function bucket(userId: string): CounterMap {
  let m = store.get(userId);
  if (!m) {
    m = new Map();
    store.set(userId, m);
  }
  return m;
}

export function recordMetric(userId: string, metric: EngineeringMetric, delta = 1): void {
  if (!userId) return;
  const m = bucket(userId);
  m.set(metric, (m.get(metric) ?? 0) + delta);
}

export function getMetrics(userId: string): Record<EngineeringMetric, number> {
  const m = bucket(userId);
  const all: EngineeringMetric[] = [
    "apply_ok",
    "apply_fail",
    "gate_pass",
    "gate_fail",
    "tsc_ok",
    "tsc_fail",
    "autoheal_success",
    "autoheal_failure",
    "publish_success",
    "publish_blocked",
  ];
  const out = {} as Record<EngineeringMetric, number>;
  for (const k of all) out[k] = m.get(k) ?? 0;
  return out;
}

export function resetMetrics(userId: string): void {
  store.delete(userId);
}
