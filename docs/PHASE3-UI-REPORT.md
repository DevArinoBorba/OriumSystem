# Fase 3 — Relatório de Interface (UI) do OpenCode

Data: 2026-10-06 · Estado: implementação de interface entregue com ferramenta verde; **browser/E2E não concluído por este relatório**.

Fronteira deste relatório: `apps/web/src` (frontend) e a seção OpenCode da nota `oriumsystem-acompanhamento`. Não altera backend, `packages/contracts`, SQL, migrações, testes nem env. Contratos compartilhados importados diretamente de `@orium/contracts` (sem espelho local de schemas/tipos e sem dependência nova de `zod` no web — o parse continua vindo dos schemas compartilhados).

## Escopo de ownership

| Área | Responsável | Estado |
|---|---|---|
| `apps/web/src/api.ts` (+ método `updateDemand` PATCH `/api/v1/demands/:id`) | OpenCode | Entregue |
| `apps/web/src/App.tsx`, `components/Header.tsx` (aba Demandas / Minhas demandas) | OpenCode | Entregue |
| `apps/web/src/types.ts` (estados/UI Fase 3) | OpenCode | Entregue |
| `apps/web/src/styles.css` (extensão do tema incumbente) | OpenCode | Entregue |
| `apps/web/src/components/DemandsView.tsx` | OpenCode | Entregue |
| `apps/web/src/components/TaskDetailView.tsx` | Antigravity QA (exclusivo, props acordadas) | Integrado/consumido |
| `docs/PHASE3-UI-REPORT.md` | OpenCode | Este arquivo |

## O que foi implementado

### Lista de demandas (`DemandsView`)
- Filtros de busca por termo (`q`), status (`open|completed|all`) e prioridade (`all|low|normal|high|urgent`), com paginação determinística.
- Rótulo condicional por perfil: admin **“Demandas”**; colaborador **“Minhas demandas”** (backend já restringe visibilidade por atribuição).
- Estados vazios distintos (nenhum chamado / nenhum atribuído / busca sem resultado), erro com “Tentar novamente” e tratamento 403.

### Criar chamado (admin)
- Formulário com cliente obrigatório (somente clientes ativos via `listClients`), título, descrição, prioridade e **“Data de entrega geral do chamado”** — campo explícito, o criador define o prazo inicial (regra aprovada).
- Validação via `createDemandSchema` com mensagens não técnicas e foco no primeiro campo inválido.

### Detalhe do chamado (admin)
- Cabeçalho com cliente, prioridade, **entrega geral** e status; descrição preservada (`pre-wrap`).
- **“Editar dados do chamado”**: ajusta título, descrição, prioridade e a **data de entrega geral** de forma explícita para Monique ajustar o compromisso geral (sem inferência automática a partir de tarefas).
  - **Integridade de versão**: ao abrir o formulário é capturada uma `editVersion` (snapshot); o envio usa somente essa versão capturada, nunca a versão viva do objeto que pode mudar em recargas do detalhe. Recarregar o detalhe (ação de tarefa) não sobrescreve a edição concorrente. A versão capturada só é atualizada na ação explícita “Descartar rascunho e carregar dados do servidor”.
  - Em 409 (`VERSION_CONFLICT`) o rascunho é **preservado**, mensagem clara e botão de recarga explícita que descarta o rascunho. Aviso usa linguagem do usuário (“Dados atualizados carregados; rascunho anterior descartado”), sem jargão de versão.
- **“Concluir chamado”**: diálogo de confirmação nativo; habilitado só quando há tarefas e todas `completed`; trata códigos reais do backend (`TASKS_NOT_COMPLETED`, `DEMAND_HAS_NO_TASKS`, `DEMAND_ALREADY_COMPLETED`, `VERSION_CONFLICT` via status 409, 403, 404).
- **“Histórico”**: painel admin com `demandHistoryResponseSchema`; eventos com autor, ação, motivo e data/hora localizada.

### Criar tarefa (admin, dentro do detalhe)
- Responsável (lista de usuários ativos via `listUsers`, com “(você)”), título, descrição, prioridade e **“Data de entrega da tarefa”** (pré-preenchida com a data geral do chamado, ajustável).
- **Requisitos**: lista dinâmica título + “Obrigatório”, até 30; contador de preenchidos.
- **Dependências**: checkboxes a partir das tarefas do mesmo chamado (com badge de status), até 30.
- Tratamento de ciclos (`TASK_DEPENDENCY_CYCLE`), 403/404/409 com mensagens claras.
- Limites consistentes com `createTaskSchema` (máximos de caracteres e de itens).

### Integração `TaskDetailView` (componente exclusivo do Antigravity QA)
- `DemandsView` renderiza `<TaskDetailView taskId session availableTasks onUnauthorized onChanged onBack>` ao clicar “Abrir detalhes” de uma tarefa.
- `onChanged` → recarrega o detalhe/histórico da demanda (estado atualizado); `onBack` → volta à lista de tarefas do chamado.
- Nenhuma edição no arquivo do QA foi feita por esta fronteira.

## Decisões de interface (linha do responsável)
- Ações de execução (aceitar/iniciar/submeter/solicitar pausa) exigem `assignedToUserId === session.user.id`, inclusive para admin — a UI não exibe “iniciar em nome de outro” (garantia no componente do QA via `isAssignee`).
- Admin gerencia revisão, requisitos/dependências, autorização de pausa e retomada independentemente de ser atribuído.
- Data de pausa é da tarefa (formulário “Nova data de entrega da tarefa” no componente QA); a data geral do chamado é editável explicitamente no detalhe da demanda (admin).
- Datas sempre `input type="date"` (YYYY-MM-DD).
- Guardas single-flight em formulários e ações; drafts preservados em 409 com recarga explícita; tratamento 401/403 coerente com a camada `api.ts`.

## Evidências de ferramenta (reais, executadas)

| Comando | Resultado |
|---|---|
| `pnpm --filter @orium/web typecheck` | 0 erros |
| `pnpm exec eslint apps/web/src --max-warnings 0` | 0 problemas |
| `pnpm --filter @orium/web build` | OK (`tsc` + `vite build`; 119 módulos; `dist` gerado) |

Dependência para o toolchain: `packages/contracts/dist` (schemas da Fase 3 já presentes — conferido).

## Não coberto / pendências
- **Browser/navegador E2E não executado por esta entrega** — flui para homologação real do QA na fase de testes com portal visível, sob PORT_POLICY, com credenciais efêmeras. Nada aqui é declaração de validação visual concluída.
- Não iniciados serviços nem alteradas portas.
- Typecheck/lint/build do monorepo completo e testes de integração permanecem para a revisão final do Codex/QA após a entrega do backend.
