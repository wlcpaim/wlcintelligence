import { describe, expect, it } from "vitest";
import { parseVersionUpload, serializeVersion } from "./instructions";

const file = (name: string) => serializeVersion({ name, slug: "x", base_version: "wlc-1.5.6", chat_instruction: "chat", copilot_instruction: "copilot", rules: [] });

describe("upload de arquivo de versão", () => {
  it("aceita um arquivo baixado da WLC IA", () => {
    expect(parseVersionUpload(file("WLC 1.6 Lite"), true).name).toBe("WLC 1.6 Lite");
  });
  it("recusa arquivo que não é JSON", () => {
    expect(() => parseVersionUpload("não é json", true)).toThrow("JSON válido");
  });
  it("recusa JSON sem os campos da versão", () => {
    expect(() => parseVersionUpload('{"foo":1}', true)).toThrow("Arquivo inválido");
  });
  it("não cria versão nova com o nome da oficial", () => {
    expect(() => parseVersionUpload(file("WLC 1.5.6"), true)).toThrow("versão oficial");
  });
  it("permite aplicar o arquivo da oficial dentro de uma versão existente", () => {
    expect(parseVersionUpload(file("WLC 1.5.6"), false).chat_instruction).toBe("chat");
  });
});
