import { beforeEach, expect, it, vi } from "vitest";
import type { Db } from "@/modules/integrations/core/runs.server";
import { generateCopilot } from "./copilot.server";
import { rankCopilotFiles } from "../copilot";

const mocks = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock("@/modules/integrations/gemini/services/chat-stream.server", () => ({ openChatStream: mocks.open }));

const files = [
  { path: "src/app.ts", content: "export const old = 1;", updated_at: "2026-11-22T02:02:00Z", deleted: false },
  { path: ".env", content: "PRIVATE=not-for-model", updated_at: "old", deleted: false },
  { path: "src/config.ts", content: 'password="not-for-model"', updated_at: "old", deleted: false },
];

function dbMock(owner = true) {
  const eq = vi.fn().mockReturnThis();
  const update = vi.fn();
  const insert = vi.fn();
  const from = vi.fn((table: string) => ({
    select: vi.fn().mockReturnThis(), eq, order: vi.fn().mockReturnThis(), update, insert,
    single: vi.fn().mockResolvedValue({ data: owner ? { id: "project", name: "My app" } : null, error: null }),
    range: vi.fn().mockResolvedValue({ data: table === "code_files" ? files : [], error: null }),
  }));
  return { db: { from } as unknown as Db, eq, update, insert };
}

function output(changes: { path: string; content: string }[]) {
  const text = JSON.stringify({ summary: "Proponho atualizar a função, sem executar testes.", changes });
  return { ok: true, response: new Response(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] })}\n\n`), keyId: "test", model: "test" };
}

beforeEach(() => vi.resetAllMocks());

it("gera proposta com a versão atual sem salvar nem executar commits", async () => {
  const db = dbMock();
  mocks.open.mockResolvedValue(output([{ path: "src/app.ts", content: "export const next = 2;" }]));
  const result = await generateCopilot(db.db, "owner", "project", "Melhore app.ts", "src/app.ts", [], new AbortController().signal);
  expect(result.changes).toEqual([{ path: "src/app.ts", content: "export const next = 2;", before: "export const old = 1;", expectedUpdatedAt: "2026-11-22T02:02:00Z" }]);
  expect(result.coverage).toEqual({ read: 1, total: 3 });
  expect(db.update).not.toHaveBeenCalled();
  expect(db.insert).not.toHaveBeenCalled();
  expect(db.eq).toHaveBeenCalledWith("user_id", "owner");
  const history = mocks.open.mock.calls[0]?.[2];
  expect(JSON.stringify(history)).not.toContain("not-for-model");
});

it("recusa ler projeto que não pertence ao usuário", async () => {
  const db = dbMock(false);
  await expect(generateCopilot(db.db, "other", "project", "x", null, [], new AbortController().signal)).rejects.toThrow("Projeto não encontrado");
  expect(mocks.open).not.toHaveBeenCalled();
});

it("recusa proposta que tenta substituir arquivo cujo segredo impediu leitura", async () => {
  const db = dbMock();
  mocks.open.mockResolvedValue(output([{ path: "src/config.ts", content: "export const config = {};" }]));
  await expect(generateCopilot(db.db, "owner", "project", "x", null, [], new AbortController().signal)).rejects.toThrow("não lido");
});

it("pode propor arquivo novo deixando a gravação para confirmação", async () => {
  const db = dbMock();
  mocks.open.mockResolvedValue(output([{ path: "src/new.ts", content: "export const sum = (a: number, b: number) => a + b;" }]));
  const result = await generateCopilot(db.db, "owner", "project", "Crie soma", null, [], new AbortController().signal);
  expect(result.changes[0]?.before).toBeNull();
  expect(result.changes[0]?.expectedUpdatedAt).toBeNull();
  expect(db.insert).not.toHaveBeenCalled();
});

it("tenta recuperar uma resposta com JSON inválido uma única vez", async () => {
  const db = dbMock();
  const valid = JSON.stringify({ summary: "Corrigir tipagem", changes: [] });
  mocks.open
    .mockResolvedValueOnce({ ok: true, response: new Response("data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"não é JSON\"}]}}]}\n\n"), keyId: "test", model: "test" })
    .mockResolvedValueOnce({ ok: true, response: new Response(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: valid }] } }] })}\n\n`), keyId: "test", model: "test" });
  const result = await generateCopilot(db.db, "owner", "project", "Explique o erro", null, [], new AbortController().signal);
  expect(result.summary).toBe("Corrigir tipagem");
  expect(mocks.open).toHaveBeenCalledTimes(2);
});


it("prioriza arquivos de configuração que explicam o projeto", async () => {
  const ranked = rankCopilotFiles([
    { path: "src/view.tsx" },
    { path: "package.json" },
    { path: "tsconfig.json" },
  ], "corrija compilação", null);
  expect(ranked.slice(0, 2).map(file => file.path)).toEqual(["package.json", "tsconfig.json"]);
});
