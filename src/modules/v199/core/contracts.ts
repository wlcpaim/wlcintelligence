import { parse } from "@babel/parser";
import type * as t from "@babel/types";

export interface ContractFile { path: string; content: string }
export interface ContractIssue { path: string; message: string; target?: string }
export interface ModuleContract { path: string; exports: string[]; typeExports: string[] }

export function resolveLocalModule(importer: string, spec: string, paths: Iterable<string>): string | null {
  const parts = spec.startsWith("@/") ? ["src"] : importer.split("/").slice(0, -1);
  if (!spec.startsWith(".") && !spec.startsWith("@/")) return null;
  for (const part of (spec.startsWith("@/") ? spec.slice(2) : spec).split("/")) {
    if (part === "..") parts.pop(); else if (part && part !== ".") parts.push(part);
  }
  const base = parts.join("/");
  const candidates = [base, ...[".ts", ".tsx", ".js", ".jsx", ".mjs"].flatMap(ext => [base + ext, base + "/index" + ext])];
  // TS projects routinely import ./module.js where the source is module.ts.
  if (/\.js$/.test(base)) candidates.push(base.slice(0, -3) + ".ts", base.slice(0, -3) + ".tsx");
  const have = new Set(paths);
  return candidates.find(path => have.has(path)) ?? null;
}

const nameOf = (node: t.Identifier | t.StringLiteral) => node.type === "Identifier" ? node.name : node.value;
function bindings(node: t.Node | null | undefined): string[] {
  if (!node) return [];
  if (node.type === "Identifier") return [node.name];
  if (node.type === "ObjectPattern") return node.properties.flatMap(p => bindings(p.type === "RestElement" ? p.argument : p.value));
  if (node.type === "ArrayPattern") return node.elements.flatMap(bindings);
  if (node.type === "AssignmentPattern") return bindings(node.left);
  if (node.type === "RestElement") return bindings(node.argument);
  return [];
}


/** Globals / built-ins that nunca precisam de import em JSX React. */
const JSX_INTRINSICS = new Set([
  "Fragment", "Suspense", "StrictMode", "Profiler", "Activity",
]);

function collectDeclaredScope(body: t.Statement[]): Set<string> {
  const scope = new Set<string>(["React", "Fragment"]);
  for (const node of body) {
    if (node.type === "ImportDeclaration") {
      for (const s of node.specifiers) {
        if (s.type === "ImportDefaultSpecifier" || s.type === "ImportNamespaceSpecifier") scope.add(s.local.name);
        if (s.type === "ImportSpecifier") scope.add(s.local.name);
      }
    }
    if (node.type === "VariableDeclaration") {
      for (const d of node.declarations) for (const n of bindings(d.id)) scope.add(n);
    }
    if (node.type === "FunctionDeclaration" && node.id) scope.add(node.id.name);
    if (node.type === "ClassDeclaration" && node.id) scope.add(node.id.name);
    if (node.type === "ExportNamedDeclaration" && node.declaration) {
      const d = node.declaration;
      if (d.type === "VariableDeclaration") for (const v of d.declarations) for (const n of bindings(v.id)) scope.add(n);
      if (d.type === "FunctionDeclaration" && d.id) scope.add(d.id.name);
      if (d.type === "ClassDeclaration" && d.id) scope.add(d.id.name);
    }
    if (node.type === "ExportDefaultDeclaration") {
      const d = node.declaration;
      if (d && "id" in d && d.id && d.id.type === "Identifier") scope.add(d.id.name);
    }
  }
  return scope;
}

function walkJsxIdentifiers(node: t.Node, out: Set<string>) {
  if (!node || typeof node !== "object") return;
  if (node.type === "JSXOpeningElement") {
    const name = node.name;
    if (name.type === "JSXIdentifier" && /^[A-Z]/.test(name.name)) out.add(name.name);
    if (name.type === "JSXMemberExpression") {
      // <Foo.Bar /> — valida o objeto raiz
      let obj: t.JSXIdentifier | t.JSXMemberExpression = name;
      while (obj.type === "JSXMemberExpression") obj = obj.object as t.JSXIdentifier | t.JSXMemberExpression;
      if (obj.type === "JSXIdentifier") out.add(obj.name);
    }
  }
  for (const key of Object.keys(node) as (keyof typeof node)[]) {
    const child = node[key];
    if (Array.isArray(child)) for (const c of child) { if (c && typeof c === "object" && "type" in c) walkJsxIdentifiers(c as unknown as t.Node, out); }
    else if (child && typeof child === "object" && "type" in (child as object)) walkJsxIdentifiers(child as unknown as t.Node, out);
  }
}

/** Detecta <Component /> usados no JSX sem import/declaração no arquivo. */
export function findUndeclaredJsxIdentifiers(files: ContractFile[]): ContractIssue[] {
  const issues: ContractIssue[] = [];
  for (const f of files) {
    if (!/\.(tsx|jsx)$/.test(f.path) || f.path.startsWith("node_modules/")) continue;
    try {
      const ast = parse(f.content, { sourceType: "unambiguous", plugins: ["typescript", "jsx"] });
      const scope = collectDeclaredScope(ast.program.body);
      const used = new Set<string>();
      walkJsxIdentifiers(ast.program, used);
      for (const name of used) {
        if (JSX_INTRINSICS.has(name) || scope.has(name)) continue;
        issues.push({
          path: f.path,
          target: f.path,
          message: `Identificador JSX não importado: <${name} />. Falta importar da biblioteca (ex: lucide-react ou componente local).`,
        });
      }
    } catch {
      /* sintaxe inválida já reportada em inspectContracts */
    }
  }
  return issues;
}

/** Syntax + exact contracts, never guesses semantic aliases or creates null stubs. */
export function inspectContracts(files: ContractFile[]) {
  const issues: ContractIssue[] = [];
  const modules = new Map<string, { body: t.Statement[]; values: Set<string>; types: Set<string>; stars: string[] }>();
  for (const f of files) {
    if (!/\.(tsx?|jsx?|mjs|mts|cjs)$/.test(f.path) || f.path.startsWith("node_modules/")) continue;
    try {
      const ast = parse(f.content, { sourceType: "unambiguous", plugins: ["typescript", "jsx"] });
      const values = new Set<string>(), types = new Set<string>(), stars: string[] = [];
      for (const node of ast.program.body) {
        if (node.type === "ExportDefaultDeclaration") values.add("default");
        if (node.type === "ExportAllDeclaration" && node.exportKind !== "type") stars.push(node.source.value);
        if (node.type !== "ExportNamedDeclaration") continue;
        const d = node.declaration;
        if (d?.type === "VariableDeclaration") for (const v of d.declarations) for (const name of bindings(v.id)) values.add(name);
        else if (d && "id" in d && d.id?.type === "Identifier") {
          if (d.type === "TSInterfaceDeclaration" || d.type === "TSTypeAliasDeclaration") types.add(d.id.name);
          else { values.add(d.id.name); if (d.type === "ClassDeclaration" || d.type === "TSEnumDeclaration") types.add(d.id.name); }
        }
        for (const s of node.specifiers) {
          const isType = node.exportKind === "type" || (s.type === "ExportSpecifier" && s.exportKind === "type");
          (isType ? types : values).add(nameOf(s.exported));
        }
      }
      modules.set(f.path, { body: ast.program.body, values, types, stars });
    } catch (e) { issues.push({ path: f.path, message: `Sintaxe inválida: ${e instanceof Error ? e.message : "erro"}` }); }
  }
  // Resolve barrel exports to a fixed point, including cyclic barrels without recursion.
  for (let round = 0; round < modules.size; round++) {
    let changed = false;
    for (const [path, m] of modules) for (const spec of m.stars) {
      const target = resolveLocalModule(path, spec, modules.keys());
      const dependency = target ? modules.get(target) : undefined;
      if (!dependency) continue;
      for (const name of dependency.values) if (name !== "default" && !m.values.has(name)) { m.values.add(name); changed = true; }
      for (const name of dependency.types) if (!m.types.has(name)) { m.types.add(name); changed = true; }
    }
    if (!changed) break;
  }
  for (const [path, module] of modules) for (const node of module.body) {
    if (node.type !== "ImportDeclaration" && node.type !== "ExportNamedDeclaration") continue;
    if (!node.source) continue;
    const target = resolveLocalModule(path, node.source.value, files.map(f => f.path));
    const dependency = target ? modules.get(target) : undefined;
    if (!target || !dependency) continue; // missing files are handled by gap detection
    for (const s of node.specifiers) {
      let name: string | null = null;
      let typeOnly = node.type === "ImportDeclaration" ? node.importKind === "type" : node.exportKind === "type";
      if (s.type === "ImportDefaultSpecifier") name = "default";
      if (s.type === "ImportSpecifier") { name = nameOf(s.imported); typeOnly ||= s.importKind === "type"; }
      if (s.type === "ExportSpecifier") { name = nameOf(s.local); typeOnly ||= s.exportKind === "type"; }
      if (!name) continue;
      if (!dependency.values.has(name) && !dependency.types.has(name)) issues.push({ path, target, message: `Import/export "${name}" não existe em ${target}${typeOnly ? " (tipo)" : ""}.` });
    }
  }
  const manifest: ModuleContract[] = [...modules].map(([path, m]) => ({ path, exports: [...m.values].sort(), typeExports: [...m.types].sort() }));
  issues.push(...findUndeclaredJsxIdentifiers(files));
  return { manifest, issues };
}