# Interface de clientes e equipe

Extensão da área protegida existente, sem redesign da tela de login e sem nova identidade visual. Fontes: apps/web/PRODUCT.md, implementação existente e PHASE2-SPEC.md. Modo: operar. Não acrescentar métricas ou clientes ilustrativos ao produto.

## Estrutura

Manter login/logout e verificação de sessão. Após login, cabeçalho com OriumSystem, identificação do usuário e Sair; navegação Clientes e Equipe somente para quem tem a permissão de leitura correspondente. Seleção de área deve ser identificável por teclado e tecnologia assistiva. Sem módulos futuros na navegação.

Clientes: título, ação Novo cliente autorizada, pesquisa por nome/contato/e-mail, filtro ativos/arquivados/todos, lista com nome/contato/status/ações e paginação. Formulário inline ou painel adjacente para nome, nome do contato, e-mail, telefone e observações; criar e editar com retorno explícito. Arquivar/restaurar somente com clients.archive e confirmação clara antes de arquivar. Não usar exclusão física. Distinguir lista vazia de pesquisa sem resultados.

Equipe: lista de nome/e-mail/papel/ativo; cadastrar com nome/e-mail/senha/papel (colaborador por padrão), desativar com confirmação e trocar papel conforme permissões da sessão. Tratar LAST_ADMINISTRATOR 409 com explicação; nenhuma senha em tabelas, logs, toast ou texto visível. Senhas digitadas em campo password e apagadas do estado após envio.

## Comportamento

- Usar schemas e tipos de packages/contracts. API é a fonte dos dados; não simular sucesso ou criar fixtures no frontend.
- Carregamento, vazio, erros e operação em andamento precisam ser visíveis. Permitir tentar novamente. Formularios com labels, mensagens de validação e foco no primeiro campo pertinente.
- AbortController/cancelamento de leituras e proteção contra resposta obsoleta de pesquisa/paginação. Um evento não deve disparar mutações duplicadas; desabilitar ações durante envio.
- 401 de qualquer endpoint protegido encerra estado local de sessão e volta ao login. 403 explica falta de permissão. Conflito de version mantém formulário e oferece carregar a versão atual explicitamente; não sobrescrever silenciosamente.
- Atualizar a lista após criação/edição/arquivo/restauração/desativação/troca de papel; respeitar filtro e paginação. Se a página fica vazia após mudança, recuar quando necessário.
- Não persistir tokens/senhas em localStorage, sessionStorage ou query string. Sessão continua baseada em cookie HttpOnly.

## Sistema visual

Herdar branco, cinza claro, texto escuro e azul da implementação existente; preservar tipografia e caráter dos controles. Usar títulos claros e listas/tabelas, sem cards de métricas ou ornamentos. Tokens CSS para cores/spacing/foco; densidade suficiente para trabalho diário. Evitar ícones se rótulo textual resolver. Navegação e formulários utilizáveis em 390px e 1280px; não deixar a página inteira com overflow horizontal.

## Verificação

Typecheck/lint/build e inspeção React. Navegador VISÍVEL no canvas para fluxos de administrador: criar cliente, pesquisar, editar, arquivar/restaurar, cadastrar colaborador e trocar papel/desativar. Verificar sessão de colaborador sem privilégios de administração. Inspeção desktop/mobile em uma rodada e uma rodada de confirmação se correções necessárias. Screenshot/relatório sem segredos. Nenhum serviço de outro projeto deve ser encerrado para executar os testes.
