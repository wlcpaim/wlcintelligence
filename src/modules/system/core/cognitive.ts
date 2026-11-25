/**
 * Sistema Cognitivo da WLC 1.1.0 System.
 * Puro TypeScript — zero dependência de LLM externo.
 * 1) Comandos de terminal (ls, tree, read, edit...) são interpretados exatamente.
 * 2) Modo CMD estrito: linguagem natural é rejeitada (zero LLM, zero adivinhação).
 */

import { SYSTEM_VERSION, OWNER_CAPABILITIES, type OwnerCapability } from "../identity";

export type SystemIntent =
  | "HELP" | "STATUS" | "CONNECT" | "PROJECTS" | "USE_PROJECT"
  | "LIST_FILES" | "TREE" | "READ_FILE" | "CREATE_FILE" | "WRITE_FILE"
  | "DELETE_FILE" | "RENAME_FILE" | "SEARCH" | "ANALYZE" | "DIAGNOSE" | "FIX"
  | "DIFF" | "TEST" | "COMMIT" | "ROLLBACK"
  | "CREATE_VERSION" | "LIST_VERSIONS" | "RUN_COMMAND" | "BRIDGE_COMMAND"
  | "REPO_STATUS" | "MUTATE_SYSTEM" | "DEPLOY" | "UNKNOWN";

export type PlanParams = Record<string, string | boolean | number | null>;

export interface CognitivePlan {
  intent: SystemIntent;
  confidence: number;
  capability: OwnerCapability | null;
  params: PlanParams;
  needsConfirm: boolean;
  summary: string;
}

interface CommandSpec {
  intent: SystemIntent;
  capability: OwnerCapability | null;
  confirm?: boolean;
  /** Recebe os argumentos da primeira linha e o corpo (linhas seguintes). */
  args?: (args: string[], body: string) => PlanParams | string;
}

const need = (v: string | undefined, msg: string) => (v ? v : null) ?? msg;

const COMMANDS: Record<string, CommandSpec> = {
  help: { intent: "HELP", capability: null },
  ajuda: { intent: "HELP", capability: null },
  status: { intent: "STATUS", capability: null },
  connect: { intent: "CONNECT", capability: "system.bridge" },
  conectar: { intent: "CONNECT", capability: "system.bridge" },
  link: { intent: "CONNECT", capability: "system.bridge" },
  projects: { intent: "PROJECTS", capability: "system.repo.read" },
  projetos: { intent: "PROJECTS", capability: "system.repo.read" },
  use: { intent: "USE_PROJECT", capability: "system.repo.read", args: (a) => {
    const name = a.join(" ").trim();
    return name ? { project: name } : "Informe o projeto. Ex: `use meu-app`";
  } },
  ls: { intent: "LIST_FILES", capability: "system.repo.read", args: (a) => ({ path: a[0] ?? "" }) },
  tree: { intent: "TREE", capability: "system.repo.read", args: (a) => ({ path: a[0] ?? "" }) },
  read: { intent: "READ_FILE", capability: "system.repo.read", args: (a) => {
    const p = need(a[0], "Informe o arquivo. Ex: `read src/app.ts`");
    return a[0] ? { path: p } : p;
  } },
  cat: { intent: "READ_FILE", capability: "system.repo.read", args: (a) => (a[0] ? { path: a[0] } : "Informe o arquivo. Ex: `cat src/app.ts`") },
  create: { intent: "CREATE_FILE", capability: "system.repo.write", args: (a, body) => (a[0] ? { path: a[0], body } : "Informe o arquivo. Ex: `create src/novo.ts` e o conteúdo nas linhas seguintes.") },
  edit: { intent: "WRITE_FILE", capability: "system.repo.write", confirm: true, args: (a, body) => {
    if (!a[0]) return "Informe o arquivo. Ex: `edit src/app.ts` e o novo conteúdo nas linhas seguintes.";
    if (!body) return "Envie o conteúdo nas linhas abaixo do comando (conteúdo completo ou blocos <<< / === / >>>).";
    return { path: a[0], body };
  } },
  delete: { intent: "DELETE_FILE", capability: "system.repo.write", confirm: true, args: (a) => (a[0] ? { path: a[0] } : "Informe o arquivo. Ex: `delete src/velho.ts`") },
  rm: { intent: "DELETE_FILE", capability: "system.repo.write", confirm: true, args: (a) => (a[0] ? { path: a[0] } : "Informe o arquivo. Ex: `rm src/velho.ts`") },
  rename: { intent: "RENAME_FILE", capability: "system.repo.write", confirm: true, args: (a) => (a[0] && a[1] ? { from: a[0], to: a[1] } : "Uso: `rename <origem> <destino>`") },
  mv: { intent: "RENAME_FILE", capability: "system.repo.write", confirm: true, args: (a) => (a[0] && a[1] ? { from: a[0], to: a[1] } : "Uso: `mv <origem> <destino>`") },
  search: { intent: "SEARCH", capability: "system.repo.read", args: (a) => {
    const term = a.join(" ").trim();
    return term ? { term } : "Informe o termo. Ex: `search useChat`";
  } },
  grep: { intent: "SEARCH", capability: "system.repo.read", args: (a) => (a.length ? { term: a.join(" ") } : "Informe o termo. Ex: `grep useChat`") },
  analyze: { intent: "ANALYZE", capability: "system.repo.read" },
  diagnose: { intent: "DIAGNOSE", capability: "system.repo.read" },
  fix: { intent: "FIX", capability: "system.repo.read" },
  diff: { intent: "DIFF", capability: "system.repo.read", args: (a) => ({ path: a[0] ?? "" }) },
  test: { intent: "TEST", capability: "system.orchestrate", confirm: true, args: (a) => ({ command: a.join(" ") || "npm test" }) },
  commit: { intent: "COMMIT", capability: "system.repo.write", confirm: true, args: (a) => ({ message: a.join(" ").trim() || "chore: alterações via WLC System" }) },
  rollback: { intent: "ROLLBACK", capability: "system.repo.write", confirm: true, args: (a) => ({ backupId: a[0] ?? "" }) },
  revert: { intent: "ROLLBACK", capability: "system.repo.write", confirm: true, args: (a) => ({ backupId: a[0] ?? "" }) },
  run: { intent: "RUN_COMMAND", capability: "system.orchestrate", confirm: true, args: (a) => (a.length ? { command: a.join(" ") } : "Informe o comando. Ex: `run npm run build`") },
  deploy: { intent: "DEPLOY", capability: "system.deploy", confirm: true },
  versions: { intent: "LIST_VERSIONS", capability: "system.versions" },
  repo: { intent: "REPO_STATUS", capability: "system.repo.read" },
  bridge: { intent: "BRIDGE_COMMAND", capability: "system.bridge" },
};

/** Frases em português que equivalem a comandos. */
const PHRASES: Array<{ re: RegExp; to: (m: RegExpMatchArray) => string }> = [
  { re: /^bridge status$/i, to: () => "connect" },
  { re: /^o que (você|vc) (pode|consegue)/i, to: () => "help" },
  { re: /^(quem (é|e) você|identidade|versão)$/i, to: () => "status" },
  { re: /^listar (arquivos|files)\s*(.*)$/i, to: (m) => `ls ${m[2] ?? ""}` },
  { re: /^(mostrar )?(estrutura|árvore|arvore)( do projeto)?$/i, to: () => "tree" },
  { re: /^(ler|mostrar conteúdo de)\s+(arquivo\s+)?(\S+)/i, to: (m) => `read ${m[3]}` },
  { re: /^(listar|meus) projetos$/i, to: () => "projects" },
  { re: /^(abrir|usar) projeto\s+(.+)$/i, to: (m) => `use ${m[2]}` },
  { re: /^(excluir|apagar|deletar)\s+(arquivo\s+)?(\S+)$/i, to: (m) => `delete ${m[3]}` },
  { re: /^renomear\s+(\S+)\s+(para\s+)?(\S+)$/i, to: (m) => `rename ${m[1]} ${m[3]}` },
  { re: /^(pesquisar|procurar|buscar)\s+(.+)$/i, to: (m) => `search ${m[2]}` },
  { re: /^(analisar|análise)( o)?( projeto)?$/i, to: () => "analyze" },
  { re: /^(diagnosticar|diagnóstico)( o)?( projeto)?$/i, to: () => "diagnose" },
  { re: /^(listar versões|versões disponíveis)$/i, to: () => "versions" },
  { re: /^(status do repo(sitório)?|repo status|github status)$/i, to: () => "repo" },
  { re: /^(fazer deploy|publicar)$/i, to: () => "deploy" },
  { re: /^(rodar|executar comando)\s+(.+)$/i, to: (m) => `run ${m[2]}` },
  { re: /^(alterações|mudanças)( pendentes)?$/i, to: () => "diff" },
  { re: /^(fazer )?rollback(\s+(\S+))?$/i, to: (m) => `rollback ${m[3] ?? ""}`.trim() },
  { re: /^(desfazer|reverter)( o)? commit(\s+(\S+))?$/i, to: (m) => `rollback ${m[4] ?? ""}`.trim() },
];

function splitArgs(line: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|`([^`]*)`|(\S+)/g;
  for (const m of line.matchAll(re)) out.push(m[1] ?? m[2] ?? m[3] ?? m[4] ?? "");
  return out;
}

const plain = (intent: SystemIntent, summary: string, params: PlanParams = {}): CognitivePlan =>
  ({ intent, confidence: 0, capability: null, params, needsConfirm: false, summary });

/** Classifica a mensagem e monta um plano de execução Owner. Determinístico. */
export function plan(message: string): CognitivePlan {
  const trimmed = message.replace(/^\s*(wlc:~\$|\$|\/)\s*/, "").trim();
  if (!trimmed) return plain("UNKNOWN", "Mensagem vazia.");

  const [rawFirst = "", ...rest] = trimmed.split("\n");
  let first = rawFirst.trim();
  const body = rest.join("\n");
  for (const p of PHRASES) {
    const m = first.match(p.re);
    if (m) { first = p.to(m).trim(); break; }
  }
  // "criar versão X" continua suportado
  const version = first.match(/^(criar|nova) versão\s+["']?([^"'\n]+)/i);
  if (version?.[2]) {
    return { intent: "CREATE_VERSION", confidence: 0.9, capability: "system.versions", params: { name: version[2].trim() }, needsConfirm: false, summary: `Criar versão ${version[2].trim()}.` };
  }

  const [cmd = "", ...args] = splitArgs(first);
  const spec = COMMANDS[cmd.toLowerCase()];
  if (spec) {
    const params = spec.args ? spec.args(args, body) : {};
    if (typeof params === "string") {
      return { ...plain("UNKNOWN", params), confidence: 1, params: { error: params, command: cmd.toLowerCase() } };
    }
    return {
      intent: spec.intent, confidence: 1, capability: spec.capability, params,
      needsConfirm: spec.confirm ?? false,
      summary: `${cmd.toLowerCase()} ${args.join(" ")}`.trim(),
    };
  }

  // CMD estrito: qualquer entrada que não seja comando registrado é rejeitada.
  const unknown = cmd || trimmed.split(/\s+/)[0] || trimmed;
  const error =
    `[CMD ERROR]: Comando "${unknown}" não reconhecido.\n` +
    `O WLC 1.1.0 opera em modo CMD estrito (zero linguagem natural).\n` +
    `Digite 'help' para ver os comandos ou use os botões do painel acima.`;
  return {
    intent: "UNKNOWN",
    confidence: 1,
    capability: null,
    params: { error, command: unknown.toLowerCase() },
    needsConfirm: false,
    summary: `Comando desconhecido: ${unknown}`,
  };
}

/** Catálogo público de comandos para o Card de Comandos (UI). */
export type CommandCatalogItem = {
  cmd: string;
  label: string;
  syntax: string;
  category: "explore" | "files" | "quality" | "devops";
  needsArg?: boolean;
};

export const COMMAND_CATALOG: CommandCatalogItem[] = [
  { cmd: "projects", label: "Lista projetos do Code Studio", syntax: "projects", category: "explore" },
  { cmd: "use", label: "Abre o projeto nesta sessão", syntax: "use <projeto>", category: "explore", needsArg: true },
  { cmd: "status", label: "Estado do projeto e da conexão", syntax: "status", category: "explore" },
  { cmd: "ls", label: "Lista arquivos e diretórios", syntax: "ls [pasta]", category: "explore" },
  { cmd: "tree", label: "Árvore do projeto em ASCII", syntax: "tree", category: "explore" },
  { cmd: "read", label: "Exibe o conteúdo do arquivo", syntax: "read <arq>", category: "explore", needsArg: true },
  { cmd: "search", label: "Busca termos no código", syntax: "search <termo>", category: "explore", needsArg: true },
  { cmd: "create", label: "Cria um arquivo novo", syntax: "create <arq>", category: "files", needsArg: true },
  { cmd: "edit", label: "Edita com diff (<<< === >>>)", syntax: "edit <arq>", category: "files", needsArg: true },
  { cmd: "delete", label: "Exclui um arquivo", syntax: "delete <arq>", category: "files", needsArg: true },
  { cmd: "rename", label: "Renomeia/move arquivo", syntax: "rename <de> <para>", category: "files", needsArg: true },
  { cmd: "analyze", label: "Estatísticas e dependências", syntax: "analyze", category: "quality" },
  { cmd: "diagnose", label: "Imports quebrados e sintaxe", syntax: "diagnose", category: "quality" },
  { cmd: "fix", label: "Sugere correções pontuais", syntax: "fix", category: "quality" },
  { cmd: "diff", label: "Alterações locais pendentes", syntax: "diff", category: "quality" },
  { cmd: "commit", label: "Commit no GitHub com backup", syntax: "commit [msg]", category: "devops" },
  { cmd: "rollback", label: "Restaura último backup", syntax: "rollback", category: "devops" },
  { cmd: "test", label: "Roda testes no WLC Runner", syntax: "test <cmd>", category: "devops", needsArg: true },
  { cmd: "run", label: "Executa comando na nuvem", syntax: "run <cmd>", category: "devops", needsArg: true },
  { cmd: "connect", label: "Handshake do canal bridge", syntax: "connect", category: "devops" },
  { cmd: "help", label: "Lista todos os comandos", syntax: "help", category: "explore" },
];

/** Lista de nomes de comando registrados (para validação externa). */
export function knownCommandNames(): string[] {
  return Object.keys(COMMANDS);
}

export function helpText(): string {
  return [
    `**${SYSTEM_VERSION.fullName}** — Terminal Owner`,
    "",
    "```",
    "connect                  verifica sessão/projeto e gera instruções de conexão",
    "projects                 lista seus projetos do WLC Code",
    "use <projeto>            abre um projeto nesta sessão",
    "ls [pasta]               lista arquivos",
    "tree [pasta]             árvore do projeto",
    "read <arquivo>           lê um arquivo",
    "create <arquivo>         cria (conteúdo nas linhas seguintes)",
    "edit <arquivo>           edita (conteúdo completo ou blocos <<< === >>>) *",
    "delete <arquivo>         exclui *",
    "rename <origem> <dest>   renomeia *",
    "search <termo>           pesquisa no projeto",
    "analyze                  analisa a estrutura",
    "diagnose                 procura imports quebrados e problemas",
    "fix                      lista correções seguras para os problemas",
    "diff [arquivo]           alterações locais ainda não enviadas",
    "test [comando]           roda testes no WLC Runner (GitHub Actions) *",
    "commit [mensagem]        envia as alterações ao GitHub *",
    "rollback [backupId]     reverte para o último backup (ou ID indicado) *",
    "status                   estado da sessão",
    "```",
    "`*` pede confirmação (`confirmar` / `cancelar`).",
    "",
    "Edição cirúrgica com `edit`:",
    "```",
    "edit src/app.ts",
    "<<<",
    "trecho atual (exato e único)",
    "===",
    "trecho novo",
    ">>>",
    "```",
    "Você também pode escrever em linguagem natural: eu identifico os arquivos envolvidos e monto o plano.",
  ].join("\n");
}

export function statusText(): string {
  return [
    `**${SYSTEM_VERSION.fullName}**`,
    `Slug: \`${SYSTEM_VERSION.slug}\``,
    `Nível: **${SYSTEM_VERSION.level}**`,
    `Puro (sem Gemini): **sim**`,
    "",
    "Capacidades Owner:",
    ...OWNER_CAPABILITIES.map((c) => `- \`${c}\``),
  ].join("\n");
}
