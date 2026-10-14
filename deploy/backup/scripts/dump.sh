#!/usr/bin/env bash
# dump.sh — dump consistente PostgreSQL (formato custom) sem expor credenciais.
# Cofre/OpenCode — deploy/backup/scripts
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
usage: dump.sh <outdir> [<container-front>]
  outdir          diretório local onde o dump é gravado (permissão restrita)
  container-front opcional: prefixo de execução, ex. "docker exec -i postgres"
                    (para pg_dump dentro do container da VPS)
Segurança: PGPASSWORD por ambiente (nunca argv/URL). Nenhum valor sensível é impresso.
EOF
  exit 2
}

[[ $# -ge 1 && $# -le 2 ]] || usage
OUTDIR="$1"
CONTAINER_FRONT="${2:-}"

: "${ORIUM_PG_DB:?dump: ORIUM_PG_DB ausente (fail-closed)}"
: "${ORIUM_PG_USER:=postgres}"
: "${ORIUM_PG_HOST:=127.0.0.1}"
: "${ORIUM_PG_PORT:=5432}"
export PGPASSWORD="${ORIUM_PG_PASSWORD:-}"

TIMEOUT="${ORIUM_DUMP_TIMEOUT_SEC:-1800}"
STAMP="$(date -u +%Y-%m-%dT%H%M%SZ)"
umask 077
mkdir -p "$OUTDIR"
chmod 700 "$OUTDIR"
OUTFILE="$OUTDIR/orium_${ORIUM_PG_DB}_$STAMP.dump"
TMPFILE="$OUTFILE.tmp"

# pg_dump em formato custom (-F c), com blobs (-b). A tabela de controle de
# migrações (Drizzle) DEVE ser preservada no dump: este projeto usa Drizzle e o
# dump precisa manter o estado exato do schema (correção da revisão — não usar
# -N '_prisma_migrations'); apenas tabelas de dados de negócio+migrações viajam.
COMMAND_DUMP=()
if [[ -n "$CONTAINER_FRONT" ]]; then
  read -r -a COMMAND_DUMP <<< "$CONTAINER_FRONT"
  # Se o prefixo é docker exec, propaga PGPASSWORD ao container com -e PGPASSWORD
  # (herda do ambiente do processo host; nunca "PGPASSWORD=valor" no argv/ps).
  # Insere logo após `docker exec` — ex.: docker exec -i postgres → docker exec -i -e PGPASSWORD postgres.
  i=0
  # procura sequência "docker" ... "exec" (pode haver flags entre ambos)
  while [[ $i -lt ${#COMMAND_DUMP[@]} ]]; do
    if [[ "${COMMAND_DUMP[$i]}" == "docker" ]]; then
      j=$((i + 1))
      while [[ $j -lt ${#COMMAND_DUMP[@]} ]]; do
        if [[ "${COMMAND_DUMP[$j]}" == "exec" ]]; then
          COMMAND_DUMP=( "${COMMAND_DUMP[@]:0:$((j+1))}" "-e" "PGPASSWORD" "${COMMAND_DUMP[@]:$((j+1))}" )
          break 2
        fi
        [[ "${COMMAND_DUMP[$j]}" == -* ]] || break
        j=$((j + 1))
      done
      break
    fi
    i=$((i + 1))
  done
fi

# Monta argv de pg_dump (nada sensível em argv: usuário/base/host não são segredo;
# senha somente via PGPASSWORD, inclusive propagada com -e ao container).
ARGS=(
  pg_dump
  -F c -b
  -U "$ORIUM_PG_USER"
  -h "$ORIUM_PG_HOST"
  -p "$ORIUM_PG_PORT"
  --dbname "$ORIUM_PG_DB"
)

set +e
if [[ ${#COMMAND_DUMP[@]} -gt 0 ]]; then
  timeout "$TIMEOUT" "${COMMAND_DUMP[@]}" "${ARGS[@]}" >"$TMPFILE" 2>"$TMPFILE.err"
  RC=$?
else
  timeout "$TIMEOUT" "${ARGS[@]}" >"$TMPFILE" 2>"$TMPFILE.err"
  RC=$?
fi
set -e

if [[ $RC -ne 0 || ! -s "$TMPFILE" ]]; then
  # Ignora o .err local (nunca imprime PGPASSWORD). Mensagem sanitizada:
  echo "dump: FALHOU (rc=$RC, arquivo vazio/ausente); nada promovido a backup final." >&2
  rm -f "$TMPFILE"
  exit 1
fi
rm -f "$TMPFILE.err"

# Certeza de que não continha texto de credencial (dump custom é binário; checagem leve):
if grep -aq "PGPASSWORD" "$TMPFILE"; then
  echo "dump: conteúdo suspeito no dump; abortado fail-closed." >&2
  rm -f "$TMPFILE"
  exit 1
fi

# Promoção atômica
mv -f "$TMPFILE" "$OUTFILE"

# Checksum sha256 e tamanho
SHA="$(sha256sum "$OUTFILE" | cut -d' ' -f1)"
SIZE="$(stat -c%s "$OUTFILE")"
# freshness parcial (dump ainda não enviado — status final é do orquestrador)
cat > "$(dirname "$OUTFILE")/freshness.dump.json" <<EOF
{"stage":"dump","ok":true,"stamp":"$STAMP","file":"$(basename "$OUTFILE")","sha256":"$SHA","size_bytes":$SIZE}
EOF

echo "dump: ok out=$OUTFILE size=$SIZE sha=$SHA"
