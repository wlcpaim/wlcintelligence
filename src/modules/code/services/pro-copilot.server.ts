// Copilot próprio da WLC 1.7.1 PRO: não depende do arquivo aberto.
// 1) vê o mapa inteiro do projeto e escolhe o que ler; 2) cria estruturas e edita trechos.
import type { Db } from "@/modules/integrations/core/runs.server";
import { openChatStream } from "@/modules/integrations/gemini/services/chat-stream.server";
import { redactSecrets } from "@/modules/integrations/github/services/repository.server";
import { textFromGeminiChunk } from "@/services/gemini.server";
import { copilotPath, rankCopilotFiles, CopilotParseError, type CopilotAnswer } from "../copilot";
import { applyEdits, parseJsonLoose, proAnswerSchema, proPickSchema } from "../pro-edits";
import { CopilotProviderError } from "./copilot.server";

const PICK = `Você é o Copilot WLC 1.7.1 PRO (modo edição). Recebe o pedido e o MAPA de arquivos.
Escolha o MÍNIMO de arquivos necessários para uma edição cirúrgica (tipicamente 3–8; máximo 15).
Inclua só o que o pedido toca: componente alvo, tipos/serviços ligados e o ponto de import/rota se for o caso.
NÃO inclua configs de build/deploy/migrations a menos que o pedido cite isso.
Responda só JSON: {"read":["caminho", ...]} com caminhos existentes.`;

const BUILD = `Você é o Copilot WLC 1.7.1 PRO — especialista em EDIÇÃO cirúrgica de código existente.

PAPEL (fixo):
- Você MODIFICA o que já existe: "altere X", "adicione Y", "corrija Z", "refatore este trecho".
- Criação de aplicativo completo do zero é papel do WLC 1.9.9 — se o pedido for isso, no summary oriente a usar 1.9.9 e deixe changes [].
- NUNCA gere Prompt Mestre, blocos [PROJETO]/[OBJETIVO] ou template de 6 seções (exclusivo do 1.5.6). Se o usuário colar um Prompt Mestre pedindo só um ajuste pontual, implemente só o ajuste.

DISCIPLINA DE ESCOPO:
- Interprete o pedido de forma literal e estreita. Não invente features, arquivos ou "melhorias" não pedidas.
- Meta: ≤ 4 arquivos alterados (teto 8). Não toque em package.json, vite, tsconfig, deploy, migrations ou schema a menos que o pedido cite explicitamente.
- Prefira sempre edits search/replace com trecho EXATO e ÚNICO do arquivo. Arquivo novo só se for impossível cumprir sem criar.
- Preserve estilo, indentação e arquitetura. Proibido any, stubs null/undefined, placeholders e dependências novas desnecessárias.
- Mobile First só quando o pedido afetar UI.

FORMATO (somente JSON válido):
{"summary":"1–3 frases do que mudou","changes":[{"path":"...","edits":[{"search":"trecho único","replace":"..."}]}]}
Arquivo novo: {"path":"...","content":"completo"}. Perguntas sem edição → changes [].
Responda em português.
`;

async function ask(db: Db, userId: string, instruction: string, messages: { role: "user" | "model"; content: string }[], signal: AbortSignal, maxOutputTokens: number): Promise<string> {
  const opened = await openChatStream(db, userId, messages, signal, false, { instruction, maxOutputTokens, responseMimeType: "application/json" });
  if (!opened.ok) throw new CopilotProviderError(opened.error);
  if (!opened.response.body) return "";
  const reader = opened.response.body.getReader();
  const dec = new TextDecoder();
  let pending = "", out = "";
  const take = (l: string) => { const t = l.trim(); if (t.startsWith("data:")) out += textFromGeminiChunk(t.slice(5).trim()); };
  try {
    for (;;) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      pending += dec.decode(value, { stream: true });
      let i: number;
      while ((i = pending.indexOf("\n")) >= 0) { take(pending.slice(0, i)); pending = pending.slice(i + 1); }
    }
    take(pending);
  } finally { await reader.cancel().catch(() => {}); }
  return out;
}

export async function generateProCopilot(
  db: Db, userId: string, projectId: string, message: string, activePath: string | null,
  history: { role: "user" | "model"; content: string }[], signal: AbortSignal,
): Promise<CopilotAnswer> {
  const { data: project } = await db.from("code_projects").select("id,name").eq("id", projectId).eq("user_id", userId).single();
  if (!project) throw new Error("Projeto não encontrado.");
  const files: { path: string; content: string; updated_at: string; deleted: boolean }[] = [];
  for (let from = 0; ; from += 1000) {
    const r = await db.from("code_files").select("path,content,updated_at,deleted").eq("project_id", projectId).eq("user_id", userId).order("path").range(from, from + 999);
    if (r.error) throw new Error("Não foi possível ler o projeto.");
    files.push(...r.data);
    if (r.data.length < 1000) break;
  }
  const visible = files.filter(f => !f.deleted && copilotPath(f.path));
  const safe = (f: { content: string }) => f.content.length <= 80_000 && !f.content.includes("\0") && redactSecrets(f.content) === f.content;
  const paths = visible.map(f => f.path);
  const hist = history.map(h => ({ ...h, content: redactSecrets(h.content) }));

  let picked: string[] = [];
  try {
    const raw = await ask(db, userId, PICK, [...hist, { role: "user", content: JSON.stringify({ request: redactSecrets(message), paths: paths.slice(0, 3000) }) }], signal, 2000);
    picked = proPickSchema.parse(parseJsonLoose(raw)).read;
  } catch (e) { if (e instanceof CopilotProviderError) throw e; }
  const byPath = new Map(visible.map(f => [f.path, f]));
  const ranked = rankCopilotFiles(visible, message, activePath);
  const order = [...picked.filter(p => byPath.has(p)).map(p => byPath.get(p)!), ...ranked];
  let budget = 160_000;
  const included = new Map<string, (typeof visible)[number]>();
  for (const f of order) {
    if (included.has(f.path) || !safe(f)) continue;
    const size = f.path.length + f.content.length + 50;
    if (size > budget) continue;
    budget -= size; included.set(f.path, f);
    if (included.size >= 40) break;
  }

  const req = [...hist, { role: "user" as const, content: JSON.stringify({
    project: project.name, request: redactSecrets(message), paths: paths.slice(0, 3000),
    files: [...included.values()].map(f => ({ path: f.path, content: f.content })),
  }) }];
  let raw = await ask(db, userId, BUILD, req, signal, 16_000);
  let parsed;
  try { parsed = proAnswerSchema.parse(parseJsonLoose(raw)); }
  catch {
    raw = await ask(db, userId, `${BUILD}\nATENÇÃO: a resposta anterior não era JSON válido. Retorne apenas JSON válido.`,
      [...req, { role: "user", content: JSON.stringify({ previous_output: raw.slice(0, 60_000) }) }], signal, 16_000);
    try { parsed = proAnswerSchema.parse(parseJsonLoose(raw)); } catch { throw new CopilotParseError("invalid-schema"); }
  }

  const notes: string[] = [];
  const changes: CopilotAnswer["changes"] = [];
  for (const c of parsed.changes) {
    const original = files.find(f => f.path === c.path && !f.deleted) ?? null;
    if (original && !included.has(c.path)) { notes.push(`Ignorado ${c.path}: arquivo não foi lido.`); continue; }
    let content: string;
    try {
      if (c.edits?.length) {
        if (!original) { notes.push(`Ignorado ${c.path}: edição em arquivo inexistente.`); continue; }
        content = applyEdits(original.content, c.edits);
      } else content = c.content ?? "";
    } catch (e) { notes.push(`Ignorado ${c.path}: ${e instanceof Error ? e.message : "edição inválida"}`); continue; }
    if (content.length > 80_000 || redactSecrets(content) !== content) { notes.push(`Ignorado ${c.path}: grande demais ou com credencial.`); continue; }
    changes.push({ path: c.path, content, before: original?.content ?? null, expectedUpdatedAt: original?.updated_at ?? null });
  }
  const summary = notes.length ? `${parsed.summary}\n\n**Avisos:**\n${notes.map(n => `- ${n}`).join("\n")}` : parsed.summary;
  return { summary, changes, coverage: { read: included.size, total: visible.length } };
}
