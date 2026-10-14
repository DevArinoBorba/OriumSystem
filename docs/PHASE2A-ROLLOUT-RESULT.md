# Relatório de Rollout e Ativação em Produção — Fase 2A (Clientes: Escopo Contratado, Equipe e Row-Level RBAC)

- **Data:** 2026-10-14
- **Coordenação e Execução:** `Antigravity #2` (com auditoria de segurança por `Sentinela`)
- **Ambientes:** Local DEV (`orium_dev` na porta `55432`) e VPS Produção (`orium_prod` em `/data/orium/production`)
- **Status:** **ROLLOUT CONCLUÍDO COM SUCESSO (100% OPERACIONAL)**

---

## 1. Release Pipeline Local (`deploy/operations/run-pipeline.mjs`)

O pipeline fail-closed de empacotamento oficial foi executado na raiz do monorepo, gerando o release canônico da Fase 2A:
- **Comando:** `node deploy/operations/run-pipeline.mjs production`
- **ID do Release:** `release-20261014165639-01e764f6467e`
- **Total de Arquivos:** 68 arquivos canônicos
- **Target Schema Version:** `0007_phase2a_clients_scope_team.sql`
- **Bundle Gerado:** `deploy/operations/releases/release-20261014165639-01e764f6467e/bundle.tar.gz` (308.249 bytes)
- **Gates:**
  - `MANIFEST_GENERATION`: **OK** (exit 0)
  - `PREFLIGHT`: **OK** (exit 0, integridade e ausência de segredos validadas)
  - `RELEASE`: **OK** (exit 0)
- **Resultado:** `pipeline PASS gates=3 failClosed=noFail` (exit 0)

---

## 2. Rollout na VPS de Produção (`orium-vps` — `/data/orium/production`)

### 2.1. Snapshot Preventivo de Produção
- **Arquivo na VPS:** `/var/lib/orium-backup/staging/orium_orium_prod_pre_phase2a.dump`
- **Permissões:** `-rw------- (600)` `root:root`
- **Tamanho:** 83.863 bytes
- **SHA-256:** `d741401969e88ce4e23bed5b094a421c525d40ada0c528dccd5ec4ccb3c4d498`
- **Integridade:** 215 TOC entries validadas via `pg_restore --list`.

### 2.2. Sincronização Cirúrgica de Código
- Arquivos sincronizados em `/data/orium/production/`:
  - `package.json`
  - `packages/contracts/package.json`
  - `packages/contracts/src/index.ts`
  - `db/migrations/0007_phase2a_clients_scope_team.sql`
  - `db/migrations/meta/_journal.json`
  - `apps/api/src/{schema.ts,migrate.ts,identity.ts,clients.ts,app.ts}`
- Line endings normalizados para LF (`sed -i 's/\r$//'`).
- Permissões aplicadas: `644` para arquivos de código; `.env` e `docker-compose.yaml` preservados intactos em `600` estrito.

### 2.3. Migração `0007_phase2a_clients_scope_team.sql` em `orium_prod`
- Migração aplicada sob `ON_ERROR_STOP=1`:
  - Tabela `client` evoluída com `contract_status`, `segment`, `account_manager_user_id`, `briefing_summary`, `brand_kit_url`, `drive_folder_url`, `active_channels` e `onboarding_completed_at`.
  - Tabelas `client_team_member` e `client_scope_item` criadas com constraints e 4 índices auxiliares.
  - 3 novas permissões (`clients.read.assigned`, `clients.manage`, `clients.team.manage`) inseridas no catálogo (total: 20 permissões) e vinculadas aos papéis canônicos.
  - 8 privilégios (`SELECT, INSERT, UPDATE, DELETE`) concedidos a `orium_app` sobre `client_team_member` e `client_scope_item`.
  - Registro canônico gravado em `drizzle.__drizzle_migrations` (`id = 8`, `hash = a1814b3e429cdb61bc3f4f2c208e40246a2e937577753c34198c38c6be46dfb9`, `created_at = 1791200007000`).

### 2.4. Rebuild dos Containers (`web` e `api`)
- **Comando executado:**
  ```bash
  cd /data/orium/production/deploy/production
  docker compose --project-name orium-production --env-file .env -f docker-compose.yaml up -d --build --no-deps web api
  ```
- **Resultado:**
  - Imagens `orium-production-web` e `orium-production-api` reconstruídas com sucesso.
  - `orium-production-postgres-1` preservado em execução contínua (`Up 6 hours, healthy`).
  - `orium-production-api-1` e `orium-production-web-1` recriados e ativos (`Up, healthy`).

### 2.5. Smoke Tests Pós-Deploy em Produção (`https://app.oriumdigital.tech`)

| Teste | Endpoint | HTTP Status | Resposta / Headers Validados |
| :--- | :--- | :---: | :--- |
| **Health Ready** | `GET /api/v1/ready` | **200 OK** | `{"status":"ready"}` com headers HSTS, CSP, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff` |
| **Auth Guard: Equipe do Cliente** | `GET /api/v1/clients/:id/team` | **401 Unauthorized** | `{"error":{"code":"UNAUTHENTICATED"}}` |
| **Auth Guard: Escopo do Cliente** | `GET /api/v1/clients/:id/scope` | **401 Unauthorized** | `{"error":{"code":"UNAUTHENTICATED"}}` |
