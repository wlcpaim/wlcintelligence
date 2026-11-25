import { beforeEach, expect, it, vi } from "vitest";
import type { Db } from "@/modules/integrations/core/runs.server";
import { diagnoseWithRunner } from "./diagnostics.server";
import { generateDiagnosticsCopilot } from "./copilot-diagnostics.server";

const mocks = vi.hoisted(() => ({ run: vi.fn(), ask: vi.fn(), gh: vi.fn(), creds: vi.fn(), proj: vi.fn(), latest: vi.fn(), dep: vi.fn(), listKeys: vi.fn() }));
vi.mock("@/modules/orchestrator/runner-actions.server", () => ({ runCommand: mocks.run }));
vi.mock("@/modules/code/services/github-write.server", () => ({ ghCall: mocks.gh }));
vi.mock("@/modules/integrations/github/services/connection.server", () => ({ getToken: vi.fn().mockResolvedValue("tok") }));
vi.mock("@/modules/integrations/gemini/services/keys.server", () => ({ listKeys: mocks.listKeys }));
vi.mock("@/modules/integrations/cloudflare/services/cloudflare.server", () => ({ getCreds: mocks.creds, findGitProject: mocks.proj, latestDeployment: mocks.latest, getDeployment: mocks.dep }));
vi.mock("./runner.server", () => ({ askBot: mocks.ask }));

const pkg = { path: "package.json", content: JSON.stringify({ scripts: { build: "vite build", test: "vitest run" } }), base_content: null as string | null, deleted: false, updated_at: "t0" };
const home = { path: "src/Home.tsx", content: "export const a: number = 'x';", base_content: "export const a: number = 'x';", deleted: false, updated_at: "t1" };
pkg.base_content = pkg.content;

function dbMock(opts: { repo?: boolean; rows?: unknown[] } = {}) {
  const rows = opts.rows ?? [pkg, home];
  const from = vi.fn((table: string) => {
    const chain: Record<string, unknown> = {};
    chain["select"] = vi.fn(() => chain); chain["eq"] = vi.fn(() => chain);
    chain["single"] = vi.fn().mockResolvedValue({ data: opts.repo === false ? { id: "p", name: "App", repo_full_name: null, branch: null } : { id: "p", name: "App", repo_full_name: "me/app", branch: "main" }, error: null });
    chain["limit"] = vi.fn().mockResolvedValue({ data: table === "code_files" ? rows : [], error: null });
    return chain;
  });
  return { from } as unknown as Db;
}
const sig = () => new AbortController().signal;

beforeEach(() => { vi.resetAllMocks(); mocks.listKeys.mockResolvedValue([]); mocks.gh.mockResolvedValue({}); mocks.creds.mockRejectedValue(new Error("Configure a Cloudflare")); });

const cfReady = (deploy: { state: string; stage?: string; url?: string; logs?: string[] }) => {
  mocks.creds.mockResolvedValue({ token: "cf", accountId: "acc" });
  mocks.proj.mockResolvedValue({ name: "app-pages" });
  mocks.latest.mockResolvedValue("dep1");
  mocks.dep.mockResolvedValue({ state: deploy.state, stage: deploy.stage ?? "build", url: deploy.url ?? "https://app.pages.dev", logs: deploy.logs ?? [] });
};

it("sem repositório vinculado não roda nada", async () => {
  const r = await diagnoseWithRunner(dbMock({ repo: false }), "u", "p", sig());
  expect(r.ok).toBe(false); expect(r.summary).toContain("Vincule um repositório"); expect(mocks.run).not.toHaveBeenCalled();
});

it("avisa em vez de instalar o Runner por conta própria", async () => {
  mocks.gh.mockRejectedValue(new Error("404"));
  const r = await diagnoseWithRunner(dbMock(), "u", "p", sig());
  expect(r.summary).toContain("setup_runner"); expect(mocks.run).not.toHaveBeenCalled();
  expect(mocks.gh.mock.calls.every((c) => c[1] === "GET")).toBe(true);
});

it("build e teste passando devolve sucesso e avisa de alterações locais não enviadas", async () => {
  mocks.run.mockResolvedValue({ runId: 1, text: "Concluído: success (run 1)\nok" });
  const dirty = { ...home, content: "novo" };
  const r = await diagnoseWithRunner(dbMock({ rows: [pkg, dirty] }), "u", "p", sig());
  expect(r.ok).toBe(true); expect(mocks.run).toHaveBeenCalledTimes(2);
  expect(mocks.run.mock.calls.map((c) => c[3])).toEqual(["npm run build", "npm run test"]);
  expect(r.summary).toContain("1 alteração");
});

it("build falhando para no primeiro erro, lê o arquivo do log e propõe correção", async () => {
  mocks.run.mockResolvedValue({ runId: 9, text: "Concluído: failure (run 9)\nsrc/Home.tsx(1,14): error TS2322: Type 'string' is not assignable to type 'number'." });
  mocks.ask.mockResolvedValue(JSON.stringify({ cause: "Tipo errado", summary: "Corrigi o tipo", changes: [{ path: "src/Home.tsx", content: "export const a: string = 'x';" }] }));
  const r = await diagnoseWithRunner(dbMock(), "u", "p", sig());
  expect(mocks.run).toHaveBeenCalledTimes(1);
  expect(r).toMatchObject({ ok: false, stage: "build", runId: "9", readPaths: ["src/Home.tsx", "package.json"] });
  expect(r.summary).toContain("TS2322"); expect(r.summary).toContain("Tipo errado");
  expect(JSON.parse(mocks.ask.mock.calls[0]![3]).files.map((f: { path: string }) => f.path)).toEqual(["src/Home.tsx", "package.json"]);
});

it("no Copilot a correção volta como proposta com a versão atual como base, sem gravar", async () => {
  const other = { path: "src/Other.ts", content: "o", base_content: "o", deleted: false, updated_at: "t2" };
  mocks.run.mockResolvedValue({ runId: 9, text: "Concluído: failure (run 9)\nsrc/Home.tsx error" });
  mocks.ask.mockResolvedValue(JSON.stringify({ cause: "x", summary: "y", changes: [
    { path: "src/Home.tsx", content: "export const a: string = 'x';" },
    { path: "src/Other.ts", content: "mexeu em arquivo que não foi lido" },
    { path: "src/novo.ts", content: "export const n = 1;" },
    { path: ".env", content: "A=1" },
  ] }));
  const ans = await generateDiagnosticsCopilot(dbMock({ rows: [pkg, home, other] }), "u", "p", sig());
  expect(ans.changes).toEqual([
    { path: "src/Home.tsx", content: "export const a: string = 'x';", before: home.content, expectedUpdatedAt: "t1" },
    { path: "src/novo.ts", content: "export const n = 1;", before: null, expectedUpdatedAt: null },
  ]);
  expect(ans.summary).toContain("Ignorado src/Other.ts");
  expect(ans.summary).toContain("Ignorado .env");
});

it("bot de Diagnóstico com resposta inválida não derruba: mostra o log e nenhuma proposta", async () => {
  mocks.run.mockResolvedValue({ runId: 3, text: "Concluído: failure (run 3)\nerror: algo" });
  mocks.ask.mockResolvedValue("não é json");
  const r = await diagnoseWithRunner(dbMock(), "u", "p", sig());
  expect(r.changes).toEqual([]); expect(r.summary).toContain("não conseguiu analisar"); expect(r.summary).toContain("error: algo");
});

it("execução ainda em andamento pede para tentar de novo", async () => {
  mocks.run.mockResolvedValue({ runId: 5, text: "Rodando (run 5, in_progress). Use run_status…" });
  const r = await diagnoseWithRunner(dbMock(), "u", "p", sig());
  expect(r.summary).toContain("ainda está rodando"); expect(r.runId).toBe("5");
});

it("build passou no GitHub mas o deploy falhou na Cloudflare: lê o log de lá e propõe correção", async () => {
  mocks.run.mockResolvedValue({ runId: 1, text: "Concluído: success (run 1)\nok" });
  cfReady({ state: "failure", stage: "build", logs: ["\u001b[31merror\u001b[0m: src/Home.tsx faltou variável VITE_URL"] });
  mocks.ask.mockResolvedValue(JSON.stringify({ cause: "Faltou VITE_URL", summary: "Usei valor padrão", changes: [{ path: "src/Home.tsx", content: "export const a = 1;" }] }));
  const r = await diagnoseWithRunner(dbMock(), "u", "p", sig());
  expect(r).toMatchObject({ ok: false, stage: "deploy", readPaths: ["src/Home.tsx", "package.json"] });
  expect(r.summary).toContain("Passou no GitHub"); expect(r.summary).toContain("falhou na Cloudflare"); expect(r.summary).toContain("Faltou VITE_URL");
  const sent = JSON.parse(mocks.ask.mock.calls[0]![3]);
  expect(sent.source).toBe("cloudflare-pages"); expect(sent.log_tail).not.toContain("\u001b");
});

it("deploy da Cloudflare sem falha só é informado", async () => {
  mocks.run.mockResolvedValue({ runId: 1, text: "Concluído: success (run 1)\nok" });
  cfReady({ state: "success" });
  const r = await diagnoseWithRunner(dbMock(), "u", "p", sig());
  expect(r.ok).toBe(true); expect(r.summary).toContain("app-pages"); expect(mocks.ask).not.toHaveBeenCalled();
});

it("sem Cloudflare configurada o resultado do GitHub continua valendo", async () => {
  mocks.run.mockResolvedValue({ runId: 1, text: "Concluído: success (run 1)\nok" });
  const r = await diagnoseWithRunner(dbMock(), "u", "p", sig());
  expect(r.ok).toBe(true); expect(r.summary).not.toContain("Cloudflare"); expect(mocks.ask).not.toHaveBeenCalled();
});

it("build falhando no GitHub não consulta a Cloudflare", async () => {
  mocks.run.mockResolvedValue({ runId: 9, text: "Concluído: failure (run 9)\nerror: x" });
  mocks.ask.mockResolvedValue(JSON.stringify({ cause: "c", summary: "s", changes: [] }));
  cfReady({ state: "failure" });
  await diagnoseWithRunner(dbMock(), "u", "p", sig());
  expect(mocks.creds).not.toHaveBeenCalled();
});
