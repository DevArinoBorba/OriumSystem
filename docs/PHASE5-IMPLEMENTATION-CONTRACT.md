# Fase 5 — Materiais, links e histórico

Status: implementação autorizada; decisão de escrita respondida pelo responsável. Fase 4 permanece em homologação, com teclado nativo e captura visual pendentes; avanço não equivale a encerramento da fase anterior.

## Objetivo da página

Centralizar referências externas por cliente e, quando aplicável, chamado/tarefa: materiais, identidade visual, previews, sites publicados e links de Drive. Sem upload, sincronização com Drive, consulta automática de URLs, credenciais ou publicação. Reutilizar preview e histórico existentes; não duplicar nem alterar o fluxo de início, requisitos ou revisão.

Página Materiais no mundo visual existente: pesquisa, filtro por cliente/categoria, lista paginada, detalhe, formulário de cadastro/edição e histórico autorizado. Estados vazio, carregando, erro/retry; links externos HTTP(S), nova aba com proteção de opener. Texto claro e acessibilidade; sem dados de demonstração apresentados como persistidos.

## Decisão do responsável

Em resposta à pergunta de cadastro/edição, o responsável confirmou: colaboradores poderão editar materiais dos próprios trabalhos. `materials.read` e `materials.write` são concedidas aos dois papéis; toda leitura e escrita do colaborador exige vínculo de trabalho atribuído. `materials.archive` permanece administrativa. Colaborador não cria material apenas de cliente, não altera vínculos após criação e não acessa material vinculado a tarefa de terceiro, mesmo que possua outra tarefa no mesmo chamado. Material somente de chamado exige tarefa própria naquele chamado. Reatribuição revoga acesso ao material associado à tarefa; autor do cadastro não confere acesso permanente.

## Contrato técnico fixado pela coordenação

Base: proposta `PHASE5-INTEGRATION-MAP.md`, subordinada às decisões abaixo. Categorias: `brand`, `preview`, `published`, `drive`, `asset`, `reference`, com rótulos portugueses na interface. Material: id UUID, clientId obrigatório, demandId/taskId nullable, title 1..200, description até 4000, URL HTTP(S) até 2048 sem username/password, category, archivedAt nullable, version inteiro positivo e createdAt/updatedAt ISO. Projeções mínimas client {id,name}, demand {id,title}|null e task {id,title}|null. Sem emails ou dados de contatos.

Query estrita: q até100; clientId/demandId/taskId opcionais UUID; category opcional; status active|archived|all padrão active; page inteiro1+ padrão1; pageSize inteiro1..50 padrão20. Resposta {materials,total,page,pageSize}, ordenação updatedAt DESC/id ASC, total e lista no mesmo snapshot. Schemas/tipos compartilhados Zod estritos, sem espelhos locais. Nomes exportados: materialSchema, listMaterialsQuerySchema, listMaterialsResponseSchema, createMaterialSchema, updateMaterialSchema, materialHistoryResponseSchema; tipos Material, ListMaterialsQuery, ListMaterialsResponse, CreateMaterialInput, UpdateMaterialInput.

Rotas: GET/POST `/api/v1/materials`; GET/PATCH `/api/v1/materials/:id`; POST `/:id/archive` e `/:id/restore` com version; GET `/:id/history` paginado. PATCH exige version; todos os campos editáveis enviados como snapshot completo. Usuários editam title/description/category/url; clientId/demandId/taskId são imutáveis após criação para ambos os papéis. Transferir referência exige novo cadastro; não transferir histórico de um trabalho para outro. Histórico autorizado retorna {events,total,page,pageSize}; evento {id,action,actorName,createdAt,changes}, changes contendo somente campos alterados e valores before/after sanitizados do material, sem identidade/email de usuários ou conteúdo de terceiros. Eventos de criação, atualização, arquivamento e restauração na mesma transação da mutação. Nunca enviar URL/arbitrary metadata em logs.

Seletor seguro: GET `/api/v1/materials/targets`, registrado antes de `/:id`, com kind client|demand|task, q/page/pageSize e clientId/demandId opcionais. Resposta {targets,total,page,pageSize}, targets {id,title,clientId?,demandId?}; campos estritos conforme kind. Clientes/chamados/tarefas somente do escopo autorizado, sem contatos ou responsáveis. Colaborador não recebe tarefas de terceiros. Listas paginadas; nenhum catálogo global obtido no navegador. Formulário escolhe cliente, chamado e tarefa opcional; colaborador exige ao menos chamado próprio. Admin admite apenas cliente. Filtros reutilizam esse endpoint.

Migração `0003_materials.sql`: material e material_event, permissões e grants/journal/schema existentes alinhados. FKs de vínculos RESTRICT/NO ACTION, sem ON DELETE SET NULL; preservar atribuição/histórico, sem ampliar acesso por perda de vínculo. CHECK taskId exige demandId, categorias/versão válidas; índice nos FKs e índices adequados às consultas paginadas, incluindo created_by_user_id. Validação hierárquica e autorização revalidadas sob locks/transação seguindo padrão de demandas e identidade existente; reatribuição concorrente não pode permitir escrita indevida. Autorização deve anteceder 409/validação de entidade para não revelar existência alheia. Inacessível retorna404; permissão ausente403; versão antiga409; sessão revogada401. Sem alterações automáticas em requisitos, prazos, estados ou previewUrl legado.

Histórico por cliente nesta entrega: aba/painel de Materiais com filtro de cliente e histórico de cada referência, integrado aos detalhes existentes por navegação para Materiais. Não declarar timeline completa de cliente implementada até a agregação segura dos eventos de cliente/chamados/materiais ser especificada e verificada; permanece critério pendente da Fase5.

## Regras de segurança e compatibilidade

Administradores usam capacidade administrativa, sem e-mails fixos. Colaboradores continuam limitados aos trabalhos atribuídos. Nenhum contador, opção de filtro, histórico, título ou identificação de material alheio pode vazar. Referências apenas de cliente, sem vínculo de trabalho que prove atribuição, permanecem restritas aos administradores nesta preparação; ampliação de compartilhamento exige definição explícita.

Vínculos cliente/chamado/tarefa devem ser consistentes e revalidados pelo backend. Paginação e totais no servidor. Mutações preservam Origin/CSRF, autorização centralizada, versão concorrente e histórico transacional. URLs não são buscadas pelo servidor; rejeitar protocolos perigosos e credenciais embutidas. Nenhum segredo em campo, log ou evidência. Arquivamento preserva histórico; não remover dados para resolver teste.

## Preparação e ownership

- Codex: arquitetura, decisões, contrato final, ROADMAP e aceite. Contrato API/modelagem ainda serão fixados após mapa de integração e resposta de negócio.
- Antigravity: backend/contratos/migração/schema/grants/journal e docs PHASE5 backend/mapa. Publicar e compilar schemas primeiro, implementar serviço/rotas, rodar checks pertinentes, sem frontend ou tests/materials.integration.test.ts. Migração/teste somente orium_test nesta entrega; ativação DEV aguarda revisão de migration e evidências pelo Codex.
- OpenCode: somente `docs/PHASE5-UI-SPEC.md` na tarefa preparatória já enviada. Sessão sem progresso observado; não atribuir frontend concorrente a este agente.
- Antigravity QA: frontend Fase5 sob ownership exclusivo `apps/web/src` (MaterialsView, App/Header/api/types/styles e links pontuais ClientsView/DemandsView), `docs/PHASE5-UI-CHECKLIST.md`, `docs/PHASE5-FRONTEND-RESULT.md`. Aplicar Impeccable modo Operate, sem redesign. Implementar quando schemas publicados. Preservar runners/evidências Fase4; não editar backend/contratos/migrações.
- Testes de integração e runner Fase5: ownership será atribuído separadamente após implementação estável; nenhum PASS ou fechamento sem execução real.

Toda delegação aplica `docs/AGENT-AUTONOMY.md`: início, evidências, impedimentos e conclusão somente na seção própria da nota `oriumsystem-acompanhamento` via `note edit`. Resposta curta. Buscar símbolos/trechos, sem releitura integral repetida. Não criar agentes adicionais se conectados atenderem. Sem testes ou builds para documentação. Serviços/testes futuros exigem PORT_POLICY e Find-FreePort por porta, preservando DEV e dados reais.

## Aceite futuro

Operação real CRUD/arquivamento, filtros/paginação, vínculos consistentes, versionamento, histórico, isolamento de contadores e registros, URLs seguras, navegação e acessibilidade. Migrations e testes isolados revisados antes de ativação DEV. Homologação funcional e visual com evidências reais; nenhum PASS baseado apenas em sintaxe ou exit 0. Não declarar Drive, publicação ou infraestrutura externa integrados.
