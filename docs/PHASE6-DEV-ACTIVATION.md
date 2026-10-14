# Fase 6 — ativação DEV do incremento 2

08/10/2026. Ativação autorizada após gate TEST do incremento de auditoria de identidade.

## Evidências

- Snapshot antes: migration 0003, 2 usuários ativos, 2 administradores, 2 credenciais; clientes/demandas/tasks/eventos/materiais vazios.
- Backup: `.local/phase5-dev/orium_dev-before-0003-2026-10-08T15-45-14-256Z.dump`, 50.822 bytes.
- `pnpm build:foundation` → contracts/API build OK.
- Migration oficial → `migrate: OK`; snapshot posterior migration 0004 presente (5 migrations totais).
- Tabelas `identity_event`/`identity_event_subject` presentes; papel `orium_app` tem apenas SELECT/INSERT; função de limpeza concedida separadamente.
- Processo API iniciado com caminho absoluto do projeto, PID 11204, listener 127.0.0.1:3002.
- Verificação independente posterior: PID 11204 persistente, caminho do projeto confirmado, `/health/ready` 200, proxy WEB5173 `/api/v1/identity-events` anônimo 401.
- Snapshot posterior: 2 usuários ativos, 2 administradores, 2 credenciais; client/demand/task/events/material = 0, permissões de materiais preservadas.

## Limites

Não houve reset, fixture, frontend build, browser/E2E, integração Bitwarden ou mudança de dados de negócio. A API DEV depende da persistência do servidor de agentes; restart futuro deve repetir a verificação de processo e portas. Retenção contínua e backups permanecem Fase10.
