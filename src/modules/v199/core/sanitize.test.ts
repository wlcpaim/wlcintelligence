import { describe, expect, it } from "vitest";
import { projectFromHistory, sanitizePackageJson } from "./sanitize";

describe("sanitizePackageJson", () => {
  it("fixa lucide-react em versão existente com ícones de marca", () => {
    const out = JSON.parse(sanitizePackageJson(JSON.stringify({ dependencies: { "lucide-react": "^4.36.0" } })));
    expect(out.dependencies["lucide-react"]).toBe("^0.460.0");
  });
  it("remove tsc do script de build", () => {
    const out = JSON.parse(sanitizePackageJson(JSON.stringify({ scripts: { build: "tsc && vite build" } })));
    expect(out.scripts.build).toBe("vite build");
  });
});

describe("projectFromHistory", () => {
  it("conversa nova não reaproveita projeto", () => {
    expect(projectFromHistory([{ role: "user", content: "crie" }])).toBeNull();
  });
  it("reusa o projeto entregue nesta conversa", () => {
    const id = "df7f941e-0b57-4982-984d-511625d068b1";
    expect(projectFromHistory([{ role: "model", content: `[Abrir](/code/${id})` }])).toBe(id);
  });
});
