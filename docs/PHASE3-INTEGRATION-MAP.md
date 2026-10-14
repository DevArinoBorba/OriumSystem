# Mapa de Integração — Fase 3 (Demandas e Tarefas)

- **Data:** 2026-10-06
- **Status:** **[~] AUDITORIA SOMENTE-LEITURA** — nenhuma alteração de código, testes, SQL, env, lock; nenhum serviço iniciado.
- **Finalidade:** Mapear os caminhos reais por onde a Fase 3 (demandas/tarefas/atribuição e visibilidade restrita de colaboradores) deverá ser ligada ao código já existente, e identificar os riscos de autorização que precisam ser tratados antes da implementação.
- **Fontes verificadas nesta auditoria:** contratos, backend, migrações e web do monorepo; complementadas por `docs/PHASE3-SPEC-DRAFT.md`, `docs/PHASE3-OPEN-DECISIONS.md` e `docs/adr/0008-matriz-colaboradores-designers-fase3.md` (propostas/pendências, ainda não implementadas).

---

## 1. Contratos Zod — `packages/contracts/src/index.ts`

Caminho único de contratos: **`packages/contracts/src/index.ts`** (fonte de verdade de tipos/schemas compartilhados API+Web).

| Símbolo | Linha(s) | O que é | Relevância Fase 3 |
|---|---|---|---|
| `permissionSchema` | 5–8 | Enum das 8 permissões: `protected.read`, `users.read`, `users.create`, `users.deactivate`, `roles.manage`, `clients.read`, `clients.write`, `clients.archive` | **Adicionar** permissões de Fase 3 (ex.: `demands.read/create/update/delete`, `tasks.*`, `clients.read_assigned`) ao enum; `rolePermissionsSchema` (linha 28) limita `.max(8)` e precisará aumentar o teto. |
| `roleSchema` | 3–4 | `administrator` / `collaborator` | Papéis reaproveitados; visibilidade vinculada **não** deve ser resolvida só por papel, e sim por atribuição (objeto). |
| `clientSchema` | 30–41 | Cliente completo (nome, contato, e-mail, telefone, observações, timestamps, version) | **Risco:** é ALTO o risco de reutilizar `clientSchema` ao aninhar o cliente numa resposta de demanda — expõe dados completos a um colaborador que só deveria ver dados essenciais (`ADR-0008`). |
| `listClientsQuerySchema` | 73–78 | `q`, `status`, `page`, `pageSize` (`.max(100)`) | Padrão de paginação a replicar nos contratos de `demands`/`tasks`. |
| CRUD client (44–68) | — | `createClientSchema`, `updateClientSchema`, `clientVersionSchema` (otimista com `version`) | Padrão de concorrência otimista a seguir em `demand`/`task` (field `version`). |

**Pontos de alteração na Fase 3:** novos schemas `prioritySchema`, `taskStatusSchema`, `demandStatusSchema`, `createDemandSchema`, `createTaskSchema`, `startTaskSchema`, `submitTaskReviewSchema`, `reviewTaskVerdictSchema`, `blockTaskSchema` (já propostos no `SPEC-DRAFT` §5), além das permissões e tetos citados acima.

---

## 2. RBAC backend — `apps/api/src/identity.ts` + `apps/api/src/migrate.ts`

- **`identity.ts` — `requirePermission(identity, permission)` (linhas 71–74):** negação por padrão; permissões de administração exigem o papel `administrator`. É o único portão de autorização usado pelas rotas hoje.
  - **Ponto de alteração:** a Fase 3 precisa de **autorização por objeto** (atribuição) além da por permissão. Recomenda-se uma primitiva nova (ex.: `authorizeAssignment(identity, task/demand)`) que verifique a atribuição no banco, chamada nas rotas de demanda/tarefa.
- **`identity.ts` — `changeRolePermissions` (linhas 128–145):** **CRÍTICO.** Hoje o handler **rejeita com 400 `ADMIN_PERMISSIONS_ONLY`** (linha 134) qualquer permissão além de `protected.read` para o papel `collaborator`, e exige todas as permissões para `administrator` (`ADMIN_PERMISSIONS_REQUIRED`, linha 133). Isso foi intencional na fronteira Fase 2/Fase 3 (`ADR-0008`), mas na Fase 3, ao tentar conceder `clients.read_assigned`/`demands.read` restritos a colaboradores, **esse handler precisará ser revisado** — senão o grant não pode ser persistido por essa via. Alternativa: tratar as permissões restritas por objeto (sem grant global), mantendo o handler intacto.
- **`identity.ts` — `publicIdentity` (51–65):** monta `roles` e `permissions` da sessão a cada requisição a partir de `user_role`/`role_permission`/`permission`.
  - **Ponto de alteração:** se as permissões restritas forem resolvidas por atribuição, o payload de sessão pode permanecer global e a visibilidade ser checada por consulta/rota; se forem permissões globais novas, `permissionSchema` (contrato) e as queries de grants passam a incluí-las.
- **`identity.ts` — `changeIdentity` (95–121):** proteção `LAST_ADMINISTRATOR` (409) na demote/desativação de admin — comportamento já testado; reutilizar para fluxos de equipe novos.
- **`migrate.ts` (linhas 15–17):** grants **manuais** ao `orium_app` (`GRANT SELECT, INSERT, UPDATE, DELETE ON auth_user, auth_account, ..., client`).
  - **Ponto de alteração:** **obrigatório** estender esse GRANT às futuras tabelas `demand`, `task`, dependências, comentários e histórico — esquecer isso gera falha silenciosa de permissão em runtime.
- **`db/init/00-roles.sql`:** roles Postgres `orium_migrator` (dono do schema `public`) e `orium_app` (`NOINHERIT`, `NOBYPASSRLS`).
  - **Nota técnica:** **não há políticas RLS** em `client` nem em nenhuma tabela hoje; a autorização é aplicada na camada de aplicação (rotas/queries). A Fase 3 deve manter esse padrão (WHERE/EXISTS por atribuição na query ou primitiva de autorização) ou, se quiser RLS, exigirá novo desenho de policies + `SET ROLE`, fora do padrão atual.

---

## 3. Rotas HTTP — `apps/api/src/app.ts`

Prefixo único: **`/api/v1`**. Autenticação via cookie HttpOnly (Better Auth), origem validada no hook `onRequest` (403 `ORIGIN_REJECTED`, 415 `JSON_REQUIRED`), erro padronizado `{ error: { code, requestId } }`.

| Rota | Linha | Permissão exigida | Onde a Fase 3 encaixa |
|---|---|---|---|
| `POST /api/v1/auth/sign-in/email` | 66 | `protected.read` | Reuso (colaborador continua autenticando) |
| `GET /api/v1/me` | 101 | `protected.read` | Payload de sessão — pode ganhar flags de visibilidade |
| `GET/POST /api/v1/users`; `PATCH /users/:id`; `PUT /users/:id/role`; `PUT /roles/:role/permissions` | 106–143 | `users.*` / `roles.manage` | — |
| `GET /api/v1/clients` | 144 | `clients.read` (**global**) | Ver §5 (risco) |
| `GET /api/v1/clients/:id` | 150 | `clients.read` (**global**) | Ver §5 (risco) |
| `POST/PATCH /api/v1/clients(/ :id)` | 157/164 | `clients.write` | — |
| `POST /api/v1/clients/:id/archive\|restore` | 172/180 | `clients.archive` | — |

**Pontos de alteração na Fase 3:** novas rotas `demands` (list/get/create/patch) e `tasks` (create/get/accept/start/block/submit-review/review/dependencies/comments/history) conforme `SPEC-DRAFT` §6, cada uma com `requirePermission` + verificação de atribuição por objeto; padrão de erros novos (`CYCLIC_DEPENDENCY_DETECTED`, etc.) registrados como `AppError` em **`apps/api/src/errors.ts`** (hoje só `AppError` genérico, status+code).

---

## 4. Schema e migrações — `apps/api/src/schema.ts` + `db/migrations/*.sql`

- **Drizzle schema (fonte):** `apps/api/src/schema.ts` — tabelas `auth_user`, `auth_session`, `auth_account`, `auth_verification`, `role`, `permission`, `user_role`, `role_permission`, `client` (38–53).
- **`db/migrations/0000_foundation.sql`:** fundação — roles `administrator`/`collaborator`, 5 permissões, grants iniciais (`collaborator` → só `protected.read`; linha 50).
- **`db/migrations/0001_clients.sql`:** tabela `client` + permissões `clients.*` concedidas a `administrator` (linhas 22–25). **Nenhum grant `clients.*` para `collaborator`** — porta de entrada do risco da Fase 3 (ver §5).

**Pontos de alteração na Fase 3 (novas migrations, ex. `0002_demands_tasks.sql`):**
- Tabelas `demand`, `task`, `task_dependency` (DAG acíclico), `task_comment`, `task_history` (conforme `SPEC-DRAFT` §2). Nova coluna/relação de **vinculação de colaborador a cliente/demanda** é necessária para a visibilidade restrita — hoje **não existe** nenhuma tabela de atribuição cliente-colaborador.
- `INSERT INTO permission ...` das novas permissões e `INSERT INTO role_permission ...` (admin) — **sem conceder nada ao colaborador** até a visibilidade por objeto estar implementada.
- **Padrão de grants de `migrate.ts` deve ser estendido** (ver §2).
- Nota: `db/migrations/meta/_journal.json` e `apps/api/src/schema.ts` devem ser atualizados **juntos** (Drizzle) quando houver implementação — fora do escopo desta auditoria.

---

## 5. API frontend — `apps/web/src/api.ts`

Cliente único `api` em **`apps/web/src/api.ts`**, usando `fetch` relativo (`/api/v1/...`) com `credentials: 'include'`, `ApiError(status, code)`, parser Zod (`request`, linhas 65–111) e `onUnauthorized` (401 → logout no `App.tsx`).

| Rota usada pelo Web | Método em `api.ts` | Linha |
|---|---|---|
| me / sign-in / sign-out | `getMe` / `signIn` / `signOut` | 114 / 122 / 144 |
| clients CRUD+list | `listClients` / `getClient` / `createClient` / `updateClient` / `archiveClient` / `restoreClient` | 153–232 |
| users | `listUsers` / `createUser` / `deactivateUser` / `changeUserRole` | 234–280 |

**Pontos de alteração na Fase 3:** novos métodos `listDemands`, `createDemand`, `getDemand`, `listTasks`, `startTask`, `submitReview`, etc., cada um com parser Zod (schemas novos de `@orium/contracts`) e o mesmo padrão de erros; **atenção** aos códigos de erro novos não mapeados hoje (o wrapper já expõe `error.code`).

---

## 6. Navegação e UI — `apps/web/src/App.tsx`, `Header.tsx`, `types.ts`

- **`types.ts` (linha 3):** `ActiveTab = 'clients' | 'team'` — **será estendido** com abas de demandas/tarefas (ex.: `'demands' | 'my-tasks'`).
- **`App.tsx`:** estado de sessão; aba padrão por primeira permissão disponível (`clients.read` → clients, senão `users.read` → team; linhas 37–41 e 84–88); renderização condicional por permissão (132–138); fallback "Área protegida" sem permissões (141–148).
  - **Ponto de alteração:** colaborador sem `clients.read`/`users.read` hoje cai no fallback "Área protegida" (linhas 141–148) — na Fase 3 deve cair na visão de **"Minhas demandas/tarefas"** (atribuídas), sem acesso a abas globais.
- **`Header.tsx`:** abas renderizadas por permissão (`hasClientsRead`/`hasUsersRead`, linhas 18–46) e badge do papel (50–67).
  - **Ponto de alteração:** novas abas condicionais por permissão/flags de Fase 3; ocultar Clientes/Equipe para colaborador (já ocultas, manter).
- **`vite.config.ts`:** proxy `/api → 127.0.0.1:3001` — **sem mudança necessária** para Fase 3 (prefixo `/api` já coberto).

---

## 7. Risco de exposição de clientes completos ao colaborador

### 7.1 Diagnóstico do risco

1. **Hoje é seguro porque não há grant:** `GET /api/v1/clients` e `GET /api/v1/clients/:id` exigem `clients.read` global (`app.ts` 144–156), e o papel `collaborator` não possui nenhum grant de clientes (`0000` linha 50; `0001` linhas 22–25; `identity.ts` linha 134 bloqueia o grant). Resultado atual para colaborador: **403** — correto.
2. **Risco na Fase 3, cenário 1 — conceder `clients.read` global:** se, para o colaborador ver o cliente da sua demanda, for (erradamente) concedido `clients.read` ao papel `collaborator`, ele passaria a listar **todos** os clientes com **dados completos** (contato, e-mail, telefone, observações) via `clientSchema` — violação direta do `ADR-0008` e do `PROJECT_CONTEXT` §2 (visibilidade **somente** dos atribuídos).
3. **Risco na Fase 3, cenário 2 — aninhar `clientSchema` na resposta de demanda:** ao devolver `{ demand, client: <clientSchema completo> }` num `GET /api/v1/demands/:id` para colaborador, mesmo sem conceder `clients.read`, os **dados completos do cliente vinculado** vazam pela rota de demanda.
4. **Risco estrutural:** não existe hoje **tabela de atribuição cliente↔colaborador**; sem ela, qualquer filtro por atribuição precisa derivar-se de `task.assigned_to_user_id` (design), o que não cobre demandas sem tarefa atribuída e fragiliza a auditoria da visibilidade.

### 7.2 Sugestões de consultas e autorização (sem implementar nesta auditoria)

1. **Manter `clients.read/write/archive` exclusivos de admin** e criar permissão restrita **`clients.read_assigned`** (já proposta no `SPEC-DRAFT` §4) para o colaborador — resolvida **por objeto**, nunca como grant global.
2. **Primitiva de autorização por atribuição** no backend (ex.: em `identity.ts` ou novo módulo `assignment.ts`):
   ```sql
   -- Sugestão conceitual: expor somente clientes vinculados ao usuário
   SELECT c.id, c.name  -- projeção mínima, NUNCA clientSchema completo
   FROM client c
   WHERE EXISTS (
     SELECT 1 FROM demand d
     JOIN task t ON t.demand_id = d.id
     WHERE d.client_id = c.id
       AND t.assigned_to_user_id = $userId
   )
   ```
   E em toda rota `demands/:id`/`tasks/:id`, checar `assigned_to_user_id = identity.user.id` (ou papel admin) **antes** de retornar qualquer dado.
3. **Projeção mínima do cliente** em respostas de demanda (ex.: `{ id, name }`) via schema Zod próprio (`assignedClientSchema`), em vez de reutilizar `clientSchema` completo — corrige o cenário 2.
4. **Tabela explícita de atribuição cliente↔colaborador** (ou `collaborator_client` / flag em `demand`) para auditar a visibilidade independentemente das tarefas; decisão de modelagem a validar com o coordenador.
5. **Não antecipar RLS**: como hoje não há policies e a app roda como `orium_app` (`NOINHERIT`/`NOBYPASSRLS`), adotar RLS seria mudança de padrão; recomenda-se aplicação da regra na camada de query/rota (consistente com a Fase 2) e revisar RLS numa fase de endurecimento.

---

## 8. Síntese — pontos de alteração por arquivo (somente-leitura; nada alterado)

| Camada | Arquivo(s) | O que muda na Fase 3 |
|---|---|---|
| Contratos | `packages/contracts/src/index.ts` | Novos schemas demand/task/status/prioridade/ações; novas permissões; teto de `rolePermissionsSchema` (max 8 → maior). |
| DB schema | `apps/api/src/schema.ts` | Novas tabelas `demand`, `task`, `task_dependency`, `task_comment`, `task_history`, atribuição cliente↔colaborador. |
| Migrations | `db/migrations/0002_*.sql` (novo) + `meta/_journal.json` | DDL, `INSERT permission`, grants `role_permission` (somente admin). |
| Grants runtime | `apps/api/src/migrate.ts` | Estender `GRANT SELECT/INSERT/UPDATE/DELETE` ao `orium_app` para as novas tabelas. |
| RBAC | `apps/api/src/identity.ts` | Primitiva de autorização por atribuição; revisar (ou contornar) `changeRolePermissions` para grants restritos. |
| Rotas | `apps/api/src/app.ts` | Novas rotas `/api/v1/demands` e `/api/v1/tasks` com permissão + objeto; códigos novos em `errors.ts`. |
| Clientes | `apps/api/src/clients.ts` | Helpers de scoping por atribuição e/ou projeção mínima (`read_assigned`). |
| API web | `apps/web/src/api.ts` | Novos métodos/parsers para demands/tasks. |
| Navegação | `apps/web/src/App.tsx`, `Header.tsx`, `types.ts`, novos componentes | Nova aba/visão "Minhas demandas" para colaborador; fallback atual "Área protegida" substituído para colaborador. |

## 9. Impedimentos / pendências (não bloqueiam a auditoria)

- **Dependência de negócio:** decisão pendente do responsável sobre efeito de pausas/bloqueios na data de entrega, prorrogação, atraso, pausa formal e cancelamento em cascata (`PHASE3-SPEC-DRAFT` §8; `PHASE3-OPEN-DECISIONS.md` §2) — necessária antes de fechar contratos/estados finais.
- **Modelagem da atribuição:** decidir se a visibilidade por atribuição usa tabela explícita cliente↔colaborador ou derivação via `task.assigned_to_user_id` — definir antes de escrever migração.
- **`changeRolePermissions`:** como conceder permissões restritas passará pelo handler atual (que hoje veta qualquer grant ao colaborador além de `protected.read`), é preciso definir o mecanismo (por objeto vs. ajuste do handler) antes da implementação.
