// ops-rollback.mjs — rollback de APLICAÇÃO para um release anterior presente no índice.
// NUNCA executa downgrade/drop de schema ou mutação de banco. Fail-closed: qualquer
// divergência de integridade aborta. Staging de exemplo: troca o ponteiro "current"
// para o bundle anterior, verificando antes a integridade completa dele.
// Uso: node deploy/operations/ops-rollback.mjs --from <releaseIdOpcional: último ativo> [--to <releaseIdEspecífico>]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256File } from './ops-util.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const RELEASES_DIR = path.join(HERE, 'releases');
const INDEX_FILE = path.join(RELEASES_DIR, 'index.json');
const CURRENT_POINTER = path.join(HERE, 'current.json');

function loadIndex() {
  try {
    const raw = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
    if (!Array.isArray(raw.releases)) throw new Error('index.json inválido');
    return raw;
  } catch {
    return { releases: [] };
  }
}

function readManifest(releaseId) {
  const m = path.join(RELEASES_DIR, releaseId, 'manifest.json');
  return JSON.parse(fs.readFileSync(m, 'utf8'));
}

function verifyBundleIntegrity(releaseId) {
  const manifest = readManifest(releaseId);
  const bundle = path.join(RELEASES_DIR, releaseId, 'bundle');
  if (!fs.existsSync(bundle)) return { ok: false, reason: `bundle ausente: ${bundle}` };
  let verified = 0;
  for (const f of manifest.files) {
    const full = path.join(bundle, f.path);
    if (!fs.existsSync(full)) return { ok: false, reason: `arquivo ausente no bundle: ${f.path}` };
    if (fs.statSync(full).size !== f.sizeBytes) return { ok: false, reason: `tamanho divergente: ${f.path}` };
    if (sha256File(full).toLowerCase() !== f.sha256.toLowerCase()) {
      return { ok: false, reason: `checksum divergente: ${f.path}` };
    }
    verified++;
  }
  return { ok: true, count: verified };
}

function parseArgs(argv) {
  const opts = { to: null };
  for (let i = 0; i < argv.length; i += 2) {
    if (argv[i] === '--to') opts.to = argv[i + 1];
  }
  return opts;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const index = loadIndex();
  if (!index.releases || index.releases.length === 0) {
    process.stderr.write('ROLLBACK FAIL: índice de releases vazio.\n');
    process.exitCode = 1;
    return;
  }

  // Ordena do mais recente para o mais antigo por createdAt.
  const ordered = [...index.releases].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const current = ordered[0];
  const candidates = ordered.slice(1); // releases anteriores (sem o atual)

  let target = opts.to;
  if (!target) {
    if (!candidates.length) {
      // Fail-closed: sem candidato anterior não há rollback possível; não fingir sucesso.
      process.stderr.write(`ROLLBACK FAIL: nenhum release anterior disponível para "current=${current.releaseId}" — sem candidato (exit 1 fail-closed).\n`);
      process.exitCode = 1;
      return;
    }
    target = candidates[0].releaseId;
  }

  // Verifica se o alvo existe no índice e não é o atual.
  const targetEntry = index.releases.find((r) => r.releaseId === target);
  if (!targetEntry) {
    process.stderr.write(`ROLLBACK FAIL: release alvo "${target}" não consta no índice.\n`);
    process.exitCode = 1;
    return;
  }
  if (target === current.releaseId) {
    process.stderr.write('ROLLBACK FAIL: alvo é o próprio release atual.\n');
    process.exitCode = 1;
    return;
  }

  // Integridade física do alvo antes de qualquer troca (fail-closed).
  const integ = verifyBundleIntegrity(target);
  if (!integ.ok) {
    process.stderr.write(`ROLLBACK FAIL: integridade do alvo "${target}" não comprovada (${integ.reason}).\n`);
    process.exitCode = 1;
    return;
  }

  // Segurança de schema: rollback de aplicação NUNCA faz downgrade de schema.
  const targetManifest = readManifest(target);
  if (targetManifest.rollbackPolicy && targetManifest.rollbackPolicy.schemaDowngradeAllowed !== false) {
    process.stderr.write('ROLLBACK FAIL: rollbackPolicy exige schemaDowngradeAllowed=false.\n');
    process.exitCode = 1;
    return;
  }

  // Aplica troca do ponteiro "current" (passo de aplicação local/arbitrada).
  const currentState = {
    from: current.releaseId,
    to: target,
    appliedAt: new Date().toISOString(),
    verifiedFiles: integ.count,
    targetSchemaVersion: targetManifest.targetSchemaVersion,
    schemaDowngrade: false,
  };
  fs.writeFileSync(CURRENT_POINTER, JSON.stringify(currentState, null, 2) + '\n', 'utf8');
  process.stdout.write(`ROLLBACK OK ${current.releaseId} -> ${target} | ${integ.count} arquivos verificados | current.json atualizado | sem downgrade de schema\n`);
}

main();
