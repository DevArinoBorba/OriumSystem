# Contrato de Implementação Coordenada — Fase 11 (Refinamento)

- **Data:** 2026-10-14
- **Coordenação:** `Antigravity #2` (Maestro / Orquestrador)
- **Referências:** `ROADMAP.md`, `docs/PHASE11-KICKOFF.md`, `docs/PHASE11-BACKEND-MAP.md`
- **Status:** **EM EXECUÇÃO — INCREMENTO 1 (Performance, Templates de Demandas e Relatórios Operacionais)**

---

## 1. Escopo Técnico da Fase 11

Em conformidade com o `ROADMAP.md` (*"Analisar gargalos, revisar UX, templates de demandas, automações, relatórios, integrações e performance"*) e com o diagnóstico de `docs/PHASE11-BACKEND-MAP.md`, a Fase 11 entrega:

1. **Performance & Índices (`db/migrations/0006_refinement_templates_reports.sql`):**
   - Índices compostos para eliminar *sort* em memória e *Sequential Scans* nas listagens e verificações anti-IDOR:
     - `demand_status_created_at_idx` em `demand (status, created_at DESC)`
     - `demand_client_status_delivery_idx` em `demand (client_id, status, delivery_date)`
     - `task_assigned_status_delivery_idx` em `task (assigned_to_user_id, status, delivery_date)`
     - `task_assigned_demand_idx` em `task (assigned_to_user_id, demand_id)`
     - `task_active_status_idx` parcial em `task (demand_id, status) WHERE status != 'completed'`
     - `demand_event_demand_created_idx` em `demand_event (demand_id, created_at DESC)`
2. **Templates de Demandas e Tarefas (`/api/v1/demand-templates`):**
   - Tabelas:
     - `demand_template` (`id`, `title`, `description`, `category`, `default_priority`, `estimated_days`, `active`, `version`, `created_at`, `updated_at`)
     - `demand_template_task` (`id`, `template_id`, `title`, `description`, `suggested_role`, `priority`, `day_offset_start`, `duration_days`, `order_index`)
     - `demand_template_task_requirement` (`id`, `template_task_id`, `title`, `mandatory`, `order_index`)
     - `demand_template_task_dependency` (`template_task_id`, `depends_on_template_task_id`)
   - Permissões e Grants:
     - Leitura de templates (`GET /api/v1/demand-templates`): exige permissão `demands.read`.
     - Criação/edição/ativação de templates (`POST /api/v1/demand-templates`, `PATCH /api/v1/demand-templates/:id`): exige papel `administrator` e permissão `demands.write`.
     - Instanciação atômica de demanda a partir de template (`POST /api/v1/demand-templates/:id/instantiate`): exige permissão `demands.write`; cria em transação única a `demand`, todas as `task` (com status inicial `ready` para tarefas sem dependências/requisitos pendentes ou `blocked` quando houver dependências/requisitos obrigatórios), `task_requirement`, `task_dependency`, evento `demand_event` e notificações correspondentes.
     - Grants estritos para `orium_app` nas 4 novas tabelas (`SELECT, INSERT, UPDATE, DELETE`), mantendo os 23 pares `role_permission` canônicos intactos.
3. **Relatórios Operacionais (`/api/v1/reports`):**
   - Endpoints somente-leitura sob transação `READ COMMITTED READ ONLY`:
     - `GET /api/v1/reports/productivity`: resumo do período (`startDate`..`endDate`, filtros opcionais `clientId`, `userId`), total de demandas criadas/concluídas, tarefas concluídas, `onTimeDeliveryRate` (%), `averageLeadTimeHours`, `averageCycleTimeHours`, série temporal e agregação por responsável (`byAssignee`).
     - `GET /api/v1/reports/bottlenecks`: visão de gargalos operacionais (tarefas em bloqueio/pausa, tempo médio por estágio `blocked`/`ready`/`in_production`/`in_review`/`paused`, principais motivos de pausa e tarefas com retrabalho/`changes_requested`).
   - Controle de acesso (RBAC / Anti-IDOR):
     - Administradores visualizam métricas globais de toda a agência.
     - Colaboradores não-administradores com `demands.read` visualizam apenas métricas escopadas às suas próprias tarefas (`assigned_to_user_id = actor.id`), sem vazar métricas individuais de outros colaboradores.
4. **Refinamento de UX e Interface Web (`apps/web/src/`):**
   - Nova visão **Relatórios & Gargalos** (`ReportsView.tsx`) acessível na navegação principal, exibindo KPIs de produtividade, taxa de entrega no prazo (OTD), gargalos por estágio e tabela de desempenho.
   - Integração de **Templates de Demandas** em `DemandsView.tsx` (ou modal/painel dedicado): permitir listar templates ativos, criar novo template (para administradores) e **Criar Demanda via Template** preenchendo cliente, título e data base com geração automática das tarefas padronizadas.

---

## 2. Divisão Estrita de Ownership por Agente

| Agente | Arquivos sob Ownership Exclusivo | Responsabilidade |
|---|---|---|
| **`Antigravity`** | `packages/contracts/src/index.ts`, `db/migrations/0006_refinement_templates_reports.sql`, `db/migrations/meta/_journal.json`, `apps/api/src/schema.ts`, `apps/api/src/templates.ts`, `apps/api/src/reports.ts`, `apps/api/src/app.ts` | Contratos Zod em `@orium/contracts`, migração `0006` (índices + 4 tabelas de templates + grants `orium_app`), rotas `/api/v1/demand-templates` e `/api/v1/reports`, build e validação em `orium_test` (sem tocar em `orium_dev` nem na VPS ainda). |
| **`OpenCode`** | `apps/web/src/components/ReportsView.tsx`, `apps/web/src/components/TemplatesModal.tsx` (ou similar), `apps/web/src/components/DemandsView.tsx`, `apps/web/src/components/Header.tsx`, `apps/web/src/App.tsx`, `apps/web/src/api.ts`, `apps/web/src/types.ts`, `apps/web/src/styles.css` | Implementação da UI de Relatórios Operacionais & Gargalos e do fluxo de Templates de Demandas no frontend `@orium/web`, com acessibilidade por teclado, estados vazios/erro e design consistente. |
| **`Antigravity QA`** | `tests/phase11/templates-reports.integration.test.ts`, `docs/PHASE11-QA-RESULT.md` | Suíte de integração real contra `orium_test` cobrindo CRUD e instanciação atômica de templates, relatórios operacionais (`productivity` e `bottlenecks`), isolamento RBAC/anti-IDOR entre administrador e colaborador, e preservação de 100% dos dados/grants preexistentes. |
| **`Sentinela`** | `docs/PHASE11-SECURITY-REVIEW.md` | Auditoria de segurança e SQL best-practices sobre `0006_refinement_templates_reports.sql`, `templates.ts` e `reports.ts` (grants mínimos, anti-IDOR, transações e índices). |

---

## 3. Regras de Ouro e Guardas Operacionais

1. **Bancos e Portas Protegidos:**
   - **Proibido** derrubar ou sobrescrever `orium_dev` (`55432`), API DEV (`3002`), Web DEV (`5173`) ou a VPS durante a implementação e os testes em `orium_test` (`5433`).
2. **Ordem de Sincronização:**
   - `Antigravity` publica primeiro os schemas em `packages/contracts/src/index.ts` e compila `@orium/contracts` (`pnpm --filter @orium/contracts build`), além de implementar `templates.ts`, `reports.ts` e `0006_refinement_templates_reports.sql`.
   - Assim que `@orium/contracts` e os endpoints estiverem prontos, `OpenCode` conecta o frontend `@orium/web`, `Antigravity QA` executa a bateria de integração real em `orium_test`, e `Sentinela` realiza a revisão de segurança.
