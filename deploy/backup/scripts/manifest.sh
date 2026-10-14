#!/usr/bin/env bash
# manifest.sh — manifesto do backup local (dump + checksum sha256), retenção isolada.
# Cofre/OpenCode — deploy/backup/scripts
# Só lista / age sobre arquivos do PRÓPRIO mecanismo (padrão orium_*.dump) na pasta
# local de staging. Nunca apaga acervo remoto, nunca toca raiz do Drive. Sem segredos.
set -euo pipefail

usage() { echo "usage: manifest.sh <backupdir>" >&2; exit 2; }
[[ $# -eq 1 ]] || usage
DIR="$1"
if command -v node >/dev/null 2>&1; then
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
else
  cutoff="$(python3 -c 'import os, time; print(int(time.time()*1000 - int(os.environ.get("ORIUM_RETENTION_DAYS", 30))*86400*1000))')"
  MANIFEST_JSON="$(ORIUM_RETENTION_DAYS="${ORIUM_RETENTION_DAYS:-30}" ORIUM_RETENTION_MODE="${ORIUM_RETENTION_MODE:-dryrun}" python3 - "$DIR" <<'PYTHEOF'
import sys, os, hashlib, json, datetime
dir_path = sys.argv[1]
stamp = datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z")
items = []
dumps = sorted([f for f in os.listdir(dir_path) if f.startswith("orium_") and f.endswith(".dump")])
for f in dumps:
    p = os.path.join(dir_path, f)
    size = os.path.getsize(p)
    with open(p, "rb") as fp:
        sha = hashlib.sha256(fp.read()).hexdigest()
    items.append({"file": f, "sha256": sha, "size_bytes": size})
ret = {
    "manifestVersion": "1.0",
    "kind": "orium-backup",
    "createdAt": stamp,
    "retention_days": int(os.environ.get("ORIUM_RETENTION_DAYS", "30")),
    "retention_mode": os.environ.get("ORIUM_RETENTION_MODE", "dryrun"),
    "files": items
}
with open(os.path.join(dir_path, "manifest.json"), "w", encoding="utf-8") as fp:
    json.dump(ret, fp, indent=2)
    fp.write("\n")
total_bytes = sum(i["size_bytes"] for i in items)
print(json.dumps({"files": len(items), "totalBytes": total_bytes}))
PYTHEOF
)"
fi

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
