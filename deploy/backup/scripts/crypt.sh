#!/usr/bin/env bash
# crypt.sh — rclone crypt: conteúdo + nomes criptografados antes de sair da VPS.
# Cofre/OpenCode — deploy/backup/scripts
# Regras: nunca syncar/deletar raiz Drive; nunca enviar dump plaintext nem a chave
# de descriptografia junto do backup ao destino. Scope drive.file (mínimo).
# Configuração rclone protegida (arquivo com ACL exclusiva) e senha de descriptografia
# da config entregue via --password-command (nunca em argv/mensagens/logs).
set -euo pipefail

usage() {
cat >&2 <<'EOF'
usage: crypt.sh <remote-name> <local-dir-with-dumps> <drive-folder>
  remote-name   remote crypt (config protegido) ex. orium-crypt
  local-dir     diretório com os dumps plaintext (stage local, exclusivo do mecanismo)
  drive-folder  pasta exclusiva no Drive (ex. OriumSystem)
Variáveis:
  ORIUM_RCLONE_CONFIG      caminho do arquivo de config do rclone (protegido)
  ORIUM_RCLONE_PASSWORD    senha da config (opcional, se encriptada)
   - se definida, o script monta um --password-command que lê da própria variável,
     repassada por ambiente; NUNCA aparece em argv/log.
  ORIUM_DRY_RUN            1 = dryrun, ignora criptografia remota até OAuth configurado
EOF
  exit 2
}
[[ $# -eq 3 ]] || usage
REMOTE="$1"; LOCALDIR="$2"; DRIVEFOLDER="$3"
RCLONE="${RCLONE_BIN:-rclone}"
DRY="${ORIUM_DRY_RUN:-0}"

if [[ "$DRY" == "1" ]]; then
  echo "crypt: modo dryrun=$DRY (ignorado crypt local até configuração do remote/OAuth); ok"
  exit 0
fi

CONFIG_ARGS=()
[[ -n "${ORIUM_RCLONE_CONFIG:-}" ]] && CONFIG_ARGS+=(--config "$ORIUM_RCLONE_CONFIG")

PWC_ARGS=()
if [[ -n "${ORIUM_RCLONE_PASSWORD:-}" ]]; then
  # --password-command lê o valor da variável de ambiente (nunca argv).
  PWC_ARGS=(--password-command "printf '%s' \"\$ORIUM_RCLONE_PASSWORD\"")
  export ORIUM_RCLONE_PASSWORD
fi

echo "crypt: verificando remote $REMOTE (scope drive.file)..."
${RCLONE} "${CONFIG_ARGS[@]}" "${PWC_ARGS[@]}" lsf "$REMOTE:" >/dev/null 2>&1 \
  && echo "crypt: remote $REMOTE acessível" \
  || { echo "crypt: remote '$REMOTE' não acessível/configurado (fail-closed)" >&2; exit 3; }

# Prova real de criptografia local: copia(criptografa) os dumps da pasta local para o
# remote crypt e depois cryptcheck (integridade). Nada é enviado ao Drive aqui.
STAGED=$(find "$LOCALDIR" -maxdepth 1 -name 'orium_*.dump' -type f | wc -l)
if [[ "$STAGED" -gt 0 ]]; then
  echo "crypt: criptografando $STAGED dump(s) para $REMOTE:/$DRIVEFOLDER (cliente-side)..."
  ${RCLONE} "${CONFIG_ARGS[@]}" "${PWC_ARGS[@]}" --transfers 2 copy "$LOCALDIR" "$REMOTE:/$DRIVEFOLDER" \
    || { echo "crypt: FALHA no crypt copy (fail-closed)" >&2; exit 4; }
  echo "crypt: cryptcheck (integridade local) ..."
  ${RCLONE} cryptcheck --include "orium_*.dump" --include "manifest.json" \
    "${CONFIG_ARGS[@]}" "${PWC_ARGS[@]}" "$LOCALDIR" "$REMOTE:/$DRIVEFOLDER" \
    || { echo "crypt: cryptcheck FALHOU (fail-closed)" >&2; exit 5; }
  echo "crypt: roundtrip local ok (criptografado antes de qualquer saída da VPS)"
else
  echo "crypt: nenhum dump novo em $LOCALDIR (nada a criptografar ainda)"
fi
