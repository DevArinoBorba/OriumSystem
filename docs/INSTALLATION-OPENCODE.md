# Instalação de ferramentas e validação local — Fase 1 (OpenCode)

Data: 05/10/2026. Escopo autorizado: **instalação/diagnóstico, `pnpm-lock.yaml` e este relatório.**
Não foram alterados apps, contratos, schema, migrations, autenticação, RBAC, ADRs, `.env` ou dados.
Não foram criados secrets operacionais nem senhas padrão. Docker operacional comprovado; **PostgreSQL real (banco com migrations/DB) ainda não provado**.

## Resumo

| Item | Declarado | Resultado |
|---|---|---|
| Node | `>=24.19.0 <25` | `v24.19.0` instalado e compatível — OK |
| pnpm | `12.8.1` | `12.8.1` instalado e compatível — OK |
| Registry npm | — | acesso restabelecido (`pnpm ping` OK); bloqueio anterior EACCES/stall removido |
| Lockfile | — | `pnpm-lock.yaml` real, 85.701 bytes, reproduzível com `pnpm install --frozen-lockfile` — OK |
| `pnpm test:unit` | — | 28/28 testes passam **somente com atalho diagnóstico** descrito abaixo; falha de resolução a corrigir no pacote raiz |
| `pnpm typecheck` | — | FALHA (erros reais de tipagem e resolução documentados abaixo) |
| `pnpm lint` | — | PASS (nenhuma violação) |
| `pnpm build` | — | FALHA (mesmos erros de tipo da web/API) |
| `docker version` | — | **OK** — Client e **Server** Docker Desktop 4.93.0 / Engine 29.8.1 (após habilitar WSL2 + reinício) |
| `docker compose version` | — | **OK** — Docker Compose v5.5.1 |
| Imagem `postgres:17.11-alpine` | — | **OK** — puxada e verificada no Docker Hub oficial (digest sha256:b0f9560a…) |
| PostgreSQL real / migrations / auth / RBAC / web→API→banco | — | **não executados** — dependem de `.env` (senhas fornecidas localmente pelo responsável) + bootstrap interativo (e-mails reais de Arino/Monique) + `pnpm test`; **fora da fronteira desta entrega**; não declarados como provados |

## Ambiente

- Sistema: Microsoft Windows 11 Home, build 26300.
- **Estado inicial da execução** (ponto de partida deste relatório): sessão **não elevada** (`IsInRole(Administrator) = False`), WSL2 **não instalado**, `docker` ausente. Ao final da execução (ver seção 5): Docker Desktop instalado e operacional e WSL2 ativo — os dois são alterações de sistema, fora do repositório.

## 1. Node e pnpm

- `node --version` → `v24.19.0`
- `pnpm --version` → `12.8.1`
- Ambos correspondem às versões declaradas em `package.json` (`packageManager: pnpm@12.8.1`, `engines.node >=24.19.0 <25`). Sem alteração.

## 2. Confirmação de versões no registry (antes de fixar)

Consultado o registry oficial (`registry.npmjs.org`, `dist-tags.latest` e presença das versões exatas).

| Pacote | Versão fixada | Presente no registry | Nota |
|---|---|---|---|
| typescript | 6.0.3 | sim | latest 7.0.2; TS7 **evitado** conforme PHASE1 (incompatibilidade typescript-eslint) — decisão preservada |
| react / react-dom | 19.3.0 | sim (latest) | — |
| vite / @vitejs/plugin-react | 8.3.2 / 6.1.2 | sim (latest) | engines Node `^20.19.0 || >=22.12.0` satisfeitos por 24.19.0 |
| fastify | 5.12.2 | sim | **existe 5.12.5 mais novo**; pin preservado (fora da fronteira; estável) |
| better-auth | 1.7.7 | sim (latest) | — |
| drizzle-orm | 0.45.3 | sim (latest) | — |
| pg | 8.23.0 | sim | **existe 8.23.1 mais novo**; pin preservado (fora da fronteira; estável) |
| zod | 4.6.5 | sim (latest) | — |
| vitest | 5.0.3 | sim (latest) | engines `^22.12.0 || ^24.0.0 || >=26.0.0` → 24.19.0 satisfaz |
| eslint / typescript-eslint | 10.12.0 / 8.71.0 | sim (latest) | — |
| @types/node / @types/pg / @types/react / @types/react-dom | 24.13.3 / 8.23.1 / 19.3.0 / 19.3.0 | sim | — |

Conclusão de compatibilidade: **todas as versões fixadas existem, são estáveis e compatíveis com Node 24.19.0** (engines verificados em `package.json` dos pacotes no registry). Não houve troca silenciosa de versões/stack. Única observação: existem `fastify@5.12.5` e `pg@8.23.1` mais novos (patch); atualizá-los exigiria editar `apps/api/package.json`, fora da fronteira — deixado para decisão do Maestro.

## 3. pnpm install — lockfile real

Estado inicial: o `pnpm-lock.yaml` existente tinha apenas 4.560 bytes e continha somente a seção `packageManagerDependencies` do próprio pnpm (sem os importers do workspace e sem as dependências do projeto) — **não era um lockfile de resolução real** (PHASE1-REPORT já indicava "sem lockfile"; o arquivo presente era artefato incompleto de tentativa anterior).

Comando executado:

```sh
pnpm install
```

Resultado:
- `Scope: all 4 workspace projects`; **219 pacotes adicionados** em ~1m40s, via content-addressable store do pnpm (`node_modules/.pnpm`).
- `pnpm-lock.yaml` agora com **85.701 bytes** e estrutura completa: importers para `.`, `apps/api`, `apps/web`, `packages/contracts`, com todas as dependências e integridades (ex.: `better-auth@1.7.7` com peers resolvidos `drizzle-orm`/`pg`/`react`; `@orium/contracts → link:packages/contracts`).
- Reproduzibilidade: `pnpm install --frozen-lockfile` → *"Lockfile is up to date, resolution step is skipped"* → **lockfile real e em sincronia**.

### Efeito colateral automático do pnpm (precisa de revisão do Maestro)

Durante o `pnpm install`, o pnpm 12.8.1 **modificou por conta própria** `pnpm-workspace.yaml`, adicionando:

```yaml
minimumReleaseAgeExclude:
  - '@vitejs/plugin-react@6.1.2'
```

Motivo observado: pnpm 12.8.1 aplica por padrão `minimumReleaseAge: 1440` (minutos ≈ 24 h), registrado em `node_modules/.pnpm-workspace-state-v1.json`; como `@vitejs/plugin-react@6.1.2` é uma release muito recente e está fixada no `apps/web/package.json`, o pnpm a **excluiu automaticamente da política de idade** para honrar o pin. Isto alterou um arquivo fora da fronteira permitida (efeito da própria ferramenta, não edição minha). Decisão de manter/reverter/definir `minimumReleaseAgeStrict`: **do Maestro**. Não reverti para não quebrar a reprodutibilidade já registrada.

## 4. Verificações executadas

### 4.1 `pnpm test:unit`

1ª execução, sem ajustes: **falhou no carregamento** de `tests/rbac.test.ts` com `ERR_MODULE_NOT_FOUND: Cannot find package '@orium/contracts'`. `tests/config.test.ts` passou (13 testes).
Causa raiz: os testes da raiz importam `@orium/contracts` (e `tests/auth.integration.test.ts` importa `fastify`), mas o **`package.json` da raiz não declara essas dependências**. No modo isolado do pnpm, um pacote do workspace só é ligado ao `node_modules` de quem o declara: `apps/api` e `apps/web` têm o link `node_modules/@orium/contracts` (verificado), a raiz não tem — logo, da raiz, `@orium/contracts` é irresolvível (confirmei com `node --input-type=module` a partir da raiz → `ERR_MODULE_NOT_FOUND`; a partir de `apps/api` → OK).

2ª execução, **com atalho somente de diagnóstico em `node_modules`** (arquivo ignorado pelo Git, descartável, não toca arquivos versionados): criei a junção
`node_modules/@orium/contracts → packages/contracts` (idêntica ao link que o pnpm criaria se a raiz declarasse a dependência) e reexecutei:

```text
Test Files  2 passed (2)
      Tests  28 passed (28)
```

Ou seja: **a lógica dos testes unitários passa (28/28)**. A correção definitiva pertence à configuração raiz (declarar `@orium/contracts` no `package.json` raiz, ou ajustar a resolução dos testes) — **decisão/fronteira do Maestro**, pois `package.json` e testes estão fora da minha fronteira.

> A junção de diagnóstico permanece em `node_modules` (não versionada). Um `pnpm install` limpo de `node_modules` a removerá; por isso o reporte acima da lacuna raiz é obrigatório antes do aceite.

### 4.2 `pnpm typecheck` — FALHA (erros reais, fora da fronteira)

```
apps/api/src/app.ts(35,40): error TS18046: 'error' is of type 'unknown'.
apps/api/src/app.ts(36,9):  error TS18046: 'error' is of type 'unknown'.
apps/web/src/main.tsx(4,8): error TS2882: Cannot find module or type declarations for side-effect import of './styles.css'.
tests/auth.integration.test.ts(2,53): error TS2307: Cannot find module 'fastify' or its corresponding type declarations.
tests/auth.integration.test.ts(23,10): error TS2339: Property 'sequential' does not exist on type 'SuiteAPI'.
```

Análise:
- `app.ts(35,36)`: no error handler do Fastify, o parâmetro `error` é tipado como `unknown` e o código acessa `error.statusCode` (linhas 35 e 36) **sem narrowing** (linha 34 já trata `AppError`). Erro de tipagem do código preparado que nunca fora compilado (PHASE1-REPORT previa "correções não compiladas").
- `main.tsx(4,8)` + `apps/web/tsconfig.json`: o import side-effect de `./styles.css` não encontra declarações de tipo; o `tsconfig` da web não inclui tipos de CSS (`vite/client`) nem `*.d.ts` de declaração. Bloqueia inclusive o `vite build`.
- `auth.integration.test.ts(2,53)`: mesma classe de lacuna da seção 4.1 — teste na raiz importa `fastify`, dependência não declarada na raiz.
- `auth.integration.test.ts(23,10)`: `describe.sequential` não reconhecido no tipo `SuiteAPI` resolvido a partir da raiz (possível imprecisão de tipos/versão na resolução raiz).

Todos os itens acima estão em `apps/**`, `tests/**` e `tsconfig` — **fora da fronteira**. Reportados para correção pelo Maestro/Codex.

### 4.3 `pnpm lint` — PASS

```sh
pnpm lint
```
Saiu sem diagnóstico (exit 0).

### 4.4 `pnpm build` — FALHA (mesma causa raiz da typecheck)

```text
packages/contracts build: Done
apps/api  build: FALHA (TS18046 app.ts)
apps/web  build: FALHA (TS2882 styles.css; vite build não chegou a rodar)
```

`packages/contracts` compila OK; `dist/index.js`/`index.d.ts` gerados.

### 4.5 `pnpm test` (integração completa) — NÃO EXECUTADO

Exige `.env` real e PostgreSQL via Docker (`orium_test`), além de bootstrap. Sem Docker e sem `.env`, **não foi executado e não é declarado como provado** — conforme fronteira e princípio do projeto (banco simulado não prova nada; suíte exige banco real e não usa skips).

## 5. Docker — RESOLVIDO (Docker Desktop + WSL2)

Histórico: `docker version` e `docker compose version` inicialmente não eram encontrados (binário ausente). A instalação pela fonte oficial foi concluída com a ajuda do responsável para aceitar a elevação UAC e para reiniciar a máquina (habilitar virtualização/WSL2).

### Passos executados

**Docker Desktop (fonte oficial do Docker via winget):**
```sh
winget install --id Docker.DockerDesktop -e --accept-package-agreements --accept-source-agreements
```
- Instalador oficial de `desktop.docker.com` (Docker Desktop 4.93.0, estável, publicado 2026-09-24), hash validado pelo winget.
- A 1ª tentativa autônoma parou no **prompt de UAC** (sessão não elevada); com o aceite do responsável e o reinício, a instalação foi concluída — `winget list` passou a reportar o pacote instalado e o client/CLI + plugin Compose entraram no PATH.

**WSL2 (backend exigido pelo Docker Desktop; ainda não estava habilitado):**
```sh
wsl --install --no-distribution   # executado elevado (RunAs) após o UAC
```
- Usamos `--no-distribution` para ativar apenas o núcleo WSL2 (o Docker Desktop cria a distro isolada `docker-desktop`).
- Antes: `wsl --status` → "não instalado". Depois do `--install` elevado: **WSL versão padrão 2** e distro `docker-desktop` Running (v2).

### Verificação final (critérios atendidos)

```text
$ docker version
Client:   Version 29.8.1
Server:   Docker Desktop 4.93.0 (240920)   Engine 29.8.1, API 1.56   # daemon OK

$ docker compose version
Docker Compose version v5.5.1

$ docker ps
CONTAINER ID   IMAGE   COMMAND   CREATED   STATUS   PORTS   NAMES   # engine saudável

$ docker info
Server Version: 29.8.1 | Operating System: Docker Desktop (containerized) | OSType: linux | Arch: x86_64
```

**Imagem PostgreSQL oficial validada** (a fixada em `compose.yaml`):
```text
$ docker pull postgres:17.11-alpine
Digest: sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24
Status: Downloaded newer image for postgres:17.11-alpine
```

> Observação de licenciamento (não é decisão deste relatório): conforme `ARCHITECTURE_PROPOSAL.md` §13, o uso do Docker Desktop deve considerar o licenciamento aplicável à organização; alternativa documentada é Docker Engine direto no WSL2 pela fonte oficial `download.docker.com/linux`.

**Próximo passo (fora da fronteira desta entrega):** prover `.env` local com senhas definidas pelo responsável (modelo em `.env.example`, arquivo ignorado pelo Git) e executar `pnpm db:up`, `pnpm db:migrate`, `pnpm db:bootstrap` (e-mails reais de Arino/Monique e senhas digitadas localmente), `pnpm test` e validação web→API→banco no navegador.

## 6. Arquivos alterados/criados por esta execução

| Arquivo | Tipo de mudança |
|---|---|
| `pnpm-lock.yaml` | **Reescrito/gerado**: lockfile real de resolução (85.701 bytes), reproduzível com `--frozen-lockfile` |
| `pnpm-workspace.yaml` | **Alterado automaticamente pelo pnpm** (`minimumReleaseAgeExclude` de `@vitejs/plugin-react@6.1.2`) — não editado por mim; revisão do Maestro |
| `node_modules/` (+ links de workspace, store em `%LOCALAPPDATA%\pnpm`) | Instalado; `node_modules/@orium/contracts` inclui junção de diagnóstico (não versionada) |
| `docs/INSTALLATION-OPENCODE.md` | **Novo**: este relatório |

Nada de apps, contratos, schema, migrations, auth, RBAC, ADRs, `.env` ou dados foi alterado/criado.

## 7. Pendências e recomendações para o Maestro/Codex

1. **Corrigir resolução da raiz** (bloqueia `test:unit` e parte do `typecheck`): declarar `@orium/contracts` (e os tipos de `fastify` usados nos testes) no `package.json` raiz como devDependencies, ou reposicionar a resolução dos testes; remover a junção de diagnóstico de `node_modules` depois.
2. **Corrigir tipo em `apps/api/src/app.ts`** (TS18046): fazer narrowing de `error` antes de acessar `statusCode` (ex.: `hasProp`/`typeof`), preservando o redaction de erros.
3. **Corrigir tipos de CSS em `apps/web`** (TS2882): adicionar tipos `vite/client` (ou déclaration `*.d.ts`) ao `tsconfig`/ambiente da web, para destravar `vite build`.
4. **Reavaliar `describe.sequential`** (TS2339) no teste de integração conforme a resolução real de tipos do Vitest 5.0.3.
5. **Provisionar o PostgreSQL local** (Docker agora operacional): criar `.env` com senhas locais e `BETTER_AUTH_SECRET` definidos pelo responsável (modelo `.env.example`, nunca enviar senhas a agentes), depois `pnpm db:up`, `pnpm db:migrate`, `pnpm db:bootstrap` (e-mails reais de Arino/Monique e senhas digitadas localmente), `pnpm test` e validação web→API→banco no navegador.
6. **Definir licenciamento/adoção do Docker Desktop** conforme §13 do `ARCHITECTURE_PROPOSAL.md` (já instalado); alternativa Engine/WSL2 documentada na seção 5.
7. **Decidir sobre o auto-ajuste do pnpm em `pnpm-workspace.yaml`** e sobre a eventual atualização de patch de `fastify`/`pg`.

Nenhuma Fase 2 ou produção foi tocada. Sem Redis/Kubernetes. Evidências confirmam instalação, lockfile real e Docker operacional; a validação completa da Fase 1 (banco real + fluxo) continua pendente de `.env` + bootstrap interativo (providos pelo responsável).
