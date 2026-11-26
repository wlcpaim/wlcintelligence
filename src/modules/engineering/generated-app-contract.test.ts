import { expect, it } from "vitest";
import { generatedDatabaseManifest, readGeneratedManifest } from "./generated-app-contract";

const manifest = { version: 1, tables: [{ name: "products", columns: [{ name: "title", type: "text" }] }] };
it("exige tabelas provisionáveis antes de publicar um sistema com dados", () => {
  expect(() => readGeneratedManifest([{ path: "schema.sql", content: "CREATE TABLE products(id uuid);" }])).toThrow("falta database.manifest.json");
  expect(readGeneratedManifest([{ path: "database.manifest.json", content: JSON.stringify(manifest) }])?.tables[0]?.name).toBe("products");
});
it("permite coluna de negócio role e rejeita colunas estruturais reservadas e SQL arbitrário", () => {
  expect(generatedDatabaseManifest.safeParse({ version: 1, tables: [{ name: "employees", columns: [{ name: "role", type: "text" }] }] }).success).toBe(true);
  expect(generatedDatabaseManifest.safeParse({ version: 1, tables: [{ name: "profiles", columns: [{ name: "id", type: "uuid" }] }] }).success).toBe(false);
  expect(generatedDatabaseManifest.safeParse({ version: 1, tables: [{ name: "products", columns: [{ name: "title", type: "text); DROP TABLE code_projects;--" }] }] }).success).toBe(false);
});
it("dados privados não ficam públicos por padrão", () => {
  expect(generatedDatabaseManifest.parse(manifest).tables[0]?.publicRead).toBe(false);
});
it("relações só podem apontar para tabelas do próprio app", () => {
  expect(generatedDatabaseManifest.safeParse({ version: 1, tables: [{ name: "products", columns: [{ name: "owner", type: "uuid", references: "code_projects" }] }] }).success).toBe(false);
});
it("recusa nomes duplicados e aceita páginas sem banco", () => {
  expect(generatedDatabaseManifest.safeParse({ ...manifest, tables: [...manifest.tables, ...manifest.tables] }).success).toBe(false);
  expect(readGeneratedManifest([{ path: "index.html", content: "<h1>Site</h1>" }])).toBeNull();
});