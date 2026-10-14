# Fase 6 — Incremento 3: Checklist de QA e Critérios de Teste (Autorização Transacional de Clientes)

**Data:** 13/10/2026 · **Autor:** Antigravity (revisão READONLY) · **Contrato base:** [PHASE6-CLIENT-AUTHORIZATION-CONTRACT.md](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/docs/PHASE6-CLIENT-AUTHORIZATION-CONTRACT.md) e [PHASE6-CLIENT-AUTHORIZATION-REVIEW.md](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/docs/PHASE6-CLIENT-AUTHORIZATION-REVIEW.md)
**Ownership da implementação e execução da suíte:** OpenCode (`apps/api/src/clients.ts`, `apps/api/src/app.ts`, `tests/clients-authorization.integration.test.ts`, `docs/PHASE6-CLIENT-AUTHORIZATION-RESULT.md`). Este documento é exclusivamente um checklist técnico READONLY de verificação; nenhuma hipótese concorrente é declarada como vulnerabilidade.

---

## 1. Escopo das Quatro Mutações e Guardas de Rota × Transação

Todas as quatro mutações em [clients.ts](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/apps/api/src/clients.ts) e suas rotas em [app.ts](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/apps/api/src/app.ts#L228-L256) devem manter a guarda inicial de rota (`authenticate` + `requirePermission`) **e** revalidar o ator dentro da transação no mesmo `PoolClient` sob `pg_advisory_xact_lock(IDENTITY_LOCK)` (`712041`), alinhando-se a [materials.ts](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/apps/api/src/materials.ts#L51-L94) e [demands.ts](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/apps/api/src/demands.ts#L101-L125).

| Rota HTTP | Serviço (`clients.ts`) | Permissão exigida | Papel exigido (`adminPermissions`) | Status sucesso | Erros preservados |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `POST /api/v1/clients` | `createClient(database, actorId, input)` | `clients.write` | `administrator` | `201` | `400 INVALID_INPUT`, `401 UNAUTHENTICATED`, `403 FORBIDDEN` |
| `PATCH /api/v1/clients/:id` | `updateClient(database, actorId, id, input)` | `clients.write` | `administrator` | `200` | `400 INVALID_INPUT`, `401`, `403`, `404 CLIENT_NOT_FOUND`, `409 CLIENT_VERSION_CONFLICT` |
| `POST /api/v1/clients/:id/archive` | `archiveClient(database, actorId, id, version)` | `clients.archive` | `administrator` | `200` | `400 INVALID_INPUT`, `401`, `403`, `404 CLIENT_NOT_FOUND`, `409 CLIENT_VERSION_CONFLICT` |
| `POST /api/v1/clients/:id/restore` | `restoreClient(database, actorId, id, version)` | `clients.archive` | `administrator` | `200` | `400 INVALID_INPUT`, `401`, `403`, `404 CLIENT_NOT_FOUND`, `409 CLIENT_VERSION_CONFLICT` |

### Checklist estrutural por mutação
- [ ] **Transação curta sem I/O externo:** `const client = await database.pool.connect()`, `BEGIN`, `SELECT pg_advisory_xact_lock($1)` com `IDENTITY_LOCK` (`712041`), revalidação do ator no mesmo `client`, query de escrita (`INSERT` ou `UPDATE ... WHERE id = $1 AND version = $2`), `COMMIT`; `ROLLBACK` garantido no `catch` e `client.release()` no `finally` (referência: `references/lock-short-transactions.md` e `references/lock-advisory.md`).
- [ ] **Ordem de verificação em `updateClient` / `archiveClient` / `restoreClient`:** A revalidação do ator (`401`/`403`) ocorre **antes** do `UPDATE` e da checagem de existência/versão (`404 CLIENT_NOT_FOUND` / `409 CLIENT_VERSION_CONFLICT`), evitando que um ator desativado ou sem permissão sonde existência ou versão de clientes no momento da escrita.
- [ ] **Leituras inalteradas:** `listClients` (`GET /api/v1/clients`) e `getClientById` (`GET /api/v1/clients/:id`) permanecem com a semântica atual.
- [ ] **Sem auditoria de identidade em clientes:** Nenhuma das 4 mutações de clientes deve inserir registros em `identity_event` ou `identity_event_subject`.

---

## 2. Matriz de Casos de Teste Obrigatórios (`orium_test` real, sem mocks/skips)

### C1 — Caminho feliz administrativo (todas as 4 mutações)
- [ ] Administrador ativo com `clients.write` e `clients.archive`:
  - `POST /api/v1/clients` cria cliente com `version = 1`, `archivedAt = null` (`201`).
  - `PATCH /api/v1/clients/:id` com `version: 1` atualiza dados e incrementa para `version = 2` (`200`).
  - `POST /api/v1/clients/:id/archive` com `version: 2` define `archivedAt != null` e incrementa para `version = 3` (`200`).
  - `POST /api/v1/clients/:id/restore` com `version: 3` limpa `archivedAt = null` e incrementa para `version = 4` (`200`).
- [ ] Conferência no banco: `SELECT count(*)::int FROM identity_event` para o `actor_id` das mutações de clientes permanece inalterado (nenhum `identity_event` emitido por operações de cliente).

### C2 — Autenticação, papéis, permissões granulares e revogação pré-requisição
- [ ] **Anônimo (sem cookie):** `401 UNAUTHENTICATED` nas 4 mutações.
- [ ] **Colaborador ativo:** `403 FORBIDDEN` nas 4 mutações (`create`, `update`, `archive`, `restore`).
- [ ] **Permissão granular no banco (`role_permission`):**
  - Quando `clients.archive` é temporariamente removida em transação/bloco de teste (com restauração garantida em `finally`), `create` e `update` (que exigem `clients.write`) continuam autorizados, enquanto `archive` e `restore` retornam `403 FORBIDDEN` (tanto via rota quanto na revalidação intra-transação).
  - Quando `clients.write` é temporariamente removida (com restauração em `finally`), `create` e `update` retornam `403 FORBIDDEN`.
  - Mesmo que `clients.write` ou `clients.archive` fosse atribuída a `collaborator` no banco, a verificação de `adminPermissions` (`role === 'administrator'`) rejeita o colaborador com `403 FORBIDDEN`.
- [ ] **Sessão revogada / usuário desativado pré-requisição:** Após `changeIdentity(db(), policyAdmin.id, targetAdmin.id, { active: false })`, requisição subsequente com o cookie antigo retorna `401 UNAUTHENTICATED`, e nova tentativa de login em `/api/v1/auth/sign-in/email` retorna `401 INVALID_CREDENTIALS` (comportamento real da API conforme [PHASE6-COORDINATION-REVIEW.md](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/docs/PHASE6-COORDINATION-REVIEW.md#L35)).

### C3 — Revalidação intra-transação: revogação ordenada ANTES da mutação (bloqueia escrita)
- [ ] Com snapshot administrativo já obtido (ou requisição HTTP que já passou por `authenticate` enquanto a transação de revogação ainda aguarda o lock), quando a revogação adquire e commita sob `IDENTITY_LOCK` **antes** da mutação de cliente:
  - **Desativação (`{ active: false }`):** a mutação de cliente falha na revalidação intra-transação com `401 UNAUTHENTICATED` e faz `ROLLBACK`.
  - **Demissão de papel (`{ role: 'collaborator' }`) ou remoção da permissão exigida:** a mutação de cliente falha na revalidação intra-transação com `403 FORBIDDEN` e faz `ROLLBACK`.
- [ ] **Prova de rollback integral:** A linha em `client` mantém exatamente `name`, `archived_at` e `version` anteriores (ou não existe, no caso de `createClient`). Cobrir as 4 operações (`create`, `update`, `archive`, `restore`).

### C4 — Ordem inversa: mutação ordenada ANTES da revogação (escrita legítima preservada)
- [ ] Quando a mutação de cliente entra na fila do `IDENTITY_LOCK` **antes** da revogação:
  - Ao liberar a barreira, a mutação de cliente adquire o lock primeiro, revalida o administrador ainda ativo/autorizado, commita com sucesso (`201`/`200`, `version` incrementada) e libera o lock.
  - Em seguida, a revogação (`changeIdentity`) adquire o lock e também conclui com sucesso.
  - **Regra de coordenação:** Não exigir erro universal para mutação serializada antes da revogação; o estado persistido no banco deve refletir a escrita concluída legitimamente e o ator desativado/demovido ao final.

### C5 — Controle otimista de `version` (`409`) e inexistência (`404`) preservados sob transação
- [ ] `PATCH /api/v1/clients/:id`, `POST .../archive` e `POST .../restore` com `version` defasada retornam `409 CLIENT_VERSION_CONFLICT`, fazem `ROLLBACK` e não alteram `name`, `contact_name`, `archived_at`, `updated_at` nem `version`.
- [ ] As mesmas três mutações para UUID inexistente (com ator válido) retornam `404 CLIENT_NOT_FOUND`.
- [ ] Payload inválido (ex.: `version <= 0`, campo desconhecido `.strict()`) retorna `400 INVALID_INPUT` sem efeitos colaterais.

---

## 3. Barreiras Determinísticas com `pg_locks` Filtrado pelo OID de `current_database()`

### Por que filtrar pelo OID de `current_database()`
`pg_locks` é uma visão global do cluster PostgreSQL. No helper existente em [identity-audit.integration.test.ts](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/tests/identity-audit.integration.test.ts#L55-L56), a consulta `ADVISORY_WAITERS` filtra apenas `locktype='advisory' AND NOT granted AND classid=0 AND objid=$1 AND objsubid=1`. Para cumprir estritamente o contrato do Incremento 3 e isolar `orium_test` de qualquer atividade em `orium_dev` no mesmo cluster, a consulta de barreira deve filtrar `pg_locks.database` pelo OID do banco atual (padrão já usado em `pg_stat_activity` em [materials.integration.test.ts](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/tests/materials.integration.test.ts#L1026-L1032)):

```sql
SELECT count(*)::int AS n
FROM pg_locks
WHERE database = (SELECT oid FROM pg_database WHERE datname = current_database())
  AND locktype = 'advisory'
  AND classid = 0
  AND objid = $1
  AND objsubid = 1
  AND NOT granted
```

### Atenção mecânica: `serializeIdentity` em memória vs fila real no PostgreSQL (`pg_locks`)
- Em [identity.ts](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/apps/api/src/identity.ts#L18-L29), `serializeIdentity(database, ...)` enfileira operações em memória por instância de `database.pool` **antes** de abrir conexão e chamar `pg_advisory_xact_lock`.
- Em [materials.ts](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/apps/api/src/materials.ts#L310-L316) e `demands.ts`, as mutações **não** usam `serializeIdentity`: abrem `database.pool.connect()`, executam `BEGIN` e chamam `SELECT pg_advisory_xact_lock($1)` diretamente no PostgreSQL.
- **Recomendação para `clients.ts` e para o teste:**
  1. Se `clients.ts` seguir `materials.ts`/`demands.ts` (adquirindo `pg_advisory_xact_lock(IDENTITY_LOCK)` diretamente no `PoolClient` sem a fila JS `serializeIdentity`), tanto a mutação de cliente quanto `changeIdentity` entram diretamente na fila de locks do PostgreSQL e podem ser observadas simultaneamente em `pg_locks` (`waitForWaiters(1)` para a 1ª operação enfileirada e `waitForWaiters(2)` para a 2ª operação enfileirada).
  2. Para testar o fluxo HTTP completo (`app.inject`) em **C3 (revogação antes da escrita)** sem `sleep`:
     - Segurar `IDENTITY_LOCK` em conexão independente (`holder` via `migrator.pool.connect()` -> `BEGIN` -> `SELECT pg_advisory_xact_lock(712041)`).
     - Disparar `revokePromise = changeIdentity(db(), policyAdmin.id, targetAdmin.id, { active: false })` e aguardar `waitForWaiters(1)` (confirma que a revogação está bloqueada no topo da fila do `IDENTITY_LOCK` no banco `orium_test`, ainda não commitada).
     - Disparar `writePromise = inject({ method: 'PATCH', url: '/api/v1/clients/...' })` com o cookie válido de `targetAdmin`. Como `revokePromise` ainda não commitou, `authenticate()` e `requirePermission()` na rota passam com o snapshot administrativo legítimo, e a requisição HTTP entra em `updateClient` e bloqueia em `pg_advisory_xact_lock(712041)` atrás de `revokePromise`.
     - Aguardar `waitForWaiters(2)` (prova determinística no `pg_locks` de que a requisição HTTP já ultrapassou `authenticate()` na rota e está estacionada no lock da transação atrás da revogação).
     - Liberar `holder` (`COMMIT`): o PostgreSQL concede o lock primeiro a `revokePromise` (que commita a desativação) e em seguida a `writePromise` (que executa a revalidação intra-transação no mesmo `PoolClient`, detecta `active = false`, faz `ROLLBACK` e retorna `401`).
  3. Para **C4 (escrita antes da revogação)**: inverter a ordem de entrada na fila sob `holder` (`writePromise` -> `waitForWaiters(1)` -> `revokePromise` -> `waitForWaiters(2)` -> liberar `holder`), comprovando `200`/`201` na escrita e sucesso na revogação subsequente.

---

## 4. Higiene, Isolamento e Cleanup Cirúrgico (`orium_test`)

- [ ] Validar URLs de teste (`TEST_DATABASE_URL` com `orium_app` e `TEST_MIGRATION_DATABASE_URL` com `orium_migrator`) apontando exclusivamente para `/orium_test` em host local (`127.0.0.1`/`localhost`/`[::1]`), conforme [clients.integration.test.ts](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/tests/clients.integration.test.ts#L11-L21).
- [ ] Evitar rate-limit de login (`429`) distribuindo `remoteAddress` no helper `inject` (`127.2.x.y`).
- [ ] Restaurar em bloco `try / finally` qualquer alteração temporária de `role_permission` e conferir o estado restaurado antes de encerrar o teste.
- [ ] No `afterAll`, remover cirurgicamente apenas os IDs/prefixos criados pela própria suíte:
  - `DELETE FROM client WHERE id = ANY($1)` (ou por prefixo exclusivo da suíte);
  - `DELETE FROM identity_event WHERE actor_id = ANY($1) OR target_user_id = ANY($1)` e `DELETE FROM identity_event_subject WHERE user_id = ANY($1)` via conexão `migrator` para os usuários de fixture criados na suíte (já que `provisionUser` e `changeIdentity` geram eventos de auditoria de identidade para as fixtures de usuário);
  - `DELETE FROM auth_user WHERE id = ANY($1)` (ou por prefixo de e-mail da suíte).
- [ ] Confirmar contagem `0` órfãos da suíte em `client`, `auth_user`, `identity_event` e `identity_event_subject` ao final.
