# Fase 7 — Incremento 3: geração transacional e alertas de calendário

Coordenação Codex #2. Documento preparado em 13/10/2026; o gate Incremento2 foi concedido e o Incremento3 foi implementado/aceito em TEST. Antigravity não produziu alterações após ficar preso em leitura por mais de dez minutos; sua execução foi interrompida e CLI encerrado antes de Codex assumir os dois arquivos de ligação. Evidências finais em PHASE7-INCREMENT3-TEST-RESULT.md. Os parágrafos de atribuição abaixo preservam o contrato original; ownership vigente de backend/módulos/suites é Codex #2. Sem ativação DEV neste incremento.

## Roteamento e escopo

Decisão explícita do responsável em 13/10/2026: revisões enviadas, solicitações de pausa e comentários feitos por colaboradores notificam **todos os administradores autorizados**, ativos e com os grants exigidos. Manter roteamento pelo papel/permissão, sem hardcode de e-mail/Monique/criador.

Avisos de ação não são enviados ao próprio autor. Todos os destinatários devem estar ativos e ter demands.read + tasks.read na transação de geração; grupo administrativo ainda exige a capacidade específica abaixo. Alertas temporais podem avisar o próprio usuário. Sem destinatários válidos, a mutação de origem continua normalmente com zero avisos. Sem backfill dos eventos anteriores à implementação.

| Evento/transição real | Kind | Destinatários |
| --- | --- | --- |
| task_created, task_reassigned | task_assigned | Responsável atual; reatribuição nunca avisa o antigo responsável |
| task_ready; blocked → ready em requisito ou dependência | task_unblocked | Responsável da tarefa efetivamente desbloqueada, inclusive cascata; criação ready não duplica task_assigned |
| task_comment_created por administrador | task_comment | Responsável atual da tarefa |
| task_comment_created por colaborador atribuído | task_comment | Administradores com tasks.manage |
| task_review_submitted | task_review_submitted | Administradores com tasks.review |
| task_changes_requested | task_changes_requested | Responsável atual |
| task_completed | task_approved | Responsável atual |
| task_pause_requested | task_important_change | Administradores com tasks.manage |
| task_pause_approved, task_resumed | task_important_change | Responsável atual |
| ready → blocked em requisito/dependência | task_important_change | Responsável atual; sem aviso por mudança sem transição operacional |
| demand_updated com mudança real de título/descrição/prioridade/data; demand_completed | demand_important_change | Responsáveis atuais distintos das tarefas do chamado, excluindo autor |

Não emitir avisos adicionais por demand_created, task_accepted, task_started ou alterações sem efeito relevante. Preserve todos os eventos existentes de auditoria independentemente de haver avisos. Cada comentário distinto continua distinto.

## Integração aos produtores

Gate Incremento2 concedido: Codex executou 25/25 reais, lint/tipos verdes e cleanup baseline preservado. Antigravity assume agora apenas ligação em apps/api/src/demands.ts e notifications.ts, relatório PHASE7-INCREMENT3-RESULT.md e helpers .local/phase7/increment3/backend/. Codex #2 mantém ownership exclusivo dos módulos notifications-producer.ts e notifications-calendar.ts já preparados, das suites notifications*.integration.test.ts e helper de fixtures dos testes. Antigravity não edita testes/helpers compartilhados concorrentes: comunica bloqueadores à coordenação e verifica seus próprios arquivos. Codex executa TEST depois do checkpoint estável; QA browser aguarda essa janela terminar. Schema/migration/identity/app/contracts/frontend READONLY salvo bloqueador demonstrado e decisão da coordenação. Sem novas dependências, permissões, migrations ou triggers necessárias.

Integração do relógio interno: ambos listNotifications e markNotificationAsRead recebem parâmetro opcional final `{ now?: Date }`, usado somente para calendário. Sessão sempre validada pelo clock real do banco. Calcular notificationCalendarDate(options.now ?? new Date(sessionRow.now_ts)) uma vez, depois da autorização. GET chama materializeCalendarNotifications no mesmo client; substituir filtro temporal provisório por calendarApplicabilityPredicate nas quatro projeções usando placeholders adequados. Não passar esse option da rota HTTP nem mudar query pública.

Usar o UUID de demand_event efetivamente inserido. Gerar avisos com o mesmo PoolClient, antes do COMMIT da mutação, sob IDENTITY_LOCK e a ordem de locks já aceita. Não chamar gerador depois do COMMIT, não abrir outra transação e não capturar exceção para silenciosamente ignorar erro. Falha de INSERT notification reverte evento e mutação. Helper central de registro de evento é permitido se preservar action/reason/metadata/IDs/actor/data das ações existentes e não refatorar o domínio inteiro.

Deduplicação evento+destinatário+kind aproveita índice existente e ON CONFLICT DO NOTHING (preserva readAt/createdAt). Capturar status antes/depois, não inferir transição pela simples presença de metadata.newStatus=ready. A cascata deve consultar a atribuição da tarefa dependente real, nunca usar responsável da predecessora. Selecionar dados atuais/grants no mesmo client, sem expor metadata no aviso. Não gerar para recurso/source incoerentes.

## Calendário: materialização pessoal oportunista

Listagem materializa apenas a própria caixa após revalidar sessão/papel/grants na transação existente. Sem cron/worker/serviço novo, sem varrer ou materializar caixas de outros usuários. Data atual em America/Cuiaba, próximos prazos amanhã..hoje+3 dias inclusive. Usar a mesma definição do dashboard e datas calendário sem somar milissegundos como se todos os dias fossem 24h.

- Tarefas abertas em chamados abertos: task_due_today se deadline=hoje; task_due_soon se amanhã<=deadline<=hoje+3 dias. Esses dois incluem tarefas bloqueadas/pausadas conforme dashboard, mas não as anunciam como atraso operacional.
- task_overdue somente deadline<hoje, started_at preenchido e status in_production/in_review/changes_requested, chamado aberto. Pausa/bloqueio/completed são excluídos.
- demand_overdue somente demanda open com deadline<hoje; colaborador precisa de ao menos tarefa não concluída atribuída no chamado, conforme overdueDemands do dashboard.
- Administrador vê calendário do escopo all do próprio dashboard; colaborador somente assigned. Caixa permanece pessoal: geração temporal para admin é destinada a ele, não permite ler avisos de outro admin.

Origem temporal = recurso+destinatário+kind+data de entrega; preservar primeiro aviso/readAt em polling concorrente/dias sucessivos. Mudança real da data cria nova origem. createdAt da primeira materialização, não backdate artificial do prazo. Não reemitir diariamente atraso lido para mesma origem.

Remover a exclusão provisória dos quatro kinds e substituir por predicado temporal atual uniforme usado por items/total/unreadCount/POST: data de origem igual ao prazo atual E kind atualmente aplicável, status/started_at/demand status e visibilidade. Aviso antigo fora da janela, concluído, pausado ou reatribuído não aparece/count nem pode ser marcado (404). Preservar o registro/readAt, sem DELETE/prune necessário. Eventos de ação continuam visíveis por autorização atual, sem filtro temporal.

Horário de calendário injetável somente em opção interna de teste, nunca query/body/endpoint público. Validar mesma referência de horário dentro de uma operação e regras de sessão sempre por clock real do banco, nunca pelo relógio injetado de calendário. POST precisa aplicar o mesmo predicado real; teste de relógio do serviço deve cobrir leitura sem alterar API pública.

## Testes reais e cleanup

Após PORT_POLICY/prova de propriedade, suites PostgreSQL sequenciais. Cobrir matriz completa, exclusão do autor, destinatário inativo/grants atuais, destinatário administrador realmente autorizado, comentário distinto vs mesmo evento reexecutado, cascata ao responsável correto, transições verdadeiras vs no-op, mudança real de demanda e ausência de backfill. Provocar falha real de persistência da fixture e comprovar rollback de versão/status/evento/aviso; sem mock de produto. Revogação/reatribuição concorrente observada por barreiras reais e lock order preservado.

Calendário: virada Cuiabá vs UTC, hoje/amanhã/+3/+4, ano bissexto, status paused/blocked/completed, started_at ausente, chamado concluído, scope admin/colaborador e demanda com tarefa concluída somente, deadline alterado, origem lida não recriada e polling concorrente, predicado uniforme em counts/items/read. Sem espera por dias reais; relógio interno controlado somente para calendário.

Atualizar os testes da fundação que tinham caixa vazia/contagens sem geração para usar destinatários dedicados ou baseline explícito das próprias fixtures. Não retirar negativas nem esconder bugs; geração deve ser comprovada na suíte nova. Não alterar suites de colegas em execução. Regressões pertinentes demands/autorização/auth/calendar/dashboard apenas quando nova ligação/cálculo justificar; reportar contagem verdadeira e cada execução.

Cleanup somente IDs e grants próprios, incluindo identity_event/subjects. Baseline de grants/histórico e contagens de resíduos em artefato durável. Lint focal, tipos API/raiz e build único pertinente após checkpoint; não executar builds redundantes. Entrega exige código + testes reais + relatório; browser/DEV continuam gates posteriores. Registrar início/evidências/conclusão somente na seção Antigravity da nota oficial e relatar Codex #2 via helper.
