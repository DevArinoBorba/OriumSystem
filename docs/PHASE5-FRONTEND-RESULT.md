# Relatório de Implementação Frontend — Página de Materiais (Fase 5)

Este documento registra a entrega completa do frontend da página **Materiais** do OriumSystem, implementada de acordo com o contrato autoritativo `docs/PHASE5-IMPLEMENTATION-CONTRACT.md` e a autorização do responsável em 2026-10-07 concedendo permissão a colaboradores para criar e editar materiais vinculados aos seus trabalhos atribuídos.

---

## 1. Princípios de Design e Arquitetura (Impeccable Brief)

### THESIS (Tese Central)
A interface de **Materiais** transforma links e referências externas em ativos estruturados, auditáveis e seguros. Diferente de um repositório genérico de links, a tela vincula cada material estritamente a um Cliente, Chamado ou Tarefa, garantindo controle de acesso preciso por papel, integridade de concorrência e proteção absoluta contra esquemas de URLs perigosos.

### STORY (Fluxo de Interação e Perfis)
1. **Administrador**:
   - Visualiza todos os materiais da agência com filtros de cliente, categoria e status.
   - Pode criar materiais associados apenas ao cliente ou a chamados/tarefas específicos.
   - Possui exclusividade de arquivamento (`materials.archive`) e restauração.
   - Acessa o histórico transacional completo com visualização de diff de alterações.
2. **Colaborador**:
   - Visualiza estritamente os materiais vinculados a chamados e tarefas sob sua responsabilidade.
   - Pode criar novos materiais vinculando-os obrigatoriamente a um chamado ou tarefa a que tem acesso.
   - Pode editar materiais existentes mantendo os vínculos estruturais imutáveis.
   - Não visualiza opções nem registros pertencentes a terceiros.

### FIRST VIEWPORT (Primeira Impressão e Layout)
- **Cabeçalho Integrado**: Aba "Materiais" com realce de aba ativa (`.nav-tab.active`) e `aria-current="page"`.
- **Barra de Controle Superior**:
  - Formulário semântico de pesquisa com campo acessível e botão "Limpar busca".
  - Seletor de alvos (`.client-select-filter`) populado dinamicamente via `/api/v1/materials/targets?kind=client`.
  - Pílulas de filtro por status (`Ativos`, `Arquivados`, `Todos`).
  - Pílulas de categorias com cores e rótulos específicos (`Briefing`, `Ativo de Marca`, `Referência`, `Copy`, `Arquivo Bruto`, `Entregável`, `Credencial`, `Outro`).
- **Tabela de Dados Paginada**:
  - Cabeçalhos semânticos com `scope="col"`.
  - Coluna de título com descrição truncada em até 2 linhas (`-webkit-line-clamp: 2`).
  - Coluna de link externo com ícone `🔗`, truncamento elíptico e abertura segura (`noopener noreferrer`).
  - Coluna de vínculos estruturais em hierarquia visual (Cliente / Chamado / Tarefa).
  - Coluna de versão (`v1`, `v2`, etc.) e data formatada no fuso de Cuiabá.

### FORM (Formulário, Concorrência Otimista, Seletores Paginados e Proteção de URLs)
- **Validação Estrita de URLs**:
  - Esquemas aceitos: exclusivamente `http://` e `https://`.
  - Rejeição imediata com foco no campo de URLs com credenciais embutidas (`username:password@`) ou esquemas perigosos (`javascript:`, `data:`, `file:`).
- **Imutabilidade de Vínculos Estruturais e Duplicação Segura (Revisão de Segurança Codex)**:
  - Conforme revisão de segurança da arquitetura para evitar expor histórico/URLs anteriores de outro trabalho ao mover materiais, os vínculos de Cliente, Chamado e Tarefa são estritamente **imutáveis para ambos os papéis** após a criação.
  - No formulário de edição, os vínculos são exibidos em modo somente-leitura (`.immutable-links-box`) e o payload do PATCH omite deliberadamente `clientId`, `demandId` e `taskId`, enviando exclusivamente `title`, `description`, `category`, `url` e `version`.
  - Para associar um mesmo link a outro trabalho, a interface disponibiliza o recurso **Duplicar** (na tabela e no painel de edição), criando um novo cadastro com novo identificador e histórico isolado, sem transferir o histórico ou dados anteriores.
- **Seletores de Alvos Paginados e Anti-Race-Condition (Revisão Codex)**:
  - Superado o limite fixo de 50 registros: implementada busca textual em tempo real (`q`) e paginação no servidor (`page`, `pageSize: 20`) para clientes, chamados e tarefas via `/api/v1/materials/targets`.
  - Removidos catches silenciosos: exibição de banners inline de erro (`.target-error-inline`) com botões "Tentar novamente".
  - Proteção estrita contra race conditions: cada seletor possui seu próprio `AbortController` cancelado na próxima busca ou desmontagem do componente, e checagem de referências (`activeClientIdRef`, `activeDemandIdRef`) garantindo que respostas lentas de seleções anteriores não sobrescrevam a seleção atual.
  - Retenção memorizada das opções ativas (`formClientOptions`, `formDemandOptions`, `formTaskOptions`, `filterClientOptions`), evitando reset indesejado do elemento nativo `<select>` quando navegar entre páginas da busca de alvos.
- **Permissões Estritas e Limpeza em 403 (Revisão Codex)**:
  - Removido qualquer bypass artificial `|| isAdmin` para as permissões `materials.read`, `materials.write` e `materials.archive` em `Header.tsx`, `App.tsx`, `MaterialsView.tsx`, `ClientsView.tsx` e `DemandsView.tsx`. O backend é autoridade total sobre o acesso.
  - Em caso de resposta HTTP 403, a interface executa wipe imediato de materiais, contadores, seletores de alvos e seleções ativas, garantindo conformidade com revogação dinâmica de privilégios.
- **Resolução de Concorrência Otimista (HTTP 409)**:
  - Envio do campo `version` em mutações de atualização.
  - Caso outro usuário atualize o material concorrentemente, o servidor responde `409` (`MATERIAL_VERSION_CONFLICT`).
  - O formulário captura o erro, exibe banner informativo claro e **preserva integralmente o rascunho digitado pelo usuário**.
  - O usuário conta com o botão de ação "Descartar rascunho e carregar dados do servidor", que faz fetch da versão mais recente via `api.getMaterial`.
- **Trava Single-Flight (`isSubmittingRef`)**:
  - Bloqueio imediato contra duplo clique ou submissões concorrentes em trânsito.

### FINISH (Histórico Transacional, Acessibilidade e Mobile)
- **Histórico com Diff Transacional**:
  - Diálogo nativo `<dialog className="native-dialog history-dialog">` com lista ordenada de eventos.
  - Exibição de alterações campo a campo (`.change-row`) com valor anterior tachado em vermelho (`.change-before`), seta indicativa (`→`) e novo valor em verde (`.change-after`).
- **Acessibilidade por Teclado Nativa**:
  - Sem uso de bridges ou emulações sintéticas.
  - Fechamento de diálogos nativos e formulários inline via tecla `Escape`.
  - Foco inicial posicionado automaticamente no campo de título ao abrir o formulário.
- **Responsividade (< 640px)**:
  - Barras de filtros e ações rearranjam-se verticalmente sem quebras ou transbordamento horizontal.
  - Links externos limitam largura com elipse sem estourar o card.

---

## 2. Evidências de Verificação Técnica

### A. Checagem de Tipos TypeScript
```
Command: pnpm --filter @orium/web exec tsc --noEmit
Exit Code: 0
Result: Nenhum erro de tipagem. Todos os contratos @orium/contracts consumidos estritamente sem tipos artificiais ou 'any'.
```

### B. Checagem de Linter ESLint
```
Command: pnpm exec eslint apps/web/src
Exit Code: 0
Result: 0 errors, 0 warnings.
```

---

## 3. Arquivos Modificados e Criados (Frontend Ownership)

| Arquivo | Ação | Descrição |
|---|---|---|
| `apps/web/src/types.ts` | Modificado | Adicionado `'materials'` a `ActiveTab`, re-exportação de tipos de contratos de materiais, tipos de estado de formulário, conflito 409 e navegação contextual. |
| `apps/web/src/api.ts` | Modificado | Implementadas 8 funções cliente da API de Materiais (`getMaterials`, `getMaterial`, `createMaterial`, `updateMaterial`, `archiveMaterial`, `restoreMaterial`, `getMaterialHistory`, `getMaterialTargets`). |
| `apps/web/src/components/Header.tsx` | Modificado | Adicionado botão de navegação `Materiais` com checagem de permissão `materials.read` / admin. |
| `apps/web/src/components/MaterialsView.tsx` | Criado | Componente completo da tela de Materiais com CRUD, seletores paginados, validação de URL segura, 409 com preservação de rascunho, modal de histórico com diff e acessibilidade nativa. |
| `apps/web/src/App.tsx` | Modificado | Chaveamento da view `materials`, gerenciamento de navegação contextual (`materialNavTarget`), abortamento de requisições e integração de links. |
| `apps/web/src/components/ClientsView.tsx` | Modificado | Adicionado botão contextual "Materiais" na tabela de clientes direcionando para a aba Materiais com pré-filtro do cliente. |
| `apps/web/src/components/DemandsView.tsx` | Modificado | Adicionado botão contextual "Materiais" na lista e no painel de detalhes do chamado direcionando com pré-filtro de cliente e chamado. |
| `apps/web/src/styles.css` | Modificado | Regras de estilo para `.materials-view`, `.materials-toolbar`, `.immutable-links-box`, `.external-link-anchor`, `.native-dialog.history-dialog`, diffs e regras responsivas. |
| `docs/PHASE5-UI-CHECKLIST.md` | Modificado | Checklist executável atualizado com todos os 6 eixos concluídos e validados. |
| `docs/PHASE5-FRONTEND-RESULT.md` | Criado | Este relatório detalhado de entrega. |

---

## 4. Preservação de Ambientes e Segurança
- O ambiente DEV (PostgreSQL 55432, API 3002, Web 5173) e contas/dados existentes permanecem totalmente preservados e intactos.
- Nenhuma migration de backend foi executada no banco de DEV (conforme restrição: Codex revisa antes).
- Nenhuma alteração foi realizada em arquivos fora da ownership de frontend (sem tocar em `apps/api/*`, `packages/contracts/*`, migrations ou runners da Fase 4).
