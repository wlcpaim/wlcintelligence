// Regras puras do terminal real (GitHub Actions): quais comandos os bots podem executar.
export const RUNNER_WORKFLOW_PATH = ".github/workflows/wlc-runner.yml";
export const RUNNER_WORKFLOW_FILE = "wlc-runner.yml";

const ALLOWED = new Set(["npm", "npx", "bun", "bunx", "node", "pnpm", "yarn", "vitest", "tsc", "python", "python3", "pip", "pip3", "pytest", "go", "cargo", "rustc", "ls", "cat", "echo", "pwd", "bash"]);

/** Aceita apenas comandos da lista, sem substituição de shell nem acesso a segredos. */
export function checkCommand(cmd: string): string | null {
  const c = cmd.trim();
  if (!c) return "Comando vazio.";
  if (c.length > 500) return "Comando longo demais.";
  if (/[`\n\r]|\$\(|\$\{?[A-Z_]*(TOKEN|SECRET|KEY)/i.test(c)) return "Comando bloqueado: substituição de shell ou leitura de segredo.";
  if (/(^|\s)(curl|wget|nc|ssh|scp|env|printenv|sudo|rm\s+-rf\s+\/)(\s|$)/.test(c)) return "Comando bloqueado: rede/segredos/destrutivo.";
  for (const part of c.split(/&&|\|\||;|\|/)) {
    const bin = part.trim().split(/\s+/)[0] ?? "";
    if (!ALLOWED.has(bin)) return `Comando não permitido: ${bin || "(vazio)"}. Permitidos: ${[...ALLOWED].join(", ")}.`;
  }
  return null;
}

/** Corta o log no que importa: cabeçalho de passos removido, foco no fim (erros/resumo). */
export function trimLog(raw: string, max = 15_000): string {
  const lines = raw.split("\n").map((l) => l.replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z\s?/, ""));
  const text = lines.join("\n");
  return text.length > max ? `…[início cortado]\n${text.slice(-max)}` : text;
}

export const RUNNER_WORKFLOW_YAML = `name: WLC Runner
on:
  workflow_dispatch:
    inputs:
      command:
        description: Comando executado pelo bot WLC
        required: true
      run_tag:
        description: Identificador da execução
        required: false
run-name: "WLC bot \${{ inputs.run_tag }}"
permissions:
  contents: read
jobs:
  run:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - uses: oven-sh/setup-bun@v2
      - uses: actions/setup-python@v5
        with:
          python-version: "3.11"
      - name: Instalar dependências
        run: |
          if [ -f bun.lockb ] || [ -f bun.lock ]; then bun install || true
          elif [ -f package-lock.json ]; then npm ci || npm install || true
          elif [ -f package.json ]; then npm install || true; fi
          if [ -f requirements.txt ]; then pip install -r requirements.txt || true; fi
      - name: Comando do bot
        env:
          WLC_COMMAND: \${{ inputs.command }}
        run: bash -c "$WLC_COMMAND"
`;
