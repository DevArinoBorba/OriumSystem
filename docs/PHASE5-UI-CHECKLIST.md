# Checklist de UI — Página de Materiais (Fase 5)

Este checklist executável orienta e documenta a implementação e homologação da interface da página **Materiais**, reaproveitando estritamente o ecossistema visual, componentes e padrões de concorrência e acessibilidade estabelecidos no OriumSystem.

---

### 1. Pontos de Integração e Navegação
- [x] **Aba no Cabeçalho (`Header.tsx`)**:
  - [x] Adicionado `'materials'` à união de tipos `ActiveTab` (`types.ts`).
  - [x] Renderização do botão de navegação `Materiais` com classe `.nav-tab`, `aria-current={activeTab === 'materials' ? 'page' : undefined}`.
  - [x] Condicionamento de visibilidade da aba estritamente à permissão autorizada `materials.read` (removido bypass `|| isAdmin` para respeitar autoridade de revogação de permissões do backend).
- [x] **Chaveamento de View (`App.tsx`)**:
  - [x] Integrado `<MaterialsView session={session} onUnauthorized={handleUnauthorized} initialTarget={materialNavTarget} onTargetConsumed={clearMaterialNav} />` no container principal.
  - [x] Condicionamento de renderização da view à permissão estrita `materials.read`.
  - [x] Preservação de estado e abortamento de requisições ativas via `AbortController` no desmontar.
  - [x] Suporte a deep-link e pré-filtro por `clientId`, `demandId` ou `taskId` via `onOpenMaterials` em `ClientsView` e `DemandsView` (ambos condicionados estritamente a `materials.read`).

---

### 2. Componentes e Padrões Reutilizáveis
- [x] **Estrutura de Painel**:
  - [x] Container principal `.view-panel.materials-view` com título e cabeçalho `.panel-header`.
  - [x] Ações primárias no topo (botão `+ Novo material` condicionado estritamente a `hasWrite` sem bypass de administrador).
- [x] **Filtros e Busca**:
  - [x] Campo de busca de texto com submissão semântica por formulário (`noValidate`, `role="search"`).
  - [x] Filtro de cliente `.client-select-filter` populado via `/api/v1/materials/targets?kind=client`, com retenção de cliente filtrado e botão de recarregar em caso de falha.
  - [x] Filtro por status (`Ativos`, `Arquivados`, `Todos`) com semântica `aria-pressed`.
  - [x] Pílulas de filtro por categoria (`Briefing`, `Ativo de Marca`, `Referência`, `Copy`, `Arquivo Bruto`, `Entregável`, `Credencial`, `Outro`).
- [x] **Seletores de Alvos Paginados e Protegidos (Revisão Codex)**:
  - [x] Eliminação de limite estático de 50 registros e buscas completas desnecessárias de catálogo.
  - [x] Busca textual em tempo real (`q`) com paginação real (`page`, `pageSize: 20`) para Cliente, Chamado e Tarefa.
  - [x] Tratamento explícito de erros com exibição de banner inline e botão "Tentar novamente" (sem catches silenciosos).
  - [x] Proteção anti-race-condition com `AbortController` por seletor e verificação de referência (`activeClientIdRef`, `activeDemandIdRef`) para impedir que respostas atrasadas de clientes/chamados anteriores sobrescrevam a seleção atual.
  - [x] Retenção memorizada da seleção atual via `formClientOptions`, `formDemandOptions` e `formTaskOptions`, prevenindo reset indesejado do `<select>` quando paginar a busca de alvos.
  - [x] Tratamento de erro 403: limpeza total imediata de materiais, rótulos, alvos e seleções ativas.
- [x] **Tabela e Lista Paginada**:
  - [x] Tabela `.data-table` acessível com cabeçalhos com escopo `scope="col"` e suporte responsivo (sem overflow quebrado em viewports < 640px).
  - [x] Badges visuais padronizados (`.badge`) para categorias de material e status de arquivamento.
  - [x] Exibição de versão otimista (`v{material.version}`) e data no fuso de Cuiabá.
  - [x] Barra de paginação `.pagination-bar` com total de materiais e páginas calculadas.

---

### 3. Estados da Interface e Acessibilidade por Teclado
- [x] **Estados de Carregamento e Vazio (Implementado)**:
  - [x] Skeleton loader acessível com `.empty-state` e `aria-live="polite"`.
  - [x] Estados vazios contextuais (busca sem resultado, filtro arquivado vazio, lista inicial limpa).
- [x] **Tratamento de Erros e Retentativa (Implementado)**:
  - [x] Banner de erro amigável (`.alert-banner.error` com `role="alert"`), sem exposição de jargões técnicos ou dados sensíveis.
  - [x] Botão de retentativa explícito recarregando os materiais com os filtros atuais.
- [x] **Interação por Teclado e Homologação Visual (Concluída — 14 PASS / Aceite do Usuário)**:
  - [x] **Implementado em Código**: Todos os controles interativos com suporte a `Tab` nativo, formulário inline fecha com tecla `Escape`, diálogos nativos (`<dialog>`) com captura nativa de `Escape`, e foco automático no campo de título ao abrir o formulário (`titleInputRef`).
  - [x] **Verificação no Browser (P5-BR-VIS)**: PASS na última rodada (14 PASS reais) com artefatos válidos registrados e confirmados por hash SHA256 (Desktop: `B418807E50FE1BF4B270DE5ADABCE7E7CFDC547CA9DEDE00E19E4A5A5183EBA8` e Mobile: `E739F0CE18890AAD2FDE7247CFEC0F86543EA20C8BEA7D7D6E6FC4137EA67EAB`). Sem suposições de causas não comprovadas de infraestrutura.
  - [x] **Evidência Manual do Usuário**: Validação interativa realizada com confirmação explícita do usuário ("tudo certo") para navegação por teclado e renderização visual no portal, superando a limitação técnica do despacho sintético CDP.

---

### 4. Isolamento de Escopo, Anti-Vazamento e Histórico
- [x] **Isolamento de Colaboradores**:
  - [x] Colaboradores visualizam estritamente materiais vinculados às demandas e tarefas a eles atribuídas (alimentado pela API `/api/v1/materials`).
  - [x] Seletor de alvos (`/api/v1/materials/targets`) pagina e filtra exclusivamente registros autorizados ao usuário.
  - [x] Colaboradores são impedidos de criar materiais vinculados exclusivamente ao cliente (exigido vínculo a chamado/tarefa própria).
- [x] **Histórico Transacional**:
  - [x] Diálogo nativo `<dialog className="native-dialog history-dialog">` com lista ordenada de eventos (`.event-list`).
  - [x] Diff de alterações de campos (`.event-changes-diff`) exibindo valor anterior e novo valor.
  - [x] Ações e datas formatadas no fuso de Cuiabá (`pt-BR`, `America/Cuiaba`), com autor da alteração.

---

### 5. Formulário, Concorrência Otimista (409) e Links Seguros
- [x] **Validação de URLs Seguras**:
  - [x] Validação estrita: aceitação comprovada de protocolos legítimos `http://` e `https://`.
  - [x] Rejeição explícita de credenciais embutidas (`username:password@`) e esquemas não permitidos (`javascript:`, `ftp:`, `data:`, etc.).
  - [x] Links externos renderizados com `target="_blank" rel="noopener noreferrer"` e `word-break: break-all`.
- [x] **Concorrência Otimista (HTTP 409)**:
  - [x] Envio obrigatório de `version` na mutação de atualização (`UpdateMaterialInput`).
  - [x] Tratamento de `409` (`MATERIAL_VERSION_CONFLICT`) preservando o rascunho do usuário no formulário.
  - [x] Ação de resolução: botão "Descartar rascunho e carregar dados do servidor", buscando a versão mais recente via `api.getMaterial`.
  - [x] Trava `isSubmittingRef` (single-flight) impedindo duplo clique concorrente.
- [x] **Imutabilidade de Vínculos e Duplicação Segura (Revisão de Segurança Codex)**:
  - [x] Vínculos (`clientId`, `demandId`, `taskId`) são estritamente imutáveis para ambos os papéis após a criação, exibidos em modo somente leitura (`.immutable-links-box`).
  - [x] Mutações de PATCH omitem vínculos e enviam exclusivamente `title`, `description`, `category`, `url`, `version`, impedindo transferência de material entre trabalhos.
  - [x] Duplicação de referência (`Duplicar` na tabela e atalho no painel de edição) disponível para reaproveitar link/conteúdo em novo cadastro com histórico limpo e isolado.

---

### 6. Definições de Negócio Autorizadas pelo Responsável
- [x] **Capacidade de Escrita de Colaboradores**:
  - [x] **Definição Autorizada:** Colaboradores autorizados a criar e editar seus próprios materiais (demandas/tarefas atribuídas).
  - [x] **Arquivamento e Restauração:** Restrito exclusivamente a administradores (`hasArchive` / `administrator`).
  - [x] **Vínculos:** Vínculos imutáveis na edição para todos os perfis. Criação vinculada exclusivamente a cliente restrita a administradores. Transferência proibida; duplicação via novo cadastro recomendada.

---

### 7. Linha do Tempo por Cliente (`PHASE5-CLIENT-TIMELINE-CONTRACT.md`)
- [x] **Painel de Interface (`MaterialsView.tsx`)**:
  - [x] Renderização condicional sob cliente selecionado (`selectedClientId && canViewTimeline`).
  - [x] Revalidação estrita de permissões (`materials.read` e `demands.read`).
  - [x] Estados de carregamento (skeleton), vazio, erro com retentativa inline e recolhimento/expansão.
  - [x] Retentativa real (retry): recuperação comprovada após falha 500 no endpoint via botão "Tentar novamente".
  - [x] Paginação real com avanço/retorno (`nav.timeline-pagination`, `.pagination-info`, `.pagination-btn`), homologada com 15 eventos (Pág 1 <-> Pág 2).
  - [x] `AbortController` e guarda de identidade estrita (`timelineControllerRef.current === controller && !controller.signal.aborted`) em sucesso, catch e finally:
    - [x] Impede que requisições abortadas (refresh concorrente ou paginação no mesmo cliente) desliguem o estado de carregamento da nova requisição via finally.
    - [x] Impede que requisições antigas atrasadas em transições rápidas A -> B -> A sobrescrevam o estado legítimo final, comprovado com payloads distinguíveis e UUIDs válidos.
    - [x] Limpeza imediata de rótulo do cliente e paginação (`timelineClientName = ''`, `timelinePage = 1`) no início da busca e em erros 403/404, evitando retenção de dados obsoletos.
- [x] **Tradução e Ações em Português**:
  - [x] Crachás de origem: `Chamado`, `Tarefa`, `Material`.
  - [x] Dicionário completo de ações em português (`Chamado criado`, `Tarefa iniciada`, `Material criado`, etc.).
  - [x] Formatação de data/hora no fuso de Cuiabá (`pt-BR`, `America/Cuiaba`) com identificação do ator.
- [x] **Destinos e Atalhos**:
  - [x] Botões para abertura de material (`open-material`), chamado (`open-demand`) e tarefa (`open-task`).
  - [x] Atalho autorizado na tabela de materiais (botão "Linha do tempo" no vínculo de cliente).
  - [x] Atalho no diálogo de histórico de alterações de materiais.
- [x] **Isolamento de Colaborador e Anti-IDOR**:
  - [x] Colaborador visualiza estritamente eventos de suas próprias tarefas e chamados associados.
  - [x] Eventos de tarefas ou materiais de terceiros são estritamente omitidos do total e da listagem.
  - [x] Tentativa de acesso a cliente sem trabalho atribuído resulta em HTTP 404 e mensagem amigável sem vazar dados.

