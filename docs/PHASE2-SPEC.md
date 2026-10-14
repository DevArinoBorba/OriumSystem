# Fase 2 — Clientes e equipe

Autorização: continuidade pelo roadmap concedida pelo responsável em 2026-10-05. Matriz de colaboradores aprovada pelo responsável (ADR-0008): os dois colaboradores designers visualizam SOMENTE clientes e demandas que forem atribuídos a eles na Fase 3. Na Fase 2, sem entidade demanda ou relação de atribuição, colaboradores permanecem estritamente sem permissões globais de clientes (`clients.read`, `clients.write`, `clients.archive`), mantendo-se em negação por padrão (HTTP 403). Cadastro, edição e arquivamento de clientes e administração da equipe permanecem exclusivos de Arino e Monique.

## Contrato de clientes

Campos públicos: id UUID, name (1–160 caracteres), contactName (até 160), email (e-mail ou null), phone (até 40), notes (até 4000), archivedAt (ISO ou null), createdAt e updatedAt (ISO), version (inteiro positivo). Campos de contato e notas são opcionais/nulos; nenhuma senha, credencial ou dado financeiro privado.

- GET /api/v1/clients?q=&status=active|archived|all&page=1&pageSize=20: busca literal por nome/contato/e-mail, paginação limitada a 100, ordenação determinística por nome/id, resposta {clients,total,page,pageSize}. Padrão active.
- GET /api/v1/clients/:id: resposta {client}; 404 para inexistente.
- POST /api/v1/clients: name obrigatório e contatos/notas opcionais, campos desconhecidos rejeitados; 201 {client}.
- PATCH /api/v1/clients/:id: version obrigatória e pelo menos um campo editável; atualização condicional, 409 CLIENT_VERSION_CONFLICT se concorrente; 404 se ausente.
- POST /api/v1/clients/:id/archive e /restore: corpo {version}; preservar dados e incrementar version; não implementar exclusão física.

Permissões explícitas: clients.read, clients.write, clients.archive. Sem permissão: 403; sem sessão: 401. Todas as mutações mantêm validação Origin e JSON existentes. Nunca aceitar IDs/autores/datas/version inicial do cliente no POST. Não devolver erros SQL ou entradas sensíveis.

## Persistência e segurança

Uma nova migration incremental, sem alterar a migration aplicada. Tabela client com índices de listagem/arquivamento e campos acima; IDs gerados no servidor. Papel orium_app sem DDL/ownership, com grants apenas DML necessários. Seed das três permissões e concessão ao administrador; colaborador sem concessão global de clientes conforme ADR-0008 (visibilidade por atribuição delimitada para a Fase 3; não implementar nem declarar na Fase 2). A atualização de permissões existentes deve preservar comportamento administrativo e não tornar clients.read privilégio administrativo apenas por estar no enum.

Os schemas Zod vivem em packages/contracts, com exports reutilizáveis por API/web. Atualizar limite de rolePermissionsSchema para o conjunto real de permissões. A definição de clientes não inclui demandas, materiais ou cofre.

## Equipe e interface

Usar endpoints de identidade existentes: listar usuários, criar conta como colaborador por padrão, desativar e trocar papel; manter última conta administradora e revogação de sessões. Exibir somente capacidades autorizadas pela sessão, sem tratar ocultação no frontend como segurança. Não implementar cadastro público ou credenciais padrão.

Área protegida terá navegação Clientes/Equipe; lista pesquisável, estados vazio/carregando/erro, formulário de criação/edição, filtros de arquivados e confirmação de arquivamento/desativação. Equipe restrita à permissão users.read, ações com permissões existentes. Dados sempre vêm da API; fixtures apenas no banco de teste.

## Aceite

Typecheck, lint, build e suítes PostgreSQL verdes. Integração verifica 401/403, validação, busca literal/paginação, CRUD/arquivamento/restauração, conflito de versão, ausência de exclusão de dados e preservação da autenticação. Navegador visível verifica cadastro/edição/pesquisa/arquivamento e equipe, desktop e mobile. Evidências precisam distinguir o módulo implementado da matriz de colaboradores ainda pendente.
