#!/usr/bin/env bash
# schedule.sh — agendamento diário 03:00 America/Cuiaba, RPO 24h.
# Cofre/OpenCode — deploy/backup/scripts
# Gera (mode=print|install) a definição de cron única com CRON_TZ (suportado por
# cronie) e a systemd timer equivalente. Não altera nada além do que for pedido
# (install exige ORIUM_SCHEDULE_INSTALL_DIR e é opcional/explícito).
set -euo pipefail

usage() { echo "usage: schedule.sh print|install [--invoke-path <caminho>]" >&2; exit 2; }
[[ $# -ge 1 ]] || usage
MODE="$1"; shift || true
INVOKE_PATH="${ORIUM_INVOKE_PATH:-/usr/local/bin/orium-backup-run.sh}"
# Proteção contra `set -u` quando nenhum argumento extra é passado:
[[ "${1:-}" == "--invoke-path" && $# -ge 2 ]] && INVOKE_PATH="$2"

MINUTE="${ORIUM_SCHEDULE_MINUTE:-0}"
HOUR="${ORIUM_SCHEDULE_HOUR:-3}"
TZ="${ORIUM_TZ:-America/Cuiaba}"

get_fname() { echo "orium-backup-${TZ//\//-}-${HOUR}h"; }

case "$MODE" in
  print)
    echo "## cron (cronie/CRON_TZ) — diário ${HOUR}:${MINUTE} ${TZ} — RPO 24h"
    echo "CRON_TZ=$TZ"
    echo "${MINUTE} ${HOUR} * * * $INVOKE_PATH  >> /var/log/orium-backup.log 2>&1"
    echo
    echo "## systemd timer equivalente (arquivo: /etc/systemd/system/orium-backup.timer)"
    fname="$(get_fname)"
    cat <<EOF
[Unit]
Description=Backup OriumSystem diário (${TZ})

[Timer]
OnCalendar=*-*-* 03:00:00 America/Cuiaba
Persistent=true
Unit=orium-backup.service

[Install]
WantedBy=timers.target
EOF
    echo "(use install para gravar com suas próprias permissões)"
    ;;
  install)
    fname="$(get_fname)"
    mkdir -p "/etc" || true
    cat > "/etc/orium-backup-${fname}.cron" <<EOF
CRON_TZ=$TZ
${MINUTE} ${HOUR} * * * $INVOKE_PATH >> /var/log/orium-backup.log 2>&1
EOF
    echo "schedule: arquivo gravado /etc/orium-backup-${fname}.cron (instalação final do link cabe ao operador VPS/Antigravity)"
    ;;
  *) usage;;
esac
