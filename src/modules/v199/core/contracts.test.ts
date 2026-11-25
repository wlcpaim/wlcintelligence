import { expect, it } from "vitest";
import { inspectContracts, resolveLocalModule } from "./contracts";

it("detecta sinônimos inexistentes sem inventar alias nem modificar arquivos", () => {
  const files = [
    { path: "src/storage.ts", content: "export const getServices = () => [];" },
    { path: "src/Page.tsx", content: "import { getStoredServices } from './storage'; export default function Page() { return <div/>; }" },
  ];
  const before = JSON.stringify(files);
  expect(inspectContracts(files).issues).toEqual([{ path: "src/Page.tsx", target: "src/storage.ts", message: 'Import/export "getStoredServices" não existe em src/storage.ts.' }]);
  expect(JSON.stringify(files)).toBe(before);
});
it("detecta export default ausente e respeita tipos, aliases e barrels", () => {
  const files = [
    { path: "src/data.ts", content: "export interface Service { id: string }; export const services = [];" },
    { path: "src/index.ts", content: "export * from './data';" },
    { path: "src/page.tsx", content: "import { services as list, type Service } from '@/index'; import Page from './data';" },
  ];
  expect(inspectContracts(files).issues.map(i => i.message)).toEqual(['Import/export "default" não existe em src/data.ts.']);
  expect(inspectContracts(files).manifest.find(m => m.path === "src/index.ts")?.exports).toEqual(["services"]);
});
it("detecta JSX interrompido antes de publicar", () => {
  expect(inspectContracts([{ path: "src/Checkout.tsx", content: "export default () => <div>{price</div>" }]).issues).toHaveLength(1);
});
it("resolve arquivos index e imports js de fontes TypeScript", () => {
  expect(resolveLocalModule("src/Page.tsx", "./services", ["src/services/index.ts"])).toBe("src/services/index.ts");
  expect(resolveLocalModule("src/Page.tsx", "./data.js", ["src/data.ts"])).toBe("src/data.ts");
});
it("detecta identificador JSX não importado", () => {
  const files = [
    { path: "src/Hero.tsx", content: "export default function Hero() { return <div><Zap /></div>; }" },
  ];
  const issues = inspectContracts(files).issues;
  expect(issues.some(i => /Identificador JSX não importado: <Zap \/>/.test(i.message))).toBe(true);
});
it("aceita JSX importado de lucide-react", () => {
  const files = [
    { path: "src/Hero.tsx", content: "import { Zap } from 'lucide-react'; export default function Hero() { return <div><Zap /></div>; }" },
  ];
  expect(inspectContracts(files).issues.filter(i => /Identificador JSX/.test(i.message))).toHaveLength(0);
});
