import { describe, expect, it } from "vitest";
import { checkCommand, RUNNER_WORKFLOW_YAML, trimLog } from "./runner-commands";
import { BOT_TOOLS } from "./tools";

describe("terminal real dos bots", () => {
  it("permite comandos de teste comuns", () => {
    expect(checkCommand("npx vitest run")).toBeNull();
    expect(checkCommand("pip install -r requirements.txt && pytest")).toBeNull();
    expect(checkCommand("go test ./...")).toBeNull();
  });
  it("bloqueia rede, segredos e substituição de shell", () => {
    expect(checkCommand("curl http://x")).not.toBeNull();
    expect(checkCommand("echo $GITHUB_TOKEN")).not.toBeNull();
    expect(checkCommand("echo $(whoami)")).not.toBeNull();
    expect(checkCommand("npm test; env")).not.toBeNull();
  });
  it("só QA, DevOps, Backend e Systems executam comandos", () => {
    expect(BOT_TOOLS.qa).toContain("run_command");
    expect(BOT_TOOLS.devops).toContain("setup_runner");
    expect(BOT_TOOLS.frontend).not.toContain("run_command");
    expect(BOT_TOOLS.architect).not.toContain("run_command");
  });
  it("workflow passa o comando por variável de ambiente", () => {
    expect(RUNNER_WORKFLOW_YAML).toContain("WLC_COMMAND: ${{ inputs.command }}");
    expect(RUNNER_WORKFLOW_YAML).not.toMatch(/run: \$\{\{ inputs\.command/);
  });
  it("corta logs longos mantendo o fim", () => {
    expect(trimLog("a".repeat(100) + "FIM", 10).endsWith("FIM")).toBe(true);
  });
});
