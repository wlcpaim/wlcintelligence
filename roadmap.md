# Roadmap

## Otimização WLC 1.7.1 PRO
- [ ] Reduzir contexto repetido e limitar expansão do plano ao orçamento.
- [ ] Substituir fallback heurístico por correspondência com offsets verificáveis.
- [ ] Distribuir fases entre projetos Gemini saudáveis menos recentemente usados.
- [ ] Rodar regressões e verificar fluxo autenticado; registrar limitações.

- [x] Fellow hardening: admin nested routes, anti-stub detectors, prompt rules
- [x] Update INTEGRATIONS_MASTER_KEY secret

## Auditoria prática solicitada

- [x] Verificar acesso real ao chat no navegador: redireciona para login, sem erros de execução observados.
- [ ] Acessar a sessão atual do usuário — bloqueado: acesso automático recusado; aguarda login na prévia.
- [ ] Criar SaaS, PDV, loja virtual, blog e fórum pelo chat e conferir os respectivos repositórios GitHub.
- [ ] Exercitar Prompt Maker, Copilot Creator e editor 1.7.1; avaliar 1.1.0 se disponível.
- [ ] Cruzar respostas, arquivos persistidos, commits e logs de execução de cada projeto.
- [ ] Emitir auditoria final de evolução e otimização baseada nos fluxos realmente executados.

- [x] Update secret INTEGRATIONS_MASTER_KEY (remix setup)
- [x] Update secret INTEGRATIONS_MASTER_KEY again after the new remix request.

## Correção do sistema de criação
- [ ] Provisionar tabelas isoladas por app antes do deploy, sem executar SQL arbitrário no banco da plataforma.
- [ ] Primeiro acesso autenticado e verificado assume admin no servidor; demais acessos não ganham admin.
- [ ] Sincronizar geração validada com GitHub e corrigir rastreamento de commits e edições concorrentes.
- [ ] Aplicar o contrato compartilhado em Chat, Copilot, editor, publicação e recuperação.
- [ ] Rodar testes de regressão e registrar limites da verificação prática.
