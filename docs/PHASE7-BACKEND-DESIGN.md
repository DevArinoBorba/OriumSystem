# Fase 7 — desenho do backend da central

Responsável: Codex #2. Data: 2026-10-13. Estado: arquitetura da fundação atribuída em PHASE7-INCREMENT2-CONTRACT.md após aceite TEST do Incremento1. Matriz de geração e calendário fixada em PHASE7-INCREMENT3-CONTRACT.md: responsável confirmou todos os administradores autorizados para avisos administrativos. Implementação aguarda gate TEST Incremento2. Este desenho não autoriza ativação DEV; somente o contrato do incremento permite a migration em TEST.

## Fundação e fronteira de autenticação

Manter Fastify/PostgreSQL, as 17 permissões e os 23 grants existentes. A API pública e os schemas permanecem exatamente em PHASE7-NOTIFICATIONS-CONTRACT.md. Sem SMTP, push, WhatsApp, worker externo ou dependência nova.

`authenticate` atualmente retorna apenas SessionResponse, sem ID de sessão. Criar uma função interna que retorna identidade pública mais um contexto privado de sessão obtido pelo Better Auth; preservar o retorno e os consumidores existentes de authenticate por um wrapper. Nenhum token, cookie, ID de sessão ou campo privado entra na resposta HTTP ou nos contracts. Não aceitar ID de sessão fornecido pelo cliente nem analisar manualmente o cookie assinado.

Listar e marcar leitura usam o mesmo PoolClient: BEGIN em READ COMMITTED → IDENTITY_LOCK → verificação/lock da sessão específica e vínculo com usuário ativo → papel/grants atuais → geração temporal autorizada, quando aplicável → seleção de avisos autorizados ou marcação → COMMIT. A linha de sessão deve ficar bloqueada de modo compatível com a própria consulta e impeditivo de DELETE concorrente até o commit. Isso cobre sign-out, que atualmente remove sessão sem adquirir IDENTITY_LOCK. Não iniciar snapshot REPEATABLE READ antes de aguardar o advisory, para evitar observar identidade anterior à revogação.

Verificar validade absoluta (expires_at e created_at, sete dias) e inatividade (last_seen_at, doze horas) com horário observado depois da espera pelos locks; não usar apenas now() da transação iniciada antes de uma espera. Revalidar também depois de esperar pela linha da sessão. Sessão ausente/inválida ou usuário inativo → 401; grants demands.read/tasks.read ausentes → 403; aviso fora da caixa ou sem visibilidade atual → 404. Não ressuscitar sessão nem prolongar validade absoluta. Aviso lido idempotentemente preserva primeiro readAt.

## Persistência e produtores

Uma tabela de avisos pessoais relaciona destinatário text (auth_user), demanda UUID, tarefa UUID opcional, kind, origem estável, created_at e read_at. Não persistir payload de comentário, motivo, URL, credencial ou cópia de títulos. Títulos e deliveryDate são consultados do recurso autorizado atual. Índices por destinatário/created_at/id e por destinatário para não lidos; índices de FKs e deduplicação definidos na migration. Privilégios mínimos para orium_app, sem DELETE global nem novas permissões de produto.

Origem de evento usa o UUID real de demand_event mais destinatário e kind como chave única. Geração ocorre no mesmo PoolClient/transação da mutação e do evento, depois da revalidação de identidade e locks de domínio. Falha em inserir o aviso reverte a mutação/evento. Não gerar a partir de histórico antigo nem deduzir destinatários históricos pela atribuição atual. Cada comentário distinto mantém seu evento/aviso distinto. Reexecução da geração do mesmo evento não duplica aviso nem redefine readAt/createdAt.

Caixa pessoal vale também para administradores. Destinatários precisam estar ativos e possuir demands.read/tasks.read no momento de geração. Consulta e leitura revalidam esses grants e acesso atual novamente. Atribuição antiga não concede acesso permanente. A geração não notifica o próprio autor nos eventos de ação; alertas temporais podem notificar o próprio responsável.

## Matriz de eventos a fechar no contrato de implementação

| Origem | Kind | Destino e condição |
| --- | --- | --- |
| task_created, task_reassigned | task_assigned | Responsável atual, incluindo atribuição a administrador; sem aviso adicional de desbloqueio quando a tarefa nasce ready |
| task_ready; mudança blocked → ready em requisito/dependência | task_unblocked | Responsável da tarefa efetivamente desbloqueada, inclusive dependentes na cascata |
| task_comment_created | task_comment | Autor administrador: responsável atual; autor colaborador: todos os administradores ativos com tasks.manage e ambos grants de leitura |
| task_review_submitted | task_review_submitted | Todos os administradores ativos com tasks.review e ambos grants de leitura |
| task_changes_requested | task_changes_requested | Responsável atual |
| task_completed | task_approved | Responsável atual |
| task_pause_requested | task_important_change | Todos os administradores ativos com tasks.manage e ambos grants de leitura |
| task_pause_approved, task_resumed; mudança ready → blocked | task_important_change | Responsável atual; não emitir por alteração sem efeito operacional |
| demand_updated, demand_completed | demand_important_change | Responsáveis atuais distintos no chamado, excluindo autor; update somente se valores relevantes efetivamente mudarem |

Não emitir avisos por aceite/início do próprio executor nesta primeira central. A matriz completa, aprovada quanto aos destinatários administrativos pelo responsável, está fixada em PHASE7-INCREMENT3-CONTRACT.md e prevalece sobre este desenho de preparação.

## Alertas de calendário

Materializar oportunisticamente na consulta da própria caixa, sem cron/serviço novo. A data atual vem de America/Cuiaba e a janela de próximas entregas permanece amanhã até hoje + 3 dias. Reutilizar os critérios do dashboard: tarefa atrasada exige started_at e status in_production/in_review/changes_requested; tarefas bloqueadas/pausadas não são atraso operacional. Chamado atrasado segue os critérios de overdueDemands existentes.

Deduplicação temporal deve representar destinatário, recurso, kind e data de entrega (não cada polling nem cada dia de atraso). Alteração real da data produz nova origem temporal; repetição preserva leitura. Seleção/contagem/leitura filtram também o predicado temporal atual: aviso que deixou de aplicar por conclusão, pausa, mudança de data ou fim da janela não reaparece como pendência histórica. Calendário pessoal segue scope all/assigned do dashboard conforme PHASE7-INCREMENT3-CONTRACT.md; não materializar caixas de todos os usuários em cada GET.

## Provas exigidas

Testes reais PostgreSQL para evento+aviso atomicamente confirmados/revertidos, deduplicação e comentários distintos, cascata de desbloqueio e ausência de aviso falso, isolamento de caixa/admin/colaborador, reatribuição e 404, sessão encerrada/expirada enquanto espera, desativação e revogação de grants, leitura concorrente/idempotente, filtros/paginação/counts e payload mínimo. Calendário com horário injetado interno (não via HTTP), virada Cuiabá, ano bissexto, janela +3 dias, pausa/bloqueio, mudança de prazo e readAt preservado. Fixtures rastreadas, baseline preservado e cleanup cirúrgico. Nenhum PASS de browser antes da API funcionar no portal visível sob PORT_POLICY.
