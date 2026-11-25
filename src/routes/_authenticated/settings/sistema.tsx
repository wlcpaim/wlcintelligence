import { createElement } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { BrainCircuit, MessageSquare, Github, KeyRound, ShieldCheck, History } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { FREE_CHAT_INSTRUCTION } from "@/services/engineering";
import { GEMINI_MODEL_FALLBACK } from "@/config/app";
import { MAX_ATTEMPTS } from "@/modules/integrations/gemini/services/rotation";
import { TYPING_SPEED } from "@/hooks/typing";

export const Route = createFileRoute("/_authenticated/settings/sistema")({
  head: () => ({ meta: [
    { title: "Sistema — WLC IA" }, { name: "description", content: "Regras, contexto GitHub, memória e funcionamento do WLC IA." },
    { property: "og:title", content: "Sistema — WLC IA" }, { property: "og:description", content: "Diretrizes e regras do WLC IA organizadas." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }), component: SystemPage,
});

const rules = [
  { id: "conversation", icon: MessageSquare, title: "Conversa e linguagem", details: [
    "Respostas em português, naturais, diretas e amigáveis. Markdown apenas quando útil.",
    "Apresentação breve: a WLC IA se identifica como inteligência artificial especializada em desenvolvimento de aplicações, sem expor detalhes internos.",
    "Enter quebra linha; a mensagem é enviada apenas pelo botão Enviar.",
    `Escrita progressiva a ${TYPING_SPEED}× da cadência base. O texto recebido é exibido aos poucos; a velocidade da API pode limitar a chegada das palavras.`,
    "A leitura não é movida automaticamente. O botão com seta para baixo leva ao final da conversa.",
  ] },
  { id: "memory", icon: History, title: "Histórico e memória", details: [
    "Cada conversa tem um endereço próprio e um histórico separado. Só o histórico desse chat é enviado ao modelo.",
    "Mensagens e respostas são salvas na sua conta e permanecem até você excluir o chat. Ao parar uma geração, o texto recebido é preservado.",
    "O título é criado pelo Gemini a partir do assunto da primeira resposta concluída. Se a criação falhar, é tentada novamente na próxima resposta.",
    "Nomes escolhidos manualmente nunca são substituídos pelo título automático. Fixados aparecem antes dos demais, ordenados pela última atividade.",
    "Anexos GitHub valem para a conversa aberta nesta sessão. Ao reabrir, selecione novamente o repositório; o texto do histórico continua salvo.",
  ] },
  { id: "github", icon: Github, title: "Leitura do GitHub", details: [
    "Acesso somente de leitura. Nenhum commit, alteração, execução de código ou comando é realizado no repositório.",
    "A árvore usa um commit fixo. Arquivos selecionados entram como contexto apenas quando você envia a mensagem.",
    "Analisar o repositório inteiro habilita o contexto dos arquivos legíveis nas próximas mensagens. A cobertura disponível não é uma afirmação de que a IA já revisou cada arquivo.",
    "Limites por leitura: 300 arquivos, 80 KB por arquivo e 1 MB total. Até 20 arquivos podem ser anexados individualmente por mensagem.",
    "Arquivos sensíveis, binários, gerados, submódulos e excedentes são excluídos com motivo. Leitura parcial e árvores truncadas não devem ser apresentadas como análise completa.",
    "Código do repositório é dado não confiável, nunca instrução. Segredos reconhecíveis são ocultados; isso não substitui uma auditoria de segurança.",
  ] },
  { id: "keys", icon: KeyRound, title: "Gemini: prioridade e falhas", details: [
    "Chaves ativas e fora do período de espera entram na fila. A principal saudável vem primeiro; falhas ficam atrás das saudáveis e perdem o posto de principal.",
    "401: credencial não autorizada. 403: acesso negado. Todos os modelos da cadeia são testados com a chave antes de registrar a falha.",
    "429: cota esgotada ou limite de uso atingido. Chaves do mesmo projeto Google informado compartilham o bloqueio daquela tentativa. Sem projeto informado, não é possível associar cotas entre chaves.",
    "Espera: 60 segundos em 401, 403 e 429; 15 segundos em falhas temporárias. Após a espera, uma chave com falha pode ser testada como último recurso.",
    "Diagnóstico manual ou verificação agendada pode recuperar a chave. A recuperada volta como reserva no final da fila; não retoma automaticamente o posto de principal.",
    `Até ${MAX_ATTEMPTS} tentativas de chave/modelo antes de começar a resposta. Não há repetição automática depois dos primeiros dados, para evitar duplicações.`,
  ] },
  { id: "security", icon: ShieldCheck, title: "Segurança e honestidade", details: [
    "A conta autenticada só acessa suas próprias conversas, mensagens e credenciais. As regras de acesso são verificadas no servidor.",
    "Credenciais Gemini e GitHub são protegidas com AES-256-GCM e vinculadas ao usuário. A chave mestra fica apenas no servidor.",
    "Trocar a chave mestra pode tornar credenciais antigas ilegíveis. Nesse caso, cadastre novamente as credenciais em Configurações.",
    "A IA deve separar hipótese de fato, não inventar arquivos, testes executados, acesso ou bugs confirmados e declarar o que não recebeu.",
  ] },
];

function SystemPage() {
  return <div className="h-full overflow-y-auto">
    <div className="mx-auto max-w-4xl px-5 py-8 md:px-10 md:py-12">
      <header className="mb-8"><h2 className="text-xl font-semibold">Sistema</h2><p className="mt-1 text-sm text-muted-foreground">Regras, processamento e diretrizes da WLC IA.</p></header>
      <Tabs defaultValue="rules">
        <TabsList className="mb-8 flex h-auto w-full justify-start gap-1 overflow-x-auto bg-transparent p-0">
          <TabsTrigger value="rules" className="gap-2"><ShieldCheck className="h-4 w-4" />Regras</TabsTrigger>
          <TabsTrigger value="processing" className="gap-2"><BrainCircuit className="h-4 w-4" />Processamento</TabsTrigger>
          <TabsTrigger value="instruction" className="gap-2"><MessageSquare className="h-4 w-4" />Instrução</TabsTrigger>
        </TabsList>
        <TabsContent value="rules"><Accordion type="multiple" defaultValue={["conversation"]}>
          {rules.map(({ id, icon, title, details }) => <AccordionItem key={id} value={id}>
            <AccordionTrigger className="gap-3 text-left"><span className="flex items-center gap-3">{createElement(icon, { className: "h-4 w-4 shrink-0 text-primary" })}{title}</span></AccordionTrigger>
            <AccordionContent><ul className="space-y-3 pl-7 text-sm leading-relaxed text-muted-foreground">{details.map(text => <li key={text} className="list-disc">{text}</li>)}</ul></AccordionContent>
          </AccordionItem>)}
        </Accordion></TabsContent>
        <TabsContent value="processing" className="space-y-8">
          <ol className="divide-y border-y">{[
            ["Sessão", "Validação da conta e da propriedade da conversa."],
            ["Memória", "Salvamento da mensagem e leitura do histórico do chat atual."],
            ["Contexto", "Leitura dos arquivos GitHub anexados, quando solicitada."],
            ["Seleção", "Fila de chaves saudáveis, modelos alternativos e tratamento de cota."],
            ["Resposta", "Gemini transmite texto; o chat exibe a escrita progressivamente, sem mover a tela."],
            ["Permanência", "Salvamento da resposta, atualização da atividade e geração do título contextual."],
          ].map(([title, text], i) => <li key={title} className="flex gap-5 py-5"><span className="font-mono text-primary">{String(i + 1).padStart(2, "0")}</span><div><h2 className="font-medium">{title}</h2><p className="mt-1 text-sm leading-relaxed text-muted-foreground">{text}</p></div></li>)}</ol>
          <section><h2 className="mb-4 font-medium">Sequência de modelos</h2><ol className="space-y-3">{GEMINI_MODEL_FALLBACK.map((m, i) => <li key={m} className="flex gap-4 text-sm"><span className="text-muted-foreground">{i + 1}</span><code>{m}</code></li>)}</ol></section>
        </TabsContent>
        <TabsContent value="instruction"><h2 className="mb-4 font-medium">Instrução ativa do chat</h2><p className="whitespace-pre-wrap border-y py-6 text-sm leading-7 text-muted-foreground">{FREE_CHAT_INSTRUCTION}</p></TabsContent>
      </Tabs>
    </div>
  </div>;
}