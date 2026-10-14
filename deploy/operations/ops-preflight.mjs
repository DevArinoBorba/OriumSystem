// ops-preflight.mjs — gates fail-closed antes de qualquer release/rollback.
// Uso: node deploy/operations/ops-preflight.mjs --manifest <arquivo> [--env production|staging|sandbox] [--port N] [--blocked-ports 1,2,3]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isForbiddenName, SECRET_CONTENT_PATTERNS } from './ops-config.mjs';
import { toPosix, sha256File } from './ops-util.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const HEX_64 = /^[a-f0-9]{64}$/i;

function parseArgs(argv) {
  const opts = { manifest: null, env: null, port: null, blockedPorts: [55432, 5433, 3000, 3001, 3002, 5173] };
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k === '--manifest') opts.manifest = v;
    else if (k === '--env') opts.env = v;
    else if (k === '--port') opts.port = Number(v);
    else if (k === '--blocked-ports') opts.blockedPorts = String(v).split(',').map(Number);
  }
  return opts;
}

function fail(code, message) {
  process.stderr.write(`PREFLIGHT FAIL [${code}] ${message}\n`);
  process.exitCode = 1;
}

function check(cond, code, message) {
  if (!cond) fail(code, message);
  return cond;
}

function runPreflight(opts) {
  // Gate 1: manifesto presente e JSON válido
  if (!opts.manifest) return fail('MANIFEST_REQUIRED', '--manifest obrigatório');
  const abs = path.resolve(opts.manifest);
  if (!fs.existsSync(abs)) return fail('MANIFEST_PARSING', `arquivo não encontrado: ${opts.manifest}`);
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch (e) {
    return fail('MANIFEST_PARSING', e.message);
  }

  // Gate 2: schema básico (manifestVersion 1.0, campos obrigatórios)
  if (!check(raw.manifestVersion === '1.0', 'SCHEMA_VIOLATION', 'manifestVersion deve ser "1.0"')) return;
  if (!check(typeof raw.releaseId === 'string' && raw.releaseId.trim().length > 0, 'SCHEMA_VIOLATION', 'releaseId obrigatório')) return;
  if (!check(typeof raw.version === 'string' && raw.version.trim().length > 0, 'SCHEMA_VIOLATION', 'version obrigatório')) return;
  if (!check(raw.gitCommit === null || (typeof raw.gitCommit === 'string' && raw.gitCommit.length >= 7), 'SCHEMA_VIOLATION', 'gitCommit nullable (local sem git) — nunca inventar')) return;
  if (!check(typeof raw.sourceTreeSHA256 === 'string' && HEX_64.test(raw.sourceTreeSHA256 || ''), 'SCHEMA_VIOLATION', 'sourceTreeSHA256 obrigatório (hex64)')) return;
  if (!check(typeof raw.createdAt === 'string' && !isNaN(Date.parse(raw.createdAt)), 'SCHEMA_VIOLATION', 'createdAt ISO obrigatório')) return;
  if (!check(['production', 'staging', 'sandbox'].includes(raw.targetEnvironment), 'SCHEMA_VIOLATION', 'targetEnvironment inválido')) return;
  if (!check(typeof raw.appImage === 'string' && raw.appImage.trim().length > 0, 'SCHEMA_VIOLATION', 'appImage obrigatório')) return;
  if (!check(typeof raw.targetSchemaVersion === 'string' && raw.targetSchemaVersion.trim().length > 0, 'SCHEMA_VIOLATION', 'targetSchemaVersion obrigatório')) return;

  // Gate 3: denylist de nomes e integridade física
  if (!Array.isArray(raw.files) || raw.files.length === 0) return fail('SCHEMA_VIOLATION', 'files precisa ter ao menos 1 entrada');
  let verified = 0;
  for (let i = 0; i < raw.files.length; i++) {
    const f = raw.files[i];
    if (!f || typeof f !== 'object') return fail('SCHEMA_VIOLATION', `files[${i}] inválido`);
    const p = toPosix(String(f.path || ''));
    if (!p) return fail('SCHEMA_VIOLATION', `files[${i}].path obrigatório`);
    if (isForbiddenName(p)) return fail('FORBIDDEN_FILE_DETECTED', `arquivo proibido "${p}" no manifesto — segredos/.env/fixtures vedados`);
    if (p.startsWith('..') || path.isAbsolute(p)) return fail('SCHEMA_VIOLATION', `files[${i}].path deve ser relativo`);
    if (!HEX_64.test(String(f.sha256 || ''))) return fail('SCHEMA_VIOLATION', `files[${i}].sha256 deve ser hex64`);
    if (!Number.isInteger(f.sizeBytes) || f.sizeBytes < 0) return fail('SCHEMA_VIOLATION', `files[${i}].sizeBytes inteiro >=0`);

    const full = path.resolve(ROOT, p);
    if (!fs.existsSync(full)) return fail('FILE_NOT_FOUND', `arquivo declarado ausente: ${p}`);
    const stat = fs.statSync(full);
    if (stat.size !== f.sizeBytes) return fail('FILE_SIZE_MISMATCH', `"${p}": esperado ${f.sizeBytes}, encontrado ${stat.size}`);
    const actual = sha256File(full);
    if (actual.toLowerCase() !== String(f.sha256).toLowerCase()) {
      return fail('CHECKSUM_MISMATCH', `"${p}": esperado ${f.sha256}, obtido ${actual}`);
    }
    verified++;
  }

  // Gate 3b: conteúdo sem assinaturas de segredo
  for (let i = 0; i < raw.files.length; i++) {
    const p = toPosix(String(raw.files[i].path || ''));
    if (p.startsWith('..')) return fail('SCHEMA_VIOLATION', 'path relativo exigido');
    const full = path.resolve(ROOT, p);
    if (!fs.existsSync(full) || fs.statSync(full).isDirectory()) continue;
    const content = fs.readFileSync(full, 'utf8');
    for (const re of SECRET_CONTENT_PATTERNS) {
      if (re.test(content)) return fail('SECRET_DETECTED', `assinatura de segredo em "${p}" (padrão ${re.source})`);
    }
  }

  // Gate 4: ambiente alvo
  if (opts.env && raw.targetEnvironment !== opts.env) {
    return fail('TARGET_ENVIRONMENT_MATCH', `manifesto=${raw.targetEnvironment}, esperado=${opts.env}`);
  }

  // Gate 5: PORT_POLICY (opcional --port)
  if (opts.port) {
    if (opts.blockedPorts.includes(opts.port)) {
      return fail('PORT_BLOCKED', `porta ${opts.port} reservada; alocar via Find-FreePort.ps1`);
    }
  }

  process.stdout.write(`PREFLIGHT OK ${raw.files.length} arquivos integridade verificada, release ${raw.releaseId}\n`);
}

const opts = parseArgs(process.argv.slice(2));
runPreflight(opts);
