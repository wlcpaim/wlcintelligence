import { expect, it } from "vitest";
import { checkCommand } from "@/modules/orchestrator/runner-commands";
import { errorTail, filesMentionedInLog, parseRunnerText, pickRunnerCommands, stripAnsi } from "./diagnostics";

const pkg = (scripts: Record<string, string>) => ({ path: "package.json", content: JSON.stringify({ scripts }) });

it("escolhe build e test conforme o gerenciador e todos passam na lista permitida do Runner", () => {
  expect(pickRunnerCommands([pkg({ build: "vite build", test: "vitest run" })]).map((c) => c.command)).toEqual(["npm run build", "npm run test"]);
  expect(pickRunnerCommands([pkg({ build: "x" }), { path: "bun.lock", content: "" }]).map((c) => c.command)).toEqual(["bun run build"]);
  expect(pickRunnerCommands([pkg({ test: "x" }), { path: "pnpm-lock.yaml", content: "" }]).map((c) => c.command)).toEqual(["pnpm run test"]);
  expect(pickRunnerCommands([pkg({ build: "x" }), { path: "yarn.lock", content: "" }])[0]?.command).toBe("yarn run build");
  for (const c of ["npm run build", "bun run build", "pnpm run test", "yarn run build"]) expect(checkCommand(c)).toBeNull();
});

it("sem package.json, JSON inválido ou sem scripts não roda nada", () => {
  expect(pickRunnerCommands([])).toEqual([]);
  expect(pickRunnerCommands([{ path: "package.json", content: "{ quebrado" }])).toEqual([]);
  expect(pickRunnerCommands([pkg({ dev: "vite" })])).toEqual([]);
});

it("interpreta sucesso, falha e execução ainda em andamento", () => {
  expect(parseRunnerText("Concluído: success (run 123)\nok")).toEqual({ state: "success", conclusion: "success", runId: "123", log: "ok" });
  const fail = parseRunnerText("Concluído: failure (run 9)\nerror TS2304\nlinha 2");
  expect(fail).toMatchObject({ state: "failure", runId: "9" });
  expect(fail.log).toContain("TS2304");
  expect(parseRunnerText("Rodando (run 77, in_progress). Use run_status…")).toMatchObject({ state: "pending", runId: "77" });
  expect(parseRunnerText("Execução enviada, mas ainda não apareceu no GitHub.")).toMatchObject({ state: "pending", runId: null });
});

it("acha arquivos do projeto citados no log, também com caminho absoluto da VM", () => {
  const log = "/home/runner/work/app/app/src/pages/Home.tsx(10,5): error TS2304\nsrc/lib/a.ts:3:1 erro";
  expect(filesMentionedInLog(log, ["src/lib/a.ts", "src/pages/Home.tsx", "src/outro.ts"])).toEqual(["src/pages/Home.tsx", "src/lib/a.ts"]);
  expect(filesMentionedInLog(log, ["src/outro.ts"])).toEqual([]);
});

it("errorTail começa perto do primeiro erro e respeita o limite", () => {
  const log = ["a", "b", "c", "d", "error: falhou aqui", "detalhe"].join("\n");
  expect(errorTail(log)).toContain("error: falhou aqui");
  expect(errorTail("x\n".repeat(5000) + "error: y", 100).length).toBeLessThanOrEqual(105);
});

it("stripAnsi tira cores do log e mantém o texto", () => {
  expect(stripAnsi("\u001b[31merror\u001b[0m: falhou")).toBe("error: falhou");
  expect(stripAnsi("sem cor")).toBe("sem cor");
});
