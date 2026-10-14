# Relatório de Rollout e Ativação Supervisionada — Fase 11 (Refinamento)

- **Data:** 2026-10-14
- **Coordenação:** `Antigravity #2` (Maestro / Orquestrador)
- **Executor Operacional VPS:** `Antigravity`
- **Ambientes:** Local DEV (`orium_dev` na porta `55432`) e VPS Produção (`orium_prod` em `/data/orium/production`)
- **Status:** **ROLLOUT CONCLUÍDO COM SUCESSO (100% OPERACIONAL)**

---

## 1. Release Pipeline Local (`deploy/operations/run-pipeline.mjs`)

O pipeline fail-closed de empacotamento oficial foi executado na raiz do monorepo, gerando o release canônico da Fase 11:
- **Comando:** `node deploy/operations/run-pipeline.mjs production`
- **ID do Release:** `release-20261014152334-c8746b3a893b`
- **Total de Arquivos:** 64 arquivos canônicos
- **Target Schema Version:** `0006_refinement_templates_reports.sql`
- **Bundle Gerado:** `deploy/operations/releases/release-20261014152334-c8746b3a893b/bundle.tar.gz` (172.618 bytes)
- **Gates:**
  - `MANIFEST_GENERATION`: **OK** (exit 0)
  - `PREFLIGHT`: **OK** (exit 0, integridade e ausência de segredos validadas)
  - `RELEASE`: **OK** (exit 0)
- **Resultado:** `pipeline PASS gates=3 failClosed=noFail` (exit 0)

---

## 2. Ativação no Ambiente DEV Local (`orium_dev` na porta `55432`)

1. **Backup Preventivo Real:**
   - **Arquivo:** `.local/phase11/backups/orium_dev_pre_phase11.dump`
   - **Tamanho:** 66.684 bytes
   - **SHA-256:** `2F3577B4F695FA83A6B95B0E022C129AF18C0C4C2C519E5146F091A17725B453`
   - **Integridade:** 174 TOC entries validadas com sucesso via `pg_restore --list`.
2. **Aplicação da Migração `0006`:**
   - **Comando:** `pnpm db:migrate`
   - **Status:** Migrações aplicadas com sucesso sob `IDENTITY_LOCK`.
3. **Verificações de Banco (`orium_dev`):**
   - 4 tabelas de templates criadas (`demand_template`, `demand_template_task`, `demand_template_task_dependency`, `demand_template_task_requirement`).
   - 6 índices de performance criados nas tabelas principais:
     - `demand_status_created_at_idx`
     - `demand_client_status_delivery_idx`
     - `task_assigned_status_delivery_idx`
     - `task_assigned_demand_idx`
     - `task_active_status_idx`
     - `demand_event_demand_created_idx`
   - 16 privilégios concedidos a `orium_app`.
   - Dados pré-existentes preservados intactos (2 contas de usuário administradoras).
4. **Smoke Test Local:**
   - `http://localhost:3002/api/v1/ready` -> `200` (`status: "ready"`)
   - `http://localhost:3002/health/ready` -> `200` (`status: "ok"`)

---

## 3. Rollout na VPS de Produção (`orium-vps` — `/data/orium/production`)

### 3.1. Snapshot Preventivo de Produção
- **Arquivo na VPS:** `/var/lib/orium-backup/staging/orium_orium_prod_pre_phase11.dump`
- **Permissões:** `-rw------- (600)` `root:root`
- **Tamanho:** 68.864 bytes
- **SHA-256:** `dfa383f60ca64f8cb34b766e5bcff5d098a33b6a8b30c1f85b1e4e3676b6d8d8`
- **Integridade:** 174 TOC entries validadas via `pg_restore --list`.

### 3.2. Sincronização de Código
- Arquivos sincronizados em `/data/orium/production/`:
  - `packages/contracts/src/index.ts`
  - `db/migrations/0006_refinement_templates_reports.sql`
  - `db/migrations/meta/_journal.json`
  - `apps/api/src/{schema.ts,migrate.ts,templates.ts,reports.ts,app.ts,config.ts}`
  - `apps/web/src/{types.ts,api.ts,App.tsx,styles.css}`
  - `apps/web/src/components/{Header.tsx,DemandsView.tsx,ReportsView.tsx,UseTemplateModal.tsx,ManageTemplatesModal.tsx}`
- Line endings convertidos estritamente para LF (`sed -i 's/\r$//'`).
- Permissões aplicadas: `644` para arquivos de código; `.env` e `docker-compose.yaml` preservados em `600` estrito.

### 3.3. Migração `0006` em `orium_prod`
- Migração executada sob transação segura e advisory lock `712040`:
  - 6 índices de performance criados nas tabelas operacionais.
  - 4 tabelas de templates de demandas criadas (`demand_template*`).
  - 5 índices auxiliares de templates criados.
  - Grants de `SELECT, INSERT, UPDATE, DELETE` concedidos para `orium_app`.
  - Registro canônico gravado em `drizzle.__drizzle_migrations` (id 7, hash `a5e6457291fd66e197d2bbc7021a4c845dcd7c2976e06aa1ae3d399d89a35db7`, timestamp `1791200006000`).
  - Integridade confirmada: 2 usuários administradores e 2 demandas ativas preservadas.

### 3.4. Rebuild dos Containers (`web` e `api`)
- **Comando executado:**
  ```bash
  cd /data/orium/production/deploy/production
  docker compose --project-name orium-production --env-file .env -f docker-compose.yaml up -d --build --no-deps web api
  ```
- **Resultado:**
  - Build das imagens `orium-production-web` e `orium-production-api` concluído com sucesso.
  - Bundles Vite minificados gerados (`index-DMexuNxU.js` e `index-DFHWpJvk.css`).
  - `orium-production-postgres-1` não foi reiniciado (uptime preservado).
  - Containers recriados e iniciados em estado saudável (`Up, healthy`).

### 3.5. Smoke Tests Pós-Deploy em Produção (`https://app.oriumdigital.tech`)

| Teste | Endpoint | HTTP Status | Resposta / Headers Validados |
|---|---|---|---|
| **Health Ready** | `GET /api/v1/ready` | **200 OK** | `{"status":"ready"}` (latência 3.49ms) |
| **Root Web & Headers** | `GET /` | **200 OK** | HTML servido com novos bundles (`index-DMexuNxU.js`). 5 security headers ativos: `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store`. |
| **Auth Guard: Templates** | `GET /api/v1/demand-templates` | **401 Unauthorized** | `{"error":{"code":"UNAUTHENTICATED"}}` com CSP estrito e sem vazamento de dados |
| **Auth Guard: Produtividade** | `GET /api/v1/reports/productivity` | **401 Unauthorized** | `{"error":{"code":"UNAUTHENTICATED"}}` |
| **Auth Guard: Gargalos** | `GET /api/v1/reports/bottlenecks` | **401 Unauthorized** | `{"error":{"code":"UNAUTHENTICATED"}}` |

---

## 4. Preservação de Ambientes e Segurança

1. **Proteção de Segredos:** Zero senhas, chaves privadas ou tokens expostos em terminais, logs ou documentação.
2. **Isolamento de Processos:** Nenhum serviço externo ou processo de outro projeto na máquina ou na VPS foi interrompido.
3. **Resiliência:** Backups pré-migração íntegros e verificados tanto em DEV (`.local/phase11/backups/`) quanto na VPS (`/var/lib/orium-backup/staging/`).

---

## 5. Semeio dos Templates Canônicos da Agência (`demand_template`)

Em cumprimento à diretriz da coordenação, foram inseridos de forma transacional e idempotente (`.local/phase11/seed-canonical-templates.sql`) os 3 templates operacionais canônicos da Orium, disponíveis imediatamente no botão `"Usar template"` tanto em `orium_dev` quanto em `orium_prod`:

1. **Criação de Landing Page (`category: 'web'`, `default_priority: 'high'`, `estimated_days: 10`):**
   - **Tarefa 1:** `Wireframe e Copywriting da Página` (offset 0d, duração 3d, prioridade alta, papel colaborador) — Requisito obrigatório: `Briefing e oferta validados com o cliente`.
   - **Tarefa 2:** `Design UI no Figma (Desktop e Mobile)` (offset 3d, duração 4d, prioridade alta, papel colaborador) — Depende da Tarefa 1; Requisito obrigatório: `Identidade visual e ativos da marca anexados`.
   - **Tarefa 3:** `Implementação, Publicação e Revisão Final` (offset 7d, duração 3d, prioridade urgente, papel colaborador) — Depende da Tarefa 2; Requisito obrigatório: `Domínio e DNS configurados`.

2. **Identidade Visual Completa (`category: 'design'`, `default_priority: 'normal'`, `estimated_days: 12`):**
   - **Tarefa 1:** `Pesquisa de Referências e Moodboard` (offset 0d, duração 3d, prioridade normal, papel colaborador) — Requisito obrigatório: `Questionário de posicionamento preenchido`.
   - **Tarefa 2:** `Criação de Logotipo e Paleta Tipográfica/Cromática` (offset 3d, duração 5d, prioridade alta, papel colaborador) — Depende da Tarefa 1.
   - **Tarefa 3:** `Manual da Marca e Fechamento de Arquivos` (offset 8d, duração 4d, prioridade normal, papel colaborador) — Depende da Tarefa 2.

3. **Produção de Vídeo / Reels Institucional (`category: 'video'`, `default_priority: 'normal'`, `estimated_days: 7`):**
   - **Tarefa 1:** `Roteiro e Decupagem de Cenas` (offset 0d, duração 2d, prioridade normal, papel colaborador) — Requisito obrigatório: `Brutos de vídeo e locução disponíveis no Drive`.
   - **Tarefa 2:** `Edição, Motion Graphics e Color Grading` (offset 2d, duração 3d, prioridade alta, papel colaborador) — Depende da Tarefa 1.
   - **Tarefa 3:** `Finalização e Exportação Multiformato` (offset 5d, duração 2d, prioridade normal, papel colaborador) — Depende da Tarefa 2.

**Total cadastrado:** 3 templates, 9 tarefas encadeadas, 5 requisitos obrigatórios e 6 dependências direcionadas validadas em `orium_dev` e `orium_prod`.

---

## 6. Consolidação Final do Estado da VPS (`orium-vps`)

- **Containers de Produção:**
  - `orium-production-web-1`: `Up (8080/tcp, 80/tcp)`
  - `orium-production-api-1`: `Up (healthy, 3001/tcp)`
  - `orium-production-postgres-1`: `Up 4+ hours (healthy, 5432/tcp)` — uptime ininterrupto preservado.
- **Permissões do Sistema de Arquivos em `/data/orium/production/`:**
  - Arquivos de segredos/compose: `-rw------- (600)` `root:root` (`.env` e `docker-compose.yaml`).
  - Código fonte, contratos, migrações e assets: `-rw-r--r-- (644)` `root:root`.
  - Diretórios: `drwxr-xr-x (755)` `root:root`.
- **Rotina de Backup Automatizado:**
  - `systemctl status orium-backup.timer`: `active (waiting)` configurado para execução diária às `03:00 America/Cuiaba` (`07:00 UTC`).
  - `freshness.sh check`: **`freshness: ok`** (verificação de snapshot com integridade validada).

