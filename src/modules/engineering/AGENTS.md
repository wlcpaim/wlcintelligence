# Shared Engineering Kernel

Camada compartilhada de qualidade para **1.7.1 PRO** e **1.9.9**.

## Contratos

- `runQualityGate` — fonte única de verdade (imports, syntax, routes, secrets, types, integrity)
- `canPersist` / Apply Guard — bloqueia persistência com erros críticos
- `runAutoHealOnce` — exatamente 1 tentativa pós-typecheck
- `buildDeliveryReport` / `formatDeliveryReport` — relatório estruturado
- `recordMetric` — telemetria isolada por usuário (sem secrets)

## Regras

- Não duplicar validação nos motores específicos
- Não expandir permissões de execução
- Não aprovar alterações sem QualityGate
- Não publicar com erros críticos
