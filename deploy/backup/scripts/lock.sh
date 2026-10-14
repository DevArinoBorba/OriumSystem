#!/usr/bin/env bash
# lock.sh — singleflight lock para o backup com timeout real.
# Cofre/OpenCode — deploy/backup/scripts
# O comando é executado SOMENTE com o flock detido na fd 9; enquanto detido, o
# caminho de um único executor está garantido (fail-closed se não obtiver o lock).
# usage: lock.sh [--lock <file>] [--timeout <sec>] -- <command...>
set -euo pipefail

LOCK_FILE="${ORIUM_LOCK_FILE:-/var/lib/orium-backup/backup.lock}"
TIMEOUT="${ORIUM_LOCK_TIMEOUT_SEC:-600}"

# parse: --lock / --timeout antes de "--"; depois o comando.
args=("$@")
cmd=()
i=0
while [[ $i -lt ${#args[@]} ]]; do
  a="${args[$i]}"
  case "$a" in
    --lock)   LOCK_FILE="${args[$((i+1))]}"; i=$((i+2));;
    --timeout) TIMEOUT="${args[$((i+1))]}"; i=$((i+2));;
    --)       i=$((i+1)); break;;
    --help|-h) echo "usage: lock.sh [--lock <file>] [--timeout <sec>] -- <command...>"; exit 0;;
    *)        echo "lock.sh: argumento inesperado: $a" >&2; echo "usage: lock.sh [--lock <file>] [--timeout <sec>] -- <command...>" >&2; exit 2;;
  esac
done
cmd+=("${args[@]:$i}")

if [[ ${#cmd[@]} -eq 0 ]]; then
  echo "lock.sh: nenhum comando após '--'" >&2; exit 2
fi

LOCK_DIR="$(dirname "$LOCK_FILE")"
mkdir -p "$LOCK_DIR"

# Abre o lock na fd 9 e aguarda até TIMEOUT. Se já detido por outro, falha rápido.
exec 9>"$LOCK_FILE"
if ! flock -w "$TIMEOUT" 9; then
  echo "lock.sh: não obteve o lock em ${TIMEOUT}s (fail-closed)" >&2
  exit 1
fi
echo "$$" > "$LOCK_DIR/.lock.owner"   # sanitizado: apenas PID, sem segredos
echo "lock.sh: obtido, executando (${#cmd[@]} arg(s))..."

# Roda o comando (dump/crypt/drive via sub-shell). Propaga o exit code.
set +e
"${cmd[@]}"
RC=$?
set -e
echo "lock.sh: comando finalizou rc=$RC; lock liberado ao sair da subshell (fd 9)"
exit $RC
