# Fase 5 — Especificação de UI (Página Materiais)

**Dono:** OpenCode (documento)
**Data:** 2026-10-07
**Fonte da verdade:** `docs/PHASE5-IMPLEMENTATION-CONTRACT.md` (regras fixadas pela coordenação/responsável) + schemas Zod publicados em `@orium/contracts` (sem espelhos locais).
**Modo de superfície:** Impeccable Operate, mundo incumbente, extensão code-led — **sem redesign**, **sem novas dependências**.

> Documento executável para o implementador do frontend (ownership por contrato: Antigravity QA em `apps/web/src`). Nenhuma regra de negócio foi inventada: todo comportamento abaixo emerge do contrato da Fase 5 e dos schemas oficiais. Itens marcados como *pendente de definição* não são implementados nesta entrega.

---

## 1. Objetivo e não-objetivos

**Objetivo:** centralizar referências externas por cliente e, quando aplicável, chamado/tarefa — materiais, identidade visual, previews, sites publicados e links de Drive. Sem upload, sem sincronização com Drive, sem consulta automática de URLs, sem credenciais, sem publicação.

**Não-objetivos (desta entrega):** timeline completa por cliente (requer agregação segura de eventos de cliente/chamados/materiais ainda não especificada — contrato linha 27); upload de arquivos; sincronização Drive; consulta automática de URLs; alteração de fluxos de início, requisitos ou revisão existentes; transferência de histórico entre trabalhos (transferir referência = novo cadastro).

## 2. Modelo de dados (esquemas oficiais `@orium/contracts`)

Referência exata para a UI (nomes reais exportados):

- `Material`: `id`, `clientId` + `client {id,name}`, `demandId`/`demand {id,title}|null`, `taskId`/`task {id,title}|null`, `title` 1..200, `description` 0..4000, `category`, `url` (HTTP(S), sem username/password, ≤2048), `archivedAt|null`, `version` (>0), `createdAt`/`updatedAt` ISO.
- `MaterialCategory` (`materialCategorySchema`): `brand | preview | published | drive | asset | reference`.
- `ListMaterialsQuery`: `q` (≤100), `clientId`/`demandId`/`taskId` (UUID opcional), `category`, `status` (`active|archived|all`, default `active`), `page` (≥1, default 1), `pageSize` (1..50, default 20).
- `ListMaterialsResponse`: `{materials, total, page, pageSize}` — total e lista no mesmo snapshot; ordenação `updatedAt DESC, id ASC`.
- `CreateMaterialInput` / `UpdateMaterialInput`: campos editáveis `title, description, category, url` (PATCH exige `version`; snapshot completo).
- `MaterialHistoryResponse`: `{events, total, page, pageSize}`; evento `{id, action, actorName, createdAt, changes{campo:{before,after}}}` com valores sanitizados (sem identidade/e-mail de usuários nem conteúdo de terceiros).
- `ListMaterialTargetsQuery/Response` (`GET /api/v1/materials/targets`): `kind client|demand|task`, `q`, `clientId?`, `demandId?`, `page/pageSize`; `targets {id, title, clientId?, demandId?}` conforme kind.

## 3. Arquivos futuros delimitados (não criados nesta tarefa documental)

Frontend implementado sob ownership do Antigravity QA; esta especificação é o insumo. Arquivos delimitados:

- `apps/web/src/components/MaterialsView.tsx` — componente principal (lista, filtros, formulário, detalhe, histórico).
- `apps/web/src/App.tsx` — aba `'materials'` no `ActiveTab`, default por permissões (`materials.read`), render/roteamento com navegação externa (pré-filtro `clientId`/`demandId`/`taskId`).
- `apps/web/src/components/Header.tsx` — aba "Materiais" quando `materials.read`.
- `apps/web/src/api.ts` — métodos `listMaterials`, `getMaterial`, `createMaterial`, `updateMaterial`, `archiveMaterial`, `restoreMaterial`, `getMaterialHistory`, `listMaterialTargets` (sempre parse com schema oficial, sem espelho local).
- `apps/web/src/types.ts` — re-exports/estados de UI (sem redefinir tipos do contracts).
- `apps/web/src/styles.css` — extensão do mundo incumbente (classes `materials-*`/`material-*`).
- Navegação contextual (`/materials?clientId=…&demandId=…`): botões "Materiais" pontuais em `ClientsView.tsx` e `DemandsView.tsx` (pre-filtro, sem ampliar escopo).

## 4. Regras de negócio — exatamente as fixadas (nada inventado)

- **Permissões:** `materials.read`/`materials.write` para os dois papéis; `materials.archive` administrativa. Colaborador só lê/escreve com vínculo de trabalho atribuído.
- **Criação/edição:** colaborador edita materiais dos **próprios trabalhos**. Colaborador **não** cria material apenas de cliente, **não** altera vínculos após criação (`clientId`/`demandId`/`taskId` imutáveis para ambos), **não** acessa material vinculado a tarefa de terceiro (mesmo tendo outra tarefa no mesmo chamado).
- **Vínculo mínimo:** material "somente chamado" exige tarefa própria naquele chamado; referências **apenas de cliente** restritas a admin nesta preparação (linha 31 do contrato).
- **Acesso via reatribuição:** reatribuição revoga acesso ao material da tarefa; autor do cadastro não confere acesso permanente.
- **Arquivamento/restauração:** `POST /:id/archive` e `/:id/restore` com `version`; preserva histórico; não remove dados.
- **Erros:** inacessível → 404 (sem revelar existência alheia); permissão ausente → 403; versão antiga → 409; sessão revogada → 401. Autorização antecede validação/409.
- **Histórico:** eventos (criação, atualização, arquivamento, restauração) transacionais; `changes` só com campos alterados e `before/after` sanitizados.
- **URL:** HTTP(S), sem credenciais embutidas; nunca enviar URL/arbitrary metadata em logs.

## 5. Spec da superfície (extensão Operate do mundo existente)

### 5.1 Aba e navegação
- Aba **"Materiais"** na navegação principal (mesmo `nav-tab` existente), exibida quando `materials.read`.
- Default da aba: preserva regra atual por permissões; com `materials.read` sem outros reads, "Materiais" é candidata inicial.
- Navegação externa (deep-link) com pré-filtro: abrir `Materiais` a partir de Clientes/Chamados deve aplicar `clientId`/`demandId`/`taskId` na query e exibir somente o escopo autorizado (revalidado pelo backend).

### 5.2 Lista (pesquisa, filtros, paginação)
- **Pesquisa** `q` (texto) com *debounce* e submissão explícita (Enter/botão), mesma UX dos formulários de busca existentes.
- **Filtros:** cliente, categoria, status (`active`/`archived`/`all`) — cada um alimentado por endpoint restrito (`GET /materials/targets` para cliente/chamado/tarefa conforme escopo; **nunca** catálogo global no navegador). Labels de categoria em português:
  - `brand → Identidade visual`, `preview → Preview`, `published → Publicado`, `drive → Drive`, `asset → Arquivo`, `reference → Referência`.
- **Lista paginada no servidor**: `page`/`pageSize` (default 20, máx 50), `total` exato no mesmo snapshot, ordenação `updatedAt DESC, id ASC`. Paginação com controles acessíveis ("Anterior"/"Próxima" + contagem "X–Y de Z"), reutilizando padrão da lista de demandas.
- **Item da lista (cartão/linha):** título, badge de categoria, cliente, vínculo chamado/tarefa (títulos), status arquivado/ativo, `updatedAt` formatado; ação primária "Abrir link" (nova aba) e ações secundárias (detalhe, editar, arquivar/restaurar) conforme permissão.

### 5.3 Detalhe e link externo
- Detalhe exibe título, descrição, categoria, URL, cliente e vínculos (chamado/tarefa), status, `version` e datas.
- **Links externos em nova aba com proteção de opener** (`target="_blank" rel="noopener noreferrer"`); nunca abrir no frame atual.
- Nada de contatos/e-mails/responsáveis de terceiros em nenhuma projeção.

### 5.4 Formulário (criar/editar)
- **Criar:** campos `title`, `description` (opcional), `category`, `url`, e vínculos via seletor:
  - Admin: `clientId` obrigatório; `demandId`/`taskId` opcionais.
  - Colaborador: exige ao menos chamado próprio (seletor alimentado por `materials/targets` com escopo autorizado); tarefa opcional.
- **Editar:** `title`, `description`, `category`, `url`; vínculos exibidos **somente leitura** (imutáveis). PATCH envia `version`.
- **409** com preservação integral do rascunho e botão de recarga/descartar (padrão existente); **single-flight** contra duplicatas.
- **URL inválida:** feedback de validação em português (protocolo não-HTTP(S) ou credenciais embutidas rejeitados pelo schema).

### 5.5 Histórico
- Diálogo/modal de histórico por material (`GET /:id/history` paginado): eventos com `action` (criação/atualização/arquivamento/restauração), `actorName`, `createdAt` (fuso Cuiabá), e diff `before → after` somente dos campos alterados.
- Sem e-mail/identidade de usuários e sem conteúdo de terceiros no diff.

### 5.6 Estados
- **Carregando:** skeleton acessível (`role="status"` + texto) consistente com o Painel.
- **Vazio:** "Nenhum material encontrado" + variação para filtros sem resultado; nunca dado de demonstração apresentado como persistido.
- **Erro/retry:** `alert-banner` com "Tentar novamente"; 403/404 tratados com mensagem de escopo; 401 → fluxo `onUnauthorized` existente; manutenção de conteúdo anterior em falha de refresh ("Dados da última atualização").

### 5.7 Acessibilidade e layout
- Labels associados, `aria-labelledby` por seção/diálogo, `th scope="col"` em tabelas, foco gerenciado em modal/diálogo (Escape fecha), `aria-current` na aba ativa, alvos ≥44px.
- Layout responsivo herdado (1280x800 e 390x844 sem overflow horizontal), bloco `@media 640px` para empilhar ações/cartões — mesma extensão aplicada ao Painel.

## 6. Critérios reais de aceite da UI (executáveis)

1. Aba "Materiais" só aparece com `materials.read`; deep-link com pré-filtro aplica `clientId/demandId/taskId` e o backend revalida escopo (404 alheio, 403 sem permissão).
2. Lista paginada reflete `page/pageSize` e `total` exato; ordenação `updatedAt DESC`.
3. Colaborador só vê materiais de tarefas/ chamados atribuídos; material de tarefa de terceiro nunca renderizado.
4. Vínculos imutáveis na edição; rascunho preservado em 409 com recarga; single-flight sem envio duplicado.
5. Links externos abrem em nova aba com `noopener noreferrer`; URL inválida/credenciais embutidas rejeitadas com feedback pt-BR.
6. Histórico exibe eventos com diff dos campos alterados e fuso Cuiabá, sem dados de terceiros.
7. Estados vazio/loading/erro/retry exercitados; acessibilidade via teclado e layout 390x844 sem overflow.

> Não executar testes/build/serviços nesta tarefa documental; nenhum PASS pode ser declarado sem execução real do frontend implementado (contract linha 43).

## 7. Pendentes de definição (não inventar — contrato linha 27/31/47)

- Timeline completa por cliente (agregação de eventos de cliente/chamados/materiais) — critério pendente; não implementar.
- Compartilhamento de referências só-cliente para colaboradores — restrito a admin nesta entrega; ampliação exige decisão explícita.
- Ativação DEV da Fase 5 — aguarda revisão de migração/evidências pelo Codex (sem frontend antes).
