import { describe, expect, it } from "vitest";
import { findMissingLocalImports, leastUsedKeyId, recordUsage } from "./gaps";
import type { DualKeyStatus } from "./keys";

describe("v199 gaps", () => {
  it("detecta páginas importadas que não existem (caso SmartAgenda)", () => {
    const miss = findMissingLocalImports([
      { path: "src/main.tsx", content: 'import PublicBooking from "./pages/PublicBooking";\nimport { Btn } from "@/components/Btn";\nimport "./index.css";' },
      { path: "src/components/Btn.tsx", content: "export const Btn = () => null;" },
    ]);
    expect(miss.map((m) => m.target)).toEqual(["src/pages/PublicBooking.tsx", "src/index.css"]);
  });

  it("aceita index e imports multi-linha existentes", () => {
    const miss = findMissingLocalImports([
      { path: "src/App.tsx", content: 'import {\n  A,\n} from "./ui";\nimport B from "../src/x/B";' },
      { path: "src/ui/index.ts", content: "" },
      { path: "src/x/B.tsx", content: "" },
    ]);
    expect(miss).toEqual([]);
  });

  it("escolhe a API menos usada e não repete em paralelo", () => {
    const status = { keys: [{ id: "a" }, { id: "b" }, { id: "c" }] } as unknown as DualKeyStatus;
    const usage = new Map<string, number>();
    recordUsage(usage, "a", 50_000);
    recordUsage(usage, "c", 100);
    expect(leastUsedKeyId(status, usage, 20_000)).toBe("b");
    expect(leastUsedKeyId(status, usage, 20_000)).toBe("c");
  });
});
