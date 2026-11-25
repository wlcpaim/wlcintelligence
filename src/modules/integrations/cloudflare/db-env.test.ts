import { describe, it, expect } from "vitest";
import { deployEnvVars, projectRef } from "./build";

describe("banco de dados no deploy", () => {
  it("sem banco configurado envia só a versão do Node", () => {
    expect(Object.keys(deployEnvVars(null))).toEqual(["NODE_VERSION"]);
  });
  it("com banco envia endereço e chave pública para o site e para o servidor", () => {
    const env = deployEnvVars({ url: "https://abc123.supabase.co/", key: "sb_publishable_xyz1234567890" });
    expect(env["VITE_SUPABASE_URL"]?.value).toBe("https://abc123.supabase.co");
    expect(env["SUPABASE_URL"]?.value).toBe("https://abc123.supabase.co");
    expect(env["VITE_SUPABASE_PUBLISHABLE_KEY"]?.value).toBe("sb_publishable_xyz1234567890");
    expect(env["VITE_SUPABASE_PROJECT_ID"]?.value).toBe("abc123");
  });
  it("ID do projeto informado tem prioridade e endereço sem padrão não gera ID", () => {
    expect(projectRef("https://meu-banco.exemplo.com")).toBe("");
    expect(deployEnvVars({ url: "https://meu-banco.exemplo.com", key: "k".repeat(30), projectId: "proj1" })["VITE_SUPABASE_PROJECT_ID"]?.value).toBe("proj1");
  });
});
