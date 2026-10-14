# Fase 6 — Incremento 1: proteção HTTP da API (resultado)

**Data:** 08/10/2026 · **Dono:** Antigravity · **Contrato:** `docs/PHASE6-IMPLEMENTATION-CONTRACT.md` (Incremento 1). Aguardando revisão/aceite do Codex.

## Alteração (`apps/api/src/app.ts`)
- Nova constante interna (não exportada) `apiSecurityHeaders`:
  - `Cache-Control: no-store` e `X-Content-Type-Options: nosniff` (preservados)
  - `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`
  - `X-Frame-Options: DENY`
  - `Referrer-Policy: no-referrer`
  - `Permissions-Policy: camera=(), microphone=(), geolocation=()`
- Hook `onRequest` aplica `reply.headers(apiSecurityHeaders)` **antes** das guardas Origin/JSON, então respostas 403/404/413/415/500 também recebem os cabeçalhos.
- Guardas Origin (`ORIGIN_REJECTED`), `sec-fetch-site: cross-site` e JSON (`JSON_REQUIRED`), cookies, logger/redact e `setErrorHandler` sanitizado inalterados.
- **Sem HSTS** em HTTP local (pertence à implantação HTTPS). Sem bypass ou caminho especial para testes no código de produção.
- A CSP da API não protege o documento web (Vite/frontend); isso é escopo separado.

## Testes (`tests/security-http.test.ts`) — `app.inject` real, sem listener
Banco: **stub explícito limitado à consulta de identidade em startup** (`assertApplicationDatabase` → `unsafe:false`); qualquer outra consulta ou `connect()` lança erro. **Não é integração PostgreSQL.** Um teste final comprova que o stub só recebeu a consulta de startup.

| Caso | Status | Verificações |
| :--- | :--- | :--- |
| `GET /health/live` | 200 | cabeçalhos; sem HSTS; sem `set-cookie` |
| Rota inexistente (com `?token=probe`) | 404 | cabeçalhos; corpo só `{error:{code,requestId}}`; probe não ecoado |
| `POST` sem Origin (senha fictícia no corpo) | 403 `ORIGIN_REJECTED` | cabeçalhos; senha fictícia não ecoada |
| `POST` cross-site com Origin válido | 403 | guarda preservada |
| `POST` com Origin, `text/plain` | 415 `JSON_REQUIRED` | guarda preservada |
| Corpo JSON > 16 KB | 413 `PAYLOAD_TOO_LARGE` | cabeçalhos; marcador do corpo não ecoado |
| JSON malformado (com Origin válido) | 400 `INVALID_INPUT` | cabeçalhos; corpo só `{error:{code,requestId}}`; marcador não ecoado; sem detalhe do parser |
| Stub usado só no startup | — | `['startup-identity-check']` |

Todos os erros: sem stack, sem texto de driver/postgres, sem `password/secret` no corpo. O contrato de cabeçalhos é provado pelas respostas reais (sem teste espelhando a constante).

## Comandos e resultados
- `node node_modules/vitest/vitest.mjs run tests/security-http.test.ts` → **8/8 PASS** (2,55 s), após ajuste da revisão Codex.
- `pnpm --filter @orium/api typecheck` → exit 0 (0 erros)
- `pnpm exec eslint apps/api/src/app.ts tests/security-http.test.ts` → exit 0 (0 problemas)

Nenhum build/dist, servidor, porta, banco, migration, frontend ou DEV tocado. API DEV em execução continua com o build anterior: os cabeçalhos só valem em DEV após rebuild/restart autorizados.
