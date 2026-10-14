# Fase 1 — Verificação em navegador (relatório)

Data: 2026-10-05. **Fase 1 permanece EM ANDAMENTO; este relatório registra evidências de navegador, não aceite técnico.** Nenhuma alteração em apps/packages/tests/configs raiz foi feita nesta tarefa. Docker já validado por Antigravity; banco de teste `orium_test` usado exclusivamente.

## Escopo e execução

- API local apontando `DATABASE_URL` = `TEST_DATABASE_URL` (`orium_test`), porta loopback 3001; Vite em 5173; `API_ORIGIN`/`WEB_ORIGIN` coerentes (`http://127.0.0.1:3001` / `http://127.0.0.1:5173`). Portas confirmadas livres antes e depois.
- Migrations **não executadas por este agente**: já estavam aplicadas por Antigravity (`public.auth_user` presente, 8 tabelas, 0 usuários). Verificação somente-leitura do estado; sem migrations concorrentes.
- Fixture temporária: e-mail `browser-<uuid>@example.test`, senha aleatória gerada e usada dentro do script, papel `collaborator`, criada via `provisionUser` (mesma primitiva de produção) e **removida** ao final (`DELETE FROM auth_user WHERE id=$1`).
- Navegador: Chrome do sistema dirigido por `playwright-core` instalado apenas em `.local/browser` (ignorado pelo git; nenhuma dependência versionada alterada).
- Scripts de orquestração em `.local/` (`browser-verify.mjs`, `state-check.mjs`), fora do controle de versão.
- `.env` não alterado; banco dev `orium_dev` e contas Arino/Monique não utilizados.

## Resultados em navegador (nada de senha/cookie/token impresso)

| # | Cenário | Resultado |
|---|---|---|
| 1 | Login (e-mail+senha) entra e exibe área protegida com nome da fixture | OK |
| 2 | Reload da página mantém sessão (área protegida + e-mail exibido) | OK |
| 3 | Cookie de sessão não exposto a `document.cookie` (HttpOnly) | OK |
| 4 | Logout volta para a tela de Entrar | OK |
| 5 | `/api/v1/me` após logout retorna 401 (acesso negado) | OK |
| 6 | Reload após logout permanece deslogado | OK |

Observação operacional: `waitUntil: 'networkidle'` não se estabiliza por causa do websocket HMR do Vite; usou-se `load`, sem impacto no resultado.

## Estado de limpeza

- Fixture removida do `orium_test` (usuários de volta a 0).
- Processos da API e do Vite iniciados por este script encerrados; portas 3001 e 5173 livres após o teste.
- Nenhum processo adicional do agente ficou ativo (processos `node` remanescentes na máquina são de outros agentes/apresentações e não foram tocados).

## Correções anteriores desta fase (registradas para revisão)

| Arquivo | Correção |
|---|---|
| `apps/api/src/app.ts` | Narrow de `error` (`unknown`) antes de acessar `statusCode` no error handler — corrige TS18046 |
| `apps/web/src/vite-env.d.ts` | Novo; `/// <reference types="vite/client" />` declara módulos `*.css` — corrige TS2882 |
| `tests/auth.integration.test.ts` | `describe.sequential(` → `describe(` (API inexistente no Vitest 5.0.3) — corrige TS2339 |
| `package.json` (raiz) | devDeps `@orium/contracts` (workspace:*) e `fastify` 5.12.2 para resolução da raiz — corrige TS2307 e `ERR_MODULE_NOT_FOUND` |
| `pnpm-lock.yaml` | regenerado com as adições; junção diagnóstica removida (link real do pnpm) |

## Checks (resultados atuais)

| Check | Resultado |
|---|---|
| `pnpm typecheck` | OK |
| `pnpm lint` | OK |
| `pnpm build` | OK (contratos + API + Vite web) |
| `pnpm test:unit` | OK 28/28 |

Detalhe de validação do check: testes na raiz resolvem `@orium/contracts` e `fastify` após as devDeps; a suíte unitária permanece independente de banco. Os pacotes `apps/*` typecheckam e a web compila para `dist` com Vite.

## Bloqueios / observações finais

- Integração `pnpm test` (suíte completa) não foi executada por este agente nesta rodada; a verificação de navegador usou o banco test já migrado. Se o Antigravity rodar a suíte, o banco `orium_test` será usado com fixture própria e cleanup do prefixo.
- Nenhum bloqueio técnico encontrado para o cenário navegador: serviços subiram, fluxo funcionou de ponta a ponta.
- Fase 1 **não está concluída**: falta validação humana/Codex, decisões de recuperação administrativa e a matriz completa de testes (integração `pnpm test`), conforme PHASE1-REPORT.md.
