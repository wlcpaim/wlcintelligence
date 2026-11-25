import { describe, it, expect } from "vitest";
import { pagesName } from "./services/cloudflare.server";
import { detectBuild, deployState } from "./build";

const pkg = (o: object) => [{ path: "package.json", content: JSON.stringify(o) }];

describe("cloudflare", () => {
  it("normaliza nome do projeto", () => { expect(pagesName("Meu_Projeto.App")).toBe("meu-projeto-app"); });
  it("projeto Vite compila com npm run build e publica dist", () => {
    expect(detectBuild(pkg({ scripts: { build: "vite build" }, devDependencies: { vite: "7" } }))).toEqual({ command: "npm run build", outDir: "dist" });
  });
  it("projeto Create React App publica build", () => {
    expect(detectBuild(pkg({ scripts: { build: "react-scripts build" }, dependencies: { "react-scripts": "5" } })).outDir).toBe("build");
  });
  it("projeto Next exportado publica out", () => {
    expect(detectBuild(pkg({ scripts: { build: "next build" }, dependencies: { next: "15" } })).outDir).toBe("out");
  });
  it("projeto TanStack Start publica o site completo com o servidor", () => {
    const b = detectBuild(pkg({ scripts: { build: "vite build" }, dependencies: { "@tanstack/react-start": "1" } }));
    expect(b.outDir).toBe("dist");
    expect(b.command.startsWith("npm run build && ")).toBe(true);
    expect(b.command).not.toContain("dist/server");
  });
  it("site sem package.json não compila e publica a raiz", () => {
    expect(detectBuild([{ path: "index.html", content: "" }])).toEqual({ command: "", outDir: "" });
  });
  it("só termina com sucesso depois da etapa de publicação", () => {
    expect(deployState({ name: "build", status: "success" })).toBe("running");
    expect(deployState({ name: "deploy", status: "success" })).toBe("success");
    expect(deployState({ name: "build", status: "failure" })).toBe("failure");
    expect(deployState(null)).toBe("running");
  });
});
