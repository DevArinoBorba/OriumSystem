# Relatório de Implementação do Backend — Fase 3: Demandas e Tarefas

**Data:** 2026-10-06  
**Responsável Técnico:** Antigravity (Backend & Contratos)  
**Coordenação:** Codex  
**Status:** CONCLUÍDO (Pronto para suíte de testes de integração do QA em `orium_test`)

---

## 1. Visão Geral e Alinhamento Arquitetural

A implementação do backend da Fase 3 foi realizada com rigorosa conformidade aos contratos e decisões aprovadas:
- **`docs/PHASE3-IMPLEMENTATION-CONTRACT.md`:** Prevalência normativa sobre nomes de campos, rotas REST, formatos de resposta e códigos HTTP.
- **ADR-0005 (Aceite vs. Início de Tarefas):** Separação estrita entre aceitação da tarefa (`accepted_at`) e início efetivo da execução (`started_at`), com validação de prontidão (`evaluateTaskReadiness`).
- **ADR-0006 (Grafo de Tarefas e Resolução de Dependências):** Grafo direcionado acíclico (DAG) por demanda, verificação de aciclicidade via DFS e propagação automática de desbloqueio para tarefas dependentes.
- **Decisão do Responsável (Pausas):** Solicitação de pausa pelo responsável com motivo; aprovação formal administrativa (Monique/admin) informando motivo e **nova data de entrega explícita** (`YYYY-MM-DD`); retomada calculando a duração real e registrando metadados completos no histórico auditável.

---

## 2. Contratos Compartilhados (`packages/contracts/src/index.ts`)

O pacote `@orium/contracts` foi enriquecido e construído com tipagem forte e validações Zod estritas:

1. **Modelos e Entidades do Domínio:**
   - Enums: `DemandPriority`, `DemandStatus`, `TaskPriority`, `TaskStatus`, `DemandAction`.
   - Tipos e Schemas: `Demand`, `Task`, `Requirement`, `TaskDependency`, `TaskComment`, `DemandEvent`.
2. **Validações Estritas de Segurança e Formato:**
   - **`previewUrlSchema`:** Valida URL e restringe estritamente o protocolo a `http:` ou `https:`, rejeitando esquemas inseguros (`javascript:`, `data:`, `vbscript:`, etc.).
   - **`calendarDateSchema`:** Validação de formato `YYYY-MM-DD` com verificação de calendário real (impede datas inexistentes como `2026-02-30`, `2026-04-31` e anos bissextos inválidos).
   - **Concorrência Otimista:** Exigência de `version > 0` em todas as mutações (`TaskVersionInput`, `UpdateDemandInput`, etc.).
3. **Contratos de Requisição e Resposta:**
   - Criação/atualização de demandas, listagem com filtros e paginação (`q`, `status`, `priority`, `page`, `limit`), histórico da demanda.
   - Criação de tarefas, aceitação, início, submissão de revisão, aprovação/rejeição de revisão, solicitação de pausa, aprovação de pausa com nova data, retomada, reatribuição, gestão de requisitos, adição/remoção de dependências e comentários mútuos.
4. **Verificação de Build:**
   - `pnpm --filter @orium/contracts build` executado com saída 0 (`dist/` gerado com tipos `.d.ts`).

---

## 3. Banco de Dados e Migração (`0002_demands_tasks.sql`)

1. **Schema Drizzle (`apps/api/src/schema.ts`):**
   - Mapeamento completo das 6 novas tabelas: `demand`, `task`, `task_requirement`, `task_dependency`, `task_comment`, `demand_event`.
   - Índices em todas as chaves estrangeiras (`client_id`, `created_by_user_id`, `demand_id`, `assigned_to_user_id`, `task_id`, `depends_on_task_id`, `author_id`, `actor_id`).
2. **Migração SQL (`db/migrations/0002_demands_tasks.sql` e `_journal.json`):**
   - Criação idempotente (`CREATE TABLE IF NOT EXISTS`) e índices (`CREATE INDEX IF NOT EXISTS`).
   - `CHECK` constraints de integridade:
     - `demand_version_positive`: `version > 0`
     - `task_version_positive`: `version > 0`
     - `task_dependency_no_self`: `task_id <> depends_on_task_id`
     - `CHECK (priority IN ('low', 'medium', 'high', 'urgent'))`
     - `CHECK (status IN ('open', 'in_progress', 'completed', 'cancelled'))`
     - `CHECK (status IN ('blocked', 'ready', 'in_production', 'in_review', 'changes_requested', 'completed', 'paused'))`
3. **Controle de Permissões (`apps/api/src/migrate.ts`):**
   - Adicionadas as 6 novas tabelas à lista de concessão `GRANT SELECT, INSERT, UPDATE, DELETE ON ... TO appRole`.
4. **Isolamento de Ambientes:**
   - O banco de desenvolvimento (`orium_dev`) **NÃO** foi migrado (preservando o estado estável da Fase 1/2 conforme determinação expressa).
   - O banco de testes (`orium_test`, porta 5433) está configurado e pronto para o runner exclusivo do QA.

---

## 4. Segurança, Permissões (RBAC/ABAC) e Controle de Concorrência

1. **Matriz de Permissões (`apps/api/src/identity.ts`):**
   - Adicionadas: `demands.read`, `demands.write`, `tasks.read`, `tasks.manage`, `tasks.execute`, `tasks.review`.
   - Funções administrativas exigem papel `administrator`: `demands.write`, `tasks.manage`, `tasks.review`.
   - Allowlist estrita para colaboradores em `changeRolePermissions`: limitada a `['protected.read', 'demands.read', 'tasks.read', 'tasks.execute']` (impedindo elevação de privilégios ou concessão espúria de acesso a clientes globais).
2. **Revalidação de Ator dentro da Transação após Locks:**
   - Helper tipado `revalidateActorInsideTransaction(dbClient, userId, requiredPerm)`.
   - Para eliminar qualquer janela de corrida em que o papel ou status ativo do usuário fosse alterado enquanto aguardava locks de linha, a revalidação do ator é executada **após** a obtenção dos locks `FOR UPDATE` da demanda e da tarefa.
3. **Ordenação Global de Locks (Deadlock Prevention):**
   - Em todas as mutações de tarefas e requisitos, o lock da demanda (`SELECT id FROM demand WHERE id = $1 FOR UPDATE`) é adquirido **sempre antes** do lock da tarefa (`SELECT * FROM task WHERE id = $1 FOR UPDATE`).
   - Criação de demandas bloqueia o cliente com `FOR SHARE` (`SELECT id, name FROM client WHERE id = $1 AND archived_at IS NULL FOR SHARE`), impedindo vínculo a cliente concorrentemente arquivado.
   - Atribuição e reatribuição checam usuário ativo com `FOR SHARE` sobre `auth_user`.
4. **Validação de Ciclos no Grafo (DAG):**
   - Mutação de dependências serializada sob o lock exclusivo da demanda.
   - Algoritmo de busca em profundidade (DFS) `wouldCreateCycle` avalia todas as arestas existentes na demanda somadas à nova aresta proposta antes da inserção.
5. **Anti-IDOR e Escopo Restrito de Visão:**
   - Colaboradores sem papel de administrador têm consultas filtradas para visualizar **apenas** tarefas atribuídas a eles e comentários dessas tarefas.
   - Tentativa de acesso a demandas ou tarefas não atribuídas resulta em `HTTP 404 NOT_FOUND` (evitando confirmação de existência e vazamento de metadados).
   - Histórico da demanda (`demand_event`) é filtrado para colaboradores visualizarem apenas eventos vinculados às suas tarefas atribuídas ou eventos globais sem tarefa.
   - Contadores da listagem de demandas (`GET /api/v1/demands`) refletem estritamente as tarefas atribuídas ao colaborador.

---

## 5. Rotas Implementadas (`apps/api/src/app.ts` e `apps/api/src/demands.ts`)

Foram registradas 21 rotas REST protegidas por autenticação de sessão e validação de CSRF Origin:

| Método | Endpoint | Permissão Exigida | Descrição |
|---|---|---|---|
| `GET` | `/api/v1/demands` | `demands.read` | Lista demandas com filtros, paginação e contagens com escopo |
| `POST` | `/api/v1/demands` | `demands.write` (Admin) | Cria nova demanda vinculada a cliente ativo |
| `GET` | `/api/v1/demands/:id` | `demands.read` | Detalhes da demanda com projeção de cliente e tarefas com escopo |
| `PATCH` | `/api/v1/demands/:id` | `demands.write` (Admin) | Atualiza título, descrição, prioridade ou data de entrega |
| `POST` | `/api/v1/demands/:id/complete` | `demands.write` (Admin) | Conclui demanda se todas as tarefas estiverem completed |
| `GET` | `/api/v1/demands/:id/history` | `demands.read` | Histórico auditável com filtro contextual por atribuição |
| `POST` | `/api/v1/tasks` | `tasks.manage` (Admin) | Cria tarefa com requisitos e dependências validadas |
| `GET` | `/api/v1/tasks/:id` | `tasks.read` | Detalhes da tarefa, requisitos e dependências com escopo |
| `POST` | `/api/v1/tasks/:id/accept` | `tasks.execute` (Assignee) | Aceita a tarefa atribuída (sem iniciar produção) |
| `POST` | `/api/v1/tasks/:id/start` | `tasks.execute` (Assignee) | Inicia tarefa se aceita e com prontidão aprovada |
| `POST` | `/api/v1/tasks/:id/submit-review` | `tasks.execute` (Assignee) | Submete tarefa em produção para revisão com previewUrl |
| `POST` | `/api/v1/tasks/:id/review` | `tasks.review` (Admin) | Aprova (`completed`) ou solicita ajustes (`changes_requested`) |
| `POST` | `/api/v1/tasks/:id/request-pause` | `tasks.execute` (Assignee) | Solicita pausa com motivo obrigatório |
| `POST` | `/api/v1/tasks/:id/approve-pause` | `tasks.manage` (Admin) | Aprova pausa com motivo e nova data explícita YYYY-MM-DD |
| `POST` | `/api/v1/tasks/:id/resume` | `tasks.manage` (Admin) | Retoma tarefa pausada calculando tempo decorrido |
| `POST` | `/api/v1/tasks/:id/reassign` | `tasks.manage` (Admin) | Reatribui tarefa não iniciada e reseta aceite |
| `PATCH` | `/api/v1/tasks/:id/requirements/:reqId` | `tasks.manage` (Admin) | Atualiza status de requisito e recalcula prontidão |
| `POST` | `/api/v1/tasks/:id/dependencies` | `tasks.manage` (Admin) | Adiciona dependência com validação de ciclo acíclico |
| `DELETE` | `/api/v1/tasks/:id/dependencies/:depId` | `tasks.manage` (Admin) | Remove dependência e reavalia prontidão |
| `GET` | `/api/v1/tasks/:id/comments` | `tasks.read` | Lista comentários da tarefa com escopo |
| `POST` | `/api/v1/tasks/:id/comments` | `tasks.execute` ou `tasks.manage` | Adiciona comentário à tarefa com escopo |

---

## 6. Evidências de Verificação Técnica

1. **Compilação e Typecheck:**
   - Comando: `pnpm build:foundation`
   - Saída:
     ```
     $ pnpm --filter @orium/contracts build && pnpm --filter @orium/api build
     $ tsc -p tsconfig.json
     $ tsc -p tsconfig.json
     ```
   - Código de saída: **0 (sucesso)**.
2. **Qualidade de Código e Linting:**
   - Comando: `pnpm exec eslint apps/api packages/contracts`
   - Saída: Vazia (zero erros, zero advertências).
   - Código de saída: **0 (sucesso)**.
3. **Nenhum Segredo ou Variável Exposta:**
   - Todas as configurações e credenciais respeitam `.env` e políticas de segredos locais.
4. **Preservação de Políticas Globais:**
   - Nenhuma porta alterada unilateralmente; política global `PORT_POLICY.md` respeitada.
   - Nenhum serviço em execução concorrente violado.

---

## 7. Próximos Passos e Handoff para Antigravity QA

1. O backend está pronto para que o agente **Antigravity QA** execute a suíte de testes de integração (`tests/demands.integration.test.ts`) exclusivamente contra o banco de testes isolado `orium_test` (porta 5433).
2. O banco de desenvolvimento `orium_dev` segue preservado sem migrações parciais até homologação completa.
