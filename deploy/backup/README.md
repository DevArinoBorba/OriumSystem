# deploy/backup — Backup PostgreSQL → Google Drive criptografado (rclone crypt + Drive)

Frente exclusiva do agente Cofre (OpenCode). Sem segredos neste diretório.
Contrato: `docs/PHASE10-BACKUP-CONTRACT.md`.

## Ownership
- `deploy/backup/` (Cofre), `docs/PHASE10-BACKUP-RESULT.md` (Cofre), `.local/phase10/cofre/` somente helpers sem segredos.
- Não modificar VPS antes do gate Codex + janela Antigravity. Não apagar acervo remoto até gate.

## Arquivos
- `orium-backup.conf.example` — parâmetros operacionais (default diário 03:00 America/Cuiaba, RPO 24h, retenção 30 dias). Parâmetro alterável.
- `scripts/` — implementação real:
  - `dump.sh` — dump consistente PostgreSQL (pg_dump, formato custom), sem URLs/senha nos args; escrita temporária com permissão restrita; NUNCA imprime credenciais.
  - `manifest.sh` — manifesto do backup local (dump + checksum sha256), retenção isolada, inclui apenas o projeto próprio, checksum e referências (sem segredos).
  - `crypt.sh` — `rclone crypt` (conteúdo + nomes) antes de sair da VPS; UTF-8 key program não é enviado ao destino junto do backup; o crypt remote aponta para a pasta exclusiva OriumSystem no Drive.
  - `drive.sh` — `rclone copy` para o remote crypt → Drive, pasta exclusiva OriumSystem; dryrun/schedule; verificação de upload + list real (dowload restore comprovado fica para QA  já autorizado). Nunca sincronizar/deletar a raiz Drive; sem dump plaintext no destino.
  - `schedule.sh` — schedule diário 03:00 America/Cuiaba, singleflight lock, timeout real, exit failclosed.
  - `lock.sh` — lock singleflight (lock_timeouts), timeout real, args sanitizados sem senha/URLs.
  - `freshness.sh` — freshness/resultado sanitizado para monitoramento (sem segredos).

Variáveis (configuração protegida ABS fora do repositório: `/home/usuario/.local/orium-backup/` com ACL exclusiva), SEM conteúdo em mensagens.

## Prova local antes de qualquer envio
- Cripto local: roundtrip crypt (encrypt→decrypt) e roundtrip restore local com que dados/seeding.
