# Relatório de Implementação do Backend — Fase 5: Linha do Tempo por Cliente

**Documento:** `docs/PHASE5-TIMELINE-RESULT.md`  
**Data:** 07/10/2026  
**Autor:** Antigravity (Backend Developer)  
**Status:** IMPLEMENTADO E VALIDADO NO GATE DE INTEGRAÇÃO (`orium_test`)  

---

## 1. Escopo e Objetivos da Entrega

Implementação do endpoint de agregação histórica e linha do tempo operacional `GET /api/v1/materials/client-timeline/:clientId` e dos schemas Zod estritos compartilhados em `@orium/contracts`, estritamente alinhados ao contrato fixado pelo Codex em `docs/PHASE5-CLIENT-TIMELINE-CONTRACT.md`.

Adicionalmente, atendimento ao ajuste pontual de determinação de concorrência no teste `12.2`, substituindo a verificação global por observação estrita de `pg_blocking_pids(pid)` vinculado ao `pg_backend_pid()` da conexão de reatribuição, com rollback garantido em bloco `finally`.

### Arquivos com Ownership da Entrega:
- `packages/contracts/src/index.ts` (acréscimos dos contratos e tipos da Linha do Tempo)
- `apps/api/src/materials.ts` (serviço `getClientTimeline` com união segura e revalidação de permissões)
- `apps/api/src/app.ts` (registro da rota autenticada antes de `/:id`)
- `tests/materials.integration.test.ts` (suíte completa com 36 testes de integração, cobrindo Gates 1..14)
- `docs/PHASE5-TIMELINE-RESULT.md` (este relatório técnico)

Nenhum arquivo de frontend (`apps/web/*`), rotinas da Fase 4 ou banco `orium_dev` foi alterado.

---

## 2. Contratos e Schemas Zod Compartilhados (`@orium/contracts`)

Foram exportados os seguintes schemas e tipos em `packages/contracts/src/index.ts`:

- **`timelineEventSourceSchema` / `TimelineEventSource`**:
  `z.enum(['demand', 'task', 'material'])`
- **`clientTimelineQuerySchema` / `ClientTimelineQuery`**:
  - `page`: inteiro positivo opcional, default 1 (`min(1).default(1)`)
  - `pageSize`: inteiro positivo opcional entre 1 e 50, default 20 (`min(1).max(50).default(20)`)
  - Validação estrita via `.strict()`
- **`clientTimelineClientSchema` / `ClientTimelineClient`**:
  - Projeção mínima do cliente: `{ id: uuid, name: string }`
- **`clientTimelineEventSchema` / `ClientTimelineEvent`**:
  - `id`: UUID do evento
  - `source`: `'demand' | 'task' | 'material'`
  - `sourceId`: UUID do objeto de origem (demanda, tarefa ou material)
  - `demandId`: UUID da demanda ou `null`
  - `taskId`: UUID da tarefa ou `null`
  - `materialId`: UUID do material ou `null`
  - `title`: título do objeto associado
  - `action`: identificador de ação (`demand_created`, `task_started`, `material_created`, etc.)
  - `actorName`: nome do usuário autor da ação
  - `createdAt`: string datetime ISO 8601 com offset (`z.string().datetime({ offset: true })`)
  - Validação estrita via `.strict()`
  - **Sanitização de segurança:** Exclusão intencional de metadata bruto, deltas `before`/`after`, comentários, preview URLs, contatos ou e-mails.
- **`clientTimelineResponseSchema` / `ClientTimelineResponse`**:
  - `{ client: ClientTimelineClient, events: ClientTimelineEvent[], total: number, page: number, pageSize: number }` com `.strict()`.

A publicação dos schemas foi notificada ao agente de frontend (`Antigravity QA`) via mensagem assíncrona.

---

## 3. Implementação do Serviço (`apps/api/src/materials.ts` e `apps/api/src/app.ts`)

1. **Ordem de Registro de Rotas (Fastify)**:
   - A rota `GET /api/v1/materials/client-timeline/:clientId` foi registrada **estritamente antes** de `GET /api/v1/materials/:id` em `apps/api/src/app.ts`, prevenindo que o parâmetro `/:id` capture a rota estática `client-timeline`.
2. **Revalidação Transacional Dupla de Permissões**:
   - Requer e revalida tanto `materials.read` quanto `demands.read` dentro do mesmo snapshot `REPEATABLE READ READ ONLY` no banco. Falta de qualquer uma resulta em `403 FORBIDDEN`.
3. **Validação de Cliente e Anti-IDOR**:
   - Rejeita com `404 NOT_FOUND` clientes inexistentes ou arquivados (`archived_at IS NOT NULL`).
   - Para colaboradores: verifica se o usuário possui ao menos uma tarefa atualmente atribuída em qualquer demanda deste cliente. Se não possuir, retorna `404 NOT_FOUND`, impedindo enumeração e vazamento de existência.
4. **União Segura e Filtragem por Atribuição**:
   - Consulta CTE `WITH timeline_events AS (...)` unindo:
     * Eventos de Demanda (`demand_event` onde `task_id IS NULL`): para colaborador, restrito a demandas onde possui tarefas atribuídas.
     * Eventos de Tarefa (`demand_event` onde `task_id IS NOT NULL`): restrito estritamente a tarefas onde `task.assigned_to_user_id = actor.id` atualmente (tarefas de terceiros no mesmo chamado são excluídas).
     * Eventos de Material (`material_event`): restrito a materiais da própria tarefa do colaborador ou materiais no nível do chamado onde ele atua. Materiais apenas de cliente e de tarefas de terceiros são estritamente excluídos.
5. **Ordenação e Paginação em Snapshot Único**:
   - Ordenação `ORDER BY created_at DESC, source ASC, id ASC`.
   - `total` e corte paginado (`LIMIT/OFFSET`) calculados sob a mesma transação consistente.

---

## 4. Refinamento de Concorrência Determinística (Teste 12.2)

- Identificação do PID do backend da conexão de reatribuição (`SELECT pg_backend_pid() AS pid`).
- Observação ativa via `pg_stat_activity` com filtro de escopo `datname = current_database() AND $1 = ANY(pg_blocking_pids(pid))`.
- Bloco `finally` com rollback explícito (`ROLLBACK`) em caso de falha de asserção antes de liberar a conexão ao pool.

---

## 5. Cobertura da Suíte de Integração (`tests/materials.integration.test.ts`)

A suíte foi executada contra o banco real de testes `orium_test` (porta 5433), totalizando **36 testes aprovados (100% PASS)**:

| Gate | Cenários Cobertos | Testes | Status |
| :--- | :--- | :--- | :--- |
| **Gate 1..3** | Autenticação, Revalidação de Banco, Forjamento de Sessão (1.5), Deativação e Revogação | 5 | **PASS** |
| **Gate 4** | CRUD Administrativo Completo e Auditoria Transacional | 7 | **PASS** |
| **Gate 5..6** | Regras de Negócio e Isolamento de Colaborador (Anti-IDOR) | 7 | **PASS** |
| **Gate 7** | Filtros, Targets e Paginação Real com >= 51 Alvos (7.3) | 3 | **PASS** |
| **Gate 8..9** | Vínculos Imutáveis e Validação Segura de URLs | 4 | **PASS** |
| **Gate 10..11**| Concorrência Otimista (409) e Integridade de Eventos | 1 | **PASS** |
| **Gate 12..13**| Reatribuição e Corrida Determinística com `pg_blocking_pids` (12.2) | 2 | **PASS** |
| **Gate 14** | **Linha do Tempo por Cliente (Client Timeline)** | 7 | **PASS** |
| | - 14.1: Rejeição 401 unauth e 404 inexistente/arquivado | | **PASS** |
| | - 14.2: Rejeição 403 se `materials.read` ou `demands.read` ausentes | | **PASS** |
| | - 14.3: Admin vê todas as 3 fontes (`demand`, `task`, `material`), contagem exata e sem metadata bruto | | **PASS** |
| | - 14.4: Paginação rejeita `pageSize > 50` (400) e pagina páginas disjuntas | | **PASS** |
| | - 14.5: Colaborador vê demandas/tarefas próprias, mas não tarefas de terceiros no mesmo chamado nem material client-only | | **PASS** |
| | - 14.6: Anti-IDOR: colaborador sem atribuição no cliente recebe 404 | | **PASS** |
| | - 14.7: Reatribuição revoga imediatamente visibilidade dos eventos da tarefa e de seus materiais | | **PASS** |

---

## 6. Resultado da Execução dos Testes

- **Comando executado:** `node --env-file=.env node_modules/vitest/vitest.mjs run tests/materials.integration.test.ts`
- **Ambiente:** Node.js v22.14.0, PostgreSQL 16 (`orium_test` na porta 5433)
- **Resultado:**
  - Test Files: **1 passed** (`tests/materials.integration.test.ts`)
  - Tests: **36 passed** (0 failed, 36 total, 0 skips)
  - Tempo de execução: ~13.2 segundos
  - Limpeza: Fixtures criadas com prefixos únicos devidamente removidas no teardown (`afterAll`), e integridade relacional de `role_permission` restaurada.

---

## 7. Salvaguardas Operacionais e Protocolo da Nota

1. **Preservação de Ambientes:**
   - O banco `orium_dev` (55432) e os serviços DEV ativos permaneceram intocados.
   - Nenhuma migration foi aplicada em DEV.
2. **Nota Compartilhada (`oriumsystem-acompanhamento`):**
   - Em conformidade com a notificação de restauração de backup pelo Codex, **nenhuma edição ou escrita foi executada na nota nesta rodada**.
   - As evidências completas e verificáveis estão documentadas neste relatório e no relatório anterior `docs/PHASE5-INTEGRATION-RESULT.md`.
