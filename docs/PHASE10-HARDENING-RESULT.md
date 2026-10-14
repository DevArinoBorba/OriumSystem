# Relatório de Hardening de Produção e Suporte a Staging (Fase 10 — Janela 2)

- **Data:** 2026-10-14T09:10:00-04:00 (13:10 UTC)
- **Coordenação:** Antigravity #2 (Maestro / Orquestrador)
- **Executor:** Antigravity
- **Contrato:** `docs/PHASE10-WINDOW2-CONTRACT.md` (Seção 3)
- **Status:** **CONCLUÍDO COM SUCESSO — TOOLCHAIN 100% VERDE**

---

## 1. Resumo Executivo das Alterações

Nesta Janela 2 da Fase 10, foram implementadas as correções de hardening de infraestrutura web e configuração de backend para viabilizar tanto a segurança estrita do tráfego de produção quanto o suporte isolado a staging, sem qualquer mutação antecipada na VPS:

1. **`deploy/production/nginx.conf`:**
   - **Correção de Herança de Headers:** No Nginx, a declaração de qualquer diretiva `add_header` em um bloco filho (como `location = /index.html`) anula completamente a herança dos cabeçalhos declarados no bloco `server`. Foram replicados explicitamente dentro de `location = /index.html` os 4 cabeçalhos de segurança obrigatórios (`X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options` e `Strict-Transport-Security`), preservando `Cache-Control "no-store"` com a diretiva `always`.
   - **Configuração de IP Real (`real_ip`):** Configurado o módulo `ngx_http_realip_module` com `set_real_ip_from 10.0.1.0/24;`, `set_real_ip_from 172.16.0.0/12;`, `real_ip_header X-Forwarded-For;` e `real_ip_recursive on;`. Isso assegura que `$remote_addr` e `X-Real-IP` encaminhados para a API reflitam o endereço IP real do cliente externo entregue pelo `coolify-proxy` (Traefik), evitando que todo o tráfego compartilhe o IP interno do proxy nos rate-limits do Better Auth.
   - **Validação Sintática Real em Container Nginx:** Sintaxe comprovada via container efêmero `nginx:1.27-alpine` executando `nginx -t` com código de retorno 0.

2. **`apps/api/src/config.ts`:**
   - **Allowlist Explícita de Origens:** Criada e exportada a constante canônica `PRODUCTION_ORIGIN_ALLOWLIST` com as origens oficiais autorizadas: `https://app.oriumdigital.tech` e `https://staging.oriumdigital.tech`.
   - **Validação de Topologia Estrita:** Em `NODE_ENV === 'production'`, exige que `API_ORIGIN` e `WEB_ORIGIN` pertençam à allowlist e sejam idênticos (`API_ORIGIN === WEB_ORIGIN`), mantendo a obrigação de `API_HOST === '0.0.0.0'` e `DATABASE_URL` no host `postgres`.
   - **Preservação de Regras Locais:** Ambientes `development` e `test` continuam exigindo loopback (`127.0.0.1`, `localhost`, `::1`) e rejeitando `API_HOST === '0.0.0.0'`.

---

## 2. Evidências das Verificações Realizadas

### 2.1. Validação Sintática do Nginx (`nginx -t`)

- **Comando executado:**
  ```bash
  docker run --rm --add-host api:127.0.0.1 -v "C:/Users/arino/OneDrive/Documentos/Projetos/OriumSystem/deploy/production/nginx.conf:/etc/nginx/conf.d/default.conf:ro" nginx:1.27-alpine nginx -t
  ```
- **Resultado:**
  ```text
  nginx: the configuration file /etc/nginx/nginx.conf syntax is ok
  nginx: configuration file /etc/nginx/nginx.conf test is successful
  ```
- **Exit Code:** `0`

### 2.2. Suíte de Testes Automatizados (`tests/phase10/production-hardening.test.ts`)

Criada suíte completa com **14 testes unitários**, cobrindo exaustivamente:
- Exportação da allowlist canônica `PRODUCTION_ORIGIN_ALLOWLIST` (`app` e `staging`).
- Aprovação de configuração de produção com `https://app.oriumdigital.tech`.
- Aprovação de configuração de staging com `https://staging.oriumdigital.tech`.
- Rejeição de domínios arbitrários em produção (`Configuração inválida:.*NODE_ENV`).
- Rejeição de protocolo inseguro `http:` em produção.
- Rejeição de divergência entre `API_ORIGIN` e `WEB_ORIGIN`.
- Rejeição de origens contendo path (`/api`).
- Rejeição de `API_HOST !== '0.0.0.0'` em produção.
- Rejeição de `DATABASE_URL` fora do hostname `postgres` em produção.
- Preservação da rejeição de `API_HOST === '0.0.0.0'` em ambiente local.
- Inspeção estrutural de `deploy/production/nginx.conf` (presença de `set_real_ip_from`, `real_ip_header`, `real_ip_recursive` e os 5 headers de segurança com `always` no `location = /index.html`).

- **Execução individual da suíte:**
  ```bash
  pnpm vitest run tests/phase10/production-hardening.test.ts
  # Tests: 14 passed (14)
  # Duration: 884ms, Exit Code: 0
  ```

- **Execução de regressão em `tests/phase10/`:**
  ```bash
  pnpm vitest run tests/phase10/
  # Test Files: 4 passed (4)
  # Tests: 41 passed (41)
  # Duration: 1.70s, Exit Code: 0
  ```

### 2.3. Validação de Tipos e Linter

| Verificação | Comando | Resultado | Exit Code |
|---|---|---|---|
| Typecheck API | `pnpm --filter @orium/api typecheck` | 0 erros | `0` |
| Typecheck Monorepo | `pnpm exec tsc -p tsconfig.json --noEmit` | 0 erros | `0` |
| ESLint | `pnpm exec eslint apps/api/src/config.ts tests/phase10/production-hardening.test.ts` | 0 erros / 0 avisos | `0` |

---

## 3. Arquivos Modificados / Criados

- `deploy/production/nginx.conf` (atualizado com real_ip e headers replicados)
- `apps/api/src/config.ts` (atualizado com allowlist e validação de staging)
- `tests/phase10/production-hardening.test.ts` (novo, 14 testes unitários)
- `docs/PHASE10-HARDENING-RESULT.md` (este relatório)

---

## 4. Limites e Próximos Passos

- **VPS Intocada:** Nenhuma mutação ou restart de containers foi realizado na VPS durante esta etapa.
- **Handoff:** Entregue para a coordenação (`Antigravity #2`) para orquestração da montagem do pacote de release conjunto e autorização do deploy supervisionado na VPS.
