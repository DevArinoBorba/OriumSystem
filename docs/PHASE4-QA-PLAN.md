# Plano de Testes e Homologação de QA — Fase 4 (Dashboard e Visão Operacional)

Data da Elaboração: 2026-10-06  
Status: **EM PREPARAÇÃO (MATRIZ DE INTEGRAÇÃO E RUNNER E2E DEFINIDOS)**  
Autor: **Antigravity QA** (validador exclusivo de QA no portal visível)  
Fronteira Documental e Ownership:
- Dono exclusivo de: [`docs/PHASE4-QA-PLAN.md`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/docs/PHASE4-QA-PLAN.md), [`docs/PHASE4-BROWSER-REPORT.md`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/docs/PHASE4-BROWSER-REPORT.md), [`tests/dashboard.integration.test.ts`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/tests/dashboard.integration.test.ts), [`.local/phase4-qa-*`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/.local) e seção `## Antigravity QA` na nota contínua `oriumsystem-acompanhamento`.
- Fronteiras de colegas: Antigravity backend (`packages/contracts/*`, `apps/api/src/dashboard.ts`, `apps/api/src/app.ts`); OpenCode frontend (`apps/web/src/components/DashboardView.tsx`, `Header.tsx`, `App.tsx`, styles); Codex coordena.
Documentos de Referência: [`docs/PHASE4-IMPLEMENTATION-CONTRACT.md`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/docs/PHASE4-IMPLEMENTATION-CONTRACT.md), [`PROJECT_CONTEXT.md`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/PROJECT_CONTEXT.md), [`ROADMAP.md`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/ROADMAP.md), [`docs/adr/0005-inicio-explicito-tarefa.md`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/docs/adr/0005-inicio-explicito-tarefa.md), [`docs/adr/0007-politicas-fundacao.md`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/docs/adr/0007-politicas-fundacao.md), [`docs/adr/0009-dashboard-operacional-fase4.md`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/docs/adr/0009-dashboard-operacional-fase4.md), [`C:/Users/arino/.maestri/PORT_POLICY.md`](file:///C:/Users/arino/.maestri/PORT_POLICY.md).

---

## 1. Diretrizes de QA e Modalidades de Teste

### 1.1. Objetivo
Homologar a **Fase 4 (Dashboard e Visão Operacional)** com base nas regras estritas de [`docs/PHASE4-IMPLEMENTATION-CONTRACT.md`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/docs/PHASE4-IMPLEMENTATION-CONTRACT.md):
- Visão somente de leitura, sem mutações de estado no dashboard.
- Isolamento absoluto e prevenção de vazamento de dados de colaboradores (anti-IDOR): contagens, títulos, identificadores e carga da equipe de terceiros nunca são visíveis ao colaborador.
- Rigor temporal: data de referência calculada no fuso horário `America/Cuiaba`.
- Janela de próximas entregas fixada em 3 dias (amanhã até hoje+3, inclusive), com `dueToday` em seção própria.
- Separação precisa entre prazo de chamado vencido (`overdueDemands`) e atraso operacional de tarefa (`overdueTasks`).
- Regra de atraso operacional de tarefa: exige `startedAt` não nulo, status em (`in_production`, `in_review`, `changes_requested`) e `deliveryDate < today`. Tarefas em `blocked`, `paused` ou nunca iniciadas **não** constituem atraso operacional.
- Carga da equipe (`workload`): acessível exclusivamente a administradores com permissão `users.read`.
- Ordenação determinística: prioridade `urgent` antes das demais, `deliveryDate` crescente, desempate por `id`.

### 1.2. Delimitação das Modalidades de Teste
1. **Testes Automatizados de Integração (Fastify inject):**
   - Implementados em [`tests/dashboard.integration.test.ts`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/tests/dashboard.integration.test.ts) contra o PostgreSQL de testes isolado (`TEST_DATABASE_URL`, porta 5433).
   - Validam exaustivamente autorização, projeções, anti-leak, regras de negócio temporais, viradas de calendário, limites e paginação.
2. **Homologação E2E no Navegador (Portal Visível Mandatório):**
   - Executada via [`.local/phase4-qa-runner.mjs`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/.local/phase4-qa-runner.mjs) no portal `Orium - Codex visivel`.
   - Valida renderização real dos cards, aba "Painel", isolamento do colaborador na interface, navegação para DemandsView, atualização manual com timestamp, tratamento de erro/retry, estado vazio, responsividade mobile (390x844) e integridade de console.
3. **Isolamento de Ambiente e Portas (`PORT_POLICY.md`):**
   - Ambiente de desenvolvimento (`orium_dev` na porta 55432, API DEV na 3002 e Web DEV na 5173) rigorosamente preservado.
   - Portas temporárias alocadas dinamicamente via `Find-FreePort.ps1`.
   - Limpeza cirúrgica pós-execução garantindo 0 registros órfãos em `orium_test`.

---

## 2. Matriz de Testes de Integração (`tests/dashboard.integration.test.ts`)

| Eixo / Grupo | Cenário de Teste | Critério de Aceitação / Asserção |
| :--- | :--- | :--- |
| **1. Autenticação e RBAC** | Não autenticado | GET `/api/v1/dashboard` retorna HTTP 401 `UNAUTHENTICATED`. |
| | Permissões insuficientes | Usuário sem `demands.read` ou sem `tasks.read` recebe HTTP 403 `FORBIDDEN`. |
| | Administrador com permissões | Retorna HTTP 200 com payload validado por `dashboardResponseSchema`. |
| **2. Isolamento e Anti-Vazamento (Collaborator)** | Escopo restrito | Colaborador recebe `scope: "assigned"`. |
| | Projeção limitada de cliente | `client` projeta apenas `id` e `name` (sem contatos, notas ou e-mail). |
| | Ocultação de terceiros | Tarefas atribuídas a outro colaborador não aparecem em nenhuma seção e não incrementam nenhum `total`. |
| | Proibição de `assignedTo` | Campo `assignedTo` em cada item de tarefa é `null` para colaborador (nunca vaza nome/id do responsável). |
| | Bloqueio de Carga da Equipe | `workloadAvailable: false` e `workload: []` (array vazio obrigatório pelo schema compartilhado de contrato). |
| | Chamados vencidos do colaborador | Em `overdueDemands`, colaborador só enxerga chamados nos quais possui tarefa própria aberta. |
| **3. Visão Operacional do Administrador** | Escopo global | Administrador com permissões completas recebe `scope: "all"`. |
| | Atribuição visível | Itens de tarefa contêm `assignedTo: { id, name }`. |
| | Carga da Equipe (`workload`) | `workloadAvailable: true`; lista contém usuários ativos (mesmo com 0 tarefas) e inativos com tarefas abertas. |
| | Métricas de Carga | Cada entrada possui `userId`, `name`, `active`, `total`, `production`, `awaitingAction` exatos e coerentes. |
| | Ausência de segredos na carga | Nenhum e-mail, hash de senha, credencial ou nota confidencial é exposta no `workload`. |
| | Admin sem `users.read` | Se admin não possuir `users.read`, `workloadAvailable: false` e `workload: []` (array vazio obrigatório pelo contrato). |
| **4. Classificação por Seções e Estados** | Seção `production` | Contém exclusivamente tarefas com status `in_production`. |
| | Seção `awaitingAction` | Contém tarefas em `blocked`, `ready` (aguardando aceite vs aguardando início), `in_review`, `changes_requested`, `paused` ou com `pauseRequestedAt != null`. |
| | Motivos explícitos (`reason`) | Campo `reason` em português reflete o estado real (ex: "Pronta aguardando aceite do responsável", "Pronta aguardando início da produção", "Bloqueada por requisitos ou dependências pendentes", "Submetida para revisão (aguardando avaliação do administrador)", "Ajustes solicitados na revisão (aguardando correções do responsável)", "Pausada: ...", "Solicitação de pausa pendente: ..."). |
| | Exclusão de Concluídos | Tarefas em `completed` e demandas em `completed` são rigorosamente excluídas de todas as seções de pendências. |
| **5. Regras de Prazo e Calendário (Fuso `America/Cuiaba`)** | Atraso Operacional vs Prazo Geral | Distinção explícita entre `overdueTasks` e `overdueDemands`. |
| | Regra estrita de `overdueTasks` | Tarefa só entra em `overdueTasks` se `startedAt != null`, status em (`in_production`, `in_review`, `changes_requested`) e `deliveryDate < today`. |
| | Falsos positivos de atraso | Tarefas em `blocked`, `paused` ou nunca iniciadas com `deliveryDate < today` NÃO entram em `overdueTasks`. |
| | Seção `dueToday` | Contém tarefas com `deliveryDate == today`. |
| | Seção `upcoming` (próximas entregas) | Contém tarefas com data entre `today + 1` e `today + 3` dias (inclusive). |
| | Virada de Mês / Ano | Validação com datas em transição de mês (ex.: 31 de outubro -> 01 a 03 de novembro) e anos bissextos. |
| | Seção `urgent` | Contém tarefas abertas com prioridade `urgent`. |
| **6. Ordenação, Limites e Consistência** | Ordenação determinística | Prioridade `urgent` no topo, seguida de `deliveryDate` ASC, e desempate por `id` ASC. |
| | Contagem exata (`total`) | `total` reflete o número real de itens da seção antes do corte de `limit`. |
| | Parâmetro `limit` | Suporte a `?limit=10` retornando no máximo 10 itens por seção, preservando `total`. |
| | Validação de `limit` | Rejeição com HTTP 400 para `limit < 1`, `limit > 50` ou valores não numéricos. |
| | Snapshot Consistente | Todas as seções e contagens correspondem ao mesmo snapshot transacional/temporal, sem discrepâncias. |

---

## 3. Matriz de Homologação E2E no Navegador (`.local/phase4-qa-runner.mjs`)

| ID | Cenário / Funcionalidade | Ator | Descrição da Validação no Portal Visível | Critério de Aceitação / Evidência |
| :--- | :--- | :---: | :--- | :--- |
| **P4-BR-01** | Painel Operacional do Administrador | Admin | Monique Borges acessa a aplicação. Aba "Painel" é selecionada como aba inicial padrão. | Cards das seções (`production`, `awaitingAction`, `overdueTasks`, `overdueDemands`, `dueToday`, `upcoming`, `urgent`) renderizados com contagens; tabela/cards de "Carga da equipe" visível com responsáveis e métricas. |
| **P4-BR-02** | Isolamento e Anti-Vazamento do Colaborador | Colaborador | Login com Lucas Designer. Acesso ao Painel. | Exibição restrita apenas às suas tarefas atribuídas; ausência de nomes/tarefas de colegas; ausência completa da seção de "Carga da equipe". |
| **P4-BR-03** | Navegação por Deep-Link para DemandsView | Admin | Clique em botão "Abrir tarefa" e botão "Abrir chamado" dentro do Dashboard. | Navegação suave para a aba "Demandas", abrindo e comprovando cabeçalho com título da tarefa (`.task-header h1`) e título da demanda (`#demand-detail-heading`) para ambos os fluxos. |
| **P4-BR-04** | Atualização Manual com Timestamp e Estado Loading | Admin | Clique no botão "Atualizar" do Dashboard com instrumentação de rede. | Indicador de carregamento transitório (`Atualizando…` ou botão desabilitado); novo payload aplicado no DOM com timestamp no fuso de Cuiabá. |
| **P4-BR-KB** | Navegação e Acessibilidade por Teclado | Admin | Foco via portal e acionamento por teclado (`Enter` e `Space`). | Foco real verificado (`document.activeElement`); acionamento de `Atualizar` via Enter; acionamento de `Abrir tarefa` via Space abrindo a demanda no DOM. |
| **P4-BR-05** | Resiliência a Falha de API e Retentativa | Admin | Interrupção controlada da API (HTTP 500) durante atualização do Dashboard. | Exibição de faixa de erro com botão "Tentar novamente"; restauração do fetch e clique em retentar recupera os dados e remove o erro. |
| **P4-BR-06** | Estado Vazio Amigável | Admin | Visualização do Dashboard sem demandas ou tarefas cadastradas no ambiente. | Exibição de estado vazio amigável e encorajador em todas as seções pendentes. |
| **P4-BR-07** | Responsividade Desktop e Mobile | Layout | Verificação em viewport desktop (1280x800) e mobile (390x844). | `desktopOverflow: false` e `mobileOverflow: false`; cards empilhados adequadamente; cabeçalho e navegação sem corte horizontal. |
| **P4-BR-08** | Integridade de Console e Coleta Estrita de Logs | Runtime | Inspeção de logs capturados do navegador via CLI e in-page tracker. | Disponibilidade de mecanismo de captura ativa comprovada; 0 erros não tratados no console, 0 rejeições não tratadas de Promises, 0 erros HTTP 500, 0 erros React. Indisponibilidade de captura proíbe estritamente registro de `logsClean`. |
| **P4-BR-CLN** | Restauração e Higiene Cirúrgica | QA / Sistema | Bloco `finally` do runner E2E. | Portal restaurado para URL de desenvolvimento (`http://127.0.0.1:5173`); servidores de teste encerrados; leases liberados; 0 registros órfãos em `orium_test`. |

---

## 4. Protocolo de Execução e Diretrizes Especiais

1. **Gestão de Quota do Better Auth:**
   - O Better Auth limita requisições de login a 5 por minuto por IP (`127.0.0.1`).
   - O runner utilizará o mecanismo comprovado `waitForSignInQuota()` (máx. 3 logins recentes por janela de 65s) para prevenir qualquer bloqueio 429 durante a suíte.
2. **Avaliação Segura no Maestri Portal:**
   - Wrappers de comando rejeitam estritamente saídas com prefixo `Error:` ou `error:` mesmo com exit code 0.
   - Em caso de falha de comando do Maestri, execução imediata de `maestri debug` para diagnóstico de canal antes de qualquer retentativa.
3. **Isolamento de Portas e Serviços:**
   - Antes de subir os serviços de teste, verificação de disponibilidade via `Find-FreePort.ps1` com leases registrados.
   - O ambiente `orium_dev` (55432 / 3002 / 5173) permanece estritamente intocado.
4. **Relatórios e Evidências:**
   - Registro de evidências estruturadas em `.local/phase4-qa-results.json`.
   - Compilação do relatório formal em [`docs/PHASE4-BROWSER-REPORT.md`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/docs/PHASE4-BROWSER-REPORT.md) contendo os 9 recibos de teste.
   - Registro de início, evidências e conclusão exclusivamente na seção `## Antigravity QA` de `oriumsystem-acompanhamento`.
