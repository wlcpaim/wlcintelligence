import { describe, expect, it } from "vitest";
import { chatInstructionFor, copilotInstructionFor, parseTrainingAnswer, slugify, versionPath, COPILOT_PRESETS, getCopilotPreset, BASE_VERSION } from "./instructions";

const rule = { id: "1", rule: "Nunca use any", chat: "Explique tipos", copilot: "Use tipos estritos", created_at: "x" };

describe("versões da WLC IA", () => {
  it("salva cada versão em chat/versions/<slug>.json", () => {
    expect(slugify("WLC 1.6 Lite")).toBe("wlc-1-6-lite");
    expect(versionPath(slugify("WLC 2.0"))).toBe("chat/versions/wlc-2-0.json");
  });
  it("chat herda as regras base e acrescenta as aprendidas", () => {
    const s = chatInstructionFor({ name: "WLC 2.0", chat_instruction: "BASE CHAT", rules: [rule] });
    expect(s.startsWith("BASE CHAT")).toBe(true);
    expect(s).toContain("1. Nunca use any — Como aplicar: Explique tipos");
  });
  it("copilot herda as regras base e aplica a parte de código", () => {
    const s = copilotInstructionFor({ name: "WLC 2.0", copilot_instruction: "BASE COPILOT", rules: [rule] });
    expect(s.startsWith("BASE COPILOT")).toBe(true);
    expect(s).toContain("Use tipos estritos");
    expect(s).not.toContain("Explique tipos");
  });
  it("lê a resposta do supervisor de treino", () => {
    const r = parseTrainingAnswer('```json\n{"reply":"ok","rules":[{"rule":"Sempre use Tailwind","chat":"","copilot":"Tailwind v4"}]}\n```');
    expect(r.rules).toHaveLength(1);
    expect(r.rules[0]?.copilot).toBe("Tailwind v4");
  });
});


describe("Copilots especializados", () => {
  it("define seis especializações independentes com instruções de Copilot", () => {
    expect(COPILOT_PRESETS.map(p => p.id)).toEqual(["frontend", "backend", "debug", "security", "data", "cursor-agent"]);
    for (const preset of COPILOT_PRESETS) {
      expect(preset.name.length).toBeGreaterThan(3);
      expect(preset.copilot_instruction).toContain("JSON válido");
      expect(slugify(preset.name)).not.toBe(BASE_VERSION.slug);
    }
  });
  it("localiza um preset pelo identificador e rejeita ids desconhecidos", () => {
    expect(getCopilotPreset("debug")?.name).toBe("WLC Dev Debugger");
    expect(getCopilotPreset("unknown")).toBeNull();
  });
});
