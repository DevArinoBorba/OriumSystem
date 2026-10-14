# Fase 7 — Revisão da coordenação

## Checklist de segurança — 13/10/2026

Codex #2 revisou a versão refinada de docs/PHASE7-SECURITY-CHECKLIST.md. Aceito como insumo de planejamento, não como homologação de código implementado.

Critérios incorporados ao futuro contrato: sessão válida e identidade ativa são verificações distintas; serialização por IDENTITY_LOCK não autentica uma sessão. Listagem, contagem e marcação de leitura devem respeitar a atribuição atual. Recursos inacessíveis não revelam existência. Deduplicação usa identidade estável do evento e destinatário, preservando comentários distintos. Geração e mutação de origem devem confirmar ou reverter juntas. Payloads não contêm segredos ou referências do cofre.

A menção a um padrão verificado em materials.ts/demands.ts no checklist não comprova, por si, revalidação de sessão dentro de toda transação existente. A implementação de notificações deverá demonstrar essa garantia explicitamente com testes de revogação concorrente.

## Regras operacionais já existentes

Em apps/api/src/dashboard.ts, getDashboard usa janela de próximas entregas de amanhã até hoje + 3 dias. Atraso operacional de tarefa exige started_at preenchido, status in_production/in_review/changes_requested e data de entrega anterior a hoje. Tarefas legitimamente bloqueadas ou pausadas não satisfazem esse critério de atraso. O contrato de notificações deve reaproveitar essas regras, evitando uma segunda definição incompatível de prazo.

## Dependências e estado

Mapas entregues e interface implementada com verificações reportadas; homologação browser permanece pendente. Incremento1 de segurança dos produtores aceito em TEST por Codex #2 após correções revisadas e evidências 56/56, baseline/cleanup preservados (PHASE7-INCREMENT1-INDEPENDENT-REVIEW.md). Fundação backend/schema/migration/rotas atribuída ao Antigravity, testes ao OpenCode em PHASE7-INCREMENT2-CONTRACT.md. Nenhuma ativação DEV autorizada neste incremento; matriz de destinatários administrativos e ligação aos produtores/materialização temporal continuam pendentes. Bitwarden e pendências históricas da Fase 4 permanecem separados.
