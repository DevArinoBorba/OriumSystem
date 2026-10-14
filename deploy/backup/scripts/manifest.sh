#!/usr/bin/env bash
# manifest.sh — manifesto do backup local (dump + checksum sha256), retenção isolada.
# Cofre/OpenCode — deploy/backup/scripts
# Só lista / age sobre arquivos do PRÓPRIO mecanismo (padrão orium_*.dump) na pasta
# local de staging. Nunca apaga acervo remoto, nunca toca raiz do Drive. Sem segredos.
set -euo pipefail

usage() { echo "usage: manifest.sh <backupdir>" >&2; exit 2; }
[[ $# -eq 1 ]] || usage
DIR="$1"
cutoff="$(node -e 'console.log(Date.now() - (Number(process.env.ORIUM_RETENTION_DAYS||30))*86400e3)')"

MANIFEST_JSON="$(ORIUM_RETENTION_DAYS="${ORIUM_RETENTION_DAYS:-30}" ORIUM_RETENTION_MODE="${ORIUM_RETENTION_MODE:-dryrun}" node - "$DIR" <<'NODEEOF'
const fs = require('fs');
const dir = process.argv[2];
const stamp = new Date().toISOString();
const items = fs.readdirSync(dir)
  .filter(f => /^orium_.+\.dump$/.test(f))
  .sort()
  .map(f => {
    const p = dir + '/' + f;
    const st = fs.statSync(p);
    const crypto = require('crypto');
    const sha = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
    return { file: f, sha256: sha, size_bytes: st.size };
  });
const ret = {
  manifestVersion: '1.0',
  kind: 'orium-backup',
  createdAt: stamp,
  retention_days: Number(process.env.ORIUM_RETENTION_DAYS || '30'),
  retention_mode: process.env.ORIUM_RETENTION_MODE || 'dryrun',
  files: items,
};
fs.writeFileSync(dir + '/manifest.json', JSON.stringify(ret, null, 2) + '\n');
console.log(JSON.stringify({ files: items.length, totalBytes: items.reduce((a,i)=>a+i.size_bytes,0) }));
NODEEOF
)"

echo "manifest: ok $MANIFEST_JSON"

# Retenção isolada (apenas dentro de $DIR, arquivos deste mecanismo).
# Default dryrun: relata o que seria removido sem apagar nada. Remota NUNCA aqui.
MODE="${ORIUM_RETENTION_MODE:-dryrun}"
stale=0
for f in "$DIR"/orium_*.dump; do
  [[ -e "$f" ]] || continue
  mtime="$(stat -c%Y "$f")"
  if (( mtime * 1000 < cutoff )); then
    echo "manifest: retencao [$MODE] consideraria remover: $(basename "$f")"
    stale=$((stale + 1))
    if [[ "$MODE" == "enabled" ]]; then
      rm -f "$f"
    fi
  fi
done
echo "manifest: retencao [$MODE] stale=$stale avisados (sem remoção em dryrun)"
