# Fase 7 — Incremento 1: Resultado da Implementação da Segurança Transacional dos Produtores de Eventos

- **Data:** 2026-10-13
- **Responsável:** Antigravity
- **Coordenação:** Codex #2 (`docs/PHASE7-INCREMENT1-CONTRACT.md` e revisão em `docs/PHASE7-INCREMENT1-INDEPENDENT-REVIEW.md`)
- **Escopo e Ownership Exclusivo:**
  - Código mantido: [`apps/api/src/demands.ts`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/apps/api/src/demands.ts)
  - Nova suíte de testes corrigida: [`tests/demands-authorization.integration.test.ts`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/tests/demands-authorization.integration.test.ts)
  - Relatório oficial: [`docs/PHASE7-INCREMENT1-RESULT.md`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/docs/PHASE7-INCREMENT1-RESULT.md)
  - Artefatos e helpers de apoio: `.local/phase7/increment1/` (`cleanup-report.json`, `cleanup-report.round1.json`)
  - Demais arquivos permaneceram estritamente **READONLY** (sem alterações em migrations, novos grants permanentes, contratos, frontend, `apps/api/src/app.ts`, `apps/api/src/identity.ts` ou arquivos de outros agentes).

---

## 1. Resumo da Implementação Técnica em `apps/api/src/demands.ts`

1. **Serialização via `IDENTITY_LOCK` (`712041`) em Todas as 16 Mutações:**
   - Cada uma das 16 funções mutadoras de demandas, tarefas e comentários inicia com a sequência obrigatória no mesmo `PoolClient`:
     ```ts
     await dbClient.query('BEGIN');
     await dbClient.query('SELECT pg_advisory_xact_lock($1)', [IDENTITY_LOCK]);
     const actor = await revalidateActorInsideTransaction(dbClient, identity.user.id, ...);
     ```
   - **Ordem de execução estrita:** `revalidateActorInsideTransaction` ocorre **antes** de qualquer lock de domínio (`demand FOR UPDATE`, `task FOR UPDATE`, `task_requirement FOR UPDATE`, `client FOR SHARE`) e **antes** de qualquer decisão `404 NOT_FOUND` ou `409 VERSION_CONFLICT`.
   - A ordem de locks subsequente existente (`demand` → `task` → `requisitos`/`dependências`) foi 100% preservada, sem adquirir advisory lock após linhas bloqueadas.
   - Em [`addDependency`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/apps/api/src/demands.ts#L1365-L1445), a validação de auto-dependência (`taskId === input.dependsOnTaskId`) foi internalizada para a transação logo após a revalidação do ator, garantindo que usuários desativados ou sem permissão recebam `401`/`403` após aguardar na fila do lock advisory.

2. **Determinação do Papel Atual In-Tx em [`createTaskComment`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/apps/api/src/demands.ts#L1553-L1602):**
   - Eliminada a dependência do snapshot obsoleto `identity.roles` recebido no request pré-transação.
   - [`revalidateActorInsideTransaction`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/apps/api/src/demands.ts#L117-L143) aceita `requiredPermission: Permission | ((role: Role) => Permission)`.
   - `createTaskComment` passa `(role) => (role === 'administrator' ? 'tasks.manage' : 'tasks.execute')`.
   - O papel atual do ator é extraído de `auth_user JOIN user_role` dentro da transação sob `IDENTITY_LOCK`. Se o ator for `administrator`, exige `tasks.manage`; se for `collaborator`, exige `tasks.execute` **E** valida `taskRow.assigned_to_user_id === actor.id`.
   - Se um administrador for rebaixado para colaborador enquanto aguarda no lock, a atribuição da tarefa passa a ser mandatória; mesmo que o colaborador receba artificialmente o grant `tasks.manage`, um comentário em tarefa alheia é rejeitado com `404 NOT_FOUND` (e com `403 FORBIDDEN` se `tasks.execute` tiver sido revogado).
   - Se um colaborador for promovido a administrador enquanto aguarda no lock, a permissão exigida passa a ser `tasks.manage` (e não `tasks.execute` do snapshot antigo), dispensando atribuição e permitindo comentar em qualquer tarefa.

3. **Exclusividade Rígida do Papel `administrator`:**
   - Mantida a guarda `if (adminPermissions.includes(permission) && role !== 'administrator') throw new AppError(403, 'FORBIDDEN')` para todas as permissões administrativas (`demands.write`, `tasks.manage`, `tasks.review`), impedindo que colaboradores executem ações de gestão mesmo se grants forem modificados na tabela `role_permission`.

---

## 2. Correções da Revisão Independente em `tests/demands-authorization.integration.test.ts`

Em resposta a `docs/PHASE7-INCREMENT1-INDEPENDENT-REVIEW.md`, foram aplicadas três correções estruturais na suíte de testes:

### 2.1 Preservação Estrita de Grants e Baseline Preexistente
- `grantExtraPermissionOnClient` agora utiliza `INSERT INTO role_permission ... ON CONFLICT DO NOTHING RETURNING role_id, permission_id`, adicionando ao conjunto `insertedGrantsBySuite` apenas quando `res.rowCount > 0` (INSERT efetivo).
- `removeExtraPermission` valida `if (!insertedGrantsBySuite.has(key)) return;` antes de disparar `DELETE`, garantindo que grants preexistentes no banco nunca sejam removidos por engano.
- Analogamente, `revokePermissionOnClient` usa `DELETE ... RETURNING` e só registra no conjunto quando `rowCount > 0`, e `restorePermission` só reintegra grants que foram removidos pela suíte.
- No `afterAll`, a transação de reconciliação de permissões opera estritamente sobre as chaves rastreadas em `removedGrantsBySuite` e `insertedGrantsBySuite`, garantindo preservação de baseline sob qualquer aborto ou falha.

### 2.2 Snapshots Determinísticos Completos do Domínio
- Criada a função `captureDomainSnapshot(clientIdsInput)` que captura o estado exato de todas as tabelas de domínio vinculadas às fixtures:
  - `demand`: `id, client_id, title, description, priority, delivery_date, status, version`
  - `task`: `id, demand_id, assigned_to_user_id, title, description, priority, delivery_date, status, version, pause_reason, pause_requested_at, paused_at, delivery_notes`
  - `task_requirement`: `id, task_id, title, mandatory, satisfied`
  - `task_dependency`: `task_id, depends_on_task_id`
  - `task_comment`: `id, task_id, author_id, content`
  - `demand_event`: `id, demand_id, task_id, actor_id, action, metadata`
- **Validação de ausência de efeitos colaterais:**
  - Em todas as tentativas negadas (401 por desativação em 16 mutações, 403 por revogação em 16 mutações, 403 por exclusividade admin sob demotion e 404/403 em comentários sob demotion), é capturado `snapshotBefore` e comparado via `expect(snapshotAfter).toEqual(snapshotBefore)`.
  - As alterações operacionais deliberadas de identidade (ex: `auth_user.active = false`) ficam expressamente fora do snapshot de domínio.

### 2.3 Barreira Específica de Reatribuição com `pg_blocking_pids`
- A consulta `ADVISORY_HOLDER_WAITING_ON_ROW` foi refinada para vincular a espera ao backend PID do `rowHolder` real desta execução:
  ```sql
  SELECT count(*)::int AS n FROM pg_locks adv_hold
    JOIN pg_locks row_wait ON adv_hold.pid = row_wait.pid
    WHERE adv_hold.database = (SELECT oid FROM pg_database WHERE datname = current_database())
      AND adv_hold.locktype = 'advisory'
      AND adv_hold.classid = 0
      AND adv_hold.objid = $1
      AND adv_hold.objsubid = 1
      AND adv_hold.granted
      AND NOT row_wait.granted
      AND row_wait.locktype IN ('relation', 'tuple', 'transactionid')
      AND (pg_blocking_pids(row_wait.pid) @> ARRAY[$2::int])
  ```
- O teste obtém `SELECT pg_backend_pid() AS pid` da conexão `rowHolder` e o passa para a barreira `waitForHolderBlockedOnRow(rowHolderPid)`.
- Isso comprova inequivocamente que a requisição `reassignTask` detém o `IDENTITY_LOCK` e está aguardando especificamente pelo lock de linha detido pelo `rowHolder` desta fixture, sem risco de interferência de locks de terceiros.

---

## 3. Evidências de Execução e Verificação

### 3.1 Verificações Estáticas
- **Focal ESLint:**
  `pnpm exec eslint apps/api/src/demands.ts tests/demands-authorization.integration.test.ts` → **Exit 0**
- **Root Typecheck:**
  `pnpm exec tsc -p tsconfig.json --noEmit` → **Exit 0**
- **API Typecheck:**
  `pnpm --filter @orium/api typecheck` → **Exit 0**

### 3.2 Execução de Testes Reais em PostgreSQL (`orium_test` — porta 5433)
Execução sequencial para evitar concorrência de grants:

1. **Suíte de Autorização Transacional (`tests/demands-authorization.integration.test.ts`):**
   ```text
    RUN  v5.0.3 C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem

    ✓ tests/demands-authorization.integration.test.ts (4 tests) 6515ms
      ✓ demands/tasks/comments transactional authorization against real PostgreSQL (4)
        ✓ rejects all 16 demand/task/comment mutations with 401 when the actor is deactivated while waiting on IDENTITY_LOCK, without altering domain or event history 3111ms
        ✓ rejects all 16 demand/task/comment mutations with 403 when the required permission is revoked while waiting on IDENTITY_LOCK, and blocks admin operations when demoted even with extra grants 1901ms
        ✓ evaluates current role inside createTaskComment transaction: demoted admin cannot bypass task assignment even with tasks.manage grant, and promoted collaborator uses tasks.manage instead of stale snapshot 869ms
        ✓ prevents previous assignee from writing a comment after concurrent reassignTask commits, verified via pg_locks barrier 416ms

    Test Files  1 passed (1)
         Tests  4 passed (4)
      Duration  7.77s
   ```

2. **Suíte de Regressão de Demandas (`tests/demands.integration.test.ts`):**
   ```text
    RUN  v5.0.3 C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem

    ✓ tests/demands.integration.test.ts (52 tests) 4094ms

    Test Files  1 passed (1)
         Tests  52 passed (52)
      Duration  5.40s
   ```
- **Total combinado:** **56/56 testes aprovados**.

### 3.3 Preservação de Baseline e Limpeza Cirúrgica (`.local/phase7/increment1/cleanup-report.json`)
```json
{
  "prefix": "dem-auth-ce7",
  "clientNamePrefix": "DemAuthClient-699316a6-",
  "at": "2026-10-13T21:57:51.497Z",
  "demandsTrackedCount": 6,
  "demandsDeleted": 6,
  "clientsTrackedCount": 4,
  "clientsDeleted": 4,
  "identityEventsDeleted": 31,
  "usersTrackedCount": 31,
  "usersDeleted": 31,
  "remainingDemands": 0,
  "remainingClients": 0,
  "remainingUsers": 0,
  "remainingIdentityEventsForSuiteUsers": 0,
  "rolesBeforeCount": 23,
  "rolesAfterCount": 23,
  "rolesEqual": true,
  "identityEventsTotalBefore": 397,
  "identityEventsTotalAfter": 397
}
```
- **Recibo anterior preservado:** Arquivado em `.local/phase7/increment1/cleanup-report.round1.json`.
- **Limpeza cirúrgica:** Deletados estritamente os IDs rastreados das fixtures (`demandsDeleted: 6`, `clientsDeleted: 4`, `usersDeleted: 31`, `identityEventsDeleted: 31`).
- **Resíduos no banco:** Exatamente **0** demandas, **0** clientes, **0** usuários e **0** eventos residuais das fixtures da suíte.
- **Integridade de `role_permission`:** `rolesBeforeCount === rolesAfterCount === 23`, com `rolesEqual === true`.
- **Integridade de `identity_event`:** `identityEventsTotalBefore === identityEventsTotalAfter === 397`.
- **Ambiente DEV:** Intacto, sem restarts ou modificações.

---

## 4. Conclusão e Prontidão
As três correções solicitadas pela revisão independente de Codex #2 foram integralmente implementadas e comprovadas com evidências concretas no PostgreSQL real. O código de produto e a suíte de testes atendem a todos os critérios de aceitação para o Incremento 1 da Fase 7.
