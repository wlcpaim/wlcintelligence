// WLC 1.7.1 PRO — ferramentas reais por bot (regras puras, testáveis).
import type { AgentRole } from "./orchestrator";

export type ToolName = "list_files" | "read_file" | "write_file" | "inspect_schema" | "apply_migration" | "list_deploys" | "deploy_logs" | "run_command" | "run_status" | "run_logs" | "setup_runner";

/** Ferramentas de cada bot: cada um só usa as suas. */
export const BOT_TOOLS: Record<AgentRole, ToolName[]> = {
  architect: ["list_files", "read_file", "inspect_schema"],
  frontend: ["list_files", "read_file", "write_file"],
  backend: ["list_files", "read_file", "write_file", "inspect_schema", "run_command", "run_logs"],
  dba: ["inspect_schema", "list_files", "read_file", "write_file", "apply_migration"],
  qa: ["list_files", "read_file", "write_file", "deploy_logs", "run_command", "run_status", "run_logs"],
  devops: ["list_deploys", "deploy_logs", "read_file", "write_file", "setup_runner", "run_command", "run_status", "run_logs"],
  systems: ["list_files", "read_file", "write_file", "run_command", "run_logs"],
};

/** Área de trabalho de cada bot: onde ele pode gravar arquivos. */
const WRITE_AREAS: Record<AgentRole, RegExp[]> = {
  architect: [],
  frontend: [/^src\/(components|routes(?!\/api\/)|hooks|styles|assets)\//, /^src\/styles\.css$/],
  backend: [/^src\/(services|routes\/api|lib|modules|server)\//],
  dba: [/^supabase\/migrations\/[\w.-]+\.sql$/],
  qa: [/\.test\.(ts|tsx)$/, /^(tests|e2e)\//, /\.py$/],
  devops: [/^(package\.json|index\.html|tailwind\.config\.[jt]s|postcss\.config\.[jt]s|wrangler\.(toml|jsonc?)|vite\.config\.ts|\.github\/workflows\/[\w.-]+\.ya?ml|scripts\/[\w.-]+\.sh)$/],
  systems: [/\.(go|rs)$/, /^(go\.mod|Cargo\.toml)$/],
};

const BLOCKED = /(^|\/)(\.env|.*\.lock$|bun\.lockb$|src\/integrations\/supabase\/)|credentials\.server\.ts$|routeTree\.gen\.ts$/;

export function canWrite(role: AgentRole, path: string): boolean {
  if (!path || path.includes("..") || path.startsWith("/") || BLOCKED.test(path)) return false;
  return WRITE_AREAS[role].some((r) => r.test(path));
}

export type BotStep =
  | { kind: "tool"; tool: ToolName; args: Record<string, string> }
  | { kind: "done"; report: string };

/** Lê a decisão do bot: {"tool":"...","args":{}} ou {"done":true,"report":"..."}. */
export function parseBotStep(raw: string, role: AgentRole): BotStep {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
  let v: unknown;
  try { v = JSON.parse(text); } catch { return { kind: "done", report: text.slice(0, 4000) }; }
  if (!v || typeof v !== "object") return { kind: "done", report: "" };
  const o = v as Record<string, unknown>;
  if (typeof o["tool"] === "string" && (BOT_TOOLS[role] as string[]).includes(o["tool"])) {
    const args: Record<string, string> = {};
    const a = o["args"];
    if (a && typeof a === "object") for (const [k, val] of Object.entries(a)) if (typeof val === "string") args[k] = val;
    return { kind: "tool", tool: o["tool"] as ToolName, args };
  }
  return { kind: "done", report: typeof o["report"] === "string" ? o["report"] : "" };
}
