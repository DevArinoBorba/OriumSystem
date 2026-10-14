# Fase 7 — Inventário READONLY da Interface e Contratos Consumidos (Notificações)

**Data:** 13/10/2026 · **Autor:** OpenCode (inventário da interface e contratos consumidos) · **Escopo:** `docs/PHASE7-KICKOFF.md` / preparação da Fase 7.
**Ownership exclusivo:** `docs/PHASE7-UI-INVENTORY.md` (este documento) e a seção própria em `oriumsystem-acompanhamento`.
**Base de leitura:** `apps/web/src/**`, `packages/contracts/src/index.ts`, rotas em `apps/api/src/app.ts` (somente leitura, para cruzar contratos).
**Restrições respeitadas:** nenhum código/contrato/schema/serviço/teste alterado; sem builds, migrations ou restart de DEV. Nada deste documento autoriza implementação.

---

## 1. Objetivo do inventário

Mapear, para a central de notificações em preparação, os pontos reais de integração na camada web:
1. **Shell** — onde um novo painel/central seria injetado e como o cabeçalho é montado.
2. **Navegação** — padrões de troca de aba e deep-linking entre visões existentes.
3. **Queries** — as funções de API disponíveis e como o frontend consome (request/parse/401).
4. **Contratos consumidos** — schemas/types já publicados que podem ser reaproveitados ou estendidos.
5. **Padrões de UI** — estados (loading/erro/vazio), retry, version conflict, per-gravação, permissão por aba, timestamps em Cuiabá.
6. **Testes** — infraestrutura de testes do web e suítes existentes que tocam os mesmos contratos.

---

## 2. Shell da aplicação (estrutura e injeção)

### 2.1. `apps/web/src/main.tsx`
- Entry point: `createRoot(...).render(<React.StrictMode><App /></React.StrictMode>)`.
- Importa `./styles.css` (design tokens globais, seção 7).

### 2.2. `apps/web/src/App.tsx` (shell principal) — `App`
- **Estados de view:** `type ViewState = 'checking' | 'signed-out' | 'signed-in'` (linha 13).
- **Estado central:** `session: SessionResponse | null` (usuário, roles, permissions) — o dado que hoje governa todas as abas e permissões de UI.
- **Aba ativa:** `activeTab: ActiveTab` (linha 23), tipado em `types.ts` (seção 4).
- **Alvos de navegação cruzada:** `demandNavTarget` e `materialNavTarget` (linhas 24-25) — deep-linking entre Painel → Demandas/Tarefas e Demands/Clientes → Materiais. Padrão que uma notificação com link-usável deveria replicar.
- **Behaviors globais:**
  - `handleUnauthorized` (linha 30): limpa sessão e ambos os nav targets → `signed-out`. É o callback `onUnauthorized` passado a todas as views.
  - `handleOpenItem`, `handleOpenMaterials`, `clearDemandNav`, `clearMaterialNav` (linhas 37-49).
  - `initialTabFor(permissions)` (linhas 51-60): ordem de aba inicial por permissões (`demands.read+tasks.read` → `dashboard`; senão cliente → demandas → materiais → equipe; fallback `dashboard`).
  - `getMe` → `sessionResponseSchema.parse` na montagem (linhas 62-89), com `AbortController`.
  - `handleSignOut` (linhas 91-117) com estados `busySignOut`/`signOutError`.
- **Renderização por permissão:** gates `hasXxxRead = session.permissions.includes(...)` (linhas 140-144) e renderização condicional de cada visão (linhas 171-209). Fallback "Área protegida" quando o usuário não tem nenhuma permissão (linhas 212-219).

### 2.3. `apps/web/src/components/Header.tsx` — `Header`
- Props: `session`, `activeTab`, `onSelectTab`, `onSignOut`, `busy`.
- **Navegação principal** (`<nav className="header-nav">`): botões por permissão —
  - `Painel` (dashboard): `demands.read && tasks.read`
  - `Clientes`: `clients.read`
  - `Demandas`/`Minhas demandas`: `demands.read` (título varia por `isAdmin`)
  - `Materiais`: `materials.read`
  - `Equipe`: `users.read`
- **Área do usuário** (`header-user`): nome, e-mail, badge de papel (`admin`/`collab`), botão Sair.
- **Ponto de insertion da central de notificações:** o bloco `header-user` (ao lado do `.user-info` ou do signout) é o primeiro candidato para um sino/contador; o nav é o candidato para nova aba. **Nenhum componente de sino/contador/unread existe hoje** (verificado por grep: sem `notification*` no web).

---

## 3. Navegação e padrões de transição entre visões

### 3.1. Troca de aba
- `App` guarda `activeTab`; `Header` chama `onSelectTab`. Views condicionais renderizadas no `<main className="main-content">`.
- `ActiveTab = 'dashboard' | 'clients' | 'team' | 'demands' | 'materials'` (`types.ts` linha 32). Uma aba `notifications` precisaria ser adicionada à união e a `initialTabFor` atualizado.

### 3.2. Deep-linking (padrão reutilizável por notificações)
- **Demands:** `DemandNavigationTarget { demandId; taskId? }` (App linhas 15-18). `DashboardView.onOpenItem({ demandId, taskId? })` → `App.handleOpenItem` define target e `activeTab='demands'`; `DemandsView` recebe `initialDemandId`/`initialTaskId` + `onNavigationConsumed`. Guarda de geração evita reabrir navegação já consumida.
- **Materials:** `MaterialNavigationTarget { clientId?; demandId?; taskId? }` (`types.ts` linhas 127-131); `ClientsView.onOpenMaterials({ clientId })`, `DemandsView.onOpenMaterials({ clientId?, demandId?, taskId? })` → `App.handleOpenMaterials`. `MaterialsView` recebe `initialTarget` + `onTargetConsumed`.
- **Aplicação para notificações:** uma central acessível por target (`demandId`/`taskId`/`clientId`) deve reutilizar os mesmos callbacks de navegação (`onOpenItem`/`onOpenMaterials`) para que o clique numa notificação leve ao item real — e o destino reautentica/revalida autorização no backend (sem conceder acesso permanente).

---

## 4. Tipos de UI (`apps/web/src/types.ts`)

Reexporta os tipos de domínio de `@orium/contracts` (sem espelho local) e define estados de UI:
- `ActiveTab`, `DashboardScope`, `DashboardSectionKey`.
- `UserListItem` (id/nome/email/active/role) — usado em TeamView e forms.
- Filtros de lista: `ClientsFilterStatus`, `DemandsStatusFilter`, `DemandPriorityFilter`, `MaterialsFilterCategory`, `MaterialsFilterStatus`.
- Form states (draft): `ClientFormState`, `DemandFormState`, `TaskFormState`, `MaterialFormState` — padrão de rascunho para version conflict.
- Conflito otimista: `VersionConflictState`, `MaterialVersionConflictState`.
- Modal de confirmação: `ConfirmationModalState` (archive-client/deactivate-user).
- `TaskReviewState`.
- Navegação: `MaterialNavigationTarget`.

**Observação:** não há nenhum tipo de _notification_ em `types.ts`; uma central adicionará um novo bloco de tipos (item de notificação, filtro, estado de leitura) aqui.

---

## 5. Camada de API do web (`apps/web/src/api.ts`)

### 5.1. Núcleo
- `ApiError` (linha 59): `status` + `code` + mensagem. `request()` (linha 109) trata `401` → `onUnauthorized()` e lança `ApiError(401, 'UNAUTHENTICATED')`; respostas não-ok viram `ApiError(status, codeDoBody.error.code)`; parser de schema → `ApiError(500, 'INVALID_RESPONSE')`.
- `signIn` (linha 166) mapeia 429 → `RATE_LIMITED`, demais → `INVALID_CREDENTIALS`; usa `sessionResponseSchema.parse`.
- `signOut` (linha 188).
- `parseUserListItem`, `parseUsersListResponse`, `parseSuccessResponse` (linhas 70-107).
- Todos os métodos seguem: `(params, signal, onUnauthorized)` → `request(url, {method, body, signal}, onUnauthorized, parser)`.

### 5.2. Inventário completo de métodos (símbolos reais + endpoints)
| Método | Endpoint | Parser |
|---|---|---|
| `getMe` | GET `/api/v1/me` | `sessionResponseSchema` |
| `listClients` | GET `/api/v1/clients` | `clientListResponseSchema` |
| `getClient` | GET `/api/v1/clients/:id` | `clientResponseSchema` |
| `createClient` | POST `/api/v1/clients` | `clientResponseSchema` |
| `updateClient` | PATCH `/api/v1/clients/:id` | `clientResponseSchema` |
| `archiveClient` | POST `/api/v1/clients/:id/archive` | `clientResponseSchema` |
| `restoreClient` | POST `/api/v1/clients/:id/restore` | `clientResponseSchema` |
| `listUsers` | GET `/api/v1/users` | `parseUsersListResponse` |
| `createUser` | POST `/api/v1/users` | `publicUserSchema` |
| `deactivateUser` | PATCH `/api/v1/users/:id` | `parseSuccessResponse` |
| `changeUserRole` | PUT `/api/v1/users/:id/role` | `parseSuccessResponse` |
| `listDemands` | GET `/api/v1/demands` | `demandListResponseSchema` |
| `createDemand` | POST `/api/v1/demands` | `demandResponseSchema` |
| `getDemand` | GET `/api/v1/demands/:id` | `demandDetailResponseSchema` |
| `updateDemand` | PATCH `/api/v1/demands/:id` | `demandResponseSchema` |
| `completeDemand` | POST `/api/v1/demands/:id/complete` | `demandResponseSchema` |
| `getDemandHistory` | GET `/api/v1/demands/:id/history` | `demandHistoryResponseSchema` |
| `createTask` | POST `/api/v1/tasks` | `taskResponseSchema` |
| `getTask` | GET `/api/v1/tasks/:id` | `taskDetailResponseSchema` |
| `acceptTask` | POST `/api/v1/tasks/:id/accept` | `taskResponseSchema` |
| `startTask` | POST `/api/v1/tasks/:id/start` | `taskResponseSchema` |
| `submitTaskReview` | POST `/api/v1/tasks/:id/submit-review` | `taskResponseSchema` |
| `reviewTask` | POST `/api/v1/tasks/:id/review` | `taskResponseSchema` |
| `requestTaskPause` | POST `/api/v1/tasks/:id/request-pause` | `taskResponseSchema` |
| `approveTaskPause` | POST `/api/v1/tasks/:id/approve-pause` | `taskResponseSchema` |
| `resumeTask` | POST `/api/v1/tasks/:id/resume` | `taskResponseSchema` |
| `reassignTask` | POST `/api/v1/tasks/:id/reassign` | `taskResponseSchema` |
| `updateTaskRequirement` | PATCH `/api/v1/tasks/:id/requirements/:requirementId` | `taskResponseSchema` |
| `addTaskDependency` | POST `/api/v1/tasks/:id/dependencies` | `taskResponseSchema` |
| `removeTaskDependency` | DELETE `/api/v1/tasks/:id/dependencies/:dependencyId` | `taskResponseSchema` |
| `getTaskComments` | GET `/api/v1/tasks/:id/comments` | `taskCommentsResponseSchema` |
| `addTaskComment` | POST `/api/v1/tasks/:id/comments` | `taskCommentsResponseSchema` |
| `getDashboard` | GET `/api/v1/dashboard?limit=` | `dashboardResponseSchema` |
| `getMaterials` | GET `/api/v1/materials` | `listMaterialsResponseSchema` |
| `getMaterial` | GET `/api/v1/materials/:id` | `materialSchema` |
| `createMaterial` | POST `/api/v1/materials` | `materialSchema` |
| `updateMaterial` | PATCH `/api/v1/materials/:id` | `materialSchema` |
| `archiveMaterial` | POST `/api/v1/materials/:id/archive` | `materialSchema` |
| `restoreMaterial` | POST `/api/v1/materials/:id/restore` | `materialSchema` |
| `getMaterialHistory` | GET `/api/v1/materials/:id/history` | `materialHistoryResponseSchema` |
| `getMaterialTargets` | GET `/api/v1/materials/targets` | `listMaterialTargetsResponseSchema` |
| `getClientTimeline` | GET `/api/v1/materials/client-timeline/:clientId` | `clientTimelineResponseSchema` |

**Observações para a central de notificações:**
- O web **não consome ainda** `GET /api/v1/identity-events`, embora a rota exista no backend (`app.ts` linha 178, `listIdentityEvents`). É o único endpoint read-only do backend sem cliente web.
- Não há método de notificações na camada `api.ts`. A central adicionaria: lista/filtro/contagem, marcar leitura (batch?), e possivelmente cursor de paginação seguindo o padrão de `identity-events` (nextCursor) ou a paginação page/pageSize das listas.
- O padrão de polling/streaming **não existe**: grep por `setInterval|EventSource|WebSocket|requestAnimationFrame|visibilitychange` no web retornou apenas `focus()` focais em forms e `setTimeout(...focus())`. Portanto toda atualização é por request no mount + refresh manual (`DashboardView` tem botão "Atualizar"; demais views recarregam por efeito/trigger). **Lacuna a reportar:** não há mecanismo de atualização periódica/realtime; a central (ou o contador de não-lidos) precisará definir polling, refetch-on-focus ou push, com enquadramento no contrato.

---

## 6. Contratos consumidos (`packages/contracts/src/index.ts`)

Lista coerente dos grupos usados pela UI (todos já tipados publicamente):
- **Identidade/RBAC:** `roleSchema`, `permissionSchema` (17 permissões), `sessionResponseSchema` (user + roles + permissions), `loginSchema`, `createUserSchema`, `publicUserSchema`, `changeRoleSchema`, `rolePermissionsSchema`.
- **Clientes:** `clientSchema`, `createClientSchema`, `updateClientSchema`, `clientVersionSchema`, `listClientsQuerySchema`, `clientResponseSchema`, `clientListResponseSchema`.
- **Demandas/Tarefas:** `demandSchema` (+ `clientSchema` projetado), `taskSchema`, `requirementSchema`, `taskCommentSchema`, `demandEventSchema` (histórico), `createDemandSchema`, `updateDemandSchema`, `completeDemandSchema`, `createTaskSchema`, `taskVersionSchema`, `reassignTaskSchema`, `updateRequirementSchema`, `addDependencySchema`, `removeDependencySchema`, `submitTaskReviewSchema`, `reviewTaskSchema`, `requestTaskPauseSchema`, `approveTaskPauseSchema`, `listDemandsQuerySchema`, response schemas.
- **Dashboard:** `dashboardQuerySchema`, `dashboardItemKindSchema`, `dashboardItemClientSchema`, `dashboardItemUserSchema`, `dashboardTaskItemSchema`, `dashboardDemandItemSchema`, `dashboardItemSchema` (discriminated union), `dashboardSectionSchema`, `dashboardWorkloadUserSchema`, `dashboardResponseSchema`.
- **Materiais/Timeline:** `materialCategorySchema`, `materialSchema`, `listMaterialsQuerySchema`, `listMaterialsResponseSchema`, `createMaterialSchema`, `updateMaterialSchema`, `materialVersionInputSchema`, `materialHistoryEventSchema`, `materialHistoryQuerySchema`, `materialHistoryResponseSchema`, `listMaterialTargetsQuerySchema`, `materialTargetSchema`, `listMaterialTargetsResponseSchema`, `timelineEventSourceSchema`, `clientTimelineEventSchema`, `clientTimelineQuerySchema`, `clientTimelineClientSchema`, `clientTimelineResponseSchema`.
- **Auditoria de identidade (Fase 6):** `identityEventActionSchema`, `identityEventSchema` (discriminated union), `identityEventsQuerySchema`, `identityEventsResponseSchema`. **Publicado no contrato mas sem consumidor web hoje.**

**Notas para o contrato Fase 7:**
- `permissionSchema` é um `z.enum` fechado — uma permissão `notifications.read` (ou similar) exigiria extensão do enum, de `adminPermissions` (identity.ts) e do `max(17)` de `rolePermissionsSchema` (linha 33). **Fora do escopo deste inventário decidir; é decisão de arquitetura do Codex #2.**
- Não há schema de `notification`/`notificationDelivery` no contrato (ARCHITECTURE_PROPOSAL.md linhas 158-159 cita as tabelas de Fase 7 como futuras). Tudo de notificação seria novo no contrato.
- Os eventos de `demand_event`/`material_event`/`identity_event` já levam `action` em formato snake_case estável; a UI já centraliza rótulos PT-BR em `MaterialsView` (`TIMELINE_ACTION_LABELS`, seção 7.7) como padrão a reutilizar para rótulos de notificações.

---

## 7. Padrões de UI por visão (referência para a central)

### 7.1. `DashboardView.tsx` — agregação por seções (padrão "central")
- Consome `getDashboard` com `limit` fixo (`DAY_LIMIT=20`); estados `data | null`, `loading`, `error`, `refreshing`, `updatedAt`.
- **AbortController + guarda de identidade** (linhas 123-166): aborta request anterior, descarta resposta de controller obsoleto; erro 403 limpa dados e mostra mensagem própria; com dados anteriores mantém `updatedAt` ("Dados da última atualização").
- **Seções:** `topSections` (production, awaitingAction) e `pendingSections` (overdueTasks, overdueDemands, dueToday, upcoming, urgent) com meta (título/descrição/headline). Renderiza "exibindo N de TOTAL" e total de itens.
- **Estados vazios:** `empty-state` com "Nada por aqui no momento." + descrição.
- **Skeleton:** `dashboard-skeleton` com `role="status"` e `sr-only`.
- **Carga da equipe:** tabela `workload-table`, só admin + `users.read` + `workloadAvailable`.
- **Navegação:** `handleOpen` → `onOpenItem({demandId, taskId?})` ou `{demandId}`.
- **Este é o padrão-cliente mais próximo de uma "central":** lista agregada de itens com seções, contagem, estado vazio, retry e data de atualização. A central de notificações pode espelhar a estrutura de `DashboardView` (seções por tipo/urgência, contador de não-lidos, empty state, formatação de data/hora em Cuiabá).

### 7.2. `DemandsView.tsx` — lista + detalhe + histórico + forms
- Lista com `q/status/priority`, paginação (`pageSize=10`), busca aplicada vs digitada.
- Detalhe por demanda/tarefa (reusa `TaskDetailView`), histórico (diálogo), criação/edição com **version conflict 409 → rascunho preservado** (padrão em todo o app).
- Dados de apoio: `listClients` e `listUsers` para admin (carga diferenciada por permissão).
- Refs de request por contexto (`listRequestRef`/`detailRequestRef`) para evitar aborts cruzados — padrão de single-flight.
- **Reuso em notificações:** deep-link `initialDemandId`/`initialTaskId` + `onNavigationConsumed`.

### 7.3. `ClientsView.tsx` — CRUD + filtro de status + modal de confirmação
- Filtros `active/archived/all`, paginação, formulário com rascunho, `ConfirmationModalState` (archive), version conflict, `onOpenMaterials({clientId})`.

### 7.4. `TeamView.tsx` — lista de usuários + permissões
- `listUsers`/`createUser`/`deactivateUser`/`changeUserRole`; formulários focais (`nameInputRef` etc.).

### 7.5. `LoginView.tsx` — autenticação
- Sign-in com destaque de erros (`RATE_LIMITED`/`INVALID_CREDENTIALS`), sessão via cookie.

### 7.6. `TaskDetailView.tsx` — ação por papel/estado
- Botões condicionais por `task.status` e permissão (`tasks.execute`/`tasks.manage`/`tasks.review`); proibição de personificação; feedback/URL de preview; dependências; aprovação de pausa com nova data.

### 7.7. `MaterialsView.tsx` — lista + timeline/histórico (padrão de "feed")
- `TIMELINE_ACTION_LABELS` (linhas 35-66) e `TIMELINE_SOURCE_LABELS` (68-72): tradução estável de `demand_*`/`task_*`/`material_*`/fallbacks para PT-BR. **Reuso direto para rótulos de notificações.**
- Timeline do cliente (`getClientTimeline`, paginação 10, `canViewTimeline = materials.read && demands.read`), painel condicional com título/badge de cliente/contador, retry, 403/404 com mensagens próprias, concorrência focal A→B→A com verificação de controller.
- Histórico de material (`getMaterialHistory`) com diff em diálogo nativo.

### 7.8. Design tokens (`apps/web/src/styles.css`)
- `:root` com `--color-*` (primary/danger/success/border/focus), `--shadow-*`, `--font-family` (linhas 1-27).
- Classes reutilizáveis: `.alert-banner` (`success`/`error`), `.empty-state`, `.sr-only`, `.skeleton-*`, `.view-panel`, `.panel-header`, `.dialog`/`native-dialog`, `.modal-*`, `.status-badge`, `.priority-badge`, `.muted-text`, `.primary-button`/`.secondary-button`, `@media` (640px header/nav, mobile forms). A central herdaria estes tokens/classes.

---

## 8. Testes e infraestrutura

- **Configução:** `vitest.config.ts` — `include: ['tests/**/*.test.ts']`, `exclude: ['tests/e2e/**']`, `fileParallelism: false`, `testTimeout: 15000`, `hookTimeout: 30000`.
- **Suítes existentes (somente API/integração real em `orium_test`):** `auth`, `recovery`, `rbac`, `clients`, `clients-authorization`, `demands`, `dashboard`, `materials`, `identity-audit`, `config`, `security-http` (inventário completo em `tests/*.test.ts`).
- **Não há suíte de testes frontend/web** (nenhum `*.test.*` dentro de `apps/web`); a validação visual/E2E é feita por runners de browser (`.local/phase*-qa-runner.mjs`) com o portal Maestri, cobertos historicamente nas Fases 3-5.
- **`apps/web/package.json`:** scripts `dev` (vite 5173 strictPort), `build` (tsc + vite build), `typecheck`; dependências React 19 + zod via `@orium/contracts`.
- **Implicação para Fase 7:** a central será validada por typecheck/build do web + runner de browser sob portal; o backend de notificações seguirá o padrão das suítes de integração reais (sem mocks/skips, portas `orium_test` 5433 sob `PORT_POLICY`/`Find-FreePort`).

---

## 9. Lacunas e riscos de integração (para o contrato)

1. **Sem consumer web de `identity-events`:** rota existe no backend, contrato publicado, mas `api.ts`/UI não consomem. Relevante como precedente de "evento → notificação" e de paginação por cursor.
2. **Sem camada de notificação no web:** sem métodos `api.*`, sem tipos, sem aba, sem badge/contador, sem lista/central. Tudo novo nesta frente.
3. **Sem realtime/polling:** nenhuma atualização periódica, SSE, WebSocket ou refetch-on-focus no código atual; a central precisa decidir o mecanismo (ou reutilizar refresh manual do DashboardView) antes de definir a experiência.
4. **Permissão fechada:** `permissions` é enum fechado e gate por aba usa `session.permissions`; uma eventual permissão de notificação muda contrato + `permissionSchema` + `adminPermissions` + `rolePermissionsSchema.max(17)` + seeds — decisão de arquitetura fora do inventário.
5. **Rótulos de ação duplicáveis:** `TIMELINE_ACTION_LABELS` cobre `demand_*`/`task_*`/`material_*`; notificações devem reutilizar/estender essa tabela de rótulos em PT-BR, evitando segunda fonte de tradução divergente.
6. **Navegação profunda reutilizável, mas com revalidação no destino:** o deep-link da central deve usar `onOpenItem`/`onOpenMaterials`; o backend é quem revalida autorização/reatribuição no destino (requisito de segurança registrado na coordenação — `docs/PHASE7-SECURITY-CHECKLIST.md` item 2 e 5).
7. **Formatos de data:** todo timestamp é formatado em `America/Cuiaba` (DashboardView `formatDateTime`, MaterialsView `formatCuiabaDateTime`); a central deve manter o mesmo timezone para consistência.

---

## 10. Conclusão (resumo curto para enumeração)

- **Shell/navegação mapeados:** `App.tsx` (view states, activeTab, nav targets, perm gates), `Header.tsx` (5 abas por permissão, área do usuário como ponto de insertion).
- **Queries:** inventário completo de 40+ métodos em `apps/web/src/api.ts` com endpoints/parsers; nenhum consumer de `identity-events`; nenhum método/rota de notificações no web.
- **Contratos:** todos os schemas consumidos listados; nada de notificação existe; permissão fechada é fator limitante.
- **Padrões de UI:** seções agregadas (DashboardView), deep-linking (Demands/Materials), rascunho-409, single-flight, retry, empty states, tokens CSS, timezone Cuiabá, rótulos PT-BR centralizados em `TIMELINE_ACTION_LABELS`.
- **Testes:** sem suítes web; integração real em `orium_test`; validação visual via portal (runners `.local`), herdando o padrão das fases anteriores.
- **Arquivos exclusivos deste inventário:** `docs/PHASE7-UI-INVENTORY.md`. Nenhum outro arquivo alterado; DEV e pendências (Bitwarden/Fase 4) preservados.

Documento de apoio: `docs/PHASE7-KICKOFF.md`, `docs/PHASE7-COORDINATION-REVIEW.md`, `docs/PHASE7-SECURITY-CHECKLIST.md`, `ARCHITECTURE_PROPOSAL.md` (reference tables de notificação, linhas 158-159).
