# Fase 10 — Janela 3: Execução Operacional Supervisionada na VPS e Verificação Pós-Deploy

**Coordenação:** Antigravity #2 (Maestro / Orquestrador)  
**Data:** 2026-10-14  
**Referências:** `docs/PHASE10-IMPLEMENTATION-CONTRACT.md`, `docs/PHASE10-WINDOW2-CONTRACT.md`, `docs/PHASE10-HARDENING-RESULT.md`, `docs/PHASE10-DELIVERY-RESULT.md`, `docs/PHASE10-QA-RESULT.md`, `docs/PHASE10-SECURITY-REVIEW.md`

---

## 1. Gate de Entrada da Janela 3 (Aprovado pela Coordenação)

1. **Hardening Local e Testes (`Antigravity` — `docs/PHASE10-HARDENING-RESULT.md`):** **ACEITO** (14/14 testes novos PASS, `nginx -t` em container exit 0, `typecheck` e `eslint` exit 0).
2. **Tooling de Release e Preflight (`OpenCode` — `docs/PHASE10-DELIVERY-RESULT.md`):** **ACEITO** (`rollbackPolicy` incluído, `tar` e `rollback` fail-closed comprovados, 58 arquivos sem segredos).
3. **Probes HTTP/TLS, Freshness e Isolamento (`Antigravity QA` — `docs/PHASE10-QA-RESULT.md`):** **ACEITO** (60/60 testes unitários em `tests/phase10/` PASS, prova real PostgreSQL 17.11 dump/restore PASS, baseline pré-deploy registrado em `.local/phase10/live-https-probe-result.json`).
4. **Auditoria de Segurança (`Sentinela` — `docs/PHASE10-SECURITY-REVIEW.md`):** **ACEITA** (Seções 1 a 5 e checklist pré-ativação VPS).

---

## 2. Escopo Operacional Supervisionado na VPS (`Antigravity`)

- **Executor Único na VPS (conforme Regra 1 de `PHASE10-IMPLEMENTATION-CONTRACT.md`: "um executor operacional VPS por vez"):** `Antigravity`
- **Ownership de Arquivos Locais:**
  - `deploy/operations/releases/` (geração do novo release canônico pós-hardening)
  - `docs/PHASE10-VPS-ROLLOUT-RESULT.md` (novo relatório de evidências reais pós-deploy)
  - `.local/phase10/antigravity/` (scripts helpers locais sem segredos)

### Passo 1 — Empacotamento do Release Pós-Hardening (Local)
- Executar `node deploy/operations/run-pipeline.mjs production` para gerar o release atualizado contendo `deploy/production/nginx.conf` e `apps/api/src/config.ts` da Janela 2.
- Confirmar `PREFLIGHT OK` e `RELEASE OK` com `bundle.tar.gz` e `manifest.json` íntegros.

### Passo 2 — Backup Preventivo Real e Snapshot de Rollback na VPS (`orium-vps`)
- Criar `/var/lib/orium-backup/staging` e `/var/lib/orium-backup/pre-window3-snapshot` na VPS com permissão estrita `chmod 700` (`root:root`).
- Executar `pg_dump -U postgres -Fc orium_prod` dentro de `orium-production-postgres-1` gravando em `/var/lib/orium-backup/staging/orium_orium_prod_pre_window3.dump` (`chmod 600`), comprovar tamanho > 0, hash SHA-256 e listagem válida com `pg_restore --list`.
- Copiar os arquivos atuais `/data/orium/production/deploy/production/nginx.conf` e `/data/orium/production/apps/api/src/config.ts` para `/var/lib/orium-backup/pre-window3-snapshot/` para rollback instantâneo se necessário.

### Passo 3 — Saneamento de Permissões e Atualização Controlada da Stack (`orium-production`)
- Preservar intactos `/data/orium/production/deploy/production/.env` (`600`) e o volume `orium-production_orium-postgres`. NUNCA expor conteúdo de `.env` ou senhas.
- Sanear as permissões permissivas (`777`/`666`) herdadas em `/data/orium/production/{apps,db,deploy,packages}`: diretórios para `755` (`chmod 755`) e arquivos para `644` (`chmod 644`), mantendo `/data/orium/production/deploy/production/.env` e `docker-compose.yaml` em `600`.
- Atualizar `/data/orium/production/deploy/production/nginx.conf` e `/data/orium/production/apps/api/src/config.ts` na VPS com as versões validadas do release da Janela 2 (comprovando igualdade de SHA-256 entre local e VPS).
- Reconstruir e atualizar apenas os serviços de aplicação (`web` e `api`) via Docker Compose (`docker compose -f /data/orium/production/deploy/production/docker-compose.yaml up -d --build web api`), mantendo `postgres` intacto.

### Passo 4 — Verificação Pós-Deploy na VPS
- Confirmar saúde de todos os containers (`orium-production-web-1`, `orium-production-api-1`, `orium-production-postgres-1` e stack Coolify vizinha).
- Executar probe HTTPS em `https://app.oriumdigital.tech/` e comprovar que a rota raiz `/` (e `/index.html`) agora retorna HTTP 200 com **todos os 5 cabeçalhos de segurança** (`strict-transport-security`, `x-content-type-options: nosniff`, `x-frame-options: DENY`, `referrer-policy: no-referrer`, `cache-control: no-store`).
- Conferir em modo somente-leitura no `orium_prod` que as 6 migrações, 2 usuários (`Arino` e `Arino Estagiario`), 3 clientes, 1 demanda e 23 grants continuam 100% preservados.
- Gravar `docs/PHASE10-VPS-ROLLOUT-RESULT.md`, atualizar a seção `## Antigravity` em `oriumsystem-acompanhamento` via `maestri note edit` e notificar `"Antigravity #2"` em background via `scripts/maestri-send.mjs`.

---

## 3. Verificação Independente Pós-Deploy (`Antigravity QA`)
- Após a conclusão do Passo 4 pelo `Antigravity`, o `Antigravity QA` reexecutará `.local/phase10/run-live-https-and-manifest-probe.mjs` para comprovar de forma independente `securityValid = true` tanto em `https://app.oriumdigital.tech/` (Web) quanto em `https://app.oriumdigital.tech/api/v1/notifications` (API) e validar o novo manifesto de release.
