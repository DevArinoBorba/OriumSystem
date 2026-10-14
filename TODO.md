# TODO — OriumSystem

Controle operacional das atividades por fase do projeto.

---

## Fase 0 — Especificação e Arquitetura
- [x] Especificação de arquitetura e ADRs iniciais (ADR-0001 a ADR-0006) — [`docs/PHASE0-CLOSURE.md`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/docs/PHASE0-CLOSURE.md)

## Fase 1 — Fundação e Autenticação
- [x] Estrutura inicial do monorepo, banco PostgreSQL migrado, papéis RBAC e BetterAuth
- [x] Procedimento de recuperação administrativa CLI sob lock (`recoverUserAccess`) — ADR-0007
- [x] Suíte de 79 testes automatizados Vitest aprovada (100% pass, 0 skips)
- [x] Validação CLI ConPTY real (8/8 casos PASS) — [`docs/PHASE1-CLI-VALIDATION.md`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/docs/PHASE1-CLI-VALIDATION.md)
- [x] Validação de navegador visível no portal (8/8 casos PASS) — [`docs/PHASE1-FINAL-BROWSER.md`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/docs/PHASE1-FINAL-BROWSER.md)
- [x] Bootstrap interativo real executado pelo responsável: contas `arinoborba@gmail.com` e `moniquiborges_5@gmail.com` ativas em `orium_dev`
- [x] Fechamento formal da Fase 1 — [`docs/PHASE1-CLOSURE.md`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/docs/PHASE1-CLOSURE.md) e [`docs/PHASE1-HANDOFF-RESULT.md`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/docs/PHASE1-HANDOFF-RESULT.md)

## Fase 2 — Clientes e Equipe
- Status: **[x] CONCLUÍDA**
- [x] Modelagem e migração de banco para Clientes (`0001_clients.sql`)
- [x] Contratos Zod para CRUD, versão otimista e filtros (`@orium/contracts`)
- [x] Rotas Fastify para Clientes com RBAC e concorrência 409 (`apps/api/src/clients.ts`)
- [x] Gestão de Equipe com salvaguarda `LAST_ADMINISTRATOR` e revogação imediata de sessões
- [x] Interface Web para Clientes e Equipe com filtros, formulários inline e diálogos nativos
- [x] Delimitação de regras de colaboradores designers (ADR-0008: deny-by-default na Fase 2; visibilidade atribuída na Fase 3)
- [x] Resolução de concorrência 409: aviso explícito de descarte de rascunho e recarga integral do backend
- [x] Proteção síncrona contra envios concorrentes (`useRef` single-flight em todas as mutações)
- [x] Acessibilidade determinística via teclado: manipulador `onKeyDown` Escape nos 3 diálogos nativos
- [x] Suíte automatizada Vitest: 79/79 testes aprovados (0 skips)
- [x] Validação E2E no portal visível: Rodada 3 oficial (timestamp `2026-10-05T21:42:54.890Z` a `21:43:42Z`) com 8/8 PASS genuínos no portal visível sem cancel artificial (Rodada 2 invalidada). Fechamento de diálogo por Escape determinístico via onKeyDown
- [x] Fechamento formal da Fase 2: aceite técnico formal concedido pela coordenação (Codex) com evidências de QA e higiene do banco — [`docs/PHASE2-CLOSURE.md`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/docs/PHASE2-CLOSURE.md)

## Fase 3 — Demandas, Aprovação e Visão Restrita (Planejamento)
- Status: **[~] PLANEJAMENTO SOMENTE**
- [ ] Mapear regras de negócio pendentes sobre calendário, prazos e modelos de tarefa
- [ ] Elaborar especificação técnica da Fase 3 (`docs/PHASE3-SPEC.md`)
- [ ] Especificar modelo de dados para demandas, tarefas, bloqueios e transições de estado
- [ ] Projetar fluxo de atribuição e visibilidade restrita para colaboradores designers (ADR-0008)
- [ ] Alinhar requisitos de calendário e bloqueios antes de iniciar qualquer código
