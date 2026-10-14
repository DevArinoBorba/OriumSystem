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
DIR="${1:-}"; [[ "${1:-}" == "--failed-stage" ]] && DIR=""
FAILED_STAGE=""
if [[ "${1:-}" == "--failed-stage" ]]; then
  FAILED_STAGE="${2:-}"
  shift 2 || true
fi
RPO="${ORIUM_FRESHNESS_RPO_SEC:-86400}"
F="${ORIUM_FRESHNESS_FILE:-/var/lib/orium-backup/freshness.json}"

case "$MODE" in
  report)
    # --failed-stage: estado pós-falha (fail-closed). Grava ok=false +
    # last_stage_failed; NUNCA ok=true apenas por existir dump antigo.
    if [[ -n "$FAILED_STAGE" ]]; then
      STAMP="$(date -u +%Y-%m-%dT%H%M%SZ)"
      OK="false" STAGE_FAILED="$FAILED_STAGE" STAMP="$STAMP" RD="${ORIUM_RETENTION_DAYS:-30}" RM="${ORIUM_RETENTION_MODE:-dryrun}" RPO="$RPO" F="$F" \
        node -e "const fs=require('fs');const x={ok:false,stage:'failed',last_stage_failed:process.env.STAGE_FAILED,stamp:process.env.STAMP,retention_days:Number(process.env.RD||30),retention_mode:process.env.RM||'dryrun',rpo_sec:Number(process.env.RPO||86400)};fs.writeFileSync(process.env.F,JSON.stringify(x)+'\n')"
      echo "freshness: FAILED stage='$FAILED_STAGE' (ok=false)" >&2
      exit 1
    fi
    [[ -n "$DIR" && -d "$DIR" ]] || { echo "freshness: DIR inválido" >&2; exit 2; }
    STAMP="$(date -u +%Y-%m-%dT%H%M%SZ)"
    # escolha o dump mais recente confirmado
    LATEST="$(ls -1t "$DIR"/orium_*.dump 2>/dev/null | head -1 || true)"
    LATEST_NAME="$(basename "$LATEST" 2>/dev/null || echo '')"
    if [[ -n "$LATEST" ]]; then
      LATEST_MTIME="$(stat -c%Y "$LATEST")"
    else
      LATEST_MTIME="0"
    fi
    NOW_EPOCH="$(date +%s)"
    AGE=$(( NOW_EPOCH - LATEST_MTIME ))
    OK=false; [[ -n "$LATEST" && $AGE -le "$RPO" ]] && OK=true
    OK="$OK" STAMP="$STAMP" L="$LATEST_NAME" A="$AGE" RPO="$RPO" RD="${ORIUM_RETENTION_DAYS:-30}" RM="${ORIUM_RETENTION_MODE:-dryrun}" F="$F" \
      node -e "const fs=require('fs');const x={ok:process.env.OK==='true',stage:'ok',stamp:process.env.STAMP,latest:process.env.L,age_sec:Number(process.env.A),rpo_sec:Number(process.env.RPO),retention_days:Number(process.env.RD||30),retention_mode:process.env.RM||'dryrun'};fs.writeFileSync(process.env.F,JSON.stringify(x)+'\n')"
    [[ -n "$DIR" && -d "$DIR" ]] || { echo "freshness: DIR inválido" >&2; exit 2; }
    STAMP="$(date -u +%Y-%m-%dT%H%M%SZ)"
    # escolha o dump mais recente confirmado
    LATEST="$(ls -1t "$DIR"/orium_*.dump 2>/dev/null | head -1 || true)"
    LATEST_NAME="$(basename "$LATEST" 2>/dev/null || echo '')"
    if [[ -n "$LATEST" ]]; then
      LATEST_MTIME="$(stat -c%Y "$LATEST")"
    else
      LATEST_MTIME="0"
    fi
    NOW_EPOCH="$(date +%s)"
    AGE=$(( NOW_EPOCH - LATEST_MTIME ))
    OK=false; [[ -n "$LATEST" && $AGE -le "$RPO" ]] && OK=true
    node -e "const fs=require('fs');const x={ok:process.env.OK==='true',stage:'ok',stamp:process.env.STAMP,latest:process.env.L,age_sec:Number(process.env.A),rpo_sec:Number(process.env.RPO),retention_days:Number(process.env.RD||30),retention_mode:process.env.RM||'dryrun'};fs.writeFileSync(process.env.F,JSON.stringify(x)+'\n')" \
      OK="$OK" STAMP="$STAMP" L="$LATEST_NAME" A="$AGE" RPO="$RPO" RD="${ORIUM_RETENTION_DAYS:-30}" RM="${ORIUM_RETENTION_MODE:-dryrun}" F="$F"
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
    if node -e "const x=require(process.env.F);process.exit(x.ok===true?0:1)" F="$F"; then
      echo "freshness: ok"
      exit 0
    else
      echo "freshness: STALE (ok=false)" >&2
      exit 1
    fi
    ;;
  *) usage;;
esac
