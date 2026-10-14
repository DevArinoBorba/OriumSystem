# Relatório de Implementação do Backend — Fase 4: Dashboard Operacional

**Documento:** `docs/PHASE4-BACKEND-RESULT.md`  
**Data:** 06/10/2026  
**Autor:** Antigravity (Backend Developer)  
**Status:** IMPLEMENTADO E VALIDADO (Aguardando homologação de frontend e QA)  

---

## 1. Escopo e Objetivos da Entrega

Implementação do endpoint de backend `GET /api/v1/dashboard` e schemas Zod estritos compartilhados em `@orium/contracts`, estritamente alinhados ao contrato operacional definido em `docs/PHASE4-IMPLEMENTATION-CONTRACT.md`.

### Arquivos com Ownership da Entrega:
- `packages/contracts/src/index.ts` (acréscimos de contratos e tipos Zod da Fase 4)
- `apps/api/src/dashboard.ts` (serviço do dashboard, consultas snapshot e projeções)
- `apps/api/src/app.ts` (registro da rota autenticada)
- `docs/PHASE4-BACKEND-RESULT.md` (este relatório)

Nenhum arquivo de frontend (`apps/web/...`) ou testes de QA (`tests/...`) foi alterado, respeitando estritamente os limites de ownership da equipe.

---

## 2. Contratos e Schemas Zod Compartilhados (`@orium/contracts`)

Foram exportados os seguintes schemas e tipos em `packages/contracts/src/index.ts`:

### 2.1 Schemas e Tipos
- **`dashboardQuerySchema` / `DashboardQuery`**:
  - `limit`: inteiro opcional entre `1` e `50`, com valor padrão `20` (`z.coerce.number().int().min(1).max(50).default(20)`).
  - Validação estrita via `.strict()`.
- **`dashboardItemKindSchema` / `DashboardItemKind`**:
  - `z.enum(['task', 'demand'])`.
- **`dashboardItemClientSchema` / `DashboardItemClient`**:
  - Projeção mínima do cliente: `{ id: uuid, name: string }`.
- **`dashboardItemUserSchema` / `DashboardItemUser`**:
  - Projeção mínima de usuário: `{ id: string, name: string }`.
- **`dashboardTaskItemSchema` / `DashboardTaskItem`**:
  - `kind`: `'task'`.
  - `id`: `uuid` da tarefa.
  - `title`: título da tarefa.
  - `demandId` / `demandTitle`: identificadores do chamado pai.
  - `client`: projeção mínima do cliente.
  - `status`: enum estrito `taskStatusSchema` (`'blocked' | 'ready' | 'in_production' | 'in_review' | 'changes_requested' | 'paused' | 'completed'`).
  - `priority`: `taskPrioritySchema`.
  - `deliveryDate`: `calendarDateSchema` (`YYYY-MM-DD`).
  - `taskId`: `uuid` da tarefa (obrigatório em itens de tarefa).
  - `startedAt`: `datetime` ISO com offset ou `null` (obrigatório em itens de tarefa).
  - `reason`: texto descritivo em português quando pertinente (opcional/nullable).
  - `assignedTo`: projeção mínima do responsável ou omitido/null para colaboradores.
- **`dashboardDemandItemSchema` / `DashboardDemandItem`**:
  - `kind`: `'demand'`.
  - `id`: `uuid` do chamado.
  - `title`: título do chamado.
  - `demandId` / `demandTitle`: id e título do próprio chamado.
  - `client`: projeção mínima do cliente.
  - `status`: enum estrito `demandStatusSchema` (`'open' | 'completed'`).
  - `priority`: `demandPrioritySchema`.
  - `deliveryDate`: `calendarDateSchema` (`YYYY-MM-DD`).
  - Demais campos (`taskId`, `startedAt`, `reason`, `assignedTo`) mantidos nulos.
- **`dashboardItemSchema` / `DashboardItem`**:
  - União discriminada estrita: `z.discriminatedUnion('kind', [dashboardTaskItemSchema, dashboardDemandItemSchema])`.
- **`dashboardSectionSchema` / `DashboardSection`**:
  - `{ total: number, items: DashboardItem[] }`.
- **`dashboardWorkloadUserSchema` / `DashboardWorkloadUser`**:
  - `{ userId: string, name: string, active: boolean, total: number, production: number, awaitingAction: number }`.
- **`dashboardResponseSchema` / `DashboardResponse`**:
  - `generatedAt`: string ISO (`datetime`).
  - `today`: data do servidor no fuso oficial (`YYYY-MM-DD`).
  - `timeZone`: literal `'America/Cuiaba'`.
  - `upcomingDays`: literal `3`.
  - `scope`: `'all' | 'assigned'`.
  - `sections`: `{ production, awaitingAction, overdueTasks, overdueDemands, dueToday, upcoming, urgent }`.
  - `workload`: lista de `DashboardWorkloadUser` (vazio para colaborador ou sem `users.read`).
  - `workloadAvailable`: booleano indicando autorização para visualizar a carga da equipe.

---

## 3. Arquitetura e Regras de Negócio (`apps/api/src/dashboard.ts`)

### 3.1 Consistência de Snapshot Único
- Toda a consulta do dashboard é executada dentro de uma única transação PostgreSQL em nível `REPEATABLE READ READ ONLY`:
  - Garante isolamento MVCC consistente entre todas as contagens, seções e agregação de carga.
  - Elimina risco de race conditions ou anomalias N+1.
- Revalidação imediata dentro da transação:
  - Confirma se o usuário solicitante continua ativo (`active = true`).
  - Recupera papéis e permissões vigentes no snapshot. Se o usuário tiver sido desativado ou perdido `demands.read` ou `tasks.read`, a requisição é rejeitada com `401 UNAUTHENTICATED` ou `403 FORBIDDEN`.

### 3.2 Fuso Horário e Janelas de Calendário
- Fuso horário oficial: `America/Cuiaba`.
- `now` único e injetável via `DashboardOptions` para permitir previsibilidade e testes determinísticos.
- `today`: formatado como `YYYY-MM-DD` via `Intl.DateTimeFormat('en-CA', { timeZone: 'America/Cuiaba' })`.
- Aritmética pura de calendário via `addCalendarDays(dateStr, days)`:
  - Suporta com precisão viradas de mês (ex.: `2026-10-31` + 1 -> `2026-11-01`).
  - Suporta viradas de ano (ex.: `2026-12-31` + 1 -> `2027-01-01`).
  - Suporta anos bissextos (ex.: `2028-02-28` + 1 -> `2028-02-29`) e anos não bissextos (`2026-02-28` + 1 -> `2026-03-01`).
- Janelas de entrega:
  - `dueToday`: tarefas com `deliveryDate === today`.
  - `upcoming`: próximas entregas nos próximos 3 dias (`deliveryDate >= today + 1` e `deliveryDate <= today + 3`).

### 3.3 Separação Rigorosa de Prazos e Atrasos
- **Prazo do chamado vencido (`overdueDemands`)**:
  - Chamados em status `open` com `deliveryDate < today`.
  - Chamados concluídos (`status = 'completed'`) são estritamente excluídos.
- **Atraso operacional da tarefa (`overdueTasks`)**:
  - Tarefa só entra em atraso se comprovadamente iniciada (`started_at IS NOT NULL`).
  - Status operacional ativo: `in_production`, `in_review` ou `changes_requested`.
  - Prazo da tarefa anterior a hoje (`task_delivery_date < today`).
  - Tarefas em `blocked`, `paused` ou nunca iniciadas **NÃO** são consideradas atraso operacional.

### 3.4 Seções e Motivos Operacionais (`awaitingAction`)
- Seção **Dependendo de Ação** reúne tarefas pendentes de ação com motivo explícito em português:
  - `blocked`: "Bloqueada por requisitos ou dependências pendentes".
  - `ready` sem aceite: "Pronta aguardando aceite do responsável".
  - `ready` com aceite: "Pronta aguardando início da produção".
  - `in_review`: "Submetida para revisão (aguardando avaliação do administrador)".
  - `changes_requested`: "Ajustes solicitados na revisão (aguardando correções do responsável)".
  - `paused`: "Pausada: [motivo]" ou "Pausada operacionalmente".
  - `pause_requested_at` pendente (mesmo em `in_production`): "Solicitação de pausa pendente: [motivo]".
- Uma mesma tarefa pode aparecer em seções distintas (ex.: em produção e com solicitação de pausa pendente em aguardando ação), sem duplicação dentro da mesma seção.

### 3.5 Isolamento por Perfil (Anti-Vazamento e RBAC)
- **Colaborador (`scope: 'assigned'`)**:
  - Apenas tarefas atribuídas a si (`assigned_to_user_id = identity.user.id`).
  - Apenas chamados onde o colaborador possua ao menos uma tarefa própria aberta.
  - `assignedTo`: estritamente `null` nas projeções (não expõe atribuições de colegas).
  - `workload`: lista vazia `[]` e `workloadAvailable: false`.
  - Nenhum título, identificador ou total alheio é computado ou exposto.
- **Administrador (`scope: 'all'`)**:
  - Visualização de todas as tarefas e chamados abertos da operação.
  - `assignedTo`: projeta `{ id, name }` do responsável da tarefa.
  - `workload` (com permissão `users.read`): array agregado diretamente no banco via `COUNT(t.id)` e filtros condicionais.
  - Inclui todos os usuários ativos (mesmo com carga 0) e usuários inativos que possuam tarefas abertas. Usuários inativos sem trabalho aberto são excluídos.

### 3.6 Ordenação Determinística e Limite
- Ordenação aplicada a todas as seções:
  1. Prioridade: `urgent` (0), `high` (1), `normal` (2), `low` (3).
  2. Data de entrega (`deliveryDate` crescente).
  3. Desempate por `id` crescente.
- O campo `total` de cada seção reflete a contagem real exata antes do truncamento por `limit`.
- A lista `items` retorna no máximo `limit` registros (1 a 50, padrão 20).

---

## 4. Registro no Servidor HTTP (`apps/api/src/app.ts`)

- Rota registrada:
  ```typescript
  app.get('/api/v1/dashboard', async (request) => {
    const identity = await authenticate(database, auth, request.headers);
    requirePermission(identity, 'demands.read');
    requirePermission(identity, 'tasks.read');
    const query = dashboardQuerySchema.parse(request.query);
    return getDashboard(database, identity, query);
  });
  ```
- Exige autenticação de sessão e permissões `demands.read` e `tasks.read`.

---

## 5. Evidências de Validação e Qualidade de Código

1. **Compilação TypeScript:**
   - `pnpm --filter @orium/contracts build` -> Exit code 0 (`tsc -p tsconfig.json`).
   - `pnpm --filter @orium/api build` -> Exit code 0 (`tsc -p tsconfig.json`).
   - `pnpm build:foundation` -> Exit code 0.
2. **Linter (ESLint):**
   - `pnpm --filter @orium/contracts exec eslint src` -> Exit code 0 (0 erros, 0 warnings).
   - `pnpm --filter @orium/api exec eslint src` -> Exit code 0 (0 erros, 0 warnings).
3. **Testes Unitários:**
   - `pnpm test:unit` -> Exit code 0 (57/57 testes PASS em `tests/config.test.ts` e `tests/rbac.test.ts`).
   - Validação unitária isolada de:
     * Aritmética de calendário (`addCalendarDays`) em virada de mês, virada de ano e anos bissextos.
     * Validação estrita de query (`dashboardQuerySchema.strict()`).
     * Validação estrita por discriminated union (`dashboardItemSchema`) para tarefas e chamados, rejeitando enums inválidos ou ausência de `taskId`/`startedAt`.
     * Ordenação determinística de itens (`urgent` > `high` > `normal` > `low`, `deliveryDate` ASC, `id` ASC).
4. **Preservação de Ambientes e Portas:**
   - Nenhuma porta foi aberta indevidamente.
   - Ambiente DEV (portas 3002 e 5173) e contas de bootstrap no PostgreSQL `orium_dev` foram preservados sem alterações destrutivas.

---

## 6. Limitação de Escala e Características de Execução

Conforme registrado na revisão de coordenação (`docs/PHASE4-COORDINATION-REVIEW.md`), a implementação do backend possui a seguinte característica de escala documentada de forma factual e honesta:

- **Seleção no Escopo e Truncamento em Memória:**
  - A consulta do banco carrega todas as tarefas abertas pertencentes a chamados abertos dentro do escopo autorizado (`all` para administradores; `assigned_to_user_id` para colaboradores) em um único snapshot `REPEATABLE READ READ ONLY`.
  - As seções operacionais (`production`, `awaitingAction`, `overdueTasks`, `dueToday`, `upcoming`, `urgent`) são particionadas e ordenadas deterministicamente no processo Node.js, e o limite (`limit`, padrão 20) é aplicado fatiando o array (`slice(0, limit)`), enquanto o campo `total` reporta a contagem real pré-limite.
  - Não há problemas de N+1 nem transferência de dados para agregação no frontend. No entanto, os resultados limitados no JSON de resposta **não limitam a leitura de linhas em memória do backend**.
  - Para volumes operacionais típicos do OriumSystem, esta abordagem garante precisão de contadores, flexibilidade de motivos e simplicidade sem race conditions. Para cenários com dezenas de milhares de tarefas simultâneas abertas, otimizações via queries particionadas (`ROW_NUMBER() OVER (...)`) poderão ser avaliadas futuramente sem alterar os contratos estabelecidos.

