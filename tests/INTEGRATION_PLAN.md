# Integração da Fase 1

Escopo autorizado: fundação, autenticação, usuários internos, RBAC, sessões,
migrations e health checks. As decisões de produto seguem PROJECT_CONTEXT.md,
ROADMAP.md e ADRs 0001–0006; a autorização atual da Fase 1 prevalece sobre o
status ainda não atualizado do roadmap.

## Pré-requisitos obrigatórios

- Vitest e dependências do backend instalados nas versões escolhidas pelo dono
  do workspace. Os testes não escolhem versões nem instalam dependências.
- PostgreSQL real, acessível por `TEST_DATABASE_URL` (papel de aplicação) e
  `TEST_MIGRATION_DATABASE_URL` (papel de migrations), ambos apontando para o
  mesmo banco chamado exatamente `orium_test`.
- A suíte falha explicitamente quando essas variáveis ou o banco faltam. Não
  usa mocks de banco, não ignora testes silenciosamente e não tenta contornar
  indisponibilidade da rede ou ausência de Docker.
- Banco dedicado: as fixtures são contas com emails exclusivos; cleanup remove
  somente fixtures criadas pela suíte, nunca todos os usuários do banco.
- Execução serial da suíte, com fechamento da aplicação e do pool em teardown.

## Interfaces combinadas

Imports a partir de `apps/api/src`: `buildApp`, `loadConfig`,
`connectDatabase`, `migrateDatabase` e `provisionUser`.

`buildApp({config, database, logger:false})` retorna Fastify;
`connectDatabase(url)` retorna `{db,pool}`; `migrateDatabase(url)` retorna
`Promise<void>`; `provisionUser(database,{name,email,password,role})` retorna
`Promise<{id:string}>`. Os papéis são `administrator` e `collaborator`.

## Matriz de aceite

| Caso | Evidência esperada |
| --- | --- |
| Migrations repetidas | Executar duas vezes sem erro e manter usuário existente |
| Papel de banco da aplicação | `pg_roles` confirma `rolsuper=false` e `rolbypassrls=false` |
| Liveness e readiness | `/health/live` e `/health/ready` retornam sucesso com banco real |
| Área protegida anônima | `/api/v1/me` retorna 401 |
| Login válido | Cookie HttpOnly; sem token de sessão no JSON; `/me` identifica usuário |
| Credenciais inválidas | Falha sem emitir sessão válida |
| Cadastro público | `/api/v1/auth/sign-up/email` não cria usuário nem sessão |
| Logout | Cookie anterior deixa imediatamente de autenticar |
| RBAC | Colaborador recebe 403 nas operações de usuários; administrador tem acesso |
| Mudança de papel | Sessão já existente perde privilégio administrativo imediatamente |
| Criação interna | Administrador cria colaborador; nova conta consegue entrar |
| Desativação | Sessão existente e novo login deixam de autenticar imediatamente |
| Origin | Mutação com origem ausente ou estrangeira é rejeitada sem efeito no banco |
| Sessão absoluta | Sessão criada há mais de 7 dias é recusada, mesmo recentemente usada |
| Sessão inativa | `lastSeenAt` há mais de 12 horas invalida a sessão |
| Sessão ativa | Acesso autenticado atualiza atividade sem estender limite absoluto |

## Suítes implementadas

- `auth.integration.test.ts`: usa Fastify inject e PostgreSQL real. Valida URLs
  antes de migrar; as duas conexões devem apontar para o mesmo `orium_test`,
  usando `orium_app` e `orium_migrator`. Usa segredo e senhas aleatórios em
  memória. Cleanup remove somente contas do prefixo aleatório desta execução.
- `config.test.ts`: valida ambiente local e não exposição de valores secretos
  nos erros de configuração.
- `rbac.test.ts`: valida grants explícitos e a fronteira administrativa do
  backend, inclusive identidade de colaborador contendo grant administrativo.

Contratos confirmados no código da API e do pacote contracts. Sessões usam
`auth_session.created_at`, `last_seen_at` e `expires_at`; a suíte modifica esses
timestamps de fixtures reais para exercitar expiração. O schema permanece sob
responsabilidade do Maestro.

Para executar, usar os scripts raiz `pnpm test:unit` e `pnpm test` (este último
carrega `.env`). A existência dos testes não constitui evidência de execução
ou de critérios cumpridos. Instalação de dependências e PostgreSQL acessível
continuam pré-requisitos externos à suíte.
