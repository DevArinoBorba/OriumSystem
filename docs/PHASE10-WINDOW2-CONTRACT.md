# Fase 10 — Janela 2: Revisão da Coordenação e Contrato de Correções Locais

**Coordenação:** Antigravity #2 (Maestro / Orquestrador em sucessão ao Codex principal, por determinação do responsável em 14/10/2026)  
**Data:** 2026-10-14  
**Referências:** `docs/PHASE10-IMPLEMENTATION-CONTRACT.md`, `docs/PHASE10-COORDINATION-REVIEW.md`, `docs/PHASE10-BACKUP-CONTRACT.md`, `docs/AGENT-AUTONOMY.md`

---

## 1. Deliberação da Janela 1 (Revisão do Orquestrador)

1. **Inventário Read-Only da VPS (`Antigravity` — `docs/PHASE10-LIVE-INVENTORY.md`):** **ACEITO.**
   - Baseline comprovado sem mutação: host `srv2061201`, UFW ativo (`22/80/443`), stack `orium-production` saudável (`web`, `api`, `postgres` 17.11, `migrate` one-shot `Exited (0)`), `orium_prod` com 6 migrações (`0000`..`0005`), 2 usuários (`Arino` admin, `Arino Estagiario` collaborator), 23 grants canônicos.
   - Não-conformidades confirmadas para endereçamento: (a) zero rotinas de backup ativas na VPS; (b) permissões `777`/`666` em diretórios de código sob `/data/orium/production`; (c) ausência de ambiente de staging isolado.
2. **Revisão de Segurança (`Sentinela` — `docs/PHASE10-SECURITY-REVIEW.md`):** **ACEITA.**
   - Causa-raiz confirmada para supressão de HSTS, `X-Content-Type-Options`, `Referrer-Policy` e `X-Frame-Options` em `/` e `/index.html`: diretiva `add_header Cache-Control "no-store" always;` isolada no bloco `location = /index.html` de `deploy/production/nginx.conf`.
   - Avaliação confirmada sobre `X-Forwarded-For` / `$remote_addr` entre `coolify-proxy` (`10.0.1.0/24`) e o container `web`.
3. **Verificação e Prova Real de Backup/Restore Isolado (`Antigravity QA` — `docs/PHASE10-QA-RESULT.md`):** **ACEITA.**
   - `deploy/verification/{manifest-validator.ts,preflight-verifier.ts,backup-restore-verifier.ts}` e `tests/phase10/` com **27/27 testes unitários PASS** (`eslint` 0, `tsc` 0).
   - Prova real executada em container efêmero PostgreSQL 17.11 (`orium-qa-sandbox-postgres`, porta dinâmica `20000` via `Find-FreePort.ps1`): 6 migrações aplicadas, `pg_dump -Fc` real (65.903 bytes), `pg_restore` em banco isolado, **20/20 tabelas canônicas** e **23/23 grants canônicos** (hash `9673b3ccf9d31ad30177ad4ba3ed1a7bbb62ef1cd2385d9827d3599c3c96195a`), com teardown completo e preservação de DEV/TEST comprovada em `.local/phase10/real-restore-result.json`.

---

## 2. Revisão Técnica de `deploy/operations/` e `deploy/backup/` (Correções Obrigatórias antes do Aceite)

A inspeção da coordenação sobre os artefatos em andamento de `OpenCode` / `Cofre` identificou desvios que precisam ser corrigidos antes de declarar o checkpoint local concluído:

### 2.1. Escopo `deploy/operations/` (`OpenCode`)
1. **Política de Rollback no Manifesto (`ops-manifest.mjs` e `ops-release.mjs`):**
   - Incluir explicitamente `rollbackPolicy: { schemaDowngradeAllowed: false, keepBackups: true }` no manifesto gerado e persistido em `manifest.json`, mantendo compatibilidade integral com `deploy/verification/manifest-validator.ts`.
2. **Empacotamento `tar.gz` Fail-Closed (`ops-release.mjs`):**
   - Se a criação de `bundle.tar.gz` falhar, `ops-release.mjs` deve encerrar com `process.exitCode = 1` (fail-closed), nunca imprimir `RELEASE OK` com exit 0.
3. **Rollback sem Candidato Anterior Fail-Closed (`ops-rollback.mjs`):**
   - Quando não houver release anterior candidato (`!candidates.length`), `ops-rollback.mjs` deve encerrar com `process.exitCode = 1` (fail-closed).
4. **Relatório Durável:**
   - Gravar `docs/PHASE10-DELIVERY-RESULT.md` documentando os scripts, o manifesto regenerado com `rollbackPolicy` e os resultados reais dos gates positivos e negativos.

### 2.2. Escopo `deploy/backup/` (`Cofre` / `OpenCode`)
1. **Sequenciamento Fail-Closed (`deploy/backup/scripts/_sequence.sh`):**
   - Se `dump.sh` (ou qualquer etapa anterior) falhar, interromper imediatamente a sequência (não executar `manifest.sh`, `crypt.sh` ou `drive.sh` sobre estado falho) e garantir que o status de freshness registre `"ok": false` e `"last_stage_failed"` (nunca reportar `"ok": 1` apenas porque existe um dump antigo no diretório).
2. **Consistência Booleana em `freshness.sh`:**
   - `freshness.sh report` gravava `"ok": 1` (numérico), enquanto `freshness.sh check` comparava `[[ "$OK" == "true" ]]` (string booleana), fazendo o `check` falhar sempre. Gravar `"ok": true` ou `"ok": false` (boolean JSON real) e suportar `--failed-stage <stage>` quando chamado pelo orquestrador em caso de erro.
3. **Higiene e Fidelidade em `dump.sh`:**
   - Aplicar `umask 077` e `chmod 700 "$OUTDIR"` antes de criar arquivos temporários.
   - Remover `-N '_prisma_migrations'`: o OriumSystem utiliza Drizzle, não Prisma, e a tabela de controle de migrações deve ser preservada no dump para que restaurações mantenham o estado exato do schema.
   - Quando `CONTAINER_FRONT` utilizar `docker exec`, propagar `PGPASSWORD` ao container usando `-e PGPASSWORD` (sem `=valor` na linha de comando, herdando do ambiente do processo host sem expor a senha em `ps`/argv).
4. **Correção de `schedule.sh`:**
   - Proteger `${1:-}` contra `set -u` quando nenhum argumento extra é passado (`[[ "${1:-}" == "--invoke-path" && $# -ge 2 ]]`).
   - Corrigir a sintaxe `OnCalendar=` do systemd timer para `OnCalendar=*-*-* 03:00:00 America/Cuiaba`.
5. **Separação Local vs Drive e Prova Real de Criptografia (`crypt.sh` e `drive.sh`):**
   - Em `crypt.sh`: incluir `"${CONFIG_ARGS[@]}" "${PWC_ARGS[@]}"` também na chamada `rclone cryptcheck`; filtrar apenas `orium_*.dump` e `manifest.json` (`--include "orium_*.dump" --include "manifest.json"`).
   - Executar **prova local real** de roundtrip com o binário `rclone` já instalado na máquina contra um remote `crypt` local em `.local/phase10/cofre/artifacts/` (sem tocar rede/Drive e sem expor chaves no repo): gerar arquivo de teste/dump isolado, criptografar com `rclone copy`, validar `rclone cryptcheck`, descriptografar para diretório de restore e comprovar igualdade de SHA-256.
   - Gravar `docs/PHASE10-BACKUP-RESULT.md` com as evidências reais da prova de criptografia/falhas fail-closed e o procedimento exato para autorização OAuth do Google Drive pelo responsável.

---

## 3. Hardening de Produção e Suporte a Staging (`Antigravity`)

- **Ownership Exclusivo na Janela 2:**
  - `deploy/production/nginx.conf`
  - `apps/api/src/config.ts`
  - `tests/phase10/production-hardening.test.ts` (novo)
  - `docs/PHASE10-HARDENING-RESULT.md` (novo)
- **Escopo e Critérios de Aceite:**
  1. **`deploy/production/nginx.conf`:**
     - No bloco `location = /index.html`, manter `add_header Cache-Control "no-store" always;` e repetir explicitamente os 4 headers de segurança do servidor (`X-Content-Type-Options nosniff always`, `Referrer-Policy no-referrer always`, `X-Frame-Options DENY always`, `Strict-Transport-Security "max-age=31536000" always`), eliminando a perda de herança no Nginx.
     - Configurar `set_real_ip_from 10.0.1.0/24; set_real_ip_from 172.16.0.0/12; real_ip_header X-Forwarded-For; real_ip_recursive on;` no bloco `server` para que `$remote_addr` reflita o IP real do cliente repassado exclusivamente pelo `coolify-proxy` na rede interna Docker, sem permitir spoofing externo e sem agrupar o rate-limit de todos os usuários no IP do proxy.
     - Validar a sintaxe real do `deploy/production/nginx.conf` executando `docker run --rm -v .../deploy/production/nginx.conf:/etc/nginx/conf.d/default.conf:ro nginx:1.27-alpine nginx -t` (sem subir container persistente nem usar portas).
  2. **`apps/api/src/config.ts`:**
     - Em `NODE_ENV === 'production'`, substituir a exigência estática de `app.oriumdigital.tech` por uma allowlist explícita de origens HTTPS oficiais (`https://app.oriumdigital.tech` e `https://staging.oriumdigital.tech`), exigindo que `API_ORIGIN` e `WEB_ORIGIN` pertençam à allowlist e sejam idênticos (`value.API_ORIGIN === value.WEB_ORIGIN`), mantendo `API_HOST === '0.0.0.0'` e `new URL(value.DATABASE_URL).hostname === 'postgres'`.
  3. **Testes Automatizados (`tests/phase10/production-hardening.test.ts`):**
     - Testar `loadConfig` em `production`: aprovação para `https://app.oriumdigital.tech` e `https://staging.oriumdigital.tech`; rejeição para domínios arbitrários, protocolo `http:`, divergência entre `API_ORIGIN` e `WEB_ORIGIN`, path na origem, `API_HOST !== '0.0.0.0'` ou `DATABASE_URL` fora do host `postgres`.
     - Testar inspeção estrutural do `deploy/production/nginx.conf`: presença dos 5 headers com `always` dentro de `location = /index.html` e configuração de `real_ip_header` / `set_real_ip_from`.
  4. **Verificações e Entrega:**
     - Executar `pnpm vitest run tests/phase10/production-hardening.test.ts`, `pnpm --filter @orium/api typecheck`, `pnpm exec tsc -p tsconfig.json --noEmit` e `pnpm exec eslint apps/api/src/config.ts tests/phase10/production-hardening.test.ts`.
     - Gravar `docs/PHASE10-HARDENING-RESULT.md`, atualizar exclusivamente a seção `## Antigravity` na nota `oriumsystem-acompanhamento` via `maestri note edit`, e enviar resumo curto em background para `"Antigravity #2"` via `node scripts/maestri-send.mjs --agent "Antigravity #2" --message-file ...`.
     - **Nenhuma mutação na VPS nesta tarefa** (a atualização do bundle e deploy supervisionado ocorrerão após o fechamento conjunto de `Antigravity` + `OpenCode`).
