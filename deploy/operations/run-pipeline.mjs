// run-pipeline.mjs — pipeline local fail-closed (sem rede/VPS/CI externo/serviços).
// Executa os gates de empacotamento em ordem e NUNCA segue adiante se um gate falhar.
// Produz .local/phase10/opencode/pipeline-result.json com exit real por gate.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const OUT_DIR = path.join(ROOT, '.local', 'phase10', 'opencode');
const OUT_FILE = path.join(OUT_DIR, 'pipeline-result.json');

const node = process.execPath;

function runGate(name, script, args = []) {
  const r = spawnSync(node, [path.join(HERE, script), ...args], {
    cwd: HERE,
    encoding: 'utf8',
    windowsHide: true,
  });
  return { name, script, argv: args, exit: r.status, stdout: (r.stdout || '').trim(), stderr: (r.stderr || '').trim() };
}

function main() {
  const env = process.argv[2] || 'production';
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const startedAt = new Date().toISOString();
  const gates = [];
  const results = [];

  // Gate 1: geração do manifesto (falha se allowlist vazia/estrutura sem migração).
  const manifestOut = path.join(OUT_DIR, 'manifest.json');
  results.push(runGate('MANIFEST_GENERATION', 'ops-manifest.mjs', ['--out', manifestOut, '--env', env]));

  // Gate 2: preflight fail-closed sobre o manifesto gerado.
  results.push(runGate('PREFLIGHT', 'ops-preflight.mjs', ['--manifest', manifestOut, '--env', env]));

  // Gate 3: release (empacota bundle real; roda scan de segredos internamente).
  results.push(runGate('RELEASE', 'ops-release.mjs', ['--env', env]));

  const failed = results.filter((r) => r.exit !== 0);
  const artifact = {
    pipeline: 'deploy/operations/run-pipeline.mjs',
    env,
    startedAt,
    finishedAt: new Date().toISOString(),
    gates: results.map(({ name, exit }) => ({ name, exit })),
    ok: failed.length === 0,
  };
  fs.writeFileSync(OUT_FILE, JSON.stringify(artifact, null, 2) + '\n', 'utf8');

  // Saída resumida (sem segredos/conteúdo).
  for (const r of results) {
    const status = r.exit === 0 ? 'OK' : 'FAIL';
    process.stdout.write(`gate=${r.name} ${status} exit=${r.exit} :: ${r.stdout.split('\n')[0] || ''}\n`);
  }
  process.stdout.write(`pipeline ${artifact.ok ? 'PASS' : 'FAIL'} gates=${results.length} failClosed=${artifact.ok ? 'noFail' : 'halted'} artifact=${OUT_FILE}\n`);
  process.exitCode = artifact.ok ? 0 : 1;
}

main();
