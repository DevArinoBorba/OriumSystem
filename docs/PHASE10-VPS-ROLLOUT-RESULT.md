# Relatório de Execução Operacional Supervisionada na VPS (Fase 10 — Janela 3)

- **Data da Execução:** 2026-10-14T09:35:00-04:00 (13:35 UTC)
- **Coordenação:** Antigravity #2 (Maestro / Orquestrador)
- **Executor Operacional VPS:** Antigravity (executor único na VPS conforme contrato)
- **Contrato:** `docs/PHASE10-WINDOW3-CONTRACT.md` (Seção 2)
- **Alvo:** VPS `srv2061201` via alias SSH `orium-vps`
- **Status:** **ROLLOUT CONCLUÍDO COM SUCESSO — SERVIÇOS HEALTHY E CABEÇALHOS ATIVOS**

---

## 1. Passo 1 — Empacotamento do Release Pós-Hardening (Local)

Executado o pipeline de empacotamento fail-closed local:
```bash
node deploy/operations/run-pipeline.mjs production
```

- **Resultados dos Gates:**
  - `gate=MANIFEST_GENERATION OK exit=0`: 58 arquivos mapeados sem segredos/fixtures/dist obsoleto; manifesto escrito em `.local/phase10/opencode/manifest.json`.
  - `gate=PREFLIGHT OK exit=0`: 58 arquivos verificados contra integridade física, hashes e schema version `0005_notifications.sql`.
  - `gate=RELEASE OK exit=0`: Release canônico gerado em `deploy/operations/releases/release-20261014133145-2ee58a9bacdd` com `bundle.tar.gz` (150.782 bytes) e `manifest.json` íntegros.
  - `pipeline PASS gates=3 failClosed=noFail`.

---

## 2. Passo 2 — Backup Preventivo Real e Snapshot de Rollback na VPS

Executado via SSH `orium-vps` com `-n -T -o BatchMode=yes`:

1. **Criação de Diretórios Seguros:**
   - `/var/lib/orium-backup/staging` criado com `chmod 700` (`root:root`).
   - `/var/lib/orium-backup/pre-window3-snapshot` criado com `chmod 700` (`root:root`).
2. **Dump Preventivo Real de `orium_prod`:**
   - Comando executado no container ativo: `docker exec orium-production-postgres-1 pg_dump -U postgres -Fc orium_prod > /var/lib/orium-backup/staging/orium_orium_prod_pre_window3.dump`
   - Permissão estrita: `chmod 600 /var/lib/orium-backup/staging/orium_orium_prod_pre_window3.dump`
   - Tamanho do arquivo: **68.864 bytes**
   - Hash SHA-256: `60552cd0b4ad792394bf3ccb5f61d16c7b4d1f96104f653f708a59b5a9a74b35`
   - Validação da Tabela de Conteúdo (`pg_restore --list`): 174 entradas válidas no formato CUSTOM com compressão gzip do PostgreSQL 17.11.
3. **Snapshot de Arquivos para Rollback Instantâneo:**
   - Copiados para `/var/lib/orium-backup/pre-window3-snapshot/`:
     - `nginx.conf.bak` (989 bytes)
     - `config.ts.bak` (2.397 bytes)

---

## 3. Passo 3 — Saneamento de Permissões e Rollout Controlado

1. **Saneamento das Permissões `777`/`666`:**
   - Diretórios sob `/data/orium/production/{apps,db,deploy,packages}` ajustados para `755` (`drwxr-xr-x`).
   - Arquivos sob `/data/orium/production/{apps,db,deploy,packages}` ajustados para `644` (`-rw-r--r--`).
   - Preservadas as permissões estritas `600` (`-rw------- root:root`) de `/data/orium/production/deploy/production/.env` e `docker-compose.yaml` (nenhum segredo ou conteúdo de `.env` foi lido ou exposto).
2. **Atualização dos Arquivos de Configuração na VPS:**
   - Transferidos via SCP e verificados via `sha256sum`:
     - `/data/orium/production/deploy/production/nginx.conf`: `c274d4de44ea4686080f1fd1afe109e076e6534e6adc29a6e3c52ec0700d6e56` (**100% idêntico ao local**).
     - `/data/orium/production/apps/api/src/config.ts`: `66cf30d6f1f54888a9be8a1434d08e0edcd81235f0f6661e292bf056a99ad685` (**100% idêntico ao local**).
3. **Reconstrução e Atualização Controlada via Docker Compose:**
   - Comando executado no diretório de deploy com isolamento de projeto:
     ```bash
     cd /data/orium/production/deploy/production && docker compose --project-name orium-production --env-file .env -f docker-compose.yaml up -d --build --no-deps web api
     ```
   - Reconstruídas as imagens `orium-production-web:latest` e `orium-production-api:latest`.
   - Recriados apenas os containers de aplicação: `orium-production-web-1` e `orium-production-api-1`.
   - **Banco de Dados Preservado:** O container `orium-production-postgres-1` e o volume persistente `orium-production_orium-postgres` permaneceram intocados e em execução ininterrupta.

---

## 4. Passo 4 — Verificação Pós-Deploy na VPS

### 4.1. Saúde dos Containers

Todos os containers da stack e da infraestrutura Coolify vizinha encontram-se operacionais e saudáveis:
- `orium-production-web-1`: `Up` (porta 8080 interna, Nginx ativo).
- `orium-production-api-1`: `Up (healthy)` (porta 3001 interna, Fastify ativo).
- `orium-production-postgres-1`: `Up (healthy)` (PostgreSQL 17.11).
- `coolify-proxy`: `Up (healthy)` (Traefik v3.7.14 com portas 80 e 443 públicas).
- `coolify`, `coolify-db`, `coolify-redis`, `coolify-sentinel`: todos `Up (healthy)`.

### 4.2. Inspeção de Configuração Interna dos Containers

- Dentro de `orium-production-web-1`: `/etc/nginx/conf.d/default.conf` reflete as diretivas `set_real_ip_from` (10.0.1.0/24 e 172.16.0.0/12) com `real_ip_recursive on` e os 5 headers de segurança dentro de `location = /index.html`.
- Dentro de `orium-production-api-1`: `/app/dist/config.js` contém a allowlist canônica `PRODUCTION_ORIGIN_ALLOWLIST = ['https://app.oriumdigital.tech', 'https://staging.oriumdigital.tech']`.

### 4.3. Probes HTTPS ao Vivo (`curl -skI`)

| Alvo | Status HTTP | Cabeçalhos de Segurança Confirmados | Resultado |
|---|---|---|---|
| `https://app.oriumdigital.tech/` | `HTTP/2 200` | `cache-control: no-store`<br>`strict-transport-security: max-age=31536000`<br>`x-content-type-options: nosniff`<br>`x-frame-options: DENY`<br>`referrer-policy: no-referrer` | **PASS — 5/5 cabeçalhos presentes** |
| `https://app.oriumdigital.tech/index.html` | `HTTP/2 200` | `cache-control: no-store`<br>`strict-transport-security: max-age=31536000`<br>`x-content-type-options: nosniff`<br>`x-frame-options: DENY`<br>`referrer-policy: no-referrer` | **PASS — 5/5 cabeçalhos presentes** |
| `https://app.oriumdigital.tech/api/v1/notifications` | `HTTP/2 401` | `content-security-policy: default-src 'none'...`<br>`strict-transport-security: max-age=31536000`<br>`x-frame-options: DENY`<br>`x-content-type-options: nosniff` | **PASS — rota protegida íntegra** |

### 4.4. Integridade do Banco de Dados de Produção (`orium_prod`)

Conferência somente-leitura em `orium-production-postgres-1`:
- **Migrations Drizzle:** 6 migrações ativas (`0000_foundation` a `0005_notifications`).
- **Contas de Usuário (`auth_user`):** 2 usuários preservados (`Arino` - administrator, `Arino Estagiario` - collaborator).
- **Dados de Negócio:** 4 clientes, 2 demandas, 23 pares `role_permission` intactos.
- **Zero corrupção ou perda de dados.**

---

## 5. Conclusão da Atualização de Produção

O rollout da Janela 3 foi concluído com sucesso e sem incidentes. O problema de herança de cabeçalhos de segurança no Nginx foi resolvido definitivamente no ambiente ao vivo, o proxy real-IP está ativo e o backend suporta staging nativamente.

---

## 6. Automação e Verificação do Backup e Timer Systemd na VPS (Passo 5)

Em conformidade com o Passo 5 da Janela 3 e com as diretrizes do Cofre/OpenCode (`docs/PHASE10-BACKUP-RESULT.md`):

### 6.1. Instalação e Permissões dos Scripts na VPS
- **Destino:** `/usr/local/lib/orium-backup/scripts/`
- **Scripts instalados (9/9):** `_sequence.sh`, `crypt.sh`, `drive.sh`, `dump.sh`, `freshness.sh`, `lock.sh`, `manifest.sh`, `orium-backup-run.sh`, `schedule.sh`.
- **Higiene e permissões:** Line endings LF sanitizados (`sed -i 's/\r$//'`), permissão estrita `chmod 750`, propriedade `root:root`.
- **Compatibilidade:** Fallback transparente para `python3` e `jq` incorporado em `manifest.sh` e `freshness.sh` para compatibilidade com o host VPS sem `node` global.

### 6.2. Configuração Protegida (`/var/lib/orium-backup/orium-backup.conf`)
- **Permissão:** `chmod 600`, propriedade `root:root`.
- **Conteúdo seguro:**
  - `ORIUM_STAGE_DIR="/var/lib/orium-backup/staging"`
  - `ORIUM_LOCK_FILE="/var/lib/orium-backup/orium-backup.lock"`
  - `ORIUM_CONTAINER_FRONT="docker exec -i orium-production-postgres-1"`
  - `ORIUM_PG_DB="orium_prod"`
  - `ORIUM_PG_USER="postgres"`
  - `ORIUM_PG_HOST="localhost"`
  - `ORIUM_PG_PORT="5432"`
  - `ORIUM_DRY_RUN="1"` (dry-run seguro para crypt/drive até autenticação OAuth do Drive pelo responsável)
  - `ORIUM_RETENTION_DAYS="30"`
  - `ORIUM_RPO_SEC="86400"`

### 6.3. Execução Real do Ciclo de Backup
Execução manual de teste na VPS:
```bash
/usr/local/lib/orium-backup/scripts/orium-backup-run.sh --config /var/lib/orium-backup/orium-backup.conf
```
- **Resultado:** Exit 0 (`orquestrador concluído com sucesso`).
- **Novo Dump:** `/var/lib/orium-backup/staging/orium_orium_prod_2026-10-14T134538Z.dump` (`chmod 600`, 68.863 bytes, SHA-256 `650f9f8627d87d414baae04622f03dad9b2f8d7e74db2839fbe48cb52e739640`).
- **Validação de Integridade do Dump:** `pg_restore --list` executado via PostgreSQL 17.11 confirmou TOC com 174 entradas válidas (esquemas `drizzle` e `public`, sequências, tabelas `auth_*`, etc.).
- **Manifesto Gerado (`manifest.json`):**
  - Versão: `1.0`
  - Total de arquivos indexados: 2 dumps de produção catalogados com seus respectivos checksums SHA-256 e tamanhos.
- **Frescura Registrada (`freshness.json`):**
  ```json
  {"ok": true, "stage": "ok", "stamp": "2026-10-14T134538Z", "latest": "orium_orium_prod_2026-10-14T134538Z.dump", "age_sec": 0, "rpo_sec": 86400, "retention_days": 30, "retention_mode": "dryrun"}
  ```
- **Checagem de Frescura:**
  ```bash
  /usr/local/lib/orium-backup/scripts/freshness.sh check /var/lib/orium-backup/staging
  # Saída: freshness: ok (exit 0)
  ```

### 6.4. Instalação e Ativação do Timer Systemd
Execução na VPS:
```bash
/usr/local/lib/orium-backup/scripts/schedule.sh install --invoke-path "/usr/local/lib/orium-backup/scripts/orium-backup-run.sh --config /var/lib/orium-backup/orium-backup.conf"
```
- **Unidades Geradas:**
  - `/etc/systemd/system/orium-backup.service` (Type=oneshot, invoca o script orquestrador com a config protegida)
  - `/etc/systemd/system/orium-backup.timer` (`OnCalendar=*-*-* 03:00:00 America/Cuiaba`, `Persistent=true`)
- **Status do Timer (`systemctl status orium-backup.timer`):**
  - `active (waiting)`
  - Trigger: `Thu 2026-10-15 07:00:00 UTC` (03:00 America/Cuiaba)
- **Teste de Acionamento via Systemd (`systemctl start orium-backup.service`):**
  - Processo finalizado com `status=0/SUCCESS`
  - Saída do journald: `orquestrador concluído com sucesso (exit 0)`
  - Deativação limpa: `orium-backup.service: Deactivated successfully`.
- **Listagem de Timers (`systemctl list-timers orium-backup.timer`):**
  - Confirma próxima execução agendada para `Thu 2026-10-15 07:00:00 UTC` (17h restantes).

