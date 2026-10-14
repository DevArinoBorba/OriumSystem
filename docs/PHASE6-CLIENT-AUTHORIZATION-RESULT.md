# Phase 6 — Incremento 3: Resultado de Implementação e Testes Reais de Autorização Transacional de Clientes

Data: 2026-10-13  
Implementador / Executor: `Antigravity` (ownership transferido explicitamente em `docs/PHASE6-CLIENT-AUTHORIZATION-CONTRACT.md` em 13/10/2026)  
Contrato de referência: `docs/PHASE6-CLIENT-AUTHORIZATION-CONTRACT.md`  
Auditoria base: `docs/PHASE6-CLIENT-AUTHORIZATION-REVIEW.md`  
Checklist de QA: `docs/PHASE6-CLIENT-AUTHORIZATION-QA-CHECKLIST.md`

---

## 1. Arquivos Alterados / Criados no Escopo do Contrato

1. `apps/api/src/clients.ts`
   - As quatro mutações (`createClient`, `updateClient`, `archiveClient`, `restoreClient`) recebem `actorId: string` e executam transação curta via `database.pool.connect()`:
     - `BEGIN`
     - `SELECT pg_advisory_xact_lock($1)` com `IDENTITY_LOCK` (`6041101`)
     - `revalidateActor(poolClient, actorId, permission)`:
       - `createClient` e `updateClient` exigem `actor.active === true`, `actor.role === 'administrator'` e `actor.permissions.includes('clients.write')`.
       - `archiveClient` e `restoreClient` exigem `actor.active === true`, `actor.role === 'administrator'` e `actor.permissions.includes('clients.archive')`.
       - Revalidação ocorre **antes** de `INSERT`/`UPDATE` e **antes** do diagnóstico de `404 CLIENT_NOT_FOUND` vs `409 CLIENT_VERSION_CONFLICT`, evitando vazamento de existência/versão para ator revogado ou rebaixado.
     - `COMMIT` em sucesso; `ROLLBACK` integral em `catch` e `poolClient.release()` em `finally`.
   - Leituras (`listClients`, `getClientDetail`) e semântica de bloqueio otimista (`WHERE id = $1 AND version = $2`) permanecem inalteradas.
   - Nenhuma emissão de `identity_event` ou `identity_event_subject` nas operações de clientes.
2. `apps/api/src/app.ts`
   - As quatro rotas mutáveis (`POST /api/v1/clients`, `PATCH /api/v1/clients/:id`, `POST /api/v1/clients/:id/archive`, `POST /api/v1/clients/:id/restore`) mantêm `requirePermission(...)` como guarda inicial e repassam `actor.id` para `createClient`, `updateClient`, `archiveClient` e `restoreClient`.
3. `tests/clients-authorization.integration.test.ts`
   - Suíte de integração real contra `orium_test` (`127.0.0.1:5433`), sem mocks/skips, cobrindo integralmente `C1` a `C5`:
     - **Inferência de overload `PoolClient`**: derivada via `const connectPoolClient = (dbInstance: Database) => dbInstance.pool.connect(); type ConnectedPoolClient = Awaited<ReturnType<typeof connectPoolClient>>;` (resolvendo o overload zero-argumento `Promise<PoolClient>` sem importar `'pg'` diretamente na raiz).
     - **Manipulação de grants por `role_id`**: `withRevokedPermission` e o teste de colaborador consultam/alteram `role_permission` por `role_id` (`'administrator'` / `'collaborator'`), verificam pré-condição e contagem real (`rowCount === 1`) e registram diffs em `removedGrantsBySuite` / `insertedGrantsBySuite` com restauração diferencial em transação curta caso um teste aborte e prova final `rolesBefore = rolesAfter`.
     - **Rastreamento centralizado de clientes e prefixo único**: `createClientHttp` e `trackClientResponse` registram imediatamente qualquer resposta `201` em `clientIds` antes de asserções, e todos os nomes usam `clientNamePrefix` (`ClientAuth-<uuid8>-`) para varredura e limpeza cirúrgica em `afterAll` sem afetar dados de terceiros.
     - **Barreiras determinísticas `pg_locks` filtradas pelo OID de `current_database()`**: `C3` testa separadamente `PATCH /api/v1/clients/:id`, `POST /api/v1/clients`, `POST /api/v1/clients/:id/archive` (sobre cliente ativo) e `POST /api/v1/clients/:id/restore` (sobre cliente genuinamente arquivado com `archived_at != null` e `version = 2`), aguardando `waitForWaiters(1)` e `waitForWaiters(2)` antes de liberar o `holder` e drenando todas as promises iniciadas com `Promise.allSettled` em `finally`.
4. `docs/PHASE6-CLIENT-AUTHORIZATION-RESULT.md` (este documento).

---

## 2. Comandos Executados e Códigos de Saída Reais

| Verificação | Comando Executado | Exit Code | Observação Objetiva |
| :--- | :--- | :---: | :--- |
| **ESLint Focal** | `pnpm exec eslint apps/api/src/clients.ts apps/api/src/app.ts tests/clients-authorization.integration.test.ts` | `0` | Zero erros ou warnings nos 3 arquivos do incremento. |
| **Typecheck API** | `pnpm --filter @orium/api typecheck` (`tsc -p tsconfig.json --noEmit` em `apps/api`) | `0` | Compilação limpa de `apps/api/src/clients.ts` e `apps/api/src/app.ts`. |
| **Typecheck Raiz (`tsconfig.json`)** | `pnpm exec tsc -p tsconfig.json --noEmit` | `2` (`inc3_tsc_errors=0`) | **Zero erros** em `apps/api/src/clients.ts`, `apps/api/src/app.ts` e `tests/clients-authorization.integration.test.ts`. Os 7 erros reportados pelo `tsc` raiz são pré-existentes e exclusivos de `tests/identity-audit.integration.test.ts` (2) e `tests/materials.integration.test.ts` (5), fora do ownership deste contrato. |
| **Suíte PostgreSQL Real (`orium_test`)** | `node --env-file=.env ./node_modules/vitest/vitest.mjs run tests/clients-authorization.integration.test.ts` | `0` | **9 passed (9)** em `19.12s` contra `orium_test` real (`127.0.0.1:5433`). |

---

## 3. Cobertura dos Casos `C1`–`C5` na Suíte Real (`9/9 PASS`)

1. **`C1: administrator happy path — create/update/archive/restore with version increments and no identity_event`** (`1512ms` — PASS):
   - Cria (`201`, `version = 1`, `archivedAt = null`), atualiza (`200`, `version = 2`), arquiva (`200`, `version = 3`, `archivedAt != null`) e restaura (`200`, `version = 4`, `archivedAt = null`).
   - Confirma no banco `version = 4`, `archived_at = null` e `0` eventos emitidos em `identity_event` para o administrador mutante.
2. **`C2: anonymous 401, collaborator 403, granular permission admin — 403 on archive/restore when clients.archive removed`** (`1134ms` — PASS):
   - Chamadas anônimas (sem cookie) para `POST /api/v1/clients`, `PATCH /api/v1/clients/:id`, `POST /api/v1/clients/:id/archive` e `POST /api/v1/clients/:id/restore` retornam `401`.
   - Com `clients.archive` revogado de `role_id = 'administrator'` (`deleted.rowCount = 1`), `archive` e `restore` retornam `403`, enquanto `update` (`200`) e `create` (`201`, rastreado em `clientIds`) permanecem autorizados.
3. **`C2: removing clients.write denies create/update 403 and a collaborator (even with clients.write) is 403 on all 4 mutations`** (`2152ms` — PASS):
   - Com `clients.write` revogado de `role_id = 'administrator'`, `create` e `update` retornam `403`, enquanto `archive` (`200`) e `restore` (`200`) seguem autorizados.
   - Colaborador padrão recebe `403` nas 4 mutações; colaborador com `clients.write` inserido temporariamente em `role_permission` (`role_id = 'collaborator'`, `insertedGrant.rowCount = 1`) também recebe `403` nas 4 mutações (`adminPermissions` exige papel `'administrator'`). Grant removido em `finally` e confirmado `0`.
4. **`C2: revoked/inactive session is refused 401 before every mutation and a new login fails 401`** (`1213ms` — PASS):
   - Após `changeIdentity(..., { active: false })`, o cookie anterior recebe `401` nas 4 mutações (`create`, `update`, `archive`, `restore`), novo login retorna `401` e `version` do cliente permanece intacta.
5. **`C3: revocation ordered first — deactivation before PATCH update causes rollback 401 and keeps prior snapshot`** (`997ms` — PASS):
   - Sob `holdIdentityLock()`, enfileira `changeIdentity(..., { active: false })` (`waitForWaiters(1)`) e `PATCH /api/v1/clients/:id` (`waitForWaiters(2)`). Após liberar o lock, `PATCH` retorna `401` e o registro em `client` permanece idêntico ao `beforeSnapshot`.
6. **`C3: revocation ordered first — demotion before POST create rolls back to no row (403)`** (`1006ms` — PASS):
   - Sob `holdIdentityLock()`, enfileira `changeIdentity(..., { role: 'collaborator' })` (`waitForWaiters(1)`) e `POST /api/v1/clients` (`waitForWaiters(2)`). Após liberar o lock, `POST` retorna `403` e `SELECT count(*) FROM client WHERE name = $1` confirma `0` linhas criadas.
7. **`C3: revocation ordered first — deactivation before archive and demotion before restore on genuinely archived client roll back (401/403) preserving full snapshots`** (`1849ms` — PASS):
   - Sub-etapa 1 (`archive`): sobre cliente ativo (`archived_at = null`, `version = 1`), desativação ordenada antes de `archive` via `waitForWaiters(1)` / `waitForWaiters(2)` retorna `401` e preserva `activeSnapshot` integralmente.
   - Sub-etapa 2 (`restore`): sobre cliente genuinamente arquivado (`archived_at != null`, `version = 2`), rebaixamento para `'collaborator'` ordenado antes de `restore` via `waitForWaiters(1)` / `waitForWaiters(2)` retorna `403` e preserva `archivedSnapshot` (`archived_at` não nulo e `version = 2`) integralmente.
   - Confirma `0` linhas em `identity_event` para ambos os administradores mutantes.
8. **`C4: mutation ordered first — write commits legitimately before later revocation, and revocation still completes`** (`825ms` — PASS):
   - Sob `holdIdentityLock()`, `PATCH /api/v1/clients/:id` entra na fila primeiro (`waitForWaiters(1)`) e `changeIdentity(..., { active: false })` entra em segundo (`waitForWaiters(2)`). Ao liberar o lock, `PATCH` commita legitimamente (`200`, `version = 2`), a revogação conclui em seguida e nova tentativa com o mesmo cookie retorna `401`.
9. **`C5: version conflict 409 and unknown id 404 rollback without data change; invalid input 400`** (`1269ms` — PASS):
   - `version + 99` em `update`, `archive` e `restore` retorna `409 CLIENT_VERSION_CONFLICT` sem alterar o snapshot.
   - UUID inexistente em `update`, `archive` e `restore` retorna `404 CLIENT_NOT_FOUND`.
   - `version: 0` e campo desconhecido (`unexpected: true`) retornam `400` sem alterar dados.

---

## 4. Evidência de Cleanup Cirúrgico e Preservação de Baseline (`.local/phase6-client-authorization-cleanup.json`)

```json
{
  "prefix": "client-auth-",
  "clientNamePrefix": "ClientAuth-6873f4a7-",
  "at": "2026-10-13T19:33:02.512Z",
  "clientsTrackedCount": 10,
  "clientsDeleted": 10,
  "eventsDeleted": 18,
  "usersDeleted": 12,
  "remainingClientsById": 0,
  "remainingClientsByPrefix": 0,
  "remainingEvents": 0,
  "remainingUsers": 0,
  "rolesBefore": [
    "administrator:clients.archive",
    "administrator:clients.read",
    "administrator:clients.write"
  ],
  "rolesAfter": [
    "administrator:clients.archive",
    "administrator:clients.read",
    "administrator:clients.write"
  ],
  "rolesEqual": true,
  "identityEventsTotalBefore": 394,
  "identityEventsTotalAfter": 394
}
```

- **Preservação do ambiente DEV**: Nenhuma migration, rebuild ou restart foi aplicado ao ambiente DEV (`PID 11204` na porta `3002` e `PID 26472` na porta `5173` permanecem intactos aguardando o gate de `Codex #2` conforme `docs/PHASE6-INCREMENT3-DEV-PLAN.md`).

---

## 5. Follow-up Factual — Remediação do Typecheck da Raiz (`docs/PHASE6-TYPECHECK-REMEDIATION.md`)

Após o registro inicial acima (`root_tsc_exit=2` com `inc3_tsc_errors=0`), `Codex #2` concedeu ownership complementar para corrigir os 7 erros pré-existentes de `tests/identity-audit.integration.test.ts` (2) e `tests/materials.integration.test.ts` (5). Os arquivos do Incremento 3 (`apps/api/src/clients.ts`, `apps/api/src/app.ts`, `tests/clients-authorization.integration.test.ts`) não foram alterados nem reexecutados sem necessidade.

- `Find-FreePort.ps1` executado com os parâmetros reais do `CmdletBinding` (`-Preferred 5433 -Service orium-inc3-test -Project <path>` -> `reserve_exit=0`, `port=20000`, `preferredPort=5433`, `leaseId=9ad12cd4-e6cb-4bf2-9102-bc45ebd6d856`, liberado imediatamente com `-ReleaseLeaseId 9ad12cd4-e6cb-4bf2-9102-bc45ebd6d856` -> `release_exit=0`; uma tentativa anterior com flags inexistentes `-PreferredPort`/`-RangeEnd`/`-Json` falhou com `NamedParameterNotFound` e foi corrigida antes da verificação final).
- `pnpm exec eslint tests/identity-audit.integration.test.ts tests/materials.integration.test.ts` -> `eslint_exit=0`
- `pnpm exec tsc -p tsconfig.json --noEmit` -> **`root_tsc_exit=0`** (raiz 100% limpa)
- Seleções focais executadas contra `orium_test` real (filtro `-t` intencional — **SELEÇÃO**, não suíte inteira):
  - `node --env-file=.env ./node_modules/vitest/vitest.mjs run tests/identity-audit.integration.test.ts -t "C7: read revalidates under IDENTITY_LOCK"` -> `c7_exit=0` (`1 passed | 17 skipped (18)`)
  - `node --env-file=.env ./node_modules/vitest/vitest.mjs run tests/materials.integration.test.ts -t "1.5: Sess"` -> `m15_exit=0` (`1 passed | 35 skipped (36)`)
- Estado pós-execução de `orium_test`: `auth_user=0`, `client=0`, `identity_event=394`, `clientRolePermissions=["administrator:clients.archive","administrator:clients.read","administrator:clients.write"]`. Detalhes completos em `docs/PHASE6-TYPECHECK-REMEDIATION.md`.

