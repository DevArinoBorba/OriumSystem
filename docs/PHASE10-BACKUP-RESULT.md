# PHASE10-BACKUP-RESULT.md — deploy/backup/scripts (Parte B). Correções Janela 2 + prova cripto real

**Data:** 14/10/2026 · **Ator:** OpenCode (aplicou correções da Seção 2.2 do `docs/PHASE10-WINDOW2-CONTRACT.md`, escopo `deploy/backup/` indicado pela coordenação) · **Sem rede/VPS/Drive**: toda execução local.

## 1. Correções aplicadas (deploy/backup/scripts/)

### `_sequence.sh` — sequenciamento fail-closed
- **Antes:** executava todas as etapas e acumulava `RC=1` no final.
- **Depois:** interrompe imediatamente na 1ª falha; **não** executa `manifest.sh`/`crypt.sh`/`drive` sobre estado falho; registra `freshness.sh report <stage> --failed-stage <stage>` gravando `"ok": false` + `last_stage_failed`.
- **Prova real (local):** `dump` falhou (rc=127, `pg_dump` ausente) → `sequence: etapa 'dump' FALHOU; abortando (fail-closed)`, exit 1, **0 novas etapas executadas**, nenhum dump promovido.

### `freshness.sh` — boolean JSON real
- **Antes:** `report` gravava `"ok":1` (numérico); `check` exigia `ok===true` → checagem sempre falhava.
- **Depois:** `"ok": true|false` (boolean JSON real) e suporte a `--failed-stage <stage>`.
- **Provas reais (local):**
  - `report` com dump → `{"ok":true,"stage":"ok",...}` exit 0.
  - `check` → `freshness: ok` exit 0.
  - `report --failed-stage dump` → `{"ok":false,"stage":"failed","last_stage_failed":"dump",...}` exit 1.

### `dump.sh` — higiene e fidelidade
- Adicionados `umask 077` e `chmod 700 "$OUTDIR"`.
- Removido `-N '_prisma_migrations'` (projeto usa **Drizzle**; tabela de controle de migrações deve ser preservada no dump).
- Quando `CONTAINER_FRONT` é `docker exec ...`, insere `-e PGPASSWORD` (herda do ambiente do host, sem `PGPASSWORD=valor` no argv/ps).
- `pg_dump -F c -b` mantido (formato custom + blobs).
- **Prova real (local):** com `pg_dump` ausente → `rc=127`, exit 1, **nada promovido** (fail-closed).

### `schedule.sh` — correções
- `[[ "${1:-}" == "--invoke-path" && $# -ge 2 ]]` (protege `${1:-}` sob `set -u` quando sem argumento extra).
- `OnCalendar=*-*-* 03:00:00 America/Cuiaba` (sintaxe systemd corrigida).
- **Prova real (local):** `schedule.sh print` gera o timer correto.

### `crypt.sh` — separação local/Drive
- `rclone cryptcheck` agora inclui `"${CONFIG_ARGS[@]}" "${PWC_ARGS[@]}"` e filtra `--include "orium_*.dump" --include "manifest.json"`.

### `schedule.sh`/`manifest.sh`/`drive.sh`/`lock.sh`/`orium-backup-run.sh`
- Sintaxe validada (`bash -n`) para os 9 scripts — 9/9 OK (Git for Windows bash).

## 2. Prova real de criptografia/decriptografia rclone crypt (local, sem rede/Drive)

- Binário: `rclone v1.75.1` (instalado via WinGet na máquina) → usado com caminho absoluto.
- Remote `crypt` local criado com `--config` **exclusivo** em `.local/phase10/cofre/artifacts/rclone.conf` (senha obscure local de teste; nada no repo, nada no config do usuário).
- Backend: `local_backend` (type=local) + remote `cofre` (type=crypt).
- Arquivo de teste determinístico `plaintext.txt`.
- Etapas reais:
  1. `rclone copy` (encrypt) exit 0.
  2. `rclone cryptcheck --include "plaintext.txt"` → `0 differences found, 1 matching files` exit 0.
  3. `rclone copy` inversa (decrypt para `restore/`) exit 0.
  4. SHA-256 antes `a9aaa9bbe194eac7a3ec7f6b2a93f859416101317d5bbe57fee739bcb454c63e` **idêntico** depois — **ROUNDTRIP OK**.

Artefatos: `.local/phase10/cofre/artifacts/` (rclone.conf com chave de teste, plaintext, local_backend criptografado, restore). Nenhuma rede acessada. Nenhum segredo real exposto.

## 3. Passo a passo OAuth do Google Drive (para o responsável/operador VPS)

Objetivo: autorizar `rclone` a acessar o Google Drive com escopo mínimo `drive.file` (somente arquivos/pastas criados pelo app), **sem expor tokens no repo/log**.

1. **Na VPS** (ou máquina com acesso ao destino), com o config protegido (`chmod 600`):
   ```bash
   rclone config create drive_dest drive scope=drive.file config_is_local=false
   ```
   - Siga o link OAuth no navegador do responsável, autentique com a conta Google dona da pasta, e copie o código de volta ao terminal.
   - O rclone grava o token no arquivo de config (nunca cole o token em chats/repo/log).
2. **Alternativa** (authorize manual sem criar remote antes):
   ```bash
   rclone authorize "drive" --scope=drive.file
   ```
   - Abra a URL impressa no navegador do responsável, autorize, copie o JSON de token impresso de volta ao `rclone config` (ou à variável de configuração protegida).
3. **Validar (sem enviar nada):**
   ```bash
   ORIUM_RCLONE_CONFIG=<caminho-protegido> rclone lsd drive_dest:   # lista apenas pastas raiz visíveis (drive.file limita ao criado pelo app)
   ```
4. **Definir as variáveis** no orquestrador de backup (protegidas, sem valores em argv/log):
   - `ORIUM_RCLONE_CONFIG` → config protegido.
   - `ORIUM_RCLONE_PASSWORD` → se o config for criptografado, senha da config via `--password-command` (implementado em `crypt.sh`/`drive.sh`).
   - `ORIUM_DRY_RUN=1` para teste sem envio; `ORIUM_DRIVE_TIMEOUT_SEC`.
5. **Fechar o loop real** (depende da autorização do responsável e de acesso ao destino): rodar `deploy/backup/scripts/_sequence.sh` completo; depois `drive.sh` com `ORIUM_DRY_RUN=0` para um primeiro envio real aprovado pelo responsável. Nesta janela **nenhum upload ocorreu** (sem OAuth efetivo, sem rede).

## 4. Limites honestos (nesta janela)

- Nenhuma VPS mutada; nenhum upload ao Drive; nenhum backup real de produção gerado aqui (sem `pg_dump` real nesta máquina; prova de dump feita por falha induzida rc=127).
- OAuth do Drive **não executado** — requer autorização do responsável (passo a passo acima).
- Os scripts são para host Linux/VPS (bash/POSIX). A prova local usou Git for Windows bash com comandos compatíveis; o comportamento definitivo do `pg_dump`/`docker`/`rclone cryptcheck` contra o destino real precisa da gate operacional VPS.
