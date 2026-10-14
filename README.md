# OriumSystem

Fundação local da aplicação para uso interno da equipe. Esta etapa cobre login,
sessões, permissões básicas, API, banco e uma área protegida. Não configura
produção; módulos de clientes ficam para as fases seguintes.

## Requisitos locais

- Node.js `>=24.19.0 <25` e pnpm `12.8.1` (versões declaradas no `package.json`).
- Docker com Docker Compose, necessário para iniciar os bancos PostgreSQL locais.
- A porta `3001` para a API, `5173` para o Vite, `55432` para desenvolvimento e
  `5433` para testes.

## Preparar o ambiente

Na raiz do repositório, instale as dependências:

```sh
pnpm install
```

Copie `.env.example` para `.env` e substitua localmente todos os valores de
preenchimento: segredo Better Auth com pelo menos 32 caracteres aleatórios,
senhas distintas para administração, migrations e aplicação nos bancos de
desenvolvimento e teste, e URLs com as senhas devidamente codificadas para URL.
Use senhas de teste diferentes das de desenvolvimento. Mantenha `.env` apenas
na sua máquina; o arquivo é ignorado pelo Git. Não envie senhas a agentes nem as
coloque em comandos, histórico do terminal ou documentação.

Suba os bancos locais:

```sh
pnpm db:up
```

O `POSTGRES_PORT` (padrão `55432`) controla somente o bind do serviço de
desenvolvimento. O Compose cria `orium_dev` em `127.0.0.1:${POSTGRES_PORT}` e
`orium_test` em `127.0.0.1:5433`. Para aplicar as migrations no banco de desenvolvimento e
criar as duas contas administrativas iniciais:

```sh
pnpm db:migrate
pnpm db:bootstrap
```

O bootstrap solicita os e-mails de Arino e Monique e pede cada senha duas vezes
com entrada oculta, sem ecoar o texto. Informe os e-mails reais das pessoas que
usarão essas contas e digite as senhas diretamente no terminal interativo. O
bootstrap só funciona com banco ainda sem usuários; não serve para recuperar ou
alterar contas existentes.

### Recuperação administrativa de acesso

Caso uma conta de usuário ou administrador precise de redefinição de senha, execute o procedimento administrativo interativo:

```sh
pnpm db:recover
```

O comando opera unicamente via terminal interativo local (`process.stdin.isTTY`) e exige reautenticação em tempo real de um administrador ativo (com papel `administrator` e permissão `roles.manage`). A nova senha (1 a 128 caracteres) é solicitada em dobro com entrada oculta. O procedimento atualiza a credencial sob lock consultivo (`IDENTITY_LOCK`) e revoga atomicamente todas as sessões ativas da conta recuperada, emitindo um recibo pós-commit no terminal. Não são aceitas senhas ou e-mails por variáveis de ambiente ou argumentos de linha de comando. Detalhes completos em `docs/PHASE1-RECOVERY.md`.

## Desenvolvimento

```sh
pnpm dev
```

Esse comando executa `build:foundation` e inicia API e web. O Vite encaminha
`/api` para a API local em `127.0.0.1:3001`. O pacote `@orium/contracts` e a API
são consumidos a partir das saídas compiladas. Ao alterar fontes desses pacotes,
execute novamente `pnpm build:foundation` para recompilá-los; não há recompilação
automática dessas fontes durante o desenvolvimento.

## Verificações disponíveis

Os comandos declarados no `package.json` raiz são:

```sh
pnpm test:unit
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

`pnpm test:unit` executa os testes de configuração e RBAC. `pnpm test` executa a
suíte completa, incluindo integração com PostgreSQL real em `orium_test`; ela
exige que `TEST_DATABASE_URL` e `TEST_MIGRATION_DATABASE_URL` estejam
configuradas no `.env` e que `pnpm db:up` tenha iniciado o banco de teste. A
suíte não substitui banco por mocks nem ignora testes quando o banco falta.

## Estado da execução local

Os serviços locais estão operacionais via Docker Compose (`pnpm db:up`), com PostgreSQL de desenvolvimento em `127.0.0.1:55432` (`orium_dev`) e testes em `127.0.0.1:5433` (`orium_test`), em conformidade com a política global de portas (`PORT_POLICY.md`). A suíte automatizada conta com **79 testes executados e aprovados** (37 unitários: 13 config + 24 rbac; e 42 de integração: 17 auth + 10 clientes + 15 recuperação/concorrência sob `IDENTITY_LOCK`), com 0 skips, além de typecheck, lint e build verdes. A auditoria de segurança (`pnpm audit`) confirmou 0 vulnerabilidades em produção e desenvolvimento com Fastify 5.12.5 consolidado. A validação interativa no terminal ConPTY nativo (8/8 casos) e visual no portal visível (8/8 casos) foi concluída com 100% de sucesso. Detalhes em [`docs/PHASE1-HANDOFF-RESULT.md`](docs/PHASE1-HANDOFF-RESULT.md).
