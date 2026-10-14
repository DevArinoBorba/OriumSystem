// ops-manifest.mjs — gera o manifesto de release a partir da árvore local.
// Shape alinhado a deploy/verification/manifest-validator.ts (ReleaseManifest)
// com o delta coordenado ao QA: gitCommit nullable + sourceTreeSHA256 obrigatória.
// Uso: node deploy/operations/ops-manifest.mjs --out <arquivo> [--env production|staging|sandbox] [--app-image <id>]
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ALLOW, EXCLUDE_GLOBS, isAllowed, isExcluded, isForbiddenName, SECRET_CONTENT_PATTERNS } from './ops-config.mjs';
import { toPosix, walkFiles, sha256File, sha256OfSourceTree, matchesGlob } from './ops-util.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');

function parseArgs(argv) {
  const opts = { env: 'production', appImage: 'orium-production', out: null };
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k === '--out') opts.out = v;
    else if (k === '--env') opts.env = v;
    else if (k === '--app-image') opts.appImage = v;
  }
  return opts;
}

// Resolve a lista de arquivos do release (allowlist + exclusões + denylist).
export function resolveReleaseEntries(rootAbs = ROOT) {
  const allFiles = walkFiles(rootAbs);
  const entries = [];
  const rejected = [];
  for (const rel of allFiles) {
    const p = toPosix(rel);
    if (!isAllowed(p)) continue;
    if (isExcluded(p) || isForbiddenName(p)) {
      rejected.push(p);
      continue;
    }
    entries.push({ path: p, sha256: sha256File(path.join(rootAbs, p)), sizeBytes: fs.statSync(path.join(rootAbs, p)).size });
  }
  entries.sort((a, b) => (a.path < b.path ? -1 : 1));
  return { entries, rejected };
}

// Detecção de segredo por conteúdo nas entradas.
export function scanForSecrets(rootAbs, entries) {
  const hits = [];
  for (const e of entries) {
    const content = fs.readFileSync(path.join(rootAbs, e.path), 'utf8');
    for (const re of SECRET_CONTENT_PATTERNS) {
      if (re.test(content)) {
        hits.push({ file: e.path, pattern: re.source });
        break;
      }
    }
  }
  return hits;
}

export function detectGitCommit(rootAbs) {
  try {
    const head = fs.readFileSync(path.join(rootAbs, '.git', 'HEAD'), 'utf8').trim();
    const ref = head.startsWith('ref:') ? head.slice(5).trim() : head;
    const hash = fs.readFileSync(path.join(rootAbs, '.git', ref), 'utf8').trim();
    if (/^[0-9a-f]{40}$/i.test(hash)) return hash;
    if (/^[0-9a-f]{40}$/i.test(ref)) return ref.toLowerCase();
    return null;
  } catch {
    return null; // sem repositório git: nunca inventar commit
  }
}

export function latestMigrationName(rootAbs) {
  const dir = path.join(rootAbs, 'db', 'migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  return files.length ? files[files.length - 1] : null;
}

export function buildManifest({ env = 'production', appImage = 'orium-production', versionOverride = null } = {}) {
  const { entries, rejected } = resolveReleaseEntries(ROOT);
  const sourceTreeSHA256 = sha256OfSourceTree(entries);
  const gitCommit = detectGitCommit(ROOT);
  const targetSchemaVersion = latestMigrationName(ROOT);
  if (!targetSchemaVersion) throw new Error('Nenhuma migração .sql encontrada em db/migrations/');
  if (!entries.length) throw new Error('Release sem arquivos — allowlist vazia ou tudo excluído');
  const version =
    versionOverride || JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version || '0.1.0';
  const ts = new Date();
  const stamp = ts.toISOString().replace(/\D/g, '').slice(0, 14);
  const releaseId = `release-${stamp}-${sourceTreeSHA256.slice(0, 12)}`;
  return {
    manifestVersion: '1.0',
    releaseId,
    version,
    gitCommit,
    sourceTreeSHA256,
    createdAt: ts.toISOString(),
    targetEnvironment: env,
    appImage,
    targetSchemaVersion,
    rollbackPolicy: { schemaDowngradeAllowed: false, keepBackups: true },
    files: entries,
    rejected,
  };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const manifest = buildManifest({ env: opts.env, appImage: opts.appImage });
  const { rejected, ...mainBody } = manifest;
  if (rejected.length) {
    // Caminhos rejeitados não entram no manifesto; apenas aparecem no log de debug.
    process.stderr.write(`ops-manifest: ${rejected.length} caminho(s) rejeitado(s) pelo allowlist (não incluídos).\n`);
  }
  const json = JSON.stringify(mainBody, null, 2) + '\n';
  if (opts.out) {
    fs.mkdirSync(path.dirname(path.resolve(opts.out)), { recursive: true });
    fs.writeFileSync(path.resolve(opts.out), json, 'utf8');
    process.stdout.write(`ops-manifest: ${mainBody.files.length} arquivos, release ${mainBody.releaseId}, escrito em ${opts.out}\n`);
  } else {
    process.stdout.write(json);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();
