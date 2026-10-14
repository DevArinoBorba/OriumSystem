#!/usr/bin/env bash
# freshness.sh — estado sanitizado para monitoramento (sem segredos, sem conteúdo).
# Cofre/OpenCode — deploy/backup/scripts
# Lê/grava ORIUM_FRESHNESS_FILE com JSON {ok, stamp, stage/last_stage_failed, retention_days, rpo_sec}.
# ok é SEMPRE boolean JSON real ("true"/"false"), compatível com `freshness.sh check`.
# exit 0 = fresco; 1 = podre (RPO excedido / sem backup confirmado).
set -euo pipefail

usage() { echo "usage: freshness.sh check|report [backupdir] [--failed-stage <stage>]" >&2; exit 2; }
[[ $# -ge 1 ]] || usage
MODE="$1"; shift || true
DIR=""
FAILED_STAGE=""
ARGS=("$@")
for ((i = 0; i < ${#ARGS[@]}; i++)); do
  if [[ "${ARGS[$i]}" == "--failed-stage" ]]; then
    FAILED_STAGE="${ARGS[$((i+1))]:-}"
  elif [[ -n "${ARGS[$i]}" && -z "$DIR" ]]; then
    DIR="${ARGS[$i]}"
  fi
done
RPO="${ORIUM_FRESHNESS_RPO_SEC:-${ORIUM_RPO_SEC:-86400}}"
F="${ORIUM_FRESHNESS_FILE:-${DIR:+$DIR/freshness.json}}"
: "${F:=/var/lib/orium-backup/freshness.json}"

case "$MODE" in
  report)
    # --failed-stage: estado pós-falha (fail-closed). Grava ok=false +
    # last_stage_failed; NUNCA ok=true apenas por existir dump antigo.
    if [[ -n "$FAILED_STAGE" ]]; then
      STAMP="$(date -u +%Y-%m-%dT%H%M%SZ)"
      if command -v node >/dev/null 2>&1; then
        STAGE_FAILED="$FAILED_STAGE" STAMP="$STAMP" RD="${ORIUM_RETENTION_DAYS:-30}" RM="${ORIUM_RETENTION_MODE:-dryrun}" RPO="$RPO" F="$F" \
          node -e "const fs=require('fs');const x={ok:false,stage:'failed',last_stage_failed:process.env.STAGE_FAILED,stamp:process.env.STAMP,retention_days:Number(process.env.RD||30),retention_mode:process.env.RM||'dryrun',rpo_sec:Number(process.env.RPO||86400)};fs.writeFileSync(process.env.F,JSON.stringify(x)+'\n')"
      else
        STAGE_FAILED="$FAILED_STAGE" STAMP="$STAMP" RD="${ORIUM_RETENTION_DAYS:-30}" RM="${ORIUM_RETENTION_MODE:-dryrun}" RPO="$RPO" F="$F" \
          python3 -c "import os, json; x={'ok':False,'stage':'failed','last_stage_failed':os.environ.get('STAGE_FAILED'),'stamp':os.environ.get('STAMP'),'retention_days':int(os.environ.get('RD',30)),'retention_mode':os.environ.get('RM','dryrun'),'rpo_sec':int(os.environ.get('RPO',86400))}; open(os.environ.get('F'),'w').write(json.dumps(x)+'\n')"
      fi
      echo "freshness: FAILED stage='$FAILED_STAGE' (ok=false)" >&2
      exit 1
    fi
    [[ -n "$DIR" && -d "$DIR" ]] || { echo "freshness: DIR inválido" >&2; exit 2; }
    STAMP="$(date -u +%Y-%m-%dT%H%M%SZ)"
    LATEST="$(ls -1t "$DIR"/orium_*.dump 2>/dev/null | head -1 || true)"
    LATEST_NAME="$(basename "$LATEST" 2>/dev/null || echo '')"
    if [[ -n "$LATEST" ]]; then
      LATEST_MTIME="$(stat -c%Y "$LATEST" 2>/dev/null || echo 0)"
    else
      LATEST_MTIME="0"
    fi
    NOW_EPOCH="$(date +%s)"
    AGE=$(( NOW_EPOCH - LATEST_MTIME ))
    OK=false; [[ -n "$LATEST" && $AGE -le "$RPO" ]] && OK=true
    if command -v node >/dev/null 2>&1; then
      OK="$OK" STAMP="$STAMP" L="$LATEST_NAME" A="$AGE" RPO="$RPO" RD="${ORIUM_RETENTION_DAYS:-30}" RM="${ORIUM_RETENTION_MODE:-dryrun}" F="$F" \
        node -e "const fs=require('fs');const x={ok:process.env.OK==='true',stage:'ok',stamp:process.env.STAMP,latest:process.env.L,age_sec:Number(process.env.A),rpo_sec:Number(process.env.RPO),retention_days:Number(process.env.RD||30),retention_mode:process.env.RM||'dryrun'};fs.writeFileSync(process.env.F,JSON.stringify(x)+'\n')"
    else
      OK="$OK" STAMP="$STAMP" L="$LATEST_NAME" A="$AGE" RPO="$RPO" RD="${ORIUM_RETENTION_DAYS:-30}" RM="${ORIUM_RETENTION_MODE:-dryrun}" F="$F" \
        python3 -c "import os, json; x={'ok':os.environ.get('OK')=='true','stage':'ok','stamp':os.environ.get('STAMP'),'latest':os.environ.get('L'),'age_sec':int(os.environ.get('A',0)),'rpo_sec':int(os.environ.get('RPO',86400)),'retention_days':int(os.environ.get('RD',30)),'retention_mode':os.environ.get('RM','dryrun')}; open(os.environ.get('F'),'w').write(json.dumps(x)+'\n')"
    fi
    if [[ "$OK" == "true" ]]; then
      echo "freshness: ok age=${AGE}s RPO=${RPO}s (${LATEST_NAME})"
    else
      echo "freshness: STALE rpo=${RPO}s age=${AGE}s latest='${LATEST_NAME}' (exit 1)" >&2
    fi
    [[ "$OK" == "true" ]]
    ;;
  check)
    [[ -f "$F" ]] || { echo "freshness: arquivo $F inexistente (fail-closed)" >&2; exit 1; }
    # ok é sempre boolean JSON real.
    CHECK_OK=1
    if command -v jq >/dev/null 2>&1; then
      if [[ "$(jq -r '.ok // false' "$F")" == "true" ]]; then
        CHECK_OK=0
      fi
    elif command -v node >/dev/null 2>&1; then
      if F="$F" node -e "const x=require(process.env.F);process.exit(x.ok===true?0:1)"; then
        CHECK_OK=0
      fi
    else
      if F="$F" python3 -c "import os, json; x=json.load(open(os.environ['F'])); exit(0 if x.get('ok') is True else 1)"; then
        CHECK_OK=0
      fi
    fi
    if [[ $CHECK_OK -eq 0 ]]; then
      echo "freshness: ok"
      exit 0
    else
      echo "freshness: STALE (ok=false)" >&2
      exit 1
    fi
    ;;
  *) usage;;
esac
