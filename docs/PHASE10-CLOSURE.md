# PHASE10-CLOSURE.md — Encerramento Técnico da Fase 10 (Infraestrutura e Produção)

**Data:** 14/10/2026
**Coordenação:** Antigravity #2 (Maestro / Orquestrador) · **Execução local (tooling/backup):** OpenCode · **Rollout VPS:** Antigravity · **Verificação independente:** Antigravity QA · **Gate 8 (CI real):** GitHub Actions
**Propósito:** consolidar com rigor e honestidade as entregas e evidências das Janelas 1, 2 e 3, declarar os limites e as pendências humanas — sem inventar fatos nem declarar concluído o que não foi verificado.

---

## 1. Resumo executivo

A Fase 10 (Infraestrutura e produção) foi executada em três janelas supervisionadas, terminando com publicação real na VPS e CI aprovado:

| Janela | Entrega principal | Evidência |
|---|---|---|
| 1 | Inventário somente-leitura da VPS + contrato | `docs/PHASE10-LIVE-INVENTORY.md` |
| 2 | Hardening config + tooling fail-closed + correções de backup + prova cripto local | `docs/PHASE10-HARDENING-RESULT.md`, `docs/PHASE10-DELIVERY-RESULT.md`, `docs/PHASE10-BACKUP-RESULT.md` |
| 3 | Rollout supervisionado na VPS + backup/timer + verificação QA pós-deploy + Gate 8 | `docs/PHASE10-VPS-ROLLOUT-RESULT.md`, `docs/PHASE10-QA-RESULT.md` §7, GitHub Actions run `#38576163707` |

Status geral: **CONCLUÍDA tecnicamente com sucesso**, com 3 gates humanos/pendências externas explícitas (seção 7).

---

## 2. Janela 1 — Inventário somente-leitura da VPS

**Fonte:** `docs/PHASE10-LIVE-INVENTORY.md` · Executor: Antigravity (100% passivo, alias SSH `orium-vps`).

- **Host:** `srv2061201`, Ubuntu 26.04.1 LTS, 2 vCPUs, ~7,9 GB RAM, UFW ativo (apenas 22/80/443 externos), SSH root-only com chaves, senha desabilitada.
- **Containers da stack Orium:** `web` (Nginx, 8080), `api` (Fastify, 3001, healthy), `postgres` (17.11-alpine, healthy, volume `orium-production_orium-postgres`), `migrate` one-shot (Exited 0); infra Coolify/Traefik saúde total.
- **Rota pública:** `https://app.oriumdigital.tech` HTTP/2 200; TLS Let's Encrypt via `acme.json`; redirect HTTP→HTTPS.
- **Banco `orium_prod`:** 6 migrations Drizzle (0000–0005), 2 usuários (Arino administrator; Arino Estagiario collaborator), 3 clientes, 1 projeto/2 demandas (rollout posterior confirmou 4 clientes/2 demandas — ver §4), 23 pares `role_permission`, 17 permissões.
- **Diagnóstico:** permissões 777/666 em `apps`, `db`, `deploy`, `packages`; **nenhum backup automatizado** (14 timers só do sistema, cronid vazio, `/data/coolify/backups` vazio); **sem staging** isolado; arquivos antigos em `/root`.

> Critério de honestidade: a Janela 1 apenas levantou e diagnosticou; não executou mutação nem declarou produção "pronta". Correções aconteceram nas Janelas 2 e 3.

---

## 3. Janela 2 — Hardening, tooling fail-closed e correções de backup

### 3.1 Hardening de produção (Antigravity) — `docs/PHASE10-HARDENING-RESULT.md`

- **`deploy/production/nginx.conf`:** contra a regra do Nginx (add_header em bloco filho anula herança), os 4 headers de segurança (`X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, `Strict-Transport-Security`) foram replicados explicitamente em `location = /index.html`, somando ao `Cache-Control: no-store` com `always` — **5 headers** no total.
- **`real_ip`:** `set_real_ip_from` (10.0.1.0/24 e 172.16.0.0/12), `real_ip_header X-Forwarded-For`, `real_ip_recursive on`.
- **`apps/api/src/config.ts`:** allowlist canônica `PRODUCTION_ORIGIN_ALLOWLIST = ['https://app.oriumdigital.tech', 'https://staging.oriumdigital.tech']`; validação de topologia estrita em produção (`API_ORIGIN === WEB_ORIGIN`, `API_HOST === '0.0.0.0'`, DB em `postgres`); dev/test continuam exigindo loopback.
- **Evidências:** `nginx -t` em container `nginx:1.27-alpine` exit 0; suíte `tests/phase10/production-hardening.test.ts` (14 testes); typecheck/lint verdes.

### 3.2 Tooling de release fail-closed (OpenCode) — `docs/PHASE10-DELIVERY-RESULT.md`

- **`deploy/operations/`:** `ops-config/ops-util/ops-manifest/ops-preflight/ops-release/ops-rollback/run-pipeline` + `README` + `package.json` (zero deps, ESM).
- **Manifesto** `manifestVersion:"1.0"` com `gitCommit` (null quando sem git — nunca inventar), `sourceTreeSHA256` (hex64) e **`rollbackPolicy:{ schemaDowngradeAllowed:false, keepBackups:true }`**.
- **Gates provados localmente:** pipeline `PASS` (58 arquivos, `bundle.tar.gz` 150.783 bytes); rollback positivo (com `current.json` atualizado, sem downgrade de schema); negativos exit 1 (`.env` → `FORBIDDEN_FILE_DETECTED`, hash → `CHECKSUM_MISMATCH`, release inexistente, **sem candidato de rollback**). Secrets-incluídos: 0 hits em 58 arquivos.
- **Fail-closed reforçado (Janela 2/§2.1):** falha de `tar` → exit 1 sem `RELEASE OK`; rollback sem candidato → exit 1.

### 3.3 Correções dos scripts de backup (OpenCode) — `docs/PHASE10-BACKUP-RESULT.md`

- **`_sequence.sh`:** interrompe na 1ª falha (não roda manifest/crypt/drive sobre estado falho) e grava freshness com `--failed-stage`.
- **`freshness.sh`:** `"ok": true|false` **boolean JSON real** (antes numérico `1/0`) + `--failed-stage`.
- **`dump.sh`:** `umask 077` + `chmod 700` no destino; removido `-N '_prisma_migrations'` (**Drizzle é o ORM — as tabelas de migração devem ser preservadas**); propagação `-e PGPASSWORD` no `docker exec` (sem senha no argv).
- **`schedule.sh`:** `${1:-}` sob `set -u`; `OnCalendar=*-*-* 03:00:00 America/Cuiaba`.
- **`crypt.sh`:** `cryptcheck` com `CONFIG_ARGS+PWC_ARGS` e `--include "orium_*.dump" --include "manifest.json"`.
- **Sintaxe:** `bash -n` 9/9 scripts OK.
- **Prova cripto real local:** `rclone v1.75.1` (install WinGet), remote `crypt` sobre backend `local`, config exclusivo em `.local/phase10/cofre/artifacts/rclone.conf`; encrypt copy → `cryptcheck` (0 differences / 1 matching) → decrypt → **SHA-256 idêntico** (`a9aaa9be...`) — **ROUNDTRIP OK**, sem rede/Drive.

---

## 4. Janela 3 — Rollout supervisionado na VPS

**Fonte:** `docs/PHASE10-VPS-ROLLOUT-RESULT.md` (executor único na VPS: Antigravity).

1. **Empacotamento local:** pipeline `PASS` → release `release-20261014133145-2ee58a9bacdd`, `bundle.tar.gz` 150.782 bytes.
2. **Backup preventivo real:** dump `orium_orium_prod_pre_window3.dump` (68.864 bytes, SHA-256 `60552cd0...`, TOC 174 entradas válidas), `chmod 600`; snapshot `nginx.conf.bak`/`config.ts.bak` em `/var/lib/orium-backup/pre-window3-snapshot` (`chmod 700`).
3. **Saneamento de permissões:** `777/666` → `755/644` em apps/db/deploy/packages; `.env` e `docker-compose.yaml` permaneceram `600 root:root` (não lidos/expostos).
4. **Deploy controlado:** SCP + `sha256sum` idêntico ao local (nginx.conf `c274d4de...`, config.ts `66cf30d6...`); `docker compose --project-name orium-production up -d --build --no-deps web api`; **postgres intacto e ininterrupto**.
5. **Pós-deploy:** containers `Up (healthy)`; dentro do web: `set_real_ip_from` + `real_ip_recursive on` + 5 headers em `location = /index.html`; dentro da api: allowlist canônica; DB `orium_prod` com 6 migrations, 2 usuários, 4 clientes, 2 demandas, 23 pares `role_permission` — zero corrupção.
6. **Backup automatizado na VPS:**
   - Scripts instalados (9/9) em `/usr/local/lib/orium-backup/scripts/` (LF sanitizado, `chmod 750`, `root:root`); fallback `python3`/`jq` onde não há `node` global.
   - Config protegida `/var/lib/orium-backup/orium-backup.conf` (`chmod 600`) com dry-run seguro (`ORIUM_DRY_RUN=1`).
   - Ciclo real executado: exit 0, dump `orium_orium_prod_2026-10-14T134538Z.dump` (68.863 bytes, SHA-256 `650f9f86...`, TOC 174 entradas), `freshness.json` `{"ok": true, ...}`, `freshness.sh check` → ok (exit 0).
   - Timer `orium-backup.timer` ativo: `OnCalendar=*-*-* 03:00:00 America/Cuiaba`, `Persistent=true`, trigger `Thu 2026-10-15 07:00:00 UTC` confirmado via `systemctl list-timers`.

---

## 5. Verificação independente de QA — `docs/PHASE10-QA-RESULT.md`

- **Componentes:** `manifest-validator.ts`, `preflight-verifier.ts`, `backup-restore-verifier.ts`, `health-probe-verifier.ts`.
- **Suíte `tests/phase10/`:** 5 arquivos, **60/60 testes aprovados** (26 + 14 + 19 + 1 = composição por janelas; conf. §7 = 60, exit 0). ESLint 0 erros; TS `--noEmit` 0 erros.
- **Prova real de restore isolado (PostgreSQL 17.11):** container efêmero `orium-qa-sandbox-postgres` (labels `project=orium, phase=10, role=qa-sandbox`), volume → porta dinâmica `20000` (lease Find-FreePort), aplicação das 6 migrations, `pg_dump -Fc` (65.903 bytes), `pg_restore` exit 0, **20/20 tabelas canônicas** e **23/23 grants** (`fingerprint 9673b3cc...`, `grantsMatchCanonical: true`); teardown completo com `protectedContainersUntouched: true`.
- **Probes HTTPS pós-deploy (Janela 3):** web `https://app.oriumdigital.tech/` → 200, `securityValid: true`, 5 headers presentes; api `/api/v1/notifications` → 401 (rota protegida), `securityValid: true` (HSTS, XCTO, XFO, RP, cache-control, CSP). Comparativo: ausências pré-deploy sanadas.
- **Evidência durável:** `.local/phase10/live-https-probe-result.json`, `.local/phase10/real-restore-result.json`.

---

## 6. Gate 8 — CI real no GitHub Actions

- **Run:** [#38576163707](https://github.com/DevArinoBorba/OriumSystem/actions/runs/38576163707) · commit `1a11a2e` (`fix(ci): build @orium/contracts before root typecheck via pnpm run typecheck`) · branch `main` · **conclusion: success**.
- **Workflow `phase10-local-gates.yml`:** triggers `push`/`pull_request` em `main` + `workflow_dispatch`; passos `checkout@v4`, `pnpm/action-setup@v4` (version from `packageManager`), `setup-node@v4` (node 24, cache pnpm), `pnpm install --frozen-lockfile`, `pnpm run typecheck` (build foundation + `tsc --noEmit`), `eslint deploy/verification tests/phase10`, `vitest run tests/phase10/`, `node deploy/operations/run-pipeline.mjs production`.
- **Resultado:** todos os passos com `success`; CI real comprovado por rede/máquina (os YAMLs anteriores eram descritivos — agora executaram de verdade).

---

## 7. Limites honestos / Gates humanos remanescentes

Nenhuma destas pendências é declarável como concluída — dependem do responsável e de acesso/ações humanos:

1. **[CONCLUÍDO em 14/10/2026 19:17Z] OAuth interativo do Google Drive (`ORIUM_DRY_RUN=0`)** — autorização OAuth (`scope=drive.file`) realizada pelo responsável, config protegido `/var/lib/orium-backup/rclone.conf` (`chmod 600`) com remote `orium-crypt` (`drive_dest:OriumSystem-Backups`), `ORIUM_DRY_RUN=0` ativo em `/var/lib/orium-backup/orium-backup.conf`, primeiro ciclo completo de upload criptografado comprovado (`orium_orium_prod_2026-10-14T191727Z.dump`, SHA-256 `303cc4c98a5444ecd8d222bf5cff11d00dcc71607000f8f1abe6e314457383f4`, `cryptcheck: 0 differences found, 9 matching files`, `drive: ok (dryrun=0)`, `freshness: ok`).
2. **Provisionamento da conta administrativa de Monique em produção** — criada hoje? Não — o inventário registra apenas os 2 usuários (Arino administrator, Arino Estagiario collaborator). **Jamais inventar senha**: a conta deve ser criada pelo responsável (bootstrap local/oriundo de DEV com hash real) e verificada por consulta somente-leitura. Conta Monique/papel administrator permanece pendente.
3. **Ativação de container staging quando autorizado** — allowlist já aceita `https://staging.oriumdigital.tech` e o backend suporta staging; a stack/container de staging na VPS **não existe ainda** e deve subir somente sob nova autorização.
4. **Monitoramento contínuo / alertas** (proposto; não implementado nesta fase): continuidade do `freshness.sh check` agendado e métricas de RPO.
5. **CI em pull request/relação full de branches** — run de referência foi em `main`; PRs exigem aprovação de revisão humana antes do merge.

---

## 8. Reprodução das evidências

```bash
# Pipeline fail-closed local
node deploy/operations/run-pipeline.mjs production

# Suíte QA completa
pnpm vitest run tests/phase10/

# Estática
pnpm exec eslint deploy/verification tests/phase10
pnpm exec tsc -p tsconfig.json --noEmit

# Backup (VPS) — ciclo manual de teste
/usr/local/lib/orium-backup/scripts/orium-backup-run.sh --config /var/lib/orium-backup/orium-backup.conf
/usr/local/lib/orium-backup/scripts/freshness.sh check /var/lib/orium-backup/staging
```

## 9. Conclusão

A Fase 10 atinge fechamento **técnico** com inteligencia real sobre a VPS (hardening aplicado e verificado ao vivo, backups automatizados e funções de restore exercitadas em sandbox, tooling fail-closed, CI real aprovada) e **sem segredos expostos**. O encerramento **formal** fica condicionado aos 3 gates humanos da seção 7 (OAuth Drive, conta Monique, staging), conforme autorização do responsável. Nenhuma evidência inventada; todas citadas possuem artefato local ou execução verificável.
