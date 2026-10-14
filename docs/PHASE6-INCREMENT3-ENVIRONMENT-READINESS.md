# Phase 6 — Incremento 3: Prontidão de Ambiente e Serviços (READONLY)

Data: 2026-10-13  
Responsável pela verificação: `Antigravity` (transferência explícita de `Codex #2` a partir de `.local/phase6/coord2-qa-readiness.txt` devido a indisponibilidade de rede do provedor em `Antigravity QA`)  
Escopo: Verificação **READONLY** de portas, processos, containers, configuração sanitizada, banco de teste (`orium_test`) e serviços DEV ativos para os testes reais do Incremento 3 (`clients.write` / `clients.archive`) e posterior ativação DEV pós-gate.

---

## 1. Verificação de Portas (`PORT_POLICY.md` e `Find-FreePort.ps1`)

Executado `C:/Users/arino/.maestri/Find-FreePort.ps1` com os parâmetros reais do `CmdletBinding` (`-Preferred <porta> -Service <serviço> -Project <diretório>`) para cada porta padrão do projeto (`3002`, `5173`, `55432`, `5433`) e liberadas imediatamente todas as reservas temporárias não utilizadas via `-ReleaseLeaseId <leaseId>` (sem manter leases órfãos em `C:/Users/arino/.maestri/port-reservations.json`; tentativas iniciais com flags de outra versão como `-Release -Port` / `-PreferredPort` falharam com `NamedParameterNotFound` e foram corrigidas com os parâmetros reais):

| Serviço | Porta Padrão | Status Pré-Ativação | PID / Processo | Pertence ao OriumSystem? | Ação / Lease Temporário |
| :--- | :---: | :--- | :--- | :---: | :--- |
| API DEV | `3002` (`127.0.0.1`) | Ocupada (ativa) | `PID 11204` (`node.exe` -> `apps/api/dist/server.js`) | Sim (`inProject=True`) | Preservado; lease temporário (`port: 20000`) liberado via `-ReleaseLeaseId` |
| WEB DEV | `5173` (`127.0.0.1`) | Ocupada (ativa) | `PID 26472` (`node.exe` -> Vite dev server) | Sim (`inProject=True`) | Preservado; lease temporário (`port: 20000`) liberado via `-ReleaseLeaseId` |
| Postgres DEV | `55432` (`127.0.0.1`) | Ocupada (ativa) | `PID 16560` (`com.docker.backend.exe` -> `orium-local-postgres-1`) | Sim | Preservado; lease temporário (`port: 20000`) liberado via `-ReleaseLeaseId` |
| Postgres TEST | `5433` (`127.0.0.1`) | Ocupada (ativa) | `PID 16560` (`com.docker.backend.exe` -> `orium-local-postgres-test-1`) | Sim | Preservado; lease temporário (`port: 20000`) liberado via `-ReleaseLeaseId` |

- **Outros containers na máquina**: `ecommerce-postgres` (`5432`) e `ecommerce-redis` (`6379`) pertencem a outro projeto e permaneceram intocados conforme `PORT_POLICY.md`.
- **Nota sobre `PID 11204` vs `PID 19884`**: O listener ativo na porta `3002` antes da ativação do Incremento 3 em 2026-10-13 era `PID 11204` (instância ativada na homologação DEV do Incremento 2 com `0004_identity_audit`), e não mais o `PID 19884` histórico.

---

## 2. Containers Docker do OriumSystem (Inspeção Sanitizada)

Verificados via `docker ps --filter "name=orium-local"` com labels do Compose (sem leitura de `Config.Env` ou segredos):

- `orium-local-postgres-1`: `Up 8 days (healthy)` | Binding: `127.0.0.1:55432->5432/tcp` | `com.docker.compose.project=orium-local`, `com.docker.compose.service=postgres`
- `orium-local-postgres-test-1`: `Up 8 days (healthy)` | Binding: `127.0.0.1:5433->5432/tcp` | `com.docker.compose.project=orium-local`, `com.docker.compose.service=postgres-test`

---

## 3. Configuração Sanitizada (`.env`)

Verificada via `.local/phase6/qa-readiness/check-readiness.mjs` expondo apenas booleanos, portas locais e nomes de campos:

- `TEST_DATABASE_URL`: `present=true`, `validLocalTarget=true`, `port=5433`, `dbMatches=true` (`orium_test`), `roleMatches=true` (`orium_app`), `hasPassword=true`
- `TEST_MIGRATION_DATABASE_URL`: `present=true`, `validLocalTarget=true`, `port=5433`, `dbMatches=true` (`orium_test`), `roleMatches=true` (`orium_migrator`), `hasPassword=true`
- `sameTestClusterAndDb`: `true` (ambas as URLs de teste apontam para `127.0.0.1:5433/orium_test`)
- `DATABASE_URL`: `present=true`, `validLocalTarget=true`, `port=55432`, `dbMatches=true` (`orium_dev`), `roleMatches=true` (`orium_app`), `hasPassword=true`
- `MIGRATION_DATABASE_URL`: `present=true`, `validLocalTarget=true`, `port=55432`, `dbMatches=true` (`orium_dev`), `roleMatches=true` (`orium_migrator`), `hasPassword=true`
- `API_HOST`: `127.0.0.1` | `API_PORT`: `3002` | `API_ORIGIN`: `http://127.0.0.1:3002` | `WEB_ORIGIN`: `http://127.0.0.1:5173`
- `BETTER_AUTH_SECRET_PRESENT`: `true`

---

## 4. Prontidão Read-Only do Banco de Teste (`orium_test` na porta `5433`)

Consultas executadas exclusivamente em `BEGIN READ ONLY` seguidas de `COMMIT`:

- **Conectividade e Roles**:
  - `orium_app` (`TEST_DATABASE_URL`): `reachable=true`, `dbMatch=true` (`orium_test`), `userMatch=true` (`orium_app`), `isSuperuser=false`, `dbOidPresent=true`.
  - `orium_migrator` (`TEST_MIGRATION_DATABASE_URL`): `migratorReachable=true`, `migrationsApplied=5` (`0000` a `0004_identity_audit`).
  - Confirmado que `orium_app` **não** possui permissão sobre o schema `drizzle` (`SQLSTATE 42501`), comprovando separação efetiva entre role de aplicação e role de migração.
- **Tabelas públicas presentes (`11/11`)**:
  - `auth_user`, `client`, `demand`, `identity_event`, `identity_event_subject`, `material`, `permission`, `role`, `role_permission`, `task`, `user_role`.
- **Privilégios de `orium_app` verificados por catálogo (`has_table_privilege` / `has_function_privilege`)**:
  - `public.client`: `SELECT=true`, `INSERT=true`, `UPDATE=true`, `DELETE=true`.
  - `public.identity_event` e `public.identity_event_subject`: `SELECT=true`, `INSERT=true`, `UPDATE=false`, `DELETE=false` (append-only preservado).
  - `public.prune_identity_events()`: `EXECUTE=true`.
- **Permissões de domínio para `clients.*` em `role_permission`**:
  - `administrator`: `clients.read`, `clients.write`, `clients.archive`.
  - `collaborator`: não possui `clients.read`/`clients.write`/`clients.archive` por padrão (alinhado ao modelo de acesso mínimo; testes de escrita granular em `C2` devem atribuir/remover explicitamente via `role_id = 'collaborator'`).
- **Contagem residual atual em `orium_test`**:
  - `auth_user`: `0`
  - `client`: `0`
  - `identity_event`: `394` (eventos históricos append-only de execuções anteriores; nenhuma fixture órfã de `auth_user` ou `client`).

---

## 5. Estado Atual dos Serviços DEV (`3002` e `5173`)

Verificado de forma read-only via `.local/phase6-dev-activate.ps1 -StatusOnly` e chamadas HTTP anônimas:

- `GET http://127.0.0.1:3002/health/ready` -> `200`
- `GET http://127.0.0.1:3002/health/live` -> `200` (`liveHeadersExact=True`: `cache-control`, `x-content-type-options`, `content-security-policy`, `x-frame-options`, `referrer-policy`, `permissions-policy` exatos; `hsts=False` em HTTP local)
- `GET http://127.0.0.1:3002/api/v1/clients` (anônimo) -> `401`
- `GET http://127.0.0.1:3002/api/v1/identity-events` (anônimo) -> `401`
- `GET http://127.0.0.1:5173/api/v1/me` (via proxy Vite) -> `401` (`apiCspViaProxy=True`)
- `GET http://127.0.0.1:5173/api/v1/clients` (via proxy Vite) -> `401`
- `GET http://127.0.0.1:5173/api/v1/materials` (via proxy Vite) -> `401` (`apiCspViaProxy=True`)

---

## 6. Conclusão de Prontidão

1. **Ambiente de Teste (`orium_test` em `127.0.0.1:5433`)**: **PRONTO** para execução da suíte real `tests/clients-authorization.integration.test.ts` pelo `OpenCode`, sem resíduos em `auth_user` ou `client` (`0` linhas) e com todas as 5 migrations (`0000`–`0004`) e grants verificados.
2. **Ambiente DEV (`127.0.0.1:3002` `PID 11204` e `127.0.0.1:5173` `PID 26472`)**: **ÍNTEGRO e INTACTO** no build do Incremento 2, pronto para futura ativação controlada conforme `docs/PHASE6-INCREMENT3-DEV-PLAN.md` somente após o aceite formal do gate `TEST` por `Codex #2`.
