import { beforeEach, expect, it, vi } from "vitest";
import type { Db } from "@/modules/integrations/core/runs.server";
import { generateTeamCopilot } from "./copilot-team.server";

const mocks = vi.hoisted(() => ({ team: vi.fn() }));
vi.mock("./runner.server", () => ({ runHybridTeam: mocks.team }));

const files = [
  { path: "src/app.ts", content: "export const old = 1;", updated_at: "2026-11-22T02:02:00Z", deleted: false },
  { path: "src/config.ts", content: 'password="not-for-model"', updated_at: "old", deleted: false },
];

function dbMock(owner = true) {
  const update = vi.fn();
  const insert = vi.fn();
  const from = vi.fn((table: string) => ({
    select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), update, insert,
    single: vi.fn().mockResolvedValue({ data: owner ? { id: "project", name: "My app" } : null, error: null }),
    range: vi.fn().mockResolvedValue({ data: table === "code_files" ? files : [], error: null }),
  }));
  return { db: { from } as unknown as Db, update, insert };
}

const plan = { intent: "x", structure: { folders: [], files: [] }, contracts: {}, distribution: [] };
const run = (changes: { path: string; content: string }[]) => ({ plan, results: [], analysis: null, changes, summary: "Time concluiu: 3/3 bots ok." });

beforeEach(() => vi.resetAllMocks());

it("roda o time sem gravar e devolve proposta com a versão atual como base", async () => {
  const d = dbMock();
  mocks.team.mockImplementation(async (_db, _u, _r, _s, onEvent) => { onEvent("✅ **Frontend** concluiu — 1 arquivo(s)"); return run([
    { path: "src/app.ts", content: "export const next = 2;" },
    { path: "./src/novo.ts", content: "export const novo = 1;" },
  ]); });
  const result = await generateTeamCopilot(d.db, "owner", "project", "Melhore app.ts", "src/app.ts", [], new AbortController().signal);
  expect(mocks.team.mock.calls[0]?.[5]).toMatchObject({ apply: false });
  expect(result.changes).toEqual([
    { path: "src/app.ts", content: "export const next = 2;", before: "export const old = 1;", expectedUpdatedAt: "2026-11-22T02:02:00Z" },
    { path: "src/novo.ts", content: "export const novo = 1;", before: null, expectedUpdatedAt: null },
  ]);
  expect(result.summary).toContain("Frontend");
  expect(d.update).not.toHaveBeenCalled();
  expect(d.insert).not.toHaveBeenCalled();
});

it("não envia ao time arquivo com segredo e ignora mudança nele", async () => {
  const d = dbMock();
  mocks.team.mockResolvedValue(run([{ path: "src/config.ts", content: "export const config = {};" }]));
  const result = await generateTeamCopilot(d.db, "owner", "project", "x", null, [], new AbortController().signal);
  expect(JSON.stringify(mocks.team.mock.calls[0]?.[5].existingFiles)).not.toContain("not-for-model");
  expect(result.changes).toEqual([]);
  expect(result.summary).toContain("Ignorado src/config.ts");
});

it("bloqueia caminho protegido e conteúdo com credencial", async () => {
  const d = dbMock();
  mocks.team.mockResolvedValue(run([{ path: ".env", content: "A=1" }, { path: "src/x.ts", content: 'password="abc123456"' }]));
  const result = await generateTeamCopilot(d.db, "owner", "project", "x", null, [], new AbortController().signal);
  expect(result.changes).toEqual([]);
});

it("recusa projeto de outro usuário e propaga falta de API", async () => {
  await expect(generateTeamCopilot(dbMock(false).db, "other", "project", "x", null, [], new AbortController().signal)).rejects.toThrow("Projeto não encontrado");
  expect(mocks.team).not.toHaveBeenCalled();
  mocks.team.mockResolvedValue({ plan: null, results: [], analysis: null, changes: [], summary: "Cadastre APIs Gemini." });
  await expect(generateTeamCopilot(dbMock().db, "owner", "project", "x", null, [], new AbortController().signal)).rejects.toThrow("Cadastre APIs");
});
