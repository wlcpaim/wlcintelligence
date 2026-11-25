export type ConnectionState = "unknown" | "connected" | "error" | "disabled" | "not_configured";
export interface DiagnosticCheck {
  name: string;
  ok: boolean;
  detail: string;
}
export interface DiagnosticReport {
  ok: boolean;
  ranAt: string;
  checks: DiagnosticCheck[];
}
