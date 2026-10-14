#!/usr/bin/env bash
# _sequence.sh — executa as etapas dump → manifest → crypt → drive → freshness
# dentro do lock já detido pelo orquestrador (lock.sh). Fail-closed:
# QUALQUER falha de etapa interrompe imediatamente a sequência, não executa as
# demais etapas e registra freshness com "ok": false + last_stage_failed.
# Cofre/OpenCode — deploy/backup/scripts (helper interno)
# usage: _sequence.sh <script-dir> <stage-dir> <remote> <drive-folder> <container-front>
set -uo pipefail

SCRIPT_DIR="$1"; STAGE_DIR="$2"; REMOTE="$3"; DRIVEFOLDER="$4"; CONTAINER_FRONT="$5"
RC=0
FAILED_STAGE=""

# 1) dump (fonte: Postgres via PGPASSWORD; container-front opcional)
if "${SCRIPT_DIR}/dump.sh" "$STAGE_DIR" "$CONTAINER_FRONT"; then
  echo "sequence: dump ok"
else
  RC=1; FAILED_STAGE="dump"
fi

# Interrupção imediata (fail-closed) — correção da revisão da coordenação:
# se qualquer etapa anterior falhou, não executar manifest/crypt/drive sobre
# estado falho. Freshness report grava "ok": false e "last_stage_failed".
if [[ $RC -ne 0 ]]; then
  echo "sequence: etapa '${FAILED_STAGE:-anterior}' FALHOU; abortando sequência (fail-closed)." >&2
  "${SCRIPT_DIR}/freshness.sh" report "$STAGE_DIR" --failed-stage "$FAILED_STAGE" || true
  exit "$RC"
fi

# 2) manifest (dump + checksums + retenção dryrun) — só após dump ok
if ! "${SCRIPT_DIR}/manifest.sh" "$STAGE_DIR"; then
  RC=1; FAILED_STAGE="manifest"
fi
if [[ $RC -ne 0 ]]; then
  echo "sequence: etapa '${FAILED_STAGE}' FALHOU; abortando sequência (fail-closed)." >&2
  "${SCRIPT_DIR}/freshness.sh" report "$STAGE_DIR" --failed-stage "$FAILED_STAGE" || true
  exit "$RC"
fi

# 3) crypt (criptografia cliente antes de qualquer saída) — só após manifest ok
if ! "${SCRIPT_DIR}/crypt.sh" "$REMOTE" "$STAGE_DIR" "$DRIVEFOLDER"; then
  RC=1; FAILED_STAGE="crypt"
fi
if [[ $RC -ne 0 ]]; then
  echo "sequence: etapa '${FAILED_STAGE}' FALHOU; abortando sequência (fail-closed)." >&2
  "${SCRIPT_DIR}/freshness.sh" report "$STAGE_DIR" --failed-stage "$FAILED_STAGE" || true
  exit "$RC"
fi

# 4) drive (envio só quando ORIUM_DRY_RUN != 1; containers de remoto list real)
if ! "${SCRIPT_DIR}/drive.sh" "$REMOTE" "$STAGE_DIR" "$DRIVEFOLDER"; then
  RC=1; FAILED_STAGE="drive"
fi
if [ "$RC" -ne 0 ]; then
  echo "sequence: etapa '${FAILED_STAGE}' FALHOU; abortando (fail-closed)." >&2
  "${SCRIPT_DIR}/freshness.sh" report "$STAGE_DIR" --failed-stage "$FAILED_STAGE" || true
  exit "$RC"
fi

# 5) freshness (estado sanitizado) — somente após todas as etapas ok
"${SCRIPT_DIR}/freshness.sh" report "$STAGE_DIR" || RC=1

exit "$RC"
