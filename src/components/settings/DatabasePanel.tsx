import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ChevronLeft, ShieldCheck, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { inspectDatabase, type SchemaTable } from "@/services/schema.functions";
import { Field } from "./Field";

const CON: Record<string, string> = { p: "Chave primária", f: "Chave estrangeira", u: "Única", c: "Verificação" };

export function DatabasePanel() {
  const { data, isLoading, error } = useQuery({ queryKey: ["schema"], queryFn: () => inspectDatabase() });
  const [sel, setSel] = useState<string | null>(null);
  if (isLoading) return <p className="text-sm text-muted-foreground">Lendo estrutura do banco…</p>;
  if (error) return <p className="text-sm text-destructive">{error.message}</p>;
  if (!data?.connected) return <p className="text-sm text-destructive">Sem conexão: {data?.error}</p>;
  const { info, myRowCounts } = data;
  const table = info.tables.find((t) => t.name === sel);
  if (table) return <TableDetail t={table} myRows={myRowCounts[table.name] ?? null} onBack={() => setSel(null)} />;

  const fkCount = info.tables.reduce((n, t) => n + t.constraints.filter((c) => c.type === "f").length, 0);
  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <section className="rounded-xl border bg-card p-4">
        <dl>
          <Field label="Nome do banco"><span className="font-mono">{info.database}</span></Field>
          <Field label="Tecnologia">{info.version.split(" on ")[0]} (Lovable Cloud)</Field>
          <Field label="Estado da conexão"><span className="text-success">Conectado (consulta real)</span></Field>
          <Field label="Tabelas (schema public)">{info.tables.length}</Field>
          <Field label="Relacionamentos (FK)">{fkCount}</Field>
          <Field label="Datas de criação">Não registradas pelo PostgreSQL para tabelas</Field>
        </dl>
      </section>
      <ul className="grid gap-2 sm:grid-cols-2">
        {info.tables.map((t) => (
          <li key={t.name}>
            <button type="button" onClick={() => setSel(t.name)} className="w-full rounded-xl border bg-card p-3 text-left transition-colors hover:bg-accent">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-mono text-sm font-medium">{t.name}</span>
                {t.rls_enabled ? <ShieldCheck className="h-4 w-4 text-success" aria-label="RLS ativo" /> : <ShieldAlert className="h-4 w-4 text-destructive" aria-label="RLS inativo" />}
              </div>
              <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{t.comment ?? "Sem descrição"}</p>
              <p className="mt-2 text-xs text-muted-foreground">{t.columns.length} colunas · {t.indexes.length} índices · {t.policies.length} políticas</p>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function H({ children }: { children: string }) {
  return <h4 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{children}</h4>;
}

function TableDetail({ t, myRows, onBack }: { t: SchemaTable; myRows: number | null; onBack: () => void }) {
  const fks = t.constraints.filter((c) => c.type === "f");
  return (
    <div className="max-w-4xl">
      <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2"><ChevronLeft className="h-4 w-4" /> Tabelas</Button>
      <h3 className="mt-2 break-all font-mono text-lg font-semibold">{t.name}</h3>
      <p className="text-sm text-muted-foreground">{t.comment ?? "Sem descrição"}</p>

      <H>Estrutura · colunas e tipos</H>
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left text-xs text-muted-foreground"><tr><th className="p-2">Coluna</th><th className="p-2">Tipo</th><th className="p-2">Nulo</th><th className="p-2">Padrão</th></tr></thead>
          <tbody>{t.columns.map((c) => (
            <tr key={c.name} className="border-t"><td className="p-2 font-mono">{c.name}</td><td className="p-2 font-mono text-xs">{c.type}</td><td className="p-2">{c.nullable ? "sim" : "não"}</td><td className="p-2 font-mono text-xs break-all">{c.default ?? "—"}</td></tr>
          ))}</tbody>
        </table>
      </div>

      <H>Relacionamentos</H>
      {fks.length ? fks.map((c) => <p key={c.name} className="break-all font-mono text-xs">{c.definition}</p>) : <p className="text-sm text-muted-foreground">Nenhuma chave estrangeira.</p>}

      <H>Restrições</H>
      <ul className="space-y-1">{t.constraints.map((c) => (
        <li key={c.name} className="text-xs"><span className="text-muted-foreground">{CON[c.type] ?? c.type}</span> · <span className="break-all font-mono">{c.definition}</span></li>
      ))}</ul>

      <H>Segurança · políticas RLS</H>
      <p className="mb-2 text-sm">RLS {t.rls_enabled ? <span className="text-success">ativo</span> : <span className="text-destructive">inativo</span>}</p>
      {t.policies.length ? t.policies.map((p) => (
        <div key={p.name} className="mb-2 rounded-lg border p-2 text-xs">
          <p className="font-medium">{p.name} <span className="text-muted-foreground">· {p.command} · {p.roles.join(", ")}</span></p>
          {p.using && <p className="break-all font-mono text-muted-foreground">USING {p.using}</p>}
          {p.check && <p className="break-all font-mono text-muted-foreground">CHECK {p.check}</p>}
        </div>
      )) : <p className="text-sm text-muted-foreground">Nenhuma política: acesso bloqueado para usuários (somente servidor).</p>}

      <H>Índices</H>
      {t.indexes.map((i) => <p key={i.name} className="mb-1 break-all font-mono text-xs">{i.definition}</p>)}

      <H>Dados armazenados</H>
      <dl>
        <Field label="Registros estimados (total)">{t.estimated_rows < 0 ? "Sem estatística ainda" : t.estimated_rows}</Field>
        <Field label="Seus registros visíveis (RLS)">{myRows ?? "Não autorizado"}</Field>
      </dl>
    </div>
  );
}
