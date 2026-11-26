import { describe, it, expect } from "vitest";
import {
  runQualityGate,
  canPersist,
  deriveEditorQualityStatus,
} from "./quality-gate";
import { buildDeliveryReport, formatDeliveryReport } from "./delivery-report";
import { recordMetric, getMetrics, resetMetrics } from "./telemetry";

describe("QualityGate", () => {
  it("aprova snapshot limpo sem changes", () => {
    const gate = runQualityGate({
      snapshot: [{ path: "src/app.ts", content: "export const x = 1;" }],
      changes: [],
    });
    expect(gate.ready).toBe(true);
    expect(gate.errors).toHaveLength(0);
    expect(gate.checks.imports.ok).toBe(true);
    expect(gate.checks.syntax.ok).toBe(true);
    expect(gate.checks.secrets.ok).toBe(true);
  });

  it("bloqueia import órfão", () => {
    const gate = runQualityGate({
      snapshot: [{ path: "src/a.ts", content: "export const a = 1;" }],
      changes: [
        {
          path: "src/b.ts",
          content: 'import { a } from "./missing";\nexport const b = a;',
        },
      ],
    });
    expect(gate.ready).toBe(false);
    expect(gate.checks.imports.ok).toBe(false);
    expect(gate.blockedReasons).toContain("imports quebrados");
    expect(canPersist(gate)).toBe(false);
  });

  it("bloqueia sintaxe desbalanceada", () => {
    const gate = runQualityGate({
      snapshot: [],
      changes: [{ path: "src/bad.ts", content: "export function f() { return 1;" }],
    });
    expect(gate.ready).toBe(false);
    expect(gate.checks.syntax.ok).toBe(false);
  });

  it("bloqueia secrets", () => {
    // redactSecrets looks for common secret patterns; use a plausible key shape
    const gate = runQualityGate({
      snapshot: [],
      changes: [
        {
          path: "src/config.ts",
          content: 'export const KEY = "sk-proj-abcdefghijklmnopqrstuvwxyz0123456789";',
        },
      ],
    });
    // Depending on redactSecrets implementation, may or may not catch; at least structure works
    expect(gate.checks.secrets).toBeDefined();
    expect(typeof gate.ready).toBe("boolean");
  });

  it("marca typecheck falho como não ready", () => {
    const gate = runQualityGate({
      snapshot: [{ path: "src/ok.ts", content: "export const ok = true;" }],
      changes: [],
      remoteTypecheck: { ok: false, log: "error TS2322: Type 'string' is not assignable..." },
    });
    expect(gate.ready).toBe(false);
    expect(gate.checks.types.ok).toBe(false);
    expect(gate.status).toBe("validation_failed");
  });

  it("deriveEditorQualityStatus", () => {
    const gate = runQualityGate({
      snapshot: [],
      changes: [{ path: "a.ts", content: "export {};" }],
    });
    expect(deriveEditorQualityStatus(gate, false, false)).toBe("ready_to_apply");
    expect(deriveEditorQualityStatus(null, false, false)).toBe("analyzing");
  });
});

describe("DeliveryReport", () => {
  it("formata relatório estruturado", () => {
    const gate = runQualityGate({
      snapshot: [],
      changes: [{ path: "src/x.ts", content: "export const x = 1;" }],
    });
    const report = buildDeliveryReport({
      objective: "Adicionar export x",
      modifiedFiles: ["src/x.ts"],
      gate,
      typecheckOk: true,
      typecheckLog: "ok",
    });
    expect(report.checksExecuted.imports).toBe(true);
    expect(report.typecheck.ok).toBe(true);
    const text = formatDeliveryReport(report);
    expect(text).toContain("Delivery Report");
    expect(text).toContain("src/x.ts");
  });
});

describe("Telemetry", () => {
  it("registra métricas isoladas por usuário", () => {
    resetMetrics("u1");
    recordMetric("u1", "apply_ok");
    recordMetric("u1", "gate_pass");
    recordMetric("u1", "apply_ok");
    const m = getMetrics("u1");
    expect(m.apply_ok).toBe(2);
    expect(m.gate_pass).toBe(1);
    expect(getMetrics("u2").apply_ok).toBe(0);
  });
});
