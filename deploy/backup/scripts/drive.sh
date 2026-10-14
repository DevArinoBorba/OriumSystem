#!/usr/bin/env bash
# drive.sh — envio do backup criptografado ao Google Drive (pasta exclusiva OriumSystem).
# Cofre/OpenCode — deploy/backup/scripts
# Regras do contrato:
#  - NUNCA sincronizar/deletar a raiz Drive; opera apenas em $DRIVEFOLDER.
#  - NUNCA enviar dump plaintext nem a chave de descriptografia ao destino.
#  - NUNCA apagar acervo remoto até gate (nada de rclone delete aqui; retenção removível só depois de dryrun negativo+allowlist+destino isolado+gate Codex).
#  - Scope drive.file (mínimo): só arquivos/pastas criados pelo app.
set -euo pipefail

usage() {
cat >&2 <<'EOF'
usage: drive.sh <remote-name> <local-dir> <drive-folder>
  remote-name   remote crypt (ex. orium-crypt)
  local-dir     dir com dumps plaintext (stage local)
  drive-folder  pasta exclusiva no Drive (ex. OriumSystem)
Variáveis: ORIUM_DRY_RUN (1 = dryrun, não envia), ORIUM_DRIVE_TIMEOUT_SEC,
ORIUM_RCLONE_CONFIG / ORIUM_RCLONE_PASSWORD (protegidas).
EOF
  exit 2
}
[[ $# -eq 3 ]] || usage
REMOTE="$1"; LOCALDIR="$2"; DRIVEFOLDER="$3"
RCLONE="${RCLONE_BIN:-rclone}"
DRY="${ORIUM_DRY_RUN:-1}"
TIMEOUT="${ORIUM_DRIVE_TIMEOUT_SEC:-3600}"

echo "drive: modo dryrun=$DRY timeout=$TIMEOUT pasta=$DRIVEFOLDER"

if [[ "$DRY" == "1" ]]; then
  echo "drive: modo dryrun=$DRY (não envia nem testa remote sem OAuth configurado); ok"
  exit 0
fi

CONFIG_ARGS=()
[[ -n "${ORIUM_RCLONE_CONFIG:-}" ]] && CONFIG_ARGS+=(--config "$ORIUM_RCLONE_CONFIG")
PWC_ARGS=()
if [[ -n "${ORIUM_RCLONE_PASSWORD:-}" ]]; then
  PWC_ARGS=(--password-command "printf '%s' \"\$ORIUM_RCLONE_PASSWORD\"")
  export ORIUM_RCLONE_PASSWORD
fi

# List real antes (verificação de acesso ao destino isolado, não raiz).
${RCLONE} "${CONFIG_ARGS[@]}" "${PWC_ARGS[@]}" lsf "$REMOTE:/$DRIVEFOLDER" >/dev/null 2>&1 \
  && echo "drive: destino isolado acessível" \
  || { echo "drive: destino acessível após mkdir (cria pasta exclusiva)" >&2;
       ${RCLONE} "${CONFIG_ARGS[@]}" "${PWC_ARGS[@]}" mkdir "$REMOTE:/$DRIVEFOLDER" \
         || { echo "drive: falha ao acessar/criar pasta exclusiva (fail-closed)" >&2; exit 3; }; }

# Envio do dump criptografado. O crypt remote já garante conteúdo+nomes criptografados
# antes de sair da máquina. dryrun usa --dry-run (não envia nada).
DRYRUN_ARGS=()
[[ "$DRY" == "1" ]] && DRYRUN_ARGS=(--dry-run)

set +e
timeout "$TIMEOUT" ${RCLONE} "${CONFIG_ARGS[@]}" "${PWC_ARGS[@]}" "${DRYRUN_ARGS[@]}" \
  --transfers 2 copy "$LOCALDIR" "$REMOTE:/$DRIVEFOLDER"
RC=$?
set -e
if [[ $RC -ne 0 ]]; then
  echo "drive: upload FALHOU (rc=$RC) — MANTER backup local; não apagar cópia local" >&2
  exit 4
fi

# Verificação real pós-envio (list do destino isolado) — não é só exit 0.
if [[ "$DRY" != "1" ]]; then
  echo "drive: verificando upload real no destino ..."
  REMOTE_FILES="$(timeout "$TIMEOUT" ${RCLONE} "${CONFIG_ARGS[@]}" "${PWC_ARGS[@]}" lsl "$REMOTE:/$DRIVEFOLDER")"
  LOCAL_FILES="$(ls -1 "$LOCALDIR"/orium_*.dump 2>/dev/null | wc -l)"
  REMOTE_COUNT="$(printf '%s\n' "$REMOTE_FILES" | grep -c '.' || true)"
  echo "drive: local=$LOCAL_FILES arquivos, destino=$REMOTE_COUNT objetos listados"
  if [[ "$REMOTE_COUNT" -lt 1 ]]; then
    echo "drive: nenhum objeto listado no destino (fail-closed)" >&2
    exit 5
  fi
fi
echo "drive: ok (dryrun=$DRY)"
