# Fase 6 — incremento 2: auditoria de identidade (RESULTADO implementação)

Contrato: `docs/PHASE6-IDENTITY-IMPLEMENTATION-CONTRACT.md` (08/10/2026).
Autores dos arquivos: Antigravity (parcial herdado) e OpenCode (transferência explícita — finalização, correções e verificação). Sem aceite/migration DEV concedido; sem frontend/MFA/cofre.

## O que foi herdado (Antigravity, não executado por mim)
- `db/migrations/0004_identity_audit.sql` + `meta/_journal.json` (idx 4).
- `apps/api/src/schema.ts`: tabelas drizzle `identity_event` / `identity_event_subject` (app-only SELECT/INSERT + rotina).
- `packages/contracts/src/index.ts`: `identityEventActionSchema`, `identityEventSchema`, `identityEventsQuerySchema`, `identityEventsResponseSchema` + tipos (projeção pública mínima).
- `apps/api/src/identity-audit.ts`: `recordIdentityEvent`, `normalizePermissions`, `listIdentityEvents` (projeção, keyset, revalidação sob lock).
- `apps/api/src/identity.ts`: conversão de `provisionUser`/`changeIdentity`/`changeRolePermissions` para transações com `IDENTITY_LOCK` + chamadas a `recordIdentityEvent`.
- `tests/identity-audit.integration.test.ts` (QA): 18 testes C1–C7 (não executado antes da transferência).

## O que eu (OpenCode) finalizei e verifiquei
- `identity.ts`: adicionado import `recordIdentityEvent, normalizePermissions` de `./identity-audit.js`; removido `sleep`/`sql` ocioso de drizzle (equivalente UUID/insert via pool mantido).
- `recovery.ts`: instrumentado com `recordIdentityEvent` (`password_recovered`, actor/target/revokedCount, sem dados de senha) dentro da transação sob `IDENTITY_LOCK`, antes do COMMIT.
- `app.ts`: ligado `GET /api/v1/identity-events` (autentica e delega a `listIdentityEvents`, que roda a revalidação sob `IDENTITY_LOCK`).
- `identity-audit.ts`: **correção obrigatória do cursor** — `Date.parse` normaliza datas impossíveis do calendário (ex. 2026-02-30); implementado `isRealCalendarDateTime` com validação de round-trip de componentes (ano/mês/dia/hora/min/seg) → data impossível agora vira 400 `INVALID_INPUT`.
- `0004_identity_audit.sql`: substituídas FKs de `identity_event` → `role(id)` por `CHECK identity_event_roles_exist_check` sobre os papéis existentes — alinha ao teste fixado (FKs limitadas a `subject→event` cascade; IDs históricos sem FK que bloqueie evidência). `orium_test` real alinhado via helper `.local/phase6-identity-align-schema.mjs` (TEST only).
- `tests/identity-audit.integration.test.ts`: ajuste mecânico no C1 — INSERT com `id` válido para exercitar a constraint de ação (23514) em vez do not-null (23502); assertion preservada.

## Verificações reais executadas
- `pnpm --filter @orium/contracts build` → OK.
- `pnpm --filter @orium/api typecheck` → 0 erros (2x).
- `pnpm --filter @orium/web typecheck` → 0 erros.
- `pnpm --filter @orium/api build` → OK.
- ESLint focal (`identity.ts`, `identity-audit.ts`, `recovery.ts`, `app.ts`, `identity-audit.integration.test.ts`) → 0 problemas.
- Suítes (real PostgreSQL, serial, `--env-file=.env`):
  - `identity-audit.integration.test.ts`: **18/18 PASS**.
  - `auth.integration.test.ts` + `recovery.integration.test.ts` + `rbac.test.ts`: **82/82 PASS** (junto: 100/100 nas 4).
  - `clients`+`demands`+`dashboard`+`materials.integration.test.ts`: **122/122 PASS** (nenhuma regressão com novos eventos).
- Container/db provado: `orium_local-postgres-test-1` 127.0.0.1:5433 `orium_test` (paper `orium_app`). DEV (`orium_local-postgres-1` 55432) intacto. Nenhum serviço/porta iniciado além do necessário; PORT_POLICY respeitada (porta fixa de testes verificada no bind).
- Cleanup: `.local/phase6-identity-qa-cleanup.json` — 61 eventos removidos, 33 usuários, 0 órfãos, permissões collaborator restauradas; apenas fixtures da própria execução.

## Limites honestos
- Sem suíte de retenção física além dos testes C6; sem agendamento contínuo (Fase10).
- Sem portal/UI/browser (incremento sem UI; não declaro homologação UI).
- Bootstrap CLI direto fora deste incremento (documentado no contrato).
- Recibo/CLI de recovery não é prova de auditoria (contrato).

## Pendências p/ aceite Codex
- Revisão final do diff/código/evidências por Codex; DEV só em gate posterior com backup e PORT_POLICY.
- MFA, cofre, auditoria de login e proteção de textos livres: escopo próprio futuro.
