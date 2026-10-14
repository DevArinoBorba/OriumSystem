#!/usr/bin/env bash
# orium-backup-run.sh — orquestra dump → manifest → crypt → drive → freshness
# sob singleflight (lock.sh), com timeout real e fail-closed.
# Cofre/OpenCode — deploy/backup/scripts
# Carrega configuração protegida (sem segredos) e NUNCA imprime credenciais/URLs.
set -euo pipefail

# Config default; pode ser sobrescrita via argumento --config ou ORIUM_BACKUP_CONF.
CONF="${ORIUM_BACKUP_CONF:-/var/lib/orium-backup/orium-backup.conf}"
if [[ "${1:-}" == "--config" && -n "${2:-}" ]]; then
  CONF="$2"
  shift 2
fi
if [[ -f "$CONF" ]]; then
  # shellcheck disable=SC1090
  set -a
  source "$CONF"
  set +a
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STAGE_DIR="${ORIUM_STAGE_DIR:-${ORIUM_BACKUP_DIR:-/var/lib/orium-backup/staging}}"
LOCK_FILE="${ORIUM_LOCK_FILE:-/var/lib/orium-backup/orium-backup.lock}"
LOCK_TIMEOUT="${ORIUM_LOCK_TIMEOUT_SEC:-600}"
REMOTE="${ORIUM_RCLONE_CRYPT_REMOTE:-orium-crypt}"
DRIVEFOLDER="${ORIUM_DRIVE_FOLDER:-OriumSystem}"
CONTAINER_FRONT="${ORIUM_CONTAINER_FRONT:-${ORIUM_PG_CONTAINER_FRONT:-}}"

# porta de saída: acumula falhas, mas sempre propaga (fail-closed).
RC=0

step() { echo "[$(date -u +%H:%M:%SZ)] :: $*"; }

run_with_lock() {
  # roda sob flock com timeout; dentro dele executa a sequência.
  "${SCRIPT_DIR}/lock.sh" --lock "$LOCK_FILE" --timeout "$LOCK_TIMEOUT" -- \
    "${SCRIPT_DIR}/_sequence.sh" "$SCRIPT_DIR" "$STAGE_DIR" "$REMOTE" "$DRIVEFOLDER" "$CONTAINER_FRONT"
}

step "orquestrador iniciado (stage=$STAGE_DIR remote=$REMOTE folder=$DRIVEFOLDER)"
mkdir -p "$STAGE_DIR"
run_with_lock && step "orquestrador concluído com sucesso (exit 0)" || {
  step "orquestrador FALHOU (fail-closed, exit 1)"
  exit 1
}
