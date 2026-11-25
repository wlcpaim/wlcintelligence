// Versões da WLC IA: persistência no banco + arquivo no repositório GitHub conectado.
import type { Db } from "@/modules/integrations/core/runs.server";
import type { Json, TablesUpdate } from "@/integrations/supabase/types";
import { getToken } from "@/modules/integrations/github/services/connection.server";
import { ghCall } from "@/modules/code/services/github-write.server";
import { GithubError } from "@/modules/integrations/github/services/api.server";
import { openChatStream } from "@/modules/integrations/gemini/services/chat-stream.server";
import { textFromGeminiChunk } from "@/services/gemini.server";
import { FREE_CHAT_INSTRUCTION } from "@/services/engineering";
import { COPILOT_INSTRUCTION } from "@/modules/code/services/copilot.server";
import { PROMPT_MAKER_CHAT_INSTRUCTION, PROMPT_MAKER_COPILOT_INSTRUCTION } from "../instructions";
import {
  BASE_VERSION, VERSIONS_DIR, TRAINING_INSTRUCTION, getCopilotPreset, parseTrainingAnswer, serializeVersion, slugify,
  versionFileSchema, versionPath, parseVersionUpload, type VersionRule,
} from "../instructions";

export const VERSION_COLS = "id,name,slug,base_version,chat_instruction,copilot_instruction,rules,repo_full_name,github_path,github_sha,sync_error,synced_at,created_at,updated_at" as const;
export interface VersionRow {
  id: string; name: string; slug: string; base_version: string; chat_instruction: string; copilot_instruction: string;
  rules: VersionRule[]; repo_full_name: string | null; github_path: string | null; github_sha: string | null;
  sync_error: string | null; synced_at: string | null; created_at: string; updated_at: string;
}

const enc = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
const dec = (b64: string) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, "")), c => c.charCodeAt(0)));
const contentsUrl = (repo: string, path: string) => `/repos/${repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}`;

async function repoTarget(db: Db, userId: string): Promise<{ token: string; repo: string } | null> {
  const { data } = await db.from("github_selection").select("repo_full_name").eq("user_id", userId).maybeSingle();
  if (!data?.repo_full_name) return null;
  try { return { token: await getToken(db, userId), repo: data.repo_full_name }; } catch { return null; }
}

function errText(e: unknown) { return e instanceof Error ? e.message : "Falha no GitHub."; }

async function getRow(db: Db, userId: string, id: string): Promise<VersionRow> {
  const { data, error } = await db.from("chat_versions").select(VERSION_COLS).eq("id", id).eq("user_id", userId).single();
  if (error || !data) throw new Error("Versão não encontrada.");
  return data as unknown as VersionRow;
}

/** Grava (cria/atualiza) o arquivo da versão no repositório; registra o resultado na linha. */
export async function pushVersion(db: Db, userId: string, v: VersionRow, message: string): Promise<VersionRow> {
  const target = await repoTarget(db, userId);
  const patch: TablesUpdate<"chat_versions"> = {};
  if (!target) patch.sync_error = "Nenhum repositório GitHub selecionado em Configurações → GitHub. A versão está salva só no app.";
  else {
    const path = versionPath(v.slug);
    try {
      let sha: string | undefined;
      try { sha = (await ghCall<{ sha: string }>(target.token, "GET", contentsUrl(target.repo, path))).sha; }
      catch (e) { if (!(e instanceof GithubError && e.status === 404)) throw e; }
      const body = serializeVersion({ name: v.name, slug: v.slug, base_version: v.base_version, chat_instruction: v.chat_instruction, copilot_instruction: v.copilot_instruction, rules: v.rules });
      const r = await ghCall<{ content: { sha: string } }>(target.token, "PUT", contentsUrl(target.repo, path), { message, content: enc(body), ...(sha ? { sha } : {}) });
      Object.assign(patch, { repo_full_name: target.repo, github_path: path, github_sha: r.content.sha, sync_error: null, synced_at: new Date().toISOString() });
    } catch (e) { patch.sync_error = errText(e); }
  }
  const { data } = await db.from("chat_versions").update(patch).eq("id", v.id).eq("user_id", userId).select(VERSION_COLS).single();
  return (data as unknown as VersionRow | null) ?? v;
}

export async function listVersions(db: Db, userId: string): Promise<VersionRow[]> {
  const { data, error } = await db.from("chat_versions").select(VERSION_COLS).eq("user_id", userId).order("created_at");
  if (error) throw new Error(error.message);
  return data as unknown as VersionRow[];
}

/** Cria a versão como cópia limpa da base (regras do chat + regras do Copilot). */
export async function createVersion(db: Db, userId: string, name: string): Promise<VersionRow> {
  const slug = slugify(name);
  if (!slug || slug === BASE_VERSION.slug || slug === slugify(BASE_VERSION.name) || slug === "wlc-1-5-6") throw new Error("Escolha outro nome para a versão.");
  const { data, error } = await db.from("chat_versions").insert({
    user_id: userId, name, slug, base_version: BASE_VERSION.slug,
    chat_instruction: FREE_CHAT_INSTRUCTION, copilot_instruction: COPILOT_INSTRUCTION, rules: [],
  }).select(VERSION_COLS).single();
  if (error) throw new Error(error.code === "23505" ? "Já existe uma versão com esse nome." : error.message);
  return pushVersion(db, userId, data as unknown as VersionRow, `WLC IA: criar versão ${name}`);
}

/** Cria uma das cinco versões especializadas com instruções próprias de chat e Copilot. */
export async function createPresetVersion(db: Db, userId: string, presetId: string): Promise<VersionRow> {
  const preset = getCopilotPreset(presetId);
  if (!preset) throw new Error("Especialização não encontrada.");
  const slug = slugify(preset.name);
  const { data, error } = await db.from("chat_versions").insert({
    user_id: userId, name: preset.name, slug, base_version: BASE_VERSION.slug,
    chat_instruction: preset.chat_instruction, copilot_instruction: preset.copilot_instruction, rules: [],
  }).select(VERSION_COLS).single();
  if (error) throw new Error(error.code === "23505" ? "Essa versão especializada já foi criada." : error.message);
  return pushVersion(db, userId, data as unknown as VersionRow, `WLC IA: criar especialização ${preset.name}`);
}

/** Arquivo da versão oficial (base de todas as versões) para download. */
export function baseVersionFile(): string {
  return serializeVersion({ name: BASE_VERSION.name, slug: BASE_VERSION.slug, base_version: BASE_VERSION.slug,
    chat_instruction: PROMPT_MAKER_CHAT_INSTRUCTION, copilot_instruction: PROMPT_MAKER_COPILOT_INSTRUCTION, rules: [] });
}

/** Upload de arquivo: cria uma versão nova ou substitui o conteúdo de uma versão existente. */
export async function importVersion(db: Db, userId: string, content: string, targetId?: string): Promise<VersionRow> {
  const file = parseVersionUpload(content, !targetId);
  const rules = file.rules as unknown as Json;
  if (targetId) {
    const v = await getRow(db, userId, targetId);
    const { data, error } = await db.from("chat_versions").update({
      chat_instruction: file.chat_instruction, copilot_instruction: file.copilot_instruction, rules, updated_at: new Date().toISOString(),
    }).eq("id", v.id).eq("user_id", userId).select(VERSION_COLS).single();
    if (error || !data) throw new Error("Não foi possível aplicar o arquivo à versão.");
    return pushVersion(db, userId, data as unknown as VersionRow, `WLC IA: upload de arquivo em ${v.name}`);
  }
  const slug = slugify(file.name);
  const { data, error } = await db.from("chat_versions").insert({
    user_id: userId, name: file.name, slug, base_version: file.base_version,
    chat_instruction: file.chat_instruction, copilot_instruction: file.copilot_instruction, rules,
  }).select(VERSION_COLS).single();
  if (error) throw new Error(error.code === "23505" ? `Já existe uma versão chamada ${file.name}.` : error.message);
  return pushVersion(db, userId, data as unknown as VersionRow, `WLC IA: importar versão ${file.name}`);
}

/** Apaga a versão no app e o arquivo no repositório (commit de exclusão). */
export async function deleteVersion(db: Db, userId: string, id: string): Promise<{ githubError: string | null }> {
  const v = await getRow(db, userId, id);
  let githubError: string | null = null;
  const target = await repoTarget(db, userId);
  if (target && v.github_path) {
    try {
      const repo = v.repo_full_name ?? target.repo;
      const cur = await ghCall<{ sha: string }>(target.token, "GET", contentsUrl(repo, v.github_path));
      await ghCall(target.token, "DELETE", contentsUrl(repo, v.github_path), { message: `WLC IA: apagar versão ${v.name}`, sha: cur.sha });
    } catch (e) { if (!(e instanceof GithubError && e.status === 404)) githubError = errText(e); }
  }
  if (githubError) return { githubError };
  const { error } = await db.from("chat_versions").delete().eq("id", id).eq("user_id", userId);
  if (error) throw new Error(error.message);
  return { githubError: null };
}

/** Auto-check: importa versões novas/alteradas do repositório e remove as apagadas lá. */
export async function syncVersions(db: Db, userId: string): Promise<{ changed: number; error: string | null }> {
  const target = await repoTarget(db, userId);
  if (!target) return { changed: 0, error: null };
  let listing: { name: string; path: string; sha: string; type: string }[];
  try { listing = await ghCall(target.token, "GET", contentsUrl(target.repo, VERSIONS_DIR)); }
  catch (e) { if (e instanceof GithubError && e.status === 404) listing = []; else return { changed: 0, error: errText(e) }; }
  const files = listing.filter(f => f.type === "file" && f.name.endsWith(".json"));
  const local = await listVersions(db, userId);
  let changed = 0;
  for (const f of files) {
    const slug = f.name.replace(/\.json$/, "");
    const mine = local.find(v => v.slug === slug);
    if (mine && mine.github_sha === f.sha) continue;
    try {
      const raw = await ghCall<{ content: string }>(target.token, "GET", contentsUrl(target.repo, f.path));
      const parsed = versionFileSchema.parse(JSON.parse(dec(raw.content)));
      const row = { name: parsed.name, base_version: parsed.base_version, chat_instruction: parsed.chat_instruction, copilot_instruction: parsed.copilot_instruction, rules: parsed.rules,
        repo_full_name: target.repo, github_path: f.path, github_sha: f.sha, sync_error: null, synced_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      const q = mine ? db.from("chat_versions").update(row).eq("id", mine.id).eq("user_id", userId)
        : db.from("chat_versions").insert({ ...row, user_id: userId, slug });
      if (!(await q).error) changed++;
    } catch { /* arquivo inválido no repositório: ignorado */ }
  }
  const remote = new Set(files.map(f => f.path));
  for (const v of local) {
    if (v.github_sha && v.github_path && v.repo_full_name === target.repo && !remote.has(v.github_path)) {
      if (!(await db.from("chat_versions").delete().eq("id", v.id).eq("user_id", userId)).error) changed++;
    }
  }
  return { changed, error: null };
}

async function collect(response: Response): Promise<string> {
  if (!response.body) throw new Error("Sem resposta do supervisor de treino.");
  const reader = response.body.getReader(); const decoder = new TextDecoder();
  let buf = "", out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (line.startsWith("data:")) out += textFromGeminiChunk(line.slice(5).trim());
    }
  }
  return out;
}

/** Escola: absorve regras da mensagem, salva permanentemente e envia ao repositório. */
export async function trainVersion(db: Db, userId: string, id: string, message: string, signal: AbortSignal) {
  const v = await getRow(db, userId, id);
  const { data: past } = await db.from("version_training_messages").select("role,content").eq("version_id", id).eq("user_id", userId).order("created_at", { ascending: false }).limit(16);
  const history = (past ?? []).reverse().map(m => ({ role: m.role, content: m.content.slice(0, 4000) }));
  const known = v.rules.map((r, i) => `${i + 1}. ${r.rule}`).join("\n") || "(nenhuma ainda)";
  const opened = await openChatStream(db, userId, [...history, { role: "user", content: `Versão em treino: ${v.name}\nRegras já aprendidas:\n${known}\n\nMensagem do treinador:\n${message}` }],
    signal, false, { instruction: TRAINING_INSTRUCTION, maxOutputTokens: 8000, responseMimeType: "application/json" });
  if (!opened.ok) throw new Error(opened.error);
  const answer = parseTrainingAnswer(await collect(opened.response));
  const now = new Date().toISOString();
  const added: VersionRule[] = answer.rules.map(r => ({ id: crypto.randomUUID(), rule: r.rule, chat: r.chat, copilot: r.copilot, created_at: now }));
  await db.from("version_training_messages").insert([
    { version_id: id, user_id: userId, role: "user", content: message },
    { version_id: id, user_id: userId, role: "model", content: answer.reply },
  ]);
  let row = v;
  if (added.length) {
    const { data, error } = await db.from("chat_versions").update({ rules: [...v.rules, ...added] as unknown as Json, updated_at: now }).eq("id", id).eq("user_id", userId).select(VERSION_COLS).single();
    if (error || !data) throw new Error("Não foi possível salvar as regras aprendidas.");
    row = await pushVersion(db, userId, data as unknown as VersionRow, `WLC IA: treino de ${v.name} (+${added.length} regra${added.length > 1 ? "s" : ""})`);
  }
  return { reply: answer.reply, added, version: row };
}

export async function removeRule(db: Db, userId: string, id: string, ruleId: string): Promise<VersionRow> {
  const v = await getRow(db, userId, id);
  const { data, error } = await db.from("chat_versions").update({ rules: v.rules.filter(r => r.id !== ruleId) as unknown as Json, updated_at: new Date().toISOString() }).eq("id", id).eq("user_id", userId).select(VERSION_COLS).single();
  if (error || !data) throw new Error("Não foi possível remover a regra.");
  return pushVersion(db, userId, data as unknown as VersionRow, `WLC IA: remover regra de ${v.name}`);
}

export async function loadVersionForUse(db: Db, userId: string, id: string): Promise<VersionRow | null> {
  const { data } = await db.from("chat_versions").select(VERSION_COLS).eq("id", id).eq("user_id", userId).maybeSingle();
  return (data as unknown as VersionRow | null) ?? null;
}
