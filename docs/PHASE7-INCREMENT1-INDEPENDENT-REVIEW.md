# Fase 7 — revisão independente do Incremento 1

Coordenação: Codex #2. Data: 2026-10-13. Estado atual: ACEITO EM TEST após revisão das correções e evidências da segunda rodada. Sem ativação DEV. A revisão inicial e seus achados ficam preservados abaixo.

## Aceite da segunda rodada

Codex #2 conferiu as alterações efetivas: INSERT/DELETE de grants usam RETURNING e somente operações que alteraram linhas entram nos conjuntos; restore/remove possuem guardas de ownership; os loops de negativas comparam snapshots determinísticos das seis tabelas de domínio (incluindo estado, versões, atribuição, requisitos, dependências, comentários e eventos); a barreira da reatribuição observa o PID do holder real com pg_blocking_pids e tipos de lock específicos. Não há bloqueador remanescente deste incremento na inspeção. O snapshot seleciona campos operacionais, não todas as colunas das tabelas; não deve ser descrito como comparação byte a byte integral do banco.

Evidências conferidas em PHASE7-INCREMENT1-RESULT.md: suíte alterada 4/4 e regressão sequencial 52/52 (56/56 no total), lint focal e tipos API/raiz exit 0. cleanup-report.json, horário 2026-10-13T21:57:51.497Z: 23 grants antes/depois com rolesEqual true, 397 eventos de identidade antes/depois e zero resíduos das fixtures. Recibo da primeira rodada preservado em cleanup-report.round1.json. A coordenação revisou código e artefatos, sem repetir suítes verdes nem declarar execução independente dos testes. DEV permanece fora deste aceite.

O aceite libera a fundação da central conforme PHASE7-INCREMENT2-CONTRACT.md. Não representa conclusão da Fase 7 nem autorização para declarar geração de avisos, integração browser ou ativação DEV como existentes.

## Código de produto

Inspeção das 16 funções mutadoras em `apps/api/src/demands.ts` confirma BEGIN → IDENTITY_LOCK → revalidação de ator/permissão antes de consultas de domínio e locks de linhas. `createTaskComment` seleciona a permissão pelo papel atual consultado na transação e verifica a atribuição atual para colaboradores. `addDependency` verifica a autodependência depois da revalidação. Nenhum bloqueador de implementação encontrado nessa inspeção. Isso não comprova revalidação transacional de sessão, expressamente fora deste incremento.

O relatório da implementação registra 56/56 testes, lint e tipos verdes. O artefato cleanup-report.json registra 23 grants iguais, 397 eventos de identidade antes/depois e zero resíduos. Esses resultados são evidências do implementador; a coordenação não repetiu os comandos nesta revisão.

## Correções necessárias antes do aceite

1. **Preservação de grants preexistentes.** `grantExtraPermissionOnClient` usa INSERT ON CONFLICT DO NOTHING, mas adiciona a chave ao conjunto de grants inseridos mesmo quando não houve INSERT. `removeExtraPermission` executa DELETE sem verificar ownership. Um grant preexistente pode ser removido. Registrar somente INSERT realmente realizado (RETURNING/rowCount), remover somente chaves efetivamente inseridas e preservar baseline também no finally/afterAll. A comparação posterior do snapshot detectaria o dano, mas não o evita.
2. **Ausência de alteração de domínio.** Os loops 401/403 verificam sobretudo status e contagem de eventos (e algumas contagens de demandas/comentários). Isso não comprova a afirmação de registros intactos: mudança em tarefa, demanda, requisito ou dependência sem evento escaparia. Comparar snapshots determinísticos completos do domínio das fixtures antes/depois de cada tentativa negada, incluindo demandas do cliente, tarefas, requisitos, dependências, comentários e eventos. Não incluir alterações deliberadas de identidade no snapshot operacional. Incluir todos os loops negados, inclusive demotion/comentários.
3. **Barreira específica da reatribuição.** `ADVISORY_HOLDER_WAITING_ON_ROW` aceita qualquer lock não concedido do holder advisory. Vincular a espera ao backend PID do rowHolder desta fixture usando `pg_blocking_pids` e tipos de lock adequados; manter filtro pelo banco atual. Isso deve comprovar que a reatribuição espera pelo holder da demanda desta execução, sem atribuir espera alheia à fixture.

## Próxima verificação

Antigravity conserva ownership do código, suíte e relatório do incremento. Corrigir os pontos acima, executar novamente a suíte alterada e a regressão pertinente sequencialmente em orium_test após PORT_POLICY/prova de propriedade. Reportar contagens reais, cleanup e baseline. Preservar DEV, não iniciar builds/migrations/restarts nele. A coordenação revisará as alterações e os novos artefatos antes de atribuir a implementação do backend de notificações.
