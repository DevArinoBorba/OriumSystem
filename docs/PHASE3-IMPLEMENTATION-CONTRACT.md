# Fase 3 — Contrato de implementação coordenada

Data: 2026-10-06. Estado: implementação autorizada; não é evidência de entrega.

Regras aprovadas: administradores distribuem trabalho; colaboradores veem somente trabalho atribuído; aceite não inicia execução; início explícito exige requisitos e dependências satisfeitos; criador informa data de entrega; Monique autoriza pausa e ajusta a data. Usar o papel administrativo existente para as ações de gestão, sem vincular autorização a um e-mail. Registrar decisões e ações com autor e motivo.

## Fronteiras de trabalho

Antigravity: contratos compartilhados, schema, migration, backend, especificação sincronizada e relatório de backend. OpenCode: frontend e relatório de interface, exceto TaskDetailView.tsx. QA: plano, testes de integração novos, runner/evidências de navegador e exclusivamente apps/web/src/components/TaskDetailView.tsx. Esse componente recebe taskId, session, availableTasks opcional, onUnauthorized, onChanged e onBack. Codex: coordenação e revisão de segurança/arquitetura. Não editar arquivos do colega sem transferência explícita.

## Modelo e representação

- `demand`: UUID, clientId UUID, createdByUserId text, title (1–160), description (até 5000, string), priority (`low|normal|high|urgent`), deliveryDate (`YYYY-MM-DD`, data real), status (`open|completed`), version positivo, createdAt/updatedAt ISO com offset.
- `task`: UUID, demandId UUID, assignedToUserId text, title/description/priority, deliveryDate, status (`blocked|ready|in_production|in_review|changes_requested|paused|completed`), acceptedAt/readyAt/startedAt/completedAt (ISO nullable), pauseRequestedAt/pauseReason (nullable), deliveryNotes/previewUrl (nullable), version, createdAt/updatedAt. startedAt é o primeiro início, preservado nos ajustes.
- `task_requirement`: UUID, taskId, title, mandatory boolean, satisfied boolean. Materiais são requisitos verificáveis, não armazenamento de arquivos/credenciais.
- `task_dependency`: tarefa e pré-requisito da mesma demanda, sem repetição, sem autorreferência e sem ciclos. FK de usuários sempre text; client.archived_at existente preservado.
- Comentário: id/taskId/authorId/authorName/content/createdAt. Evento: id/demandId/taskId nullable/actorId/actorName/action/reason nullable/metadata/createdAt. Conteúdo e metadata sanitizados; sem segredos nem notas globais de cliente.
- Datas de entrega são dias do calendário, sem cálculo de duração. Não implementar alertas de atraso nesta etapa; a classificação operacional pertence ao dashboard.
- Tarefas exigem responsável ativo. Nova tarefa recebe data explícita ou a data da demanda, sem duração gerada. Criação de demanda exige cliente ativo; arquivamento posterior não apaga histórico.

## Contratos compartilhados e respostas

Exportar `demandSchema`, `taskSchema`, `demandListResponseSchema`, `demandDetailResponseSchema`, `taskResponseSchema`, `taskDetailResponseSchema`, `taskCommentsResponseSchema`, `demandHistoryResponseSchema` e schemas de inputs abaixo. Usar objetos strict e listas limitadas; status/prioridade via enums.

- Lista: `{ demands: Demand[], total, page, pageSize }`; cada Demand contém `client: { id, name }` e demais campos do modelo. Filtros q/status/priority/clientId, paginação determinística, busca literal escapada.
- Detalhe demanda: `{ demand: Demand, tasks: Task[] }`; colaborador recebe somente suas tarefas. Detalhe tarefa: `{ task: Task, requirements: Requirement[], dependencies: { id, satisfied }[] }`; metadados das tarefas alheias não são expostos.
- Mutação demanda: `{ demand }`; mutação tarefa: `{ task }`. Comentários `{ comments }`; histórico `{ events }`.
- `createDemandSchema`: clientId/title/description default vazio/priority default normal/deliveryDate. `updateDemandSchema`: version e campos editáveis, pelo menos um; cliente não muda nesta etapa.
- `createTaskSchema`: demandId/assignedToUserId/title/description/priority/deliveryDate opcional/requirements (`{title,mandatory}` até 30)/dependsOnTaskIds até 30.
- Toda ação de tarefa: version obrigatório. Accept/start/resume somente version. Reassign: version/assignedToUserId/reason. Requirement: version/satisfied. Dependencies: version/dependsOnTaskId; remoção version no body. Submit: version/deliveryNotes (1–3000)/previewUrl opcional http(s). Review: version/decision (`complete|changes_requested`)/feedback obrigatório. Request pause: version/reason obrigatório. Approve pause: version/reason/deliveryDate obrigatório. Comment: content 1–4000.

## API /api/v1

GET/POST `/demands`; GET/PATCH `/demands/:id`; POST `/demands/:id/complete` (version); GET `/demands/:id/history`.
POST `/tasks`; GET `/tasks/:id`; POST `/tasks/:id/accept`, `/start`, `/submit-review`, `/review`, `/request-pause`, `/approve-pause`, `/resume`, `/reassign`.
PATCH `/tasks/:id/requirements/:requirementId`; POST `/tasks/:id/dependencies`; DELETE `/tasks/:id/dependencies/:dependencyId`; GET/POST `/tasks/:id/comments`.

GET/POST rotas existentes de clientes/equipe mantêm proteção administrativa. `/clients` não vira lista global acessível a colaboradores. A projeção do cliente vinculado é somente id e nome.

## Autorização e transições

- Novas permissões: `demands.read`, `demands.write`, `tasks.read`, `tasks.manage`, `tasks.execute`, `tasks.review`. Administrador recebe todas; colaborador somente read de demandas/tarefas e execute, sempre combinado com atribuição. Revisar permissionSchema, limite de rolePermissionsSchema e política de grants de collaborator sem liberar clientes/equipe.
- Administradores criam demandas/tarefas, alteram requisitos/dependências, reatribuem, revisam, aprovam pausas e retomam. Execução (accept/start/submit/request-pause) exige usuário diretamente atribuído, inclusive administrador que atua como responsável. Não executar em nome de outro nesta entrega.
- Colaborador só lê demanda quando possui tarefa nela. Detalhes, listas, comentários e histórico restringem-se às tarefas atualmente atribuídas. Sem histórico global da demanda para colaborador; eventos administrativos relevantes da sua tarefa são permitidos. Objeto inacessível retorna 404; mutação administrativa proibida retorna 403. Sem contagens ou títulos de tarefas alheias.
- Accept registra acceptedAt sem alterar status/startedAt. Repetição com versão antiga retorna 409. Start exige acceptedAt e status ready/changes_requested, todos requisitos obrigatórios satisfeitos e dependências completed. startedAt só preenchido no primeiro start.
- Pré-início: blocked se faltam requisitos/dependências, ready se todos satisfeitos; readyAt registra prontidão. Atualizações de requisito/dependência reavaliam o estado somente antes do primeiro início. Não permitir alteração estrutural de requisitos/dependências após início nesta entrega; conflitos 409 em vez de inventar regra de invalidação em produção.
- Submit exige in_production e leva a in_review. Review exige in_review; changes_requested registra feedback, complete grava completedAt e libera tarefas dependentes por reavaliação. Não concluir dependência antes da revisão administrativa.
- Request pause exige in_production, registra solicitação/motivo sem pausar automaticamente. Approve pause exige solicitação pendente, registra autor/motivo/data anterior e nova e leva a paused; nova data explicitamente informada, sem soma automática de tempo. Resume é gestão administrativa explícita de paused para in_production, registra intervalo e limpa solicitação. Não cria novo startedAt.
- Reassign antes do primeiro início, motivo obrigatório, responsável ativo, limpa acceptedAt e registra evento; preserva histórico. Pós-início fica fora do fluxo atual até definição da regra, retorna 409.
- Complete demand exige ao menos uma tarefa e todas completed, ação administrativa explícita. Publicação externa é registro operacional/etapa de trabalho, não deploy automático. Cancelamento/reabertura/cascata não serão inventados.

## Integridade e critérios de aceite

Transições e eventos na mesma transação; versão otimista para conflitos. Todas as mutações de tarefa/dependências serializam na linha da demanda antes de consultar estado, revalidam sessão/usuário ativo/papel/atribuição dentro da transação e mantêm ordem de locks uniforme. Inserções simultâneas de arestas opostas não podem criar ciclo. Sem chamadas externas em transações. FK indexadas e paginação limitada. Grants do migrator para novas tabelas, app nunca proprietária.

Preservar DB dev e contas reais; testar mudanças primeiro em orium_test identificado. Antes de serviços aplicar PORT_POLICY.md e Find-FreePort.ps1, sem encerrar processos alheios. Testes de navegador no portal visível, credenciais efêmeras de fixtures sem logs. Testes reais de autorização/IDOR, requisitos, concorrência, pausas aprovadas, revisão e fluxo landing page. Não declarar Fase 3 concluída antes de revisão e evidências finais.
