# Infraestrutura local — status

Data: 2026-10-05. Registro da decisão de remanejamento de portas para convivência entre projetos, conforme política global de portas e coordenação.

## Motivo

Outro projeto utiliza a porta `5432` (PostgreSQL próprio, `Gordinho Locacoes/.local/postgres-data`). Para não encerrar serviços de outro projeto, o PostgreSQL de **desenvolvimento** do OriumSystem foi remanejado para `55432`, mantendo testes em `5433`.

## Decisão aplicada

- **Dev:** bind `127.0.0.1:55432 → 5432` (interno), controlado por `POSTGRES_PORT` no Compose, com fallback `55432`.
- **Teste:** mantido `127.0.0.1:5433 → 5432` (inalterado).
- **API:** `127.0.0.1:3001` (registrada com reserva temporária conforme política).
- **Web (Vite):** `127.0.0.1:5173`, serviço ativo do próprio projeto (não realocada).
- Portas internas dos containers permanecem fixas em `5432`.

## Arquivos tocados

| Arquivo | Mudança |
|---|---|
| `compose.yaml` | porta publicada do serviço `postgres` usa `127.0.0.1:${POSTGRES_PORT:-55432}:5432`; teste permanece `5433` |
| `.env.example` | adicionado `POSTGRES_PORT=55432`; `DATABASE_URL` e `MIGRATION_DATABASE_URL` dev atualizadas para `55432` |
| `.env` (local, ignorado) | `POSTGRES_PORT=55432` adicionado; `DATABASE_URL` e `MIGRATION_DATABASE_URL` dev atualizadas via `URL.port` — credenciais e demais valores preservados; backup em `.local/.env.backup-*` |
| `README.md` | portas de referência atualizadas (`55432` dev, `5433` teste) e nota sobre `POSTGRES_PORT` |

Nenhum segredo foi impresso, persistido ou enviado; credenciais do `.env` preservadas integralmente.

## Estado verificado (read-only)

- `docker compose ps`: `orium-local-postgres-1` (dev) e `orium-local-postgres-test-1` (teste) **up healthy**.
- Banco test: migrations presentes (`public.auth_user` etc.), usuários `0` (antes da execução de migrations/testes do Antigravity).
- API e Vite: API de teste **não iniciada** ainda, aguardando conclusão das migrations/testes de Fase 2; Vite ativo em `5173`.

## Próximos passos

- Aguardar conclusão de migrations/testes de Fase 2 (Antigravity) antes do login fixture/portal.
- Migrations **não** serão aplicadas por este agente (exceto mediante coordenação).
- Ao iniciar a API de demonstração, usar `DATABASE_URL` apontando para `TEST_DATABASE_URL` (`orium_test`), porta `3001`, com reserva vigente.
