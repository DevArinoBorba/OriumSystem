// ops-release.mjs — empacota um release verificável a partir da allowlist local.
// Gera: releases/<releaseId>/bundle/ (árvore do release), bundle.tar.gz (relativo ao
// Dockerfile: `context: ../..`, deploy/production/** no raiz), manifest.json e index.json.
// Uso: node deploy/operations/ops-release.mjs [--env production] [--app-image orium-production]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { buildManifest, resolveReleaseEntries, scanForSecrets } from './ops-manifest.mjs';
import { isForbiddenName, isExcluded, isAllowed } from './ops-config.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const RELEASES_DIR = path.join(HERE, 'releases');
const INDEX_FILE = path.join(RELEASES_DIR, 'index.json');

function parseArgs(argv) {
  const opts = { env: 'production', appImage: 'orium-production' };
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k === '--env') opts.env = v;
    else if (k === '--app-image') opts.appImage = v;
  }
  return opts;
}

function loadIndex() {
  try {
    return JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
  } catch {
    return { releases: [] };
  }
}

function saveIndex(index) {
  fs.writeFileSync(INDEX_FILE, JSON.stringify(index, null, 2) + '\n', 'utf8');
}

function main() {
  const opts = parseArgs(process.argv.slice(2));

  // 1. Build manifest reutiliza a mesma resolução do gerador (idempotente).
  const manifest = buildManifest({ env: opts.env, appImage: opts.appImage });

  // 2. Gates fail-closed antes do empacotamento.
  const { entries } = resolveReleaseEntries(ROOT);
  const secretHits = scanForSecrets(ROOT, entries);
  if (secretHits.length) {
    process.stderr.write(`FAIL: segredo detectado em conteúdo (${secretHits.map((h) => h.file).join(', ')}). Release abortado.\n`);
    process.exitCode = 1;
    return;
  }
  // Denylist estrutural também é re-aplicada no manifesto abaixo.

  // 3. Monta bundle (árvore de release) em releases/<releaseId>/bundle/.
  const canonical = {
    manifestVersion: '1.0',
    releaseId: manifest.releaseId,
    version: manifest.version,
    gitCommit: manifest.gitCommit,
    sourceTreeSHA256: manifest.sourceTreeSHA256,
    createdAt: manifest.createdAt,
    targetEnvironment: manifest.targetEnvironment,
    appImage: manifest.appImage,
    targetSchemaVersion: manifest.targetSchemaVersion,
    rollbackPolicy: { schemaDowngradeAllowed: false, keepBackups: true },
    files: manifest.files.map(({ path: p, sha256, sizeBytes }) => ({ path: p, sha256, sizeBytes })),
  };
  const releaseDir = path.join(RELEASES_DIR, manifest.releaseId);
  const bundleDir = path.join(releaseDir, 'bundle');
  fs.rmSync(bundleDir, { recursive: true, force: true });
  fs.mkdirSync(bundleDir, { recursive: true });

  let copied = 0;
  for (const f of canonical.files) {
    const src = path.join(ROOT, f.path);
    const dst = path.join(bundleDir, f.path);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    copied++;
  }
  if (copied !== canonical.files.length) {
    process.stderr.write(`FAIL: divergência de cópia (${copied}/${canonical.files.length}).\n`);
    process.exitCode = 1;
    return;
  }

  // 4. Manifesto e índice.
  fs.writeFileSync(path.join(releaseDir, 'manifest.json'), JSON.stringify(canonical, null, 2) + '\n', 'utf8');
  const index = loadIndex();
  index.releases = index.releases.filter((r) => r.releaseId !== canonical.releaseId);
  index.releases.push({
    releaseId: canonical.releaseId,
    version: canonical.version,
    createdAt: canonical.createdAt,
    targetEnvironment: canonical.targetEnvironment,
    appImage: canonical.appImage,
    gitCommit: canonical.gitCommit,
    sourceTreeSHA256: canonical.sourceTreeSHA256,
    targetSchemaVersion: canonical.targetSchemaVersion,
    filesCount: canonical.files.length,
    bundleDir: `releases/${canonical.releaseId}/bundle`,
  });
  saveIndex(index);

  // 5. tar.gz com caminhos relativos ao CONTEXTO do Dockerfile (root do bundle).
  // `context: ../..` no compose = raiz do bundle; deploy/production/** na raiz.
  // Fail-closed: falha de tar NUNCA imprime RELEASE OK nem sai com exit 0.
  let tarNote = '';
  try {
    const tarFile = path.join(releaseDir, 'bundle.tar.gz');
    fs.rmSync(tarFile, { force: true });
    execFileSync('tar', ['-czf', tarFile, '-C', bundleDir, '.'], { stdio: ['ignore', 'ignore', 'pipe'] });
    if (!fs.existsSync(tarFile) || fs.statSync(tarFile).size === 0) {
      process.stderr.write('FAIL: bundle.tar.gz ausente ou vazio após tar (fail-closed). Release abortado.\n');
      process.exitCode = 1;
      return;
    }
    tarNote = `bundle.tar.gz (${fs.statSync(tarFile).size} bytes)`;
  } catch (e) {
    process.stderr.write(`FAIL: empacotamento tar.gz falhou (${(e && e.message) || e}); exitCode=1 fail-closed.\n`);
    process.exitCode = 1;
    return;
  }

  process.stdout.write(
    `RELEASE OK ${canonical.releaseId} | ${canonical.files.length} arquivos | env=${canonical.targetEnvironment} | schema=${canonical.targetSchemaVersion} | dir=${path.relative(ROOT, releaseDir)} | ${tarNote}\n`
  );
}

main();
