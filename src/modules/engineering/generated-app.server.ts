import type { Db } from "@/modules/integrations/core/runs.server";
import type { DbEnv } from "@/modules/integrations/cloudflare/build";
import { GENERATED_APP_CLIENT_SOURCE, readGeneratedManifest, type GeneratedFile } from "./generated-app-contract";

export async function provisionGeneratedDatabase(db: Db, projectId: string, files: GeneratedFile[], environment: DbEnv | null) {
  const manifest = readGeneratedManifest(files);
  if (!manifest) return { ready: true, tables: 0 };
  if (!environment?.url || !environment.key) throw new Error("Configure o banco do app antes de publicar; não será usado um login fictício.");
  // Never apply app SQL to an unrelated external database or to the platform's tables.
  const urls = [process.env['SUPABASE_URL'], process.env['VITE_SUPABASE_URL']].filter(Boolean);
  const target = environment.url.replace(/\/+$/, "");
  const sameProject = environment.projectId && environment.projectId === process.env['SUPABASE_PROJECT_ID'];
  if (!sameProject && !urls.some(url => url?.replace(/\/+$/, "") === target)) {
    throw new Error("Provisionamento automático disponível somente no banco Lovable Cloud deste projeto; banco externo exige migração própria.");
  }
  const support = files.find(f => f.path === "src/lib/generated-app-client.ts");
  if (support?.content !== GENERATED_APP_CLIENT_SOURCE) throw new Error("Cliente isolado do app ausente ou alterado; regenere antes de publicar.");
  const client = files.find(f => /^src\/lib\/supabase\.tsx?$/.test(f.path));
  if (!client?.content.includes("createGeneratedAppClient") || !client.content.includes("VITE_WLC_PROJECT_ID")) {
    throw new Error("Cliente do app não utiliza o banco isolado por projeto.");
  }
  const names = new Set(manifest.tables.map(t => t.name));
  const code = files.filter(f => /\.(tsx?|jsx?)$/.test(f.path) && f.path !== support.path);
  for (const file of code) {
    for (const match of file.content.matchAll(/\.from\(\s*['"]([a-z][a-z0-9_]*)['"]\s*\)/g)) {
      if (match[1] && !names.has(match[1])) throw new Error(`Tabela ${match[1]} usada em ${file.path} não está no manifesto.`);
    }
  }
  const allCode = code.map(f => f.content).join("\n");
  if (!allCode.includes("signInWithPassword") || !allCode.includes("claim_generated_app_admin") || !allCode.includes("generated_app_role")) {
    throw new Error("Autenticação real e verificação de admin obrigatórias antes de publicar.");
  }
  const { data, error } = await db.rpc("provision_generated_app", { p_project_id: projectId, p_manifest: manifest });
  if (error) throw new Error("Banco não provisionado; publicação interrompida sem alterar contas ou dados existentes.");
  if (!data || typeof data !== "object" || Array.isArray(data) || data['ready'] !== true) {
    throw new Error("Provisionamento do banco não confirmado.");
  }
  return { ready: true, tables: manifest.tables.length };
}