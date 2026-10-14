# Fase 7 — Mapa de Integração Transacional, Schema, Permissões e Produtores de Eventos (READONLY)

- **Data:** 2026-10-13
- **Responsável:** Antigravity
- **Coordenação:** Codex #2 (`docs/PHASE7-KICKOFF.md`)
- **Escopo:** Inventário técnico **READONLY** de produtores de eventos nas transações de demandas/tarefas/comentários, permissões, schema (`0000` a `0004`), contratos (`@orium/contracts`) e infraestrutura de alertas/tempo (`dashboard.ts`), com identificação de lacunas, proposta de integração transacional e plano de testes reais em PostgreSQL (`orium_test`).
- **Invariantes preservadas:** Nenhum arquivo de código, schema, migration, dependência ou configuração foi alterado; nenhuma suíte, build ou restart foi executado; ambiente DEV (`API 3002 / PID 63632`, `WEB 5173 / PID 26472`, `orium_dev 55432`) e pendências externas (Bitwarden / Fase 4) permaneceram intactos.

---

## 1. Inventário de Arquivos e Símbolos Reais Mapeados

### 1.1 Backend (`apps/api/src/`)
| Arquivo | Símbolos Reais Exportados / Internos Relevantes | Papel Atual na Arquitetura |
|---|---|---|
| [`apps/api/src/demands.ts`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/apps/api/src/demands.ts) | `revalidateActorInsideTransaction` (interno, L162), `evaluateTaskReadiness` (interno, L226), `wouldCreateCycle` (exportado, L256), `listDemands` (L286), `createDemand` (L380), `getDemandById` (L419), `updateDemand` (L455), `completeDemand` (L524), `getDemandHistory` (L576), `createTask` (L615), `getTaskById` (L718), `acceptTask` (L757), `startTask` (L811), `submitTaskReview` (L871), `reviewTask` (L931), `requestTaskPause` (L1026), `approveTaskPause` (L1078), `resumeTask` (L1145), `reassignTask` (L1213), `updateRequirement` (L1278), `addDependency` (L1352), `removeDependency` (L1446), `listTaskComments` (L1516), `createTaskComment` (L1540) | Domínio central da Fase 3: gerencia ciclo de vida de chamados (`demand`), tarefas (`task`), requisitos (`task_requirement`), dependências (`task_dependency`), comentários (`task_comment`) e gravação transacional de histórico operacional (`demand_event`). |
| [`apps/api/src/dashboard.ts`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/apps/api/src/dashboard.ts) | `DashboardOptions` (L18), `addCalendarDays` (L79), `sortDashboardItems` (L91), `getAwaitingActionReason` (interno, L103), `getDashboard` (L177) | Domínio da Fase 4: snapshot transacional `REPEATABLE READ READ ONLY` com fuso fixo `America/Cuiaba`, cálculo de `today`, `tomorrow`, `upcomingLimit` (`today + 3 dias`), atraso operacional (`overdueTasks`, `overdueDemands`), entregas do dia (`dueToday`), próximas entregas (`upcoming`), urgentes (`urgent`) e pendências de ação (`awaitingAction`). |
| [`apps/api/src/materials.ts`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/apps/api/src/materials.ts) | `revalidateActor` (interno, L51), `listMaterials` (L125), `createMaterial` (L305), `updateMaterial` (L447), `archiveMaterial`, `restoreMaterial`, `getMaterialHistory`, `getClientTimeline` | Domínio da Fase 5: aplica `SELECT pg_advisory_xact_lock($1)` com `IDENTITY_LOCK` em todas as mutações, revalida ator in-tx, grava `material_event` e agrega linha do tempo (`demand_event` + `material_event`). |
| [`apps/api/src/identity.ts`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/apps/api/src/identity.ts) | `IDENTITY_LOCK = 712041` (L13), `serializeIdentity` (L19), `provisionUser` (L34), `publicIdentity` (L60), `authenticate`, `requirePermission`, `adminPermissions`, `changeIdentity`, `changeRolePermissions`, `recoverUserPassword` | Domínio das Fases 1 e 6: serialização de mutações de identidade via `IDENTITY_LOCK = 712041`, revogação imediata de `auth_session` e gravação em `identity_event`. |
| [`apps/api/src/clients.ts`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/apps/api/src/clients.ts) | `revalidateActor` (interno, L33), `listClients` (L79), `getClientById`, `createClient`, `updateClient`, `archiveClient`, `restoreClient` | Domínio das Fases 2 e 6 (Incremento 3): mutações protegidas por `SELECT pg_advisory_xact_lock($1)` (`IDENTITY_LOCK`) + `revalidateActor` dentro da transação antes de `FOR UPDATE`. |
| [`apps/api/src/app.ts`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/apps/api/src/app.ts) | `buildApp` (rotas `/api/v1/demands*`, `/api/v1/tasks*`, `/api/v1/dashboard`, `/api/v1/materials*`, `/api/v1/clients*`, `/api/v1/users*`, `/api/v1/roles*`, `/api/v1/audit/identity-events`) | Registro HTTP Fastify, autenticação pré-transação (`authenticate`), guarda inicial de permissão (`requirePermission`) e validação Zod. **Não há rotas `/api/v1/notifications*` atualmente.** |
| [`apps/api/src/schema.ts`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/apps/api/src/schema.ts) | Tabelas Drizzle: `user` (`auth_user`), `session` (`auth_session`), `role`, `permission`, `userRole`, `rolePermission`, `client`, `demand`, `task`, `taskRequirement`, `taskDependency`, `taskComment`, `demandEvent`, `material`, `materialEvent`, `identityEvent`, `identityEventSubject` | Espelho Drizzle das migrations `0000` a `0004`. **Não possui tabela de notificações ou recibos de leitura por usuário.** |

### 1.2 Contratos (`packages/contracts/src/index.ts`)
- **`permissionSchema` (L6–12):** Contém exatamente 17 permissões:
  - Identidade/Base: `'protected.read'`, `'users.read'`, `'users.create'`, `'users.deactivate'`, `'roles.manage'`
  - Clientes: `'clients.read'`, `'clients.write'`, `'clients.archive'`
  - Demandas/Tarefas: `'demands.read'`, `'demands.write'`, `'tasks.read'`, `'tasks.manage'`, `'tasks.execute'`, `'tasks.review'`
  - Materiais: `'materials.read'`, `'materials.write'`, `'materials.archive'`
- **`rolePermissionsSchema` (L33):** `.max(17)` hardcoded no array de permissões.
- **Schemas de Eventos Existentes:**
  - `demandEventSchema` (L221–231): `{ id, demandId, taskId, actorId, actorName, action, reason, metadata, createdAt }` (histórico operacional do chamado/tarefa, sem destinatário nominal nem estado `readAt`).
  - `materialHistoryEventSchema` (L608–614) e `clientTimelineEventSchema` (L660–671).
  - `identityEventSchema` (L718–761): auditoria administrativa estrita da Fase 6.

### 1.3 Migrations SQL (`db/migrations/`)
- [`0000_foundation.sql`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/db/migrations/0000_foundation.sql): `auth_user`, `auth_session`, `auth_account`, `auth_verification`, `role`, `permission`, `user_role`, `role_permission`.
- [`0001_clients.sql`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/db/migrations/0001_clients.sql): `client` + permissões `clients.read`, `clients.write`, `clients.archive`.
- [`0002_demands_tasks.sql`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/db/migrations/0002_demands_tasks.sql): `demand`, `task`, `task_requirement`, `task_dependency`, `task_comment`, `demand_event` + permissões `demands.read`, `demands.write`, `tasks.read`, `tasks.manage`, `tasks.execute`, `tasks.review`.
- [`0003_materials.sql`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/db/migrations/0003_materials.sql): `material`, `material_event` + permissões `materials.read`, `materials.write`, `materials.archive`.
- [`0004_identity_audit.sql`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/db/migrations/0004_identity_audit.sql): `identity_event`, `identity_event_subject`, `public.prune_identity_events()`.

---

## 2. Mapeamento dos Produtores Transacionais de Eventos (`apps/api/src/demands.ts`)

Todas as 16 mutações em [`apps/api/src/demands.ts`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/apps/api/src/demands.ts) executam `BEGIN ... COMMIT` e inserem registros em `demand_event`. Abaixo está o mapeamento exato de cada produtor transacional e sua correspondência com os 8 tipos de evento listados no roadmap da Fase 7 (*nova tarefa, desbloqueio, prazo próximo, atraso, comentário, revisão, aprovação, alterações importantes*):

| # | Função em `demands.ts` | Rota HTTP (`app.ts`) | Permissão Revalidada In-Tx | Locks Atuais na Transação | `demand_event.action` Gravado | Payload `reason` e `metadata` Atual | Tipo de Notificação Candidato (Fase 7) | Destinatário(s) Candidato(s) |
|---|---|---|---|---|---|---|---|---|
| 1 | `createDemand` (L380) | `POST /api/v1/demands` | `demands.write` (admin-only) | `client FOR SHARE` | `'demand_created'` | `reason: NULL`, `metadata: { priority, deliveryDate }` | *(Evento de chamado; sem colaborador atribuído ainda)* | Administradores ativos (se aplicável) |
| 2 | `updateDemand` (L455) | `PATCH /api/v1/demands/:id` | `demands.write` (admin-only) | `demand FOR UPDATE` | `'demand_updated'` | `reason: NULL`, `metadata: input` (`title`, `description`, `priority`, `deliveryDate`, `version`) | **Alterações importantes** (ex.: mudança de `priority` ou `deliveryDate` do chamado) | Colaboradores ativos com tarefas abertas atribuídas no chamado (`task.assigned_to_user_id`) |
| 3 | `completeDemand` (L524) | `POST /api/v1/demands/:id/complete` | `demands.write` (admin-only) | `demand FOR UPDATE` | `'demand_completed'` | `reason: NULL`, `metadata: {}` | **Alterações importantes** / Conclusão de chamado | Administradores ativos / criador do chamado |
| 4 | `createTask` (L615) | `POST /api/v1/tasks` | `tasks.manage` (admin-only) | `demand FOR UPDATE`, `auth_user FOR SHARE` | `'task_created'` | `reason: NULL`, `metadata: { assignedToUserId, priority, status }` (`status` já nasce `'ready'` ou `'blocked'`) | **Nova tarefa** (e se `status === 'ready'`, já nasce desbloqueada para aceite) | `input.assignedToUserId` (colaborador atribuído, desde que ativo e `!== actor.id` ou conforme regra) |
| 5 | `acceptTask` (L757) | `POST /api/v1/tasks/:id/accept` | `tasks.execute` + check `assigned_to_user_id === actor.id` | `demand FOR UPDATE`, `task FOR UPDATE` | `'task_accepted'` | `reason: NULL`, `metadata: {}` | *(Ação do próprio executor; informativo para gestão)* | Administradores ativos (opcional, a confirmar na matriz de destinatários) |
| 6 | `startTask` (L811) | `POST /api/v1/tasks/:id/start` | `tasks.execute` + check `assigned_to_user_id === actor.id` | `demand FOR UPDATE`, `task FOR UPDATE` | `'task_started'` | `reason: NULL`, `metadata: {}` | *(Início de produção pelo responsável)* | Administradores ativos (opcional) |
| 7 | `submitTaskReview` (L871) | `POST /api/v1/tasks/:id/submit-review` | `tasks.execute` + check `assigned_to_user_id === actor.id` | `demand FOR UPDATE`, `task FOR UPDATE` | `'task_review_submitted'` | `reason: NULL`, `metadata: { deliveryNotes, previewUrl }` | **Revisão** (submissão para revisão) | Administradores ativos com permissão `tasks.review` / `created_by_user_id` do chamado |
| 8 | `reviewTask` — ramo `changes_requested` (L959) | `POST /api/v1/tasks/:id/review` | `tasks.review` (admin-only) | `demand FOR UPDATE`, `task FOR UPDATE` | `'task_changes_requested'` | `reason: input.feedback`, `metadata: {}` | **Revisão / Alterações importantes** (ajustes solicitados na revisão) | `taskRow.assigned_to_user_id` (colaborador responsável pela tarefa) |
| 9 | `reviewTask` — ramo `complete` (L973) | `POST /api/v1/tasks/:id/review` | `tasks.review` (admin-only) | `demand FOR UPDATE`, `task FOR UPDATE` | `'task_completed'` | `reason: input.feedback`, `metadata: {}` | **Aprovação** (tarefa aprovada/concluída na revisão) | `taskRow.assigned_to_user_id` (colaborador responsável pela tarefa) |
| 10 | `reviewTask` — cascata de dependentes (L989–1013) | `POST /api/v1/tasks/:id/review` | `tasks.review` (admin-only) | `demand FOR UPDATE`, `depTask FOR UPDATE` | `'task_ready'` | `reason: NULL`, `metadata: {}` (quando tarefa dependente passa de `'blocked'` para `'ready'`) | **Desbloqueio** (tarefa dependente desbloqueada automaticamente após aprovação da predecessora) | `depTask.assigned_to_user_id` (colaborador responsável pela tarefa recém-desbloqueada!) |
| 11 | `requestTaskPause` (L1026) | `POST /api/v1/tasks/:id/request-pause` | `tasks.execute` + check `assigned_to_user_id === actor.id` | `demand FOR UPDATE`, `task FOR UPDATE` | `'task_pause_requested'` | `reason: input.reason`, `metadata: {}` | **Alterações importantes** (solicitação de pausa pelo colaborador) | Administradores ativos com permissão `tasks.manage` |
| 12 | `approveTaskPause` (L1078) | `POST /api/v1/tasks/:id/approve-pause` | `tasks.manage` (admin-only) | `demand FOR UPDATE`, `task FOR UPDATE` | `'task_pause_approved'` | `reason: input.reason`, `metadata: { oldDeliveryDate, newDeliveryDate, originalPauseReason }` | **Alterações importantes** (pausa aprovada + novo prazo `deliveryDate`) | `taskRow.assigned_to_user_id` (colaborador responsável pela tarefa) |
| 13 | `resumeTask` (L1145) | `POST /api/v1/tasks/:id/resume` | `tasks.manage` (admin-only) | `demand FOR UPDATE`, `task FOR UPDATE` | `'task_resumed'` | `reason: NULL`, `metadata: { pausedAt, resumedAt, pausedDurationSeconds }` | **Alterações importantes / Desbloqueio operacional** (retomada de tarefa pausada) | `taskRow.assigned_to_user_id` (colaborador responsável pela tarefa) |
| 14 | `reassignTask` (L1213) | `POST /api/v1/tasks/:id/reassign` | `tasks.manage` (admin-only) | `demand FOR UPDATE`, `task FOR UPDATE`, `auth_user FOR SHARE` | `'task_reassigned'` | `reason: input.reason`, `metadata: { previousAssignedToUserId, newAssignedToUserId }` | **Nova tarefa / Alterações importantes** (atribuição ao novo responsável e revogação de acesso do anterior) | `input.assignedToUserId` (novo responsável). **Importante:** o responsável anterior (`previousAssignedToUserId`) perde acesso aos detalhes da tarefa reatribuída. |
| 15 | `updateRequirement` (L1278) | `PATCH /api/v1/tasks/:id/requirements/:requirementId` | `tasks.manage` (admin-only) | `demand FOR UPDATE`, `task FOR UPDATE`, `task_requirement FOR UPDATE` | `'task_requirement_updated'` | `reason: NULL`, `metadata: { requirementId, satisfied, newStatus }` | **Desbloqueio** (quando `taskRow.status === 'blocked' && newStatus === 'ready'`) ou **Alterações importantes** (quando volta a `'blocked'`) | `taskRow.assigned_to_user_id` |
| 16 | `addDependency` (L1352) | `POST /api/v1/tasks/:id/dependencies` | `tasks.manage` (admin-only) | `demand FOR UPDATE`, `task FOR UPDATE` | `'task_dependency_added'` | `reason: NULL`, `metadata: { dependsOnTaskId, newStatus }` | **Alterações importantes** (quando `taskRow.status === 'ready' && newStatus === 'blocked'`) | `taskRow.assigned_to_user_id` |
| 17 | `removeDependency` (L1446) | `DELETE /api/v1/tasks/:id/dependencies/:dependencyId` | `tasks.manage` (admin-only) | `demand FOR UPDATE`, `task FOR UPDATE` | `'task_dependency_removed'` | `reason: NULL`, `metadata: { removedDependencyId, newStatus }` | **Desbloqueio** (quando `taskRow.status === 'blocked' && newStatus === 'ready'`) | `taskRow.assigned_to_user_id` |
| 18 | `createTaskComment` (L1540) | `POST /api/v1/tasks/:id/comments` | Colaborador: `tasks.execute` + `assigned_to_user_id === actor.id`; Admin: `tasks.manage` | `demand FOR UPDATE`, `task FOR UPDATE` | `'task_comment_created'` (+ insert em `task_comment`) | `reason: NULL`, `metadata: { commentId }` | **Comentário** | Se autor é Admin -> `taskRow.assigned_to_user_id`; se autor é Colaborador atribuído -> Administradores ativos (ou criador do chamado `demand.created_by_user_id`) |

### 2.1 Observação sobre Desbloqueio (`task_ready`) em `demands.ts`
Atualmente há **quatro caminhos transacionais** onde uma tarefa fica pronta (`status = 'ready'`):
1. `createTask` (L685–694): nasce `'blocked'` e, se `evaluateTaskReadiness` retornar `ready === true`, atualiza para `'ready'` na mesma transação, mas grava apenas `action = 'task_created'` com `metadata.status = 'ready'`.
2. `reviewTask` (L989–1012): ao concluir (`decision === 'complete'`) uma tarefa, percorre `task_dependency WHERE depends_on_task_id = $1`, faz `SELECT id, status FROM task WHERE id = $1 FOR UPDATE` (nota: `depTaskRes` seleciona apenas `id, status`, **não seleciona `assigned_to_user_id` nem `title`**) e, se `ready === true`, atualiza para `'ready'` e grava `demand_event` com `action = 'task_ready'`.
3. `updateRequirement` (L1316–1340): recalcula `evaluateTaskReadiness` e atualiza `task.status` para `'ready'` ou `'blocked'`, gravando apenas `action = 'task_requirement_updated'` com `metadata.newStatus` (não emite `'task_ready'` separado).
4. `removeDependency` (L1480–1504): recalcula `evaluateTaskReadiness` e atualiza `task.status` para `'ready'` ou `'blocked'`, gravando apenas `action = 'task_dependency_removed'` com `metadata.newStatus` (não emite `'task_ready'` separado).

Para notificações de **desbloqueio** consistentes na Fase 7, a transição `previousStatus === 'blocked' && newStatus === 'ready'` deve ser detectada de forma unificada nos caminhos (2), (3) e (4) — e em `reviewTask` (L995) a query de `depTaskRes` deve projetar também `assigned_to_user_id` e `title`.

---

## 3. Infraestrutura Existente de Prazos e Alertas Temporais (`apps/api/src/dashboard.ts`)

Os tipos de evento **prazo próximo** e **atraso** não são disparados por mutações explícitas de escrita em `demands.ts`; eles decorrem da passagem do tempo em relação a `task.delivery_date` e `demand.delivery_date`.

O módulo [`apps/api/src/dashboard.ts`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/apps/api/src/dashboard.ts) já implementa regras determinísticas de calendário que servem como referência arquitetural direta:
1. **Fuso Horário Oficial (`timeZone`):** `'America/Cuiaba'` (L184), convertendo `now` para `YYYY-MM-DD` via `new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Cuiaba' }).format(now)`.
2. **Injeção Determinística de Relógio para Testes:** `DashboardOptions { now?: Date }` (L18–20), permitindo testar viradas de dia, prazos próximos e vencimentos sem depender do relógio físico ou sleeps.
3. **Cálculo Existente no Dashboard (L185–187, L355–370):**
   - `today`: data local em `America/Cuiaba`.
   - `dueToday`: `t.task_delivery_date === today` (com `t.status != 'completed'` e `d.status != 'completed'`).
   - `upcoming` (próximos 3 dias): `t.task_delivery_date >= tomorrow && t.task_delivery_date <= addCalendarDays(today, 3)`.
   - `overdueTasks` (atraso operacional de tarefa no Dashboard, L356–362): exige `Boolean(t.started_at)` + `['in_production', 'in_review', 'changes_requested'].includes(t.task_status)` + `t.task_delivery_date < today`.
   - `overdueDemands` (L286–288): `d.status = 'open' AND d.delivery_date < today`.

---

## 4. Segurança, Autorização Transacional e Visibilidade após Reatribuição

Conforme diretriz explícita de [`docs/PHASE7-KICKOFF.md`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/docs/PHASE7-KICKOFF.md):
> *"Notificações devem respeitar autenticação, usuário ativo, papel/permissão revalidados na transação e escopo de tarefas atribuídas. Colaborador não pode receber nem consultar alertas de tarefas/chamados de terceiros; após reatribuição, uma notificação não pode conceder acesso permanente a detalhes de tarefa que não lhe pertencem mais."*

### 4.1 Revalidação e `IDENTITY_LOCK` (`712041`)
1. **Desalinhamento atual em `demands.ts`:**
   - Em [`apps/api/src/clients.ts`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/apps/api/src/clients.ts) e [`apps/api/src/materials.ts`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/apps/api/src/materials.ts), toda transação de escrita adquire `SELECT pg_advisory_xact_lock($1)` com `IDENTITY_LOCK = 712041` antes de revalidar o ator, serializando contra desativação de usuário (`changeIdentity`), troca de papel ou revogação de permissões (`changeRolePermissions`).
   - Em [`apps/api/src/demands.ts`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/apps/api/src/demands.ts), as funções de escrita chamam `revalidateActorInsideTransaction` **sem** adquirir `pg_advisory_xact_lock(IDENTITY_LOCK)`, e as funções de leitura (`listDemands`, `getDemandById`, `getDemandHistory`, `getTaskById`, `listTaskComments`) usam `identity.roles` da sessão pré-transação sem `BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`.
   - Adicionalmente, em `createTaskComment` (L1561–1563 de `demands.ts`), `isCollaborator` é calculado sobre `identity.roles` (pré-transação) antes de chamar `revalidateActorInsideTransaction`.
2. **Requisito para Fase 7:**
   - Toda consulta/listagem e mutação de leitura/ack de notificações (bem como a geração transacional de notificações) deve revalidar `auth_user.active = true`, papéis (`user_role`) e permissões (`role_permission`) **dentro da transação** (usando `REPEATABLE READ READ ONLY` para leituras, como em `dashboard.ts` e `materials.ts`, e `pg_advisory_xact_lock(IDENTITY_LOCK)` para mutações).

### 4.2 Proteção contra Vazamento de Escopo após Reatribuição (`reassignTask`)
Se uma notificação for persistida em banco para o Colaborador A quando a Tarefa T lhe foi atribuída (`task_created`), e posteriormente um Administrador reatribuir a Tarefa T para o Colaborador B (`reassignTask`, L1213 de `demands.ts`):
- Em `getTaskById` (L731), `getDemandById` (L440), `getDemandHistory` (L597) e `listTaskComments` (L1529), o Colaborador A já recebe `404 NOT_FOUND` ao tentar abrir a Tarefa T.
- **Se a tabela/endpoint de notificações retornasse os dados da Tarefa T apenas com base em `notification.recipient_user_id = A`**, o Colaborador A continuaria vendo título, status, motivo ou metadados da Tarefa T (ou notificações geradas antes da reatribuição), violando o isolamento de escopo.
- **Solução Arquitetural Obrigatória (Filtro Relacional Vivo no SELECT e no Ack):**
  - Toda query de leitura (`GET /api/v1/notifications`) ou marcação de leitura (`POST /api/v1/notifications/:id/read` / `read-all`) para usuário não-administrador (`!actor.isAdmin`) **DEVE fazer JOIN vivo com `task` / `demand`** no mesmo snapshot transacional:
    ```sql
    AND (
      n.task_id IS NULL
      OR EXISTS (
        SELECT 1 FROM task t
        WHERE t.id = n.task_id
          AND t.assigned_to_user_id = $recipientUserId
      )
    )
    AND (
      n.demand_id IS NULL
      OR EXISTS (
        SELECT 1 FROM task t2
        WHERE t2.demand_id = n.demand_id
          AND t2.assigned_to_user_id = $recipientUserId
      )
    )
    ```
  - Adicionalmente, dentro da transação de `reassignTask` (L1245 de `demands.ts`), notificações pendentes/ativas daquela `task_id` destinadas ao `previousAssignedToUserId` podem ser arquivadas/removidas ou revogadas na própria transação de reatribuição, **além** do filtro `EXISTS (SELECT 1 FROM task ...)` em tempo de leitura. Essa dupla barreira (revogação na escrita + filtro relacional vivo na leitura) garante que uma notificação jamais conceda acesso permanente a uma tarefa reatribuída.

### 4.3 Sanitização Estrita de Payload (Zero Segredos)
- Nenhuma notificação ou metadado pode armazenar ou expor hashes, tokens de sessão, `cookie`, `authorization`, URLs de banco, referências ao cofre externo Bitwarden, nem texto livre sensível fora do escopo autorizado.
- Campos expostos no contrato público de notificações devem restringir-se a identificadores UUID (`id`, `demandId`, `taskId`), tipo enumerado estrito (`kind` / `type`), título/resumo operacional sanitizado do recurso (ou projetado via JOIN da `task`/`demand` autorizada), timestamps ISO-8601 e estado de leitura (`readAt`).

---

## 5. Lacunas Identificadas (Schema, Permissões, Contratos e Regras de Negócio)

### 5.1 Lacunas Técnicas no Código e Schema Atuais
1. **Ausência de Persistência de Estado de Notificação por Destinatário:**
   - `demand_event` registra quem **executou** a ação (`actor_id`, `actor_name`), mas **não possui** `recipient_user_id`, `read_at` / `acknowledged_at`, nem chave de deduplicação para alertas temporais (`due_soon`, `overdue`).
2. **Ausência de Schemas e Contratos em `@orium/contracts`:**
   - Não existem schemas Zod para `notificationKindSchema`, `notificationItemSchema`, `listNotificationsQuerySchema`, `listNotificationsResponseSchema` ou `markNotificationReadResponseSchema`.
   - `permissionSchema` tem 17 permissões e `rolePermissionsSchema` limita `.max(17)`. Caso se opte por reutilizar `demands.read` + `tasks.read` (como faz `/api/v1/dashboard` em `app.ts` L438–440), não é necessário alterar `permissionSchema` nem `role_permission`, preservando 100% de compatibilidade com os testes e snapshots da Fase 6 (que validam as 17 permissões e 23 grants).
3. **Ausência de `pg_advisory_xact_lock(IDENTITY_LOCK)` nas Mutações de `demands.ts`:**
   - Diferentemente de `clients.ts` e `materials.ts`, `demands.ts` ainda não adquire `pg_advisory_xact_lock(IDENTITY_LOCK)` no início das transações de escrita e não corrigiu `isCollaborator` pré-transação em `createTaskComment` (L1561).
4. **Projeção incompleta em `reviewTask` (L994–996 de `demands.ts`):**
   - Ao desbloquear tarefas dependentes (`status: 'blocked' -> 'ready'`), a query `SELECT id, status FROM task WHERE id = $1 FOR UPDATE` não retorna `assigned_to_user_id`, necessário para emitir a notificação de **desbloqueio** para o responsável da tarefa dependente.

### 5.2 Regras de Negócio em Aberto (Alinhadas a `docs/PHASE7-KICKOFF.md`)
As 5 definições listadas pelo coordenador em `docs/PHASE7-KICKOFF.md` impactam diretamente a implementação e devem ser fixadas no contrato da Fase 7:
1. **Janela de "Prazo Próximo" (`due_soon`):**
   - *Recomendação técnica:* Reutilizar a convenção já consolidada na Fase 4 (`dashboard.ts` L185–187, L365–370): fuso `America/Cuiaba`, `dueToday` (`delivery_date === today`) e `upcoming` (`tomorrow` até `today + 3 dias` corridos, `upcomingDays = 3`), ou parametrizar a janela em dias corridos no mesmo fuso.
2. **Semântica de Leitura (`readAt` vs. não lida + contador):**
   - *Recomendação técnica:* Persistir `read_at timestamptz NULL` por `(notification_id, recipient_user_id)` (ou diretamente na linha de `notification` individual por destinatário), expondo `unreadCount` no response de listagem e endpoints `POST /api/v1/notifications/:id/read` e `POST /api/v1/notifications/read-all`.
3. **Matriz de Destinatários por Tipo de Evento:**
   - *Colaborador atribuído atual (`task.assigned_to_user_id`):* recebe `task_assigned` (nova tarefa ou reatribuição para si), `task_unblocked` (desbloqueio por dependência concluída, requisito satisfeito ou dependência removida), `task_changes_requested` (revisão com ajustes solicitados), `task_approved` (aprovação na revisão), `task_Comment` (quando comentado por administrador), `task_updated` (pausa aprovada, retomada, alteração de prazo/prioridade), `task_due_soon` e `task_overdue`.
   - *Administradores ativos (`role_id = 'administrator'` e `active = true`, exceto o próprio `actor_id` quando aplicável):* recebem `task_review_submitted` (submissão para revisão pelo colaborador), `task_pause_requested` (solicitação de pausa pelo colaborador), `task_comment` (quando comentado pelo colaborador), além de alertas de atraso/prazo próximo do escopo global (`demand_overdue`, `task_overdue`, `task_due_soon`).
4. **Comportamento de Alertas de Prazo/Atraso em Tarefas Pausadas, Bloqueadas ou Concluídas:**
   - *Recomendação técnica:* Em `dashboard.ts` (L255, L356), tarefas `'completed'` nunca geram alerta; para **atraso operacional (`overdue`)**, `dashboard.ts` considera apenas tarefas iniciadas e ativas (`in_production`, `in_review`, `changes_requested`) com `delivery_date < today`, enquanto tarefas `'paused'` ou `'blocked'` figuram em `awaitingAction` (e não em atraso de execução). Manter a mesma regra evita divergência entre os números do Dashboard (Fase 4) e os alertas operacionais (Fase 7).
5. **Deduplicação e Fechamento Automático de Alertas Temporais (`due_soon` / `overdue`):**
   - *Recomendação técnica:* Para alertas temporais materializados ou híbridos, usar chave única determinística `(recipient_user_id, kind, COALESCE(task_id, demand_id), reference_date)` com `ON CONFLICT DO NOTHING`, e filtrar/ocultar automaticamente alertas temporais quando a tarefa/demanda for concluída (`status = 'completed'`) ou tiver seu `delivery_date` prorrogado para fora da janela (ex.: via `approveTaskPause` ou `updateDemand`).

---

## 6. Proposta de Integração Transacional

### 6.1 Modelo Híbrido / Transacional Recomendado (`0005_notifications.sql`)
1. **Permissões:**
   - Reutilizar `demands.read` + `tasks.read` (mesmo par exigido por `GET /api/v1/dashboard`), evitando alterar a enum `permissionSchema` (17 itens) e a tabela `role_permission` (23 grants da Fase 6).
2. **Tabela `operational_notification` (ou `notification`):**
   - `id uuid PRIMARY KEY`
   - `recipient_user_id text NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE`
   - `actor_id text REFERENCES auth_user(id) ON DELETE SET NULL`
   - `demand_id uuid NOT NULL REFERENCES demand(id) ON DELETE CASCADE`
   - `task_id uuid REFERENCES task(id) ON DELETE CASCADE`
   - `source_event_id uuid REFERENCES demand_event(id) ON DELETE CASCADE`
   - `kind text NOT NULL` — `CHECK (kind IN ('task_assigned', 'task_unblocked', 'task_due_soon', 'task_overdue', 'demand_overdue', 'task_comment', 'task_review_submitted', 'task_changes_requested', 'task_approved', 'task_important_change'))`
   - `dedupe_key text UNIQUE` — chave determinística para idempotência de alertas temporais e eventos transacionais
   - `read_at timestamptz`
   - `created_at timestamptz NOT NULL DEFAULT now()`
   - Índices: `(recipient_user_id, read_at, created_at DESC, id DESC)`, `(task_id)`, `(demand_id)`.
3. **Emissão Transacional (Eventos de Mutação em `demands.ts`):**
   - Dentro da **mesma transação PostgreSQL** (`dbClient`) que já grava `demand_event`, um helper `recordOperationalNotifications(dbClient, ...)` resolve os destinatários ativos elegíveis (`SELECT u.id FROM auth_user u ... WHERE u.active = true`) e insere as notificações correspondentes.
   - Se a transação principal sofrer `ROLLBACK` (por conflito de versão `409`, falha de requisito ou permissão `403`), **nenhuma notificação órfã é gravada**.
   - Em `reassignTask`, a mesma transação remove/revoga notificações não aplicáveis do `previousAssignedToUserId` para aquela `task_id` e cria a notificação `'task_assigned'` para o `newAssignedToUserId`.
4. **Avaliação Determinística de Prazos (`due_soon` / `overdue`) e Leitura Segura:**
   - Na consulta de notificações/alertas (`listNotifications(database, identity, query, options?: { now?: Date })`), a transação abre, adquire `pg_advisory_xact_lock(IDENTITY_LOCK)` (se materializar alertas temporais idempotentes via `INSERT ... ON CONFLICT (dedupe_key) DO NOTHING`) ou executa em snapshot consistente revalidando o ator (`auth_user.active`, `roles`, `permissions`), sincroniza alertas de prazo próximo/atraso para o escopo autorizado usando `now` no fuso `America/Cuiaba`, e retorna apenas itens cujo `task_id`/`demand_id` ainda pertença ao escopo atual do usuário (`t.assigned_to_user_id = actor.id` para colaboradores) e cujo alerta temporal ainda seja válido.

---

## 7. Plano de Testes Reais em PostgreSQL (`orium_test`)

Quando a implementação da Fase 7 for autorizada, a suíte `tests/notifications.integration.test.ts` deve validar em banco real (`orium_test` na porta `5433`, sem mocks):

1. **Geração Transacional por Evento (`C1`):**
   - Criar tarefa (`task_assigned`), desbloquear tarefa via conclusão de dependência em `reviewTask` e via `updateRequirement`/`removeDependency` (`task_unblocked`), comentar (`task_comment`), submeter revisão (`task_review_submitted`), pedir ajustes (`task_changes_requested`), aprovar (`task_approved`) e alterar pausa/prazo (`task_important_change`).
   - Confirmar que rollback de mutação (ex.: `409 VERSION_CONFLICT`) não persiste notificação.
2. **Alertas Temporais Determinísticos (`C2`):**
   - Usar injeção de relógio (`options.now` em `America/Cuiaba`, padrão `tests/dashboard.integration.test.ts`) para comprovar geração e idempotência (sem duplicatas em múltiplas leituras) de `task_due_soon`, `task_overdue` e `demand_overdue`, além do desaparecimento/fechamento do alerta quando a tarefa é concluída ou tem prazo prorrogado.
3. **Isolamento de Escopo e Revogação por Reatribuição (`C3`):**
   - Colaborador A recebe tarefa e notificação -> Admin executa `reassignTask` para Colaborador B -> Colaborador A consulta `GET /api/v1/notifications` e tenta `POST /api/v1/notifications/:id/read` na notificação antiga -> recebe `404` / lista vazia para a tarefa reatribuída; Colaborador B vê a notificação de atribuição da tarefa.
4. **Concorrência Real com Barreiras `pg_locks` (`C4`):**
   - Teste determinístico segurando `IDENTITY_LOCK` (`712041`) ou lock de linha em conexão separada (com filtro `l.database = (SELECT oid FROM pg_database WHERE datname = current_database())`) enquanto uma mutação concorrente de desativação de usuário (`users.deactivate`), revogação de permissão (`roles.manage`) ou `reassignTask` ocorre, comprovando que usuário desativado (`401`), sem permissão (`403`) ou desatribuído (`404`) não lê nem confirma notificações fora de escopo.
5. **Higiene e Preservação de Baseline (`C5`):**
   - Snapshot de `role_permission` e `identity_event` antes/depois, e limpeza cirúrgica apenas dos IDs criados pela suíte.
