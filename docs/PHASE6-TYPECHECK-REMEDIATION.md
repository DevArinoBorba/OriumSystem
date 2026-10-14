# Phase 6 — Remediação de Typecheck da Raiz (`tsconfig.json`)

Data: 2026-10-13  
Responsável: `Antigravity` (ownership complementar autorizado por `Codex #2` para `tests/identity-audit.integration.test.ts`, `tests/materials.integration.test.ts` e `docs/PHASE6-TYPECHECK-REMEDIATION.md`)  
Objetivo: Eliminar os 7 erros pré-existentes de `pnpm exec tsc -p tsconfig.json --noEmit` na raiz do repositório sem alterar código de produção, schema, dependências, `tsconfig.json` ou serviços DEV, e validar as seleções focais afetadas contra `orium_test` real preservando o baseline (`394` `identity_event`, `0` `auth_user`, `0` `client`).

---

## 1. Diagnóstico e Correções Aplicadas

### 1.1. `tests/identity-audit.integration.test.ts` (2 erros resolvidos)

1. **Linha 3 (`TS2307: Cannot find module 'pg' or its corresponding type declarations`)**:
   - **Causa**: `pg` e `@types/pg` são dependências de `@orium/api` (`apps/api/package.json`), não da raiz. Além disso, `Pool.connect` em `@types/pg` possui overload sem argumento (`Promise<PoolClient>`) e overload com callback (`void`).
   - **Correção**: Removido `import type { PoolClient } from 'pg'` e declarada a função helper sem argumentos `const connectPoolClient = (dbInstance: Database) => dbInstance.pool.connect(); type ConnectedPoolClient = Awaited<ReturnType<typeof connectPoolClient>>;`, utilizada diretamente em `holdIdentityLock` (`const client = await connectPoolClient(mig());`) e `releaseIdentityLock`.
2. **Linha 632 (`TS2339: Property 'targetUserId' does not exist on type ...`)**:
   - **Causa**: Na união discriminada retornada por `identityEventSchema.parse(item)`, a variante `role_permissions_changed` possui `targetRoleId` em vez de `targetUserId`.
   - **Correção**: Aplicado narrowing explícito `'targetUserId' in parsed` com `flatMap` em `C7`:
     ```ts
     expect(
       firstResult.events.flatMap((item) => {
         const parsed = identityEventSchema.parse(item);
         return 'targetUserId' in parsed ? [parsed.targetUserId] : [];
       }),
     ).toContain(foreign.id);
     ```

### 1.2. `tests/materials.integration.test.ts` (5 erros resolvidos + preservação do baseline `394` de `identity_event`)

1. **Linha 298 (`TS2339: Property 'name' does not exist on type '{ email: string; id: string; }'`)**:
   - **Causa**: `fixtureUser` cadastrava `name: \`User \${label}\`` via `provisionUser`, mas retornava apenas `{ ...created, email }` (e `provisionUser` retorna `{ id }`).
   - **Correção**: `fixtureUser` passa a retornar `{ ...created, name, email }` com o `name` real recém-cadastrado para a fixture, mantendo inalterada a montagem da sessão forjada e a expectativa `403` no caso `1.5`.
2. **Linha 334 (`TS2345: Argument of type ... Property 'description' is missing`)**:
   - **Causa**: `createMaterial` exige `description: string` no tipo de entrada, ausente na chamada direta de teste do caso `1.5`.
   - **Correção**: Adicionado `description: 'Descrição válida para tentativa forjada'` no payload de `createMaterial` do caso `1.5`, mantendo a rejeição `403 FORBIDDEN` pela revalidação no banco.
3. **Linhas 1056, 1057 e 1065 (`TS2532: Object is possibly 'undefined'`)**:
   - **Causa**: Acesso direto a `matCheck.rows[0].title`, `matCheck.rows[0].version` e `eventCheck.rows[0].action` sob `noUncheckedIndexedAccess`.
   - **Correção**: Adicionados asserts explícitos `expect(matCheck.rows.length).toBe(1)` / `expect(matRow).toBeDefined()` e `expect(eventCheck.rows.length).toBe(1)` / `expect(eventRow).toBeDefined()` antes da validação de `title`, `version` e `action`.
4. **Higiene de cleanup de `identity_event` no `afterAll` de `tests/materials.integration.test.ts`**:
   - Como `provisionUser` grava eventos `user_created` em `identity_event` (tabela append-only para `orium_app`), `fixtureUser` passou a rastrear `createdUserIds` e o `afterAll` remove via `connectDatabase(migrationUrl)` (`orium_migrator`) os registros de `identity_event` e `identity_event_subject` pertencentes exclusivamente aos `createdUserIds` da própria execução, preservando o baseline histórico de `394` eventos em `orium_test`.

---

## 2. Verificação de Porta (`PORT_POLICY.md` / `Find-FreePort.ps1`)

- **Registro honesto de falha inicial de parâmetros e correção**:
  - Uma chamada inicial com flags inexistentes (`-PreferredPort`, `-RangeEnd`, `-Format`/`-Json`) falhou com `NamedParameterNotFound`.
  - Inspecionado o `CmdletBinding` real de `C:/Users/arino/.maestri/Find-FreePort.ps1` (`Preferred`, `Service`, `Project`, `Protocol`, `ListenAddress`, `ReleaseLeaseId`) e executada a verificação correta para a porta `5433` do banco de testes:
    - Reserva: `powershell -NoProfile -File C:/Users/arino/.maestri/Find-FreePort.ps1 -Preferred 5433 -Service orium-inc3-test -Project (Get-Location).Path` -> `reserve_exit=0`
      ```json
      {"leaseId":"9ad12cd4-e6cb-4bf2-9102-bc45ebd6d856","project":"C:\\Users\\arino\\OneDrive\\Documentos\\Projetos\\OriumSystem","service":"orium-inc3-test","protocol":"tcp","address":"127.0.0.1","port":20000,"preferredPort":5433,"expiresAt":"2026-10-13T19:57:52.4455363+00:00"}
      ```
    - Como `5433` está ocupada pelo container legítimo já comprovado do próprio projeto (`orium-local-postgres-test-1`, `Up 8 days (healthy)`), a reserva alternativa (`port: 20000`) foi liberada imediatamente:
    - Liberação: `powershell -NoProfile -File C:/Users/arino/.maestri/Find-FreePort.ps1 -ReleaseLeaseId 9ad12cd4-e6cb-4bf2-9102-bc45ebd6d856` -> `release_exit=0`
      ```json
      {"releasedLeaseId":"9ad12cd4-e6cb-4bf2-9102-bc45ebd6d856"}
      ```

---

## 3. Comandos Executados, Exit Codes Individuais e Seleção Focal de Testes

| Etapa | Comando Executado | Exit Code | Resultado / Escopo |
| :--- | :--- | :---: | :--- |
| **ESLint Focal** | `pnpm exec eslint tests/identity-audit.integration.test.ts tests/materials.integration.test.ts` | `0` | Zero erros ou warnings nos 2 arquivos alterados. |
| **Typecheck Raiz** | `pnpm exec tsc -p tsconfig.json --noEmit` | `0` | **Raiz 100% limpa** (`0` erros em todo o projeto e em todas as suítes `tests/**/*.ts`). |
| **Teste Focal 1 (SELEÇÃO via `-t`)** | `node --env-file=.env ./node_modules/vitest/vitest.mjs run tests/identity-audit.integration.test.ts -t "C7: read revalidates under IDENTITY_LOCK"` | `0` | **SELEÇÃO**: `1 passed | 17 skipped (18)` em `16.21s` (`C7` executado contra `orium_test` real). |
| **Teste Focal 2 (SELEÇÃO via `-t`)** | `node --env-file=.env ./node_modules/vitest/vitest.mjs run tests/materials.integration.test.ts -t "1.5: Sess"` | `0` | **SELEÇÃO**: `1 passed | 35 skipped (36)` em `10.77s` (caso `1.5` executado contra `orium_test` real). |

> **Nota explícita**: As duas execuções Vitest acima utilizaram filtro `-t` intencional (**SELEÇÃO** dos casos afetados pelas linhas corrigidas, e não reexecução integral das suítes `identity-audit` e `materials`). A suíte `tests/clients-authorization.integration.test.ts` (`9/9 passed`) não foi reexecutada pois não sofreu alteração.

---

## 4. Evidência Pós-Execução de Cleanup e Baseline (`orium_test`)

- `.local/phase6-identity-qa-cleanup.json` (gerado pelo `afterAll` de `identity-audit.integration.test.ts`):
  ```json
  {
    "prefix": "identity-audit-",
    "at": "2026-10-13T19:47:39.637Z",
    "collaboratorPermissionsRestored": true,
    "eventsDeleted": 5,
    "usersDeleted": 3,
    "remainingEvents": 0,
    "remainingSubjectsOfOwnEvents": 0,
    "remainingUsers": 0
  }
  ```
- Verificação read-only pós-execução (`.local/phase6/qa-readiness/check-readiness.mjs`):
  - `currentCounts`: `{"auth_user": 0, "client": 0, "identity_event": 394}`
  - `clientRolePermissions`: `["administrator:clients.archive", "administrator:clients.read", "administrator:clients.write"]`
  - Serviços DEV (`PID 11204` em `3002` e `PID 26472` em `5173`) permanecem intocados.
