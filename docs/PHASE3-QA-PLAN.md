# Plano de Testes e Homologação de QA — Fase 3 (Demandas e Tarefas)

Data da Revisão: 2026-10-06  
Status: **HOMOLOGAÇÃO COMPLETA APROVADA (151/151 TESTES VITEST + 16/16 TESTES BROWSER E2E, 0 FAILS, EXIT 0)**  
Autor: **Antigravity QA** (validador exclusivo de QA no portal visível)  
Fronteira Documental e Ownership:
- Dono exclusivo de: [`docs/PHASE3-QA-PLAN.md`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/docs/PHASE3-QA-PLAN.md), [`docs/PHASE3-BROWSER-REPORT.md`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/docs/PHASE3-BROWSER-REPORT.md), [`tests/demands.integration.test.ts`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/tests/demands.integration.test.ts), [`.local/phase3-qa-*`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/.local) e seção `## Antigravity QA` na nota contínua.
- Antigravity backend completou contratos/backend; OpenCode entregou frontend; Antigravity QA entregou TaskDetailView.tsx; Codex coordena.
Documentos de Referência: [`docs/PHASE3-IMPLEMENTATION-CONTRACT.md`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/docs/PHASE3-IMPLEMENTATION-CONTRACT.md) (contrato executável definitivo), [`docs/PHASE3-BROWSER-REPORT.md`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/docs/PHASE3-BROWSER-REPORT.md), [`PROJECT_CONTEXT.md`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/PROJECT_CONTEXT.md), [`ROADMAP.md`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/ROADMAP.md), [`docs/adr/0005-inicio-explicito-tarefa.md`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/docs/adr/0005-inicio-explicito-tarefa.md), [`docs/adr/0008-matriz-colaboradores-designers-fase3.md`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/docs/adr/0008-matriz-colaboradores-designers-fase3.md), [`C:/Users/arino/.maestri/PORT_POLICY.md`](file:///C:/Users/arino/.maestri/PORT_POLICY.md).

> [!IMPORTANT]
> **STATUS DA EXECUÇÃO:**  
> 1. Suíte Vitest contra `orium_test` (5433): 151 testes executados, 151 aprovados (151 PASS, 0 FAIL, 0 SKIP, exit code 0).  
> 2. Suíte Browser E2E contra portal visível `Orium - Codex visivel` sob `PORT_POLICY.md`: 16 testes executados, 16 aprovados (16 PASS, 0 FAIL, 0 SKIP, exit code 0).  
> 3. Higiene pós-teste: 0 registros órfãos em `orium_test`.  
> 4. Preservação de ambiente: `orium_dev` (55432) 100% intacto e preservado.  
> 5. Relatório oficial detalhado registrado em [`docs/PHASE3-BROWSER-REPORT.md`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/docs/PHASE3-BROWSER-REPORT.md).

---

## 1. Diretrizes de QA e Modalidades de Teste

### 1.1. Objetivo
Homologar a **Fase 3 (Demandas e Tarefas)** com base no contrato executável definitivo [`docs/PHASE3-IMPLEMENTATION-CONTRACT.md`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/docs/PHASE3-IMPLEMENTATION-CONTRACT.md), validando autorização por atribuição, prevenção de IDOR, integridade do DAG (grafo de dependências), ciclo de prontidão (`ready_at`) desacoplado de início (`started_at`), fluxo de pausa aprovada por Monique e rastreabilidade total.

### 1.2. Delimitação das Modalidades de Teste
1. **Testes Automatizados de Integração e Unidade (Headless / CLI):**
   - Implementados em [`tests/demands.integration.test.ts`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/tests/demands.integration.test.ts) utilizando o harness real Fastify inject contra PostgreSQL isolado (`TEST_DATABASE_URL`).
   - São testes automatizados headless/CLI padrão, rápidos e determinísticos.
2. **Homologação E2E de Navegador (Portal Visível Mandatório):**
   - A etapa final de validação visual de formulários, navegação e feedback de usuário exige obrigatoriamente o portal visível no canvas Maestri (`Orium - Codex visivel`).
   - Proibido declarar homologação visual apenas com testes headless.
3. **Isolamento de Ambiente e Portas (`PORT_POLICY.md`):**
   - Execução restrita ao banco de testes (`TEST_DATABASE_URL`, porta 5433).
   - Portas temporárias alocadas exclusivamente via [`Find-FreePort.ps1`](file:///C:/Users/arino/.maestri/Find-FreePort.ps1).
   - Ambiente de desenvolvimento (`orium_dev` na porta 55432, API dev na 3001, Web dev na 5173) rigorosamente preservado.

---

## 2. PARTE I — Testes Preparados na Suíte de Integração (`tests/demands.integration.test.ts`)

A suíte real [`tests/demands.integration.test.ts`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/tests/demands.integration.test.ts) implementa os seguintes blocos de asserção:

### 2.1. Autenticação, RBAC e Deny-by-default Estrito
- **TC-P3-AUTH-01 (401 Geral):** Rotas não autenticadas de demandas e tarefas retornam HTTP 401.
- **TC-P3-AUTH-02 (`GET /clients` 403):** Rota global de clientes administrativos permanece estritamente HTTP 403 `FORBIDDEN` para colaboradores (sem alternativa de 200 `[]`).
- **TC-P3-AUTH-03 (Lista Vazia):** Colaborador sem demandas atribuídas recebe HTTP 200 com lista vazia `{ demands: [] }` em `GET /api/v1/demands`.
- **TC-P3-AUTH-04 (Bloqueio de Gestão):** Colaboradores são impedidos de criar demandas, criar tarefas ou concluir demandas com HTTP 403.

### 2.2. Visibilidade Vinculada por Atribuição e Prevenção de IDOR
- **TC-P3-IDOR-01 (Projeção Limitada):** Colaborador A enxerga apenas a demanda atribuída. A projeção do cliente contém estritamente `{ id, name }`; contatos, notas confidenciais e dados financeiros são omitidos.
- **TC-P3-IDOR-02 (Isolamento Horizontal de Demandas):** Colaborador A tentando acessar Demanda B recebe 404 (ou 403).
- **TC-P3-IDOR-03 (Isolamento Horizontal de Tarefas):** Colaborador A tentando ler ou executar ações na Tarefa B recebe 404 (ou 403).
- **TC-P3-IDOR-04 (Isolamento de Comentários):** Colaborador A não consegue ler nem postar comentários na Tarefa B.
- **TC-P3-IDOR-05 (Isolamento de Histórico):** Colaborador A não acessa histórico de demandas alheias.

### 2.3. Privacidade em Demanda Compartilhada entre Colaboradores
- **TC-P3-PRIV-01:** Na Demanda D_Shared com Tarefa T_A (Colab A) e Tarefa T_B (Colab B), Colaborador A visualiza apenas `[T_A]`; Tarefa T_B, seus comentários e seu histórico permanecem inacessíveis.

### 2.4. Aceite Obrigatório vs. Início Explícito (ADR-0005)
- **TC-P3-STG-01:** Tarefa nasce em status `blocked` quando há requisitos obrigatórios não satisfeitos.
- **TC-P3-STG-02:** Ação de aceite (`POST /tasks/:id/accept`) grava `acceptedAt`, mantém status `blocked` e relógio operacional não inicia (`startedAt` null).
- **TC-P3-STG-03:** Tentativa de `POST /tasks/:id/start` antes dos requisitos atendidos retorna HTTP 409/422.
- **TC-P3-STG-04:** Ao satisfazer requisitos (`PATCH /requirements/:id`), status avança para `ready` (`readyAt` gravado), mantendo `startedAt` null.
- **TC-P3-STG-05:** Ação explícita de início (`POST /tasks/:id/start`) transiciona para `in_production` e grava `startedAt`.

### 2.5. Grafo de Dependências e Liberação após Revisão Concluída
- **TC-P3-DEP-01:** Tarefa dependente (T_Dev) permanece `blocked` enquanto a tarefa pré-requisito (T_Art) não estiver concluída.
- **TC-P3-DEP-02:** Submissão de T_Art para revisão (`in_production` -> `in_review`) mantém T_Dev bloqueada.
- **TC-P3-DEP-03:** Solicitação de ajustes (`review` com `changes_requested`) mantém T_Dev bloqueada.
- **TC-P3-DEP-04:** Aprovação de T_Art (`review` com `complete`) grava `completedAt` e libera automaticamente T_Dev para `ready`.

### 2.6. Inserções Concorrentes de Ciclos no Grafo (Race Condition A ↔ B)
- **TC-P3-CYC-01:** Inserção simultânea cruzada (A depende de B e B depende de A no mesmo milissegundo): exatamente uma requisição obtém sucesso (200/201) e a requisição concorrente é rejeitada com HTTP 400 (`DEPENDENCY_CYCLE_DETECTED`) ou 409, garantindo zero ciclos no banco.

### 2.7. Concorrência Otimista (Version 409)
- **TC-P3-CONC-01:** Mutação com versão defasada em demanda ou tarefa é rejeitada com HTTP 409 `VERSION_CONFLICT`.

### 2.8. Fluxo de Pausa e Prorrogação (Decisão de Negócio Confirmada)
- **TC-P3-PAUSE-01 (Solicitação de Pausa):** Colaborador em `in_production` solicita pausa (`POST /tasks/:id/request-pause`). **O status PERMANECE `in_production` e a data de entrega PERMANECE inalterada**; grava `pauseRequestedAt` e `pauseReason`.
- **TC-P3-PAUSE-02 (Aprovação por Monique):** Administrador aprova a pausa (`POST /tasks/:id/approve-pause`), definindo **explicitamente nova data de entrega**; status transiciona para `paused`.
- **TC-P3-PAUSE-03 (Retomada Administrativa):** Administrador aciona retomada (`POST /tasks/:id/resume`); status volta para `in_production`, limpa solicitação de pausa e preserva o `startedAt` original.

### 2.9. Reatribuição e Revogação Imediata
- **TC-P3-REASSIGN-01:** Administrador reatribui tarefa antes do primeiro início (`POST /tasks/:id/reassign`). O campo `acceptedAt` é limpo; Colaborador anterior tem o acesso revogado imediatamente (recebe 404/403 na próxima requisição); novo colaborador ganha acesso.

### 2.10. Conclusão da Demanda
- **TC-P3-COMPL-01:** `POST /demands/:id/complete` rejeita com 409/422 se houver tarefas não concluídas; permite conclusão com sucesso apenas quando todas as tarefas estiverem `completed`.

### 2.11. Validação Estrita de Input: Datas Inexistentes no Calendário e URLs Inseguras (Anti-XSS)
- **TC-P3-VAL-01 (Datas Inexistentes no Calendário):** Rejeição com HTTP 400 `INVALID_INPUT` para datas fora do calendário real (ex.: `2026-02-30`, `2026-04-31`, `2025-02-29`, `2026-13-01`) em criação de demandas (`POST /api/v1/demands`), criação de tarefas (`POST /api/v1/tasks`) e aprovação de pausas com nova data (`POST /api/v1/tasks/:id/approve-pause`).
- **TC-P3-VAL-02 (Anti-XSS em previewUrl):** Rejeição com HTTP 400 `INVALID_INPUT` na submissão de revisão (`POST /api/v1/tasks/:id/submit-review`) para esquemas de URL perigosos (`javascript:`, `data:`, `vbscript:`). Aceitação apenas de esquemas seguros (`http:`, `https:`) ou valores nulos/omitidos.

---

## 3. PARTE II — Cenários de Negócio com Escopo Futuro (Fora da Entrega Atual)

Os seguintes pontos foram delimitados no contrato executivo e **NÃO SERÃO ANTECIPADOS**:
1. **Reatribuição pós-início:** Fica fora do fluxo atual (retorna 409 se tentada após início).
2. **Reabertura e Cancelamento em Cascata:** Não serão inventados; demandas concluídas encerram o ciclo.
3. **Classificação e Alertas de Atraso:** Pertencem ao dashboard operacional (Fase 4), não à API da Fase 3.

---

## 4. PARTE III — Especificação de Homologação E2E no Navegador Visível (`Orium - Codex visivel`)

A validação final de aceitação pelo usuário ocorre de ponta a ponta através do portal visível no canvas Maestri, utilizando o runner `.local/phase3-qa-runner.mjs`.

### 4.1. Regras Mandatórias de Execução
1. **Portal Visível:** Execução conduzida via `maestri portal` no portal `Orium - Codex visivel` (`http://127.0.0.1:5173`).
2. **Interações Reais de DOM:** Todos os testes usam comandos reais (`snapshot`, `click`, `fill`, `select`, `type`, `text`). **É estritamente proibido** o uso de fallbacks artificiais de eventos (`dispatchEvent` simulado, monkeypatches) ou edição manual de resultados.
3. **Isolamento de Portas e Serviços (`PORT_POLICY.md`):**
   - Execução de `Find-FreePort.ps1` antes de qualquer startup para reservar portas dedicadas para a API de teste e Web de teste (ex.: 3002 e 5174).
   - O ambiente de desenvolvimento (`orium_dev` na porta 55432, API dev na 3001 e Web dev na 5173) permanece intacto e inalterado.
4. **Higiene do Banco de Testes:** Todas as fixtures de clientes, demandas, tarefas e usuários criados durante o teste são limpos em bloco `finally`, restaurando o portal para a URL de dev (`http://127.0.0.1:5173`) e comprovando 0 registros órfãos.

### 4.2. Matriz de Casos de Teste no Navegador (Fluxo Landing Page)

| ID | Cenário / Fluxo | Ator | Descrição da Ação no Portal Visível | Critério de Aceitação / Evidência DOM |
| :--- | :--- | :---: | :--- | :--- |
| **BR-P3-01** | Autenticação e Navegação para Demandas | Administrador | Login via formulário com credenciais de administrador fixture; navegação até a aba de Demandas. | Tela de Demandas renderizada com lista, botão "Nova Demanda" e filtros de busca. |
| **BR-P3-02** | Criação de Nova Demanda com Data Explícita | Administrador | Preenchimento do modal/form de Demanda: seleção de cliente fixture, título, prioridade e data de entrega válida (`YYYY-MM-DD`). | Demanda criada com sucesso, exibida na lista com status `draft` / `planned` e detalhes correspondentes. |
| **BR-P3-03** | Criação de Tarefas com Requisitos e Dependências | Administrador | Criação de Tarefa A (Design de Telas) com requisito de briefing e atribuição ao Colaborador fixture; criação de Tarefa B (Implementação) dependente de Tarefa A. | Tarefas listadas no detalhe da demanda; Tarefa B com pré-requisito registrado e status `blocked`. |
| **BR-P3-04** | Visibilidade Vinculada e Isolamento do Colaborador | Colaborador | Logout do administrador e login com credenciais do Colaborador. Acesso à aba de Demandas. | Colaborador visualiza apenas a demanda em que possui tarefas; Tarefa A visível; detalhes confidenciais de cliente omitidos. |
| **BR-P3-05** | Ciclo de Aceite da Tarefa (`ready` sem aceite) | Colaborador | Colaborador abre Tarefa A: status `ready` ou `blocked`; botão "Aceitar Tarefa" exibido; botão "Iniciar Produção" desabilitado com aviso explicativo. | Ao clicar em "Aceitar Tarefa", `acceptedAt` é persistido; aviso orienta aguardar liberação/iniciar. |
| **BR-P3-06** | Início da Produção pelo Assignee | Colaborador | Com requisitos atendidos e tarefa aceita, colaborador clica em "Iniciar Produção" (`POST /start`). | Status transiciona para `in_production`, botão muda de estado; relógio operacional iniciado. |
| **BR-P3-07** | Solicitação e Aprovação de Pausa (Monique) | Colab / Admin | Colaborador solicita pausa informando motivo; Admin autentica e aprova a pausa com novo prazo (`YYYY-MM-DD`); Admin retoma. | Solicitação não altera status imediatamente; aprovação avança para `paused` com nova data; retomada volta para `in_production`. |
| **BR-P3-08** | Submissão de Revisão com URL Segura e Ajustes | Colab / Admin | Colaborador submete para revisão com `previewUrl` (HTTP/HTTPS); Admin avalia e solicita ajustes (`changes_requested`) com feedback. | Tarefa passa para `changes_requested`; Colaborador visualiza botão "Retomar Ajustes" via `/start` e feedback no histórico. |
| **BR-P3-09** | Conclusão da Tarefa e Liberação de Dependente | Colab / Admin | Colaborador retoma, ajusta e ressubmete; Admin aprova com `complete`. | Tarefa A transiciona para `completed`; Tarefa B dependente é automaticamente liberada para `ready`. |
| **BR-P3-10** | Concorrência Otimista (409) e Resiliência de Rascunho | Colaborador | Edição de tarefa com versão defasada simula conflito no servidor. | Mensagem amigável exibida ("Esta tarefa foi atualizada por outra pessoa"); rascunho preservado; botão para descartar e recarregar restaura dados atualizados. |
| **BR-P3-CLN** | Restauração de Ambiente e Higiene Cirúrgica | Sistema / QA | Encerramento do runner em `finally`: retorno do portal para URL de dev, desligamento de serviços de teste e limpeza de dados. | Portal em `http://127.0.0.1:5173`; processos e leases liberados; 0 registros órfãos em `orium_test`. |

---

## 5. Próximos Passos e Critérios de Conclusão da Fase 3

1. **Construção do Runner de Homologação Browser (`.local/phase3-qa-runner.mjs`):**
   - Utilizar o padrão estabelecido no runner da Fase 2: isolamento estrito de portas via `Find-FreePort.ps1`, spawn direto de node para API e Vite de teste, asserções reais no DOM do portal `Orium - Codex visivel`.
2. **Execução Real no Portal Visível:**
   - Executar o runner e registrar screenshots e evidências estruturadas em `.local/phase3-qa-results.json` e `docs/PHASE3-FINAL-BROWSER.md`.
3. **Handoff e Relatório Final:**
   - Registrar evidências completas e contagens finais (sem inventar cobertura ou suprimir falhas).
   - Atualizar a seção oficial na nota compartilhada `oriumsystem-acompanhamento`.

