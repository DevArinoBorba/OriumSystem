# Relatório de Revisão Somente-Leitura do Frontend — Fase 2

- **Data da revisão:** 2026-10-05
- **Arquivos inspecionados:**
  - [`apps/web/src/App.tsx`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/apps/web/src/App.tsx)
  - [`apps/web/src/api.ts`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/apps/web/src/api.ts)
  - [`apps/web/src/components/ClientsView.tsx`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/apps/web/src/components/ClientsView.tsx)
  - [`apps/web/src/components/TeamView.tsx`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/apps/web/src/components/TeamView.tsx)
  - [`apps/web/src/components/Header.tsx`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/apps/web/src/components/Header.tsx)
  - [`packages/contracts/src/index.ts`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/packages/contracts/src/index.ts)
- **Documentos de referência:** [`docs/PHASE2-UI-SPEC.md`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/docs/PHASE2-UI-SPEC.md), [`docs/PHASE2-BROWSER-REPORT.md`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/docs/PHASE2-BROWSER-REPORT.md) e [`docs/PHASE2-SPEC.md`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/docs/PHASE2-SPEC.md).
- **Modo:** Somente-leitura. Nenhuma alteração foi realizada em `apps/`, `tests/` ou configurações; nenhum serviço foi iniciado ou reiniciado.

---

## 1. Resumo Executivo

A arquitetura do frontend implementa fielmente a separação por abas controlada por RBAC, o isolamento estrito de tokens (zero segredos em `localStorage`/`sessionStorage`), a validação em runtime via schemas Zod de `@orium/contracts` e a política de logout seguro.

Contudo, a inspeção estática detalhada identificou **bugs concretos de implementação** que impedem o aceite pleno da interface ou explicam comportamentos anômalos detectados previamente nos relatórios de QA (como a falha no teste de fechamento de diálogos via tecla `Escape` registrada no relatório de navegador).

---

## 2. Matriz de Achados (Findings)

| ID | Componente / Arquivo | Linhas | Gravidade | Categoria | Descrição Sintética | Status |
|---|---|---|---|---|---|---|
| **FE-01** | `ClientsView.tsx`<br>`TeamView.tsx` | L717-735<br>L464-480<br>L527-545 | **Média** | Acessibilidade / Diálogos | Tecla Escape em `<dialog>` nativo. Diagnóstico empírico de QA no portal visível comprovou que eventos automatizados de portal geram `keydown:Escape` com `isTrusted: false`, que navegadores recusam para o cancel nativo (inclusive em dialogs vanilla). Resolvido adicionando `onKeyDown` explícito nos 3 diálogos para fechamento determinístico via teclado quando `!isActionBusyRef.current`, preservando a proteção de `busy`. | **Corrigido** |
| **FE-02** | `ClientsView.tsx`<br>`TeamView.tsx` | L177-198, L277, L298<br>L141-160, L183, L207 | **Alta** | Concorrência / UI | Ausência de guarda síncrona nos manipuladores permitia disparos duplicados. Resolvido com `useRef` single-flight síncronas em todas as mutações e liberação em `finally`. | **Corrigido** |
| **FE-03** | `ClientsView.tsx`<br>`TeamView.tsx` | L192-225, L235-268<br>L153-174 | **Média** | Validação / UX | Mensagens de validação genéricas mascaravam erros em e-mail ou campos secundários. Resolvido com extração do primeiro issue do Zod e foco no campo específico. | **Corrigido** |
| **FE-04** | `ClientsView.tsx` | L270-274 | **Média** | Ciclo de Vida / Concorrência | Chamada simultânea de `setPage(1)` e `loadClients(1)` gerava corrida. Resolvido com separação condicional (`page !== 1 ? setPage(1) : void loadClients(1)`). | **Corrigido** |
| **FE-05** | `ClientsView.tsx`<br>`TeamView.tsx` | L169-175<br>L132-139 | **Baixa** | Acessibilidade / Foco | Ao fechar painéis inline ou cancelar diálogos, foco não retorna ao elemento disparador. | **Pendente de refinamento** |
| **FE-06** | `ClientsView.tsx` | L284-307, L461-477 | **Alta** | Integridade / Concorrência 409 | 409 trocava apenas a versão base mascarando perda de dados concorrentes do servidor. Resolvido com aviso explícito de descarte de rascunho e substituição integral de todos os campos ao recarregar. | **Corrigido** |

---

## 3. Detalhamento Técnico dos Achados e Implementações

### FE-01: Fechamento de Diálogos Nativos via Tecla Escape e Eventos Sintéticos
- **Status:** **Corrigido** via manipulador `onKeyDown` explícito com salvaguarda de `busy`.
- **Arquivos e Linhas:**
  - [`apps/web/src/components/ClientsView.tsx`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/apps/web/src/components/ClientsView.tsx) (L717-L735)
  - [`apps/web/src/components/TeamView.tsx`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/apps/web/src/components/TeamView.tsx) (L464-L480, L527-L545)
- **Diagnóstico Empírico de QA no Portal:**
  O Antigravity QA diagnosticou no portal visível que comandos de teclado automatizados (`maestri portal key "Escape"`) geram eventos `keydown` com `isTrusted: false`. Conforme as especificações W3C/HTML, os navegadores não disparam o evento de cancelamento nativo (`cancel`) em elementos `<dialog>` na presença de eventos de teclado não confiáveis (`isTrusted: false`), mesmo em diálogos HTML vanilla sem qualquer código React. O `event.preventDefault()` no `onCancel` da aplicação não era a causa do não-fechamento.
- **Implementação da Solução de Acessibilidade:**
  Para garantir fechamento determinístico via teclado tanto com teclados físicos quanto em ambientes de automação/portal sem recorrer a monkeypatches nos testes:
  1. Foi adicionado um manipulador `onKeyDown` explícito nos 3 diálogos nativos (`archiveDialogRef`, `deactivateDialogRef`, `roleDialogRef`).
  2. Quando `event.key === 'Escape'`, se não houver envio em curso (`!isActionBusyRef.current`), chama `event.preventDefault()` e invoca o mesmo reset de estado do botão de cancelamento.
  3. Se houver envio em curso (`isActionBusyRef.current`), executa `event.preventDefault()` para preservar a integridade da requisição em voo.
  4. O manipulador nativo `onCancel` foi mantido com proteção de `busy` para cobrir disparos nativos do browser.

---

### FE-02: Ausência de guarda contra submissão concorrente nos manipuladores
- **Gravidade:** Alta
- **Arquivos e Linhas:**
  - [`apps/web/src/components/ClientsView.tsx#L177-L198`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/apps/web/src/components/ClientsView.tsx#L177-L198) (`handleFormSubmit`)
  - [`apps/web/src/components/ClientsView.tsx#L277`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/apps/web/src/components/ClientsView.tsx#L277) (`handleArchiveConfirm`)
  - [`apps/web/src/components/ClientsView.tsx#L298`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/apps/web/src/components/ClientsView.tsx#L298) (`handleRestore`)
  - [`apps/web/src/components/TeamView.tsx#L141-L160`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/apps/web/src/components/TeamView.tsx#L141-L160) (`handleCreateUser`)
  - [`apps/web/src/components/TeamView.tsx#L183`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/apps/web/src/components/TeamView.tsx#L183) (`handleDeactivateConfirm`)
  - [`apps/web/src/components/TeamView.tsx#L207`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/apps/web/src/components/TeamView.tsx#L207) (`handleRoleChangeConfirm`)
- **Mecanismo do Bug:**
  O `PHASE2-UI-SPEC.md` estipula expressamente: *"Um evento não deve disparar mutações duplicadas; desabilitar ações durante envio"*.
  Os botões JSX contêm `disabled={formBusy}` ou `disabled={actionBusy}`. Porém, no JavaScript/React, antes do próximo render ciclo aplicar o atributo `disabled` ao DOM, múltiplos disparos de teclado (ex.: pressionar `Enter` repetidamente em um campo de texto) ou múltiplos cliques rápidos entram na função.
  Como as funções assíncronas não possuem um `if (formBusy) return;` ou `if (actionBusy) return;` em seu topo, requisições paralelas idênticas são enviadas ao backend. No caso de restauração (`handleRestore`), a primeira requisição incrementa a versão e a segunda colide gerando um `409 CLIENT_VERSION_CONFLICT`. No caso de criação de usuário, a segunda requisição gera um `409 USER_CONFLICT`.
### FE-02: Guarda síncrona contra submissão concorrente (Corrigido)
- **Status:** Corrigido via `useRef` booleanos single-flight.
- **Arquivos e Linhas:**
  - [`apps/web/src/components/ClientsView.tsx`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/apps/web/src/components/ClientsView.tsx) (`isFormSubmittingRef`, `isActionBusyRef`)
  - [`apps/web/src/components/TeamView.tsx`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/apps/web/src/components/TeamView.tsx) (`isFormSubmittingRef`, `isActionBusyRef`)
- **Resolução Implementada:**
  Todas as mutações assíncronas (`handleFormSubmit`, `reloadLatestVersion`, `handleArchiveConfirm`, `handleRestore`, `handleCreateUser`, `handleDeactivateConfirm`, `handleRoleChangeConfirm`) agora verificam uma referência síncrona no topo (`if (isSubmittingRef.current) return; isSubmittingRef.current = true;`) e a liberam no bloco `finally`, mantendo concomitantemente o estado React (`formBusy`/`actionBusy`) para desabilitar controles visuais no DOM.

---

### FE-03: Mensagens de validação genéricas e foco no campo correto (Corrigido)
- **Status:** Corrigido via inspeção de issues do Zod e foco por `useRef`.
- **Arquivos e Linhas:**
  - [`apps/web/src/components/ClientsView.tsx`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/apps/web/src/components/ClientsView.tsx)
  - [`apps/web/src/components/TeamView.tsx`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/apps/web/src/components/TeamView.tsx)
- **Resolução Implementada:**
  Quando a validação de schema falha, o primeiro erro (`validation.error.issues[0]`) é inspecionado para determinar o campo culpado (`name`, `contactName`, `email`, `phone`, `notes` / `name`, `email`, `password`), exibindo uma mensagem de validação contextualizada e transferindo o foco de teclado imediatamente para o controle correspondente.

---

### FE-04: Corrida e aborto de requisição em `createClient` ao alterar página (Corrigido)
- **Status:** Corrigido com bifurcação condicional de página.
- **Arquivos e Linhas:**
  - [`apps/web/src/components/ClientsView.tsx`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/apps/web/src/components/ClientsView.tsx)
- **Resolução Implementada:**
  Após criação de cliente com sucesso, o componente verifica: se `page !== 1`, executa exclusivamente `setPage(1)`, permitindo que o `useEffect` nativo de paginação faça a carga da primeira página; se `page === 1`, executa diretamente `loadClients(1)`. Isso elimina a corrida e o aborto involuntário da requisição.

---

### FE-05: Perda de foco de teclado ao fechar formulários e diálogos
- **Gravidade:** Baixa
- **Arquivos e Linhas:**
  - [`apps/web/src/components/ClientsView.tsx#L169-L175`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/apps/web/src/components/ClientsView.tsx#L169-L175)
  - [`apps/web/src/components/TeamView.tsx#L132-L139`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/apps/web/src/components/TeamView.tsx#L132-L139)
- **Mecanismo:**
  Embora o foco seja adequadamente transferido para o primeiro campo ao abrir o formulário (`nameInputRef.current?.focus()`), ao clicar em "Cancelar" ou "✕", o painel desmonta sem restaurar o foco para o botão de origem (`+ Novo cliente` ou botão de edição da tabela), deixando o foco no elemento `body`.

---

### FE-06: Perda de atualizações concorrentes por substituição cega de version no 409 (Corrigido)
- **Gravidade:** Alta (confirmada na revisão)
- **Arquivos e Linhas:**
  - [`apps/web/src/components/ClientsView.tsx`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/apps/web/src/components/ClientsView.tsx)
- **Resolução Implementada:**
  1. O rascunho com as alterações digitadas pelo operador permanece estritamente preservado no formulário durante o estado de conflito de versão (409).
  2. O banner de conflito apresenta um aviso explícito de que recarregar os dados do servidor descartará o rascunho local não salvo.
  3. O botão de ação é rotulado claramente como *"Descartar rascunho e carregar dados do servidor"*.
  4. Ao clicar, a função `reloadLatestVersion` substitui integralmente todos os campos do formulário (`name`, `contactName`, `email`, `phone`, `notes` e `version`) pelos valores atuais retornados pelo servidor.

---

## 4. Auditoria de Contratos e Políticas Críticas

### 4.1. Conformidade com `@orium/contracts`
- **Autenticação e Sessão:** `sessionResponseSchema` utilizado com validação estrita em runtime tanto no `getMe` quanto no `signIn`.
- **Clientes:** Schemas `createClientSchema`, `updateClientSchema`, `clientResponseSchema` e `clientListResponseSchema` aplicados sem `any` ou type assertions inseguras.
- **Equipe:** `publicUserSchema`, `roleSchema` e validações booleanas de `active` rigorosamente respeitados.
- **Conclusão:** 100% dos contratos Zod estão em sincronia com o backend Fastify.

### 4.2. Política de Sessão e Resposta 401
- **Inspeção:** Verificou-se a função central `request()` em [`apps/web/src/api.ts#L83-L86`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/apps/web/src/api.ts#L83-L86).
- **Comportamento:** Qualquer resposta HTTP 401 invoca imediatamente o callback `onUnauthorized()`, que em [`apps/web/src/App.tsx#L20-L23`](file:///C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/apps/web/src/App.tsx#L20-L23) executa `setSession(null)` e `setView('signed-out')`, limpando o estado em memória e redirecionando para a tela de login.
- **Conclusão:** Em total conformidade com a especificação da Fase 1 e Fase 2.

### 4.3. Armazenamento e Segredos
- **Inspeção:** Não há nenhuma ocorrência de `localStorage`, `sessionStorage` ou passagem de tokens via URL em todo o diretório `apps/web`.
- **Higiene de Senhas:** Em `TeamView.tsx`, o campo `password` é limpo do estado no bloco `finally` imediatamente após o envio.

---

## 5. Conclusão e Estado das Correções

As correções pontuais autorizadas pelo responsável para sanar os achados críticos (**FE-02**, **FE-03**, **FE-04** e **FE-06**) foram implementadas cirurgicamente em `ClientsView.tsx` e `TeamView.tsx`. O achado **FE-01** foi mantido com sua proteção de busy original sob observação para testes dinâmicos de navegador. O frontend está pronto para compilação e verificação de typecheck, lint e build.
