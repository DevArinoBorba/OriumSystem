# Fase 7 — Incremento 2: Resultado da Implementação da Fundação de Persistência e API da Central Pessoal

- **Data:** 2026-10-13
- **Responsável:** Antigravity
- **Coordenação:** Codex #2 (`docs/PHASE7-INCREMENT2-CONTRACT.md` e `docs/PHASE7-NOTIFICATIONS-CONTRACT.md`)
- **Escopo e Ownership Exclusivo:**
  - Código novo: [`apps/api/src/notifications.ts`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/apps/api/src/notifications.ts)
  - Código alterado:
    - [`apps/api/src/identity.ts`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/apps/api/src/identity.ts) (sessão interna confiável `authenticateInternal` + delegação transparente de `authenticate`)
    - [`apps/api/src/app.ts`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/apps/api/src/app.ts) (montagem de `GET /api/v1/notifications` e `POST /api/v1/notifications/:id/read`)
    - [`apps/api/src/schema.ts`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/apps/api/src/schema.ts) (exportação de `notification`)
    - [`apps/api/src/migrate.ts`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/apps/api/src/migrate.ts) (permissões restritas da tabela `notification` ao papel `orium_app`)
    - [`db/migrations/0005_notifications.sql`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/db/migrations/0005_notifications.sql) (migração real)
    - [`db/migrations/meta/_journal.json`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/db/migrations/meta/_journal.json) (registro da entrada 5)
  - Helper exclusivo: `.local/phase7/increment2/backend/verify-backend.mjs`
  - Relatório oficial: [`docs/PHASE7-INCREMENT2-RESULT.md`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/docs/PHASE7-INCREMENT2-RESULT.md)
  - Arquivos READONLY preservados: `apps/api/src/demands.ts`, contratos (`packages/contracts/`), frontend (`apps/web/`) e suíte de testes (`tests/notifications.integration.test.ts`, de ownership exclusivo do OpenCode).

---

## 1. Schema, Restrições e Privilégios no Banco de Dados

### 1.1 Tabela `notification` e Integridade Relacional
A migração [`0005_notifications.sql`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/db/migrations/0005_notifications.sql) define a estrutura de persistência real da central de notificações:
- **Chave primária:** `id uuid PRIMARY KEY`.
- **Chaves estrangeiras com cascata cirúrgica:**
  - `recipient_user_id text NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE`
  - `demand_id uuid NOT NULL REFERENCES demand(id) ON DELETE CASCADE`
  - `task_id uuid REFERENCES task(id) ON DELETE CASCADE`
  - `source_event_id uuid REFERENCES demand_event(id) ON DELETE CASCADE`
  - *Garante cleanup automático e completo quando fixtures de teste ou usuários forem excluídos.*
- **Colunas temporais e de origem:**
  - `source_delivery_date date` (utilizada exclusivamente por kinds de calendário)
  - `created_at timestamptz NOT NULL`
  - `read_at timestamptz` (inicialmente NULL; carimbado quando lida)

### 1.2 Restrições (CHECK Constraints)
1. **`notification_kind_check`:** restringe `kind` estritamente aos 12 tipos públicos do contrato (`task_assigned`, `task_unblocked`, `task_comment`, `task_review_submitted`, `task_changes_requested`, `task_approved`, `task_important_change`, `demand_important_change`, `task_due_today`, `task_due_soon`, `task_overdue`, `demand_overdue`).
2. **`notification_single_source_check`:** exige exatamente uma origem (`source_event_id XOR source_delivery_date`).
3. **`notification_kind_source_check`:** kinds de calendário exigem `source_delivery_date IS NOT NULL`; demais kinds exigem `source_event_id IS NOT NULL`.
4. **`notification_kind_task_check`:** kinds `task_*` exigem `task_id IS NOT NULL`; kinds `demand_*` exigem `task_id IS NULL`.

### 1.3 Deduplicação e Índices Parciais
- `notification_event_dedup_idx`: `UNIQUE (recipient_user_id, kind, source_event_id) WHERE source_event_id IS NOT NULL`.
- `notification_calendar_task_dedup_idx`: `UNIQUE (recipient_user_id, kind, demand_id, task_id, source_delivery_date) WHERE source_delivery_date IS NOT NULL AND task_id IS NOT NULL`.
- `notification_calendar_demand_dedup_idx`: `UNIQUE (recipient_user_id, kind, demand_id, source_delivery_date) WHERE source_delivery_date IS NOT NULL AND task_id IS NULL`.
- `notification_recipient_created_at_idx`: `(recipient_user_id, created_at DESC, id DESC)` para ordenação eficiente da consulta pessoal.
- `notification_recipient_unread_idx`: `(recipient_user_id) WHERE read_at IS NULL` para cômputo rápido de `unreadCount`.
- Índices de FK em `demand_id`, `task_id` e `source_event_id`.

### 1.4 Privilégios Mínimos para `orium_app` em [`apps/api/src/migrate.ts`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/apps/api/src/migrate.ts)
A tabela `notification` foi mantida fora do `GRANT` amplo:
```sql
REVOKE ALL ON notification FROM "orium_app";
GRANT SELECT, INSERT ON notification TO "orium_app";
GRANT UPDATE (read_at) ON notification TO "orium_app";
```
- A aplicação possui permissão estritamente para `SELECT`, `INSERT` e `UPDATE` **apenas da coluna `read_at`**.
- Tentativas de `DELETE`, `TRUNCATE` ou `UPDATE` em colunas imutáveis (`kind`, `demand_id`, etc.) são rejeitadas pelo PostgreSQL com erro `42501 (insufficient_privilege)`, comprovado pelo verificador.

---

## 2. Sessão Privada e Ordem de Locks

### 2.1 Refatoração em [`apps/api/src/identity.ts`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/apps/api/src/identity.ts)
- Adicionado o helper interno `authenticateInternal(database, auth, headers)` que retorna `{ sessionId, identity }`.
- O helper público existente `authenticate` mantém rigorosamente a assinatura e delega a `authenticateInternal`, preservando total compatibilidade com todas as demais rotas.
- O `sessionId` nunca é aceito do cliente nem impresso em logs/respostas; é derivado exclusivamente do Better Auth via cookie verificado.

### 2.2 Serialização e Revalidação Transacional
Em ambas as rotas (`GET /api/v1/notifications` e `POST /api/v1/notifications/:id/read`), a execução segue a ordem estrita no mesmo `PoolClient`:
1. `BEGIN READ COMMITTED`
2. `SELECT pg_advisory_xact_lock(IDENTITY_LOCK)` (`712041`)
3. `SELECT s.id FROM auth_session s WHERE s.id = $1 FOR SHARE OF s`
   - O lock `FOR SHARE` na linha da sessão serializa perfeitamente com operações concorrentes de `sign-out` ou demotion/desativação (que executam `DELETE FROM auth_session WHERE user_id = $1`).
4. Revalidação de sessão, usuário ativo e limites temporais em comando subsequente no mesmo client após a aquisição do lock:
   - Executado após a espera do lock na linha da sessão terminar, garantindo que `clock_timestamp()` seja avaliado após a espera.
   - Verifica: `active = true`, `expires_at > clock_timestamp()`, `created_at > clock_timestamp() - interval '7 days'` (limite absoluto negando igualdade: `now - created_at >= 7 days` rejeitado) e `last_seen_at > clock_timestamp() - interval '12 hours'` (inatividade negando igualdade: `now - last_seen_at >= 12 hours` rejeitado), em total conformidade com `authenticate`.
   - Se inválida ou ausente, dispara `AppError(401, 'UNAUTHENTICATED')`.
5. Revalidação de papéis e permissões in-tx:
   - Exige concomitantemente `demands.read` **E** `tasks.read` (403 se faltar qualquer uma).

---

## 3. Consulta, Projeção e Leitura Pessoal

### 3.1 Autorização por Recurso Atual e Caixa Pessoal
- **Caixa estritamente pessoal:** `n.recipient_user_id = actor.id` para todos os usuários, incluindo administradores.
- **Administrador:** visualiza avisos vinculados a demandas e tarefas existentes (`t.demand_id = n.demand_id`).
- **Colaborador:**
  - Aviso de tarefa (`task_id IS NOT NULL`): exige que a tarefa esteja atualmente atribuída ao colaborador (`t.assigned_to_user_id = actor.id`).
  - Aviso de demanda (`task_id IS NULL`): exige que o colaborador possua ao menos uma tarefa atualmente atribuída a ele no chamado (`EXISTS (SELECT 1 FROM task at_sub WHERE at_sub.demand_id = n.demand_id AND at_sub.assigned_to_user_id = actor.id)`).
- **Tratamento de avisos temporais na fundação:** Conforme alternativa autorizada no contrato (`docs/PHASE7-INCREMENT2-CONTRACT.md`) e ratificada na revisão independente, os quatro kinds temporais de calendário (`task_due_today`, `task_due_soon`, `task_overdue`, `demand_overdue`) são explicitamente excluídos em listagem, `total`, `unreadCount` e `POST /read` (`404 NOT_FOUND`) nesta fundação. A comparação isolada de `source_delivery_date` com o prazo atual não implementa o predicado temporal completo (hoje, +3 dias, status de início/pausa/conclusão); a materialização e filtros temporais completos serão implementados no incremento de geração de avisos, mantendo o schema e constraints/dedup prontos no banco.
- **Segurança de existência:** Qualquer aviso inexistente, alheio, temporal ou inacessível retorna `404 NOT_FOUND` sem revelar metadados.
- **Projeção:** Apenas títulos e prazos dos recursos atuais (`d.title`, `t.title`, `delivery_date`); campos de auditoria, eventos de origem, metadados ou comentários nunca são retornados.

### 3.2 Listagem (`GET /api/v1/notifications`)
- `unreadCount`: computa todos os avisos visíveis não lidos (`read_at IS NULL`) do usuário, independente de paginação ou filtro.
- `total`: computa o total de avisos visíveis respeitando o filtro `unreadOnly`.
- `updatedAt`: reflete o timestamp real da consulta formatado ISO com offset.
- `page` / `pageSize`: paginação com `LIMIT` e `OFFSET`.

### 3.3 Marcação de Leitura (`POST /api/v1/notifications/:id/read`)
- Valida corpo estrito `{}` diretamente sobre `request.body` sem fallback de default (rejeita ausência/undefined, null, array ou propriedades adicionais com 400).
- Bloqueia exclusivamente a linha do aviso via `FOR UPDATE OF n` sob a mesma expressão de autorização.
- Executa `UPDATE notification SET read_at = COALESCE(read_at, clock_timestamp()) WHERE id = $1 RETURNING read_at`.
- Preserva o primeiro `read_at` em chamadas repetidas ou concorrentes (idempotência).

---

## 4. Evidências de Execução e Verificação

### 4.1 Verificações Estáticas
- **Focal ESLint:**
  `pnpm exec eslint apps/api/src/notifications.ts apps/api/src/identity.ts apps/api/src/app.ts apps/api/src/schema.ts apps/api/src/migrate.ts` → **Exit 0**
- **API Typecheck:**
  `pnpm --filter @orium/api typecheck` → **Exit 0**
- **Root Typecheck:**
  `pnpm exec tsc -p tsconfig.json --noEmit` → **Exit 0**
- **Build da API:**
  `pnpm --filter @orium/api build` → **Exit 0**

### 4.2 Script de Verificação de Schema e Privilégios (`verify-backend.mjs`)
Executado contra `orium_test` (porta 5433):
```text
1. Applying migrations to orium_test...
Migration applied successfully.
2. Inspecting table notification columns and constraints...
Columns: [
  'id (uuid, nullable: NO)',
  'recipient_user_id (text, nullable: NO)',
  'demand_id (uuid, nullable: NO)',
  'task_id (uuid, nullable: YES)',
  'kind (text, nullable: NO)',
  'source_event_id (uuid, nullable: YES)',
  'source_delivery_date (date, nullable: YES)',
  'created_at (timestamp with time zone, nullable: NO)',
  'read_at (timestamp with time zone, nullable: YES)'
]
Indexes: [
  'notification_calendar_demand_dedup_idx',
  'notification_calendar_task_dedup_idx',
  'notification_demand_id_idx',
  'notification_event_dedup_idx',
  'notification_pkey',
  'notification_recipient_created_at_idx',
  'notification_recipient_unread_idx',
  'notification_source_event_id_idx',
  'notification_task_id_idx'
]
3. Testing orium_app permissions...
SELECT works, count: 0
DELETE by orium_app denied (42501): true
UPDATE(kind) by orium_app denied (42501): true
UPDATE(read_at) by orium_app allowed: true
All backend checks PASSED!
```

### 4.3 Suítes de Regressão Sequenciais em PostgreSQL Real (`orium_test`)
1. **Autenticação e Identidade (`tests/auth.integration.test.ts`):**
   `17 passed (17)` — 5.61s
2. **Autorização Transacional de Demandas (`tests/demands-authorization.integration.test.ts`):**
   `4 passed (4)` — 7.71s
3. **Regressão de Demandas (`tests/demands.integration.test.ts`):**
   `52 passed (52)` — 5.40s
- **Total:** **73/73 testes verdes**.
- **Baseline de Grants:** Exatamente **23 grants** preservados (`role_permission`).
- **Ambiente DEV:** Intacto, sem restarts, migrations ou builds.

---

## 5. Checkpoint e Próximos Passos
A fundação de persistência e API pessoal do Incremento 2 está concluída e disponível para integração. A suíte de testes E2E do Incremento 2 (`tests/notifications.integration.test.ts`) está sob ownership do OpenCode; este relatório estabelece o checkpoint estável para que o OpenCode execute e comprove a validação completa de testes sem risco de concorrência.
