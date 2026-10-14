// ops-config.mjs — fonte única de política de empacotamento do release.
// Alinhada ao Dockerfile de produção (deploy/production/Dockerfile) para que o
// bundle seja um contexto de build válido com `context: ../..`.
// NENHUM segredo, fixture de teste, dump ou dist pré-existente é permitido no bundle.
import { matchesGlob } from './ops-util.mjs';

// Inclusões POSITIVAS por prefixo de caminho relativo à raiz do monorepo.
export const ALLOW = [
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'tsconfig.base.json',
  'packages/contracts/package.json',
  'packages/contracts/tsconfig.json',
  'packages/contracts/src/',
  'apps/api/package.json',
  'apps/api/tsconfig.json',
  'apps/api/src/',
  'apps/web/package.json',
  'apps/web/tsconfig.json',
  'apps/web/index.html',
  'apps/web/src/',
  'db/migrations/',
  'deploy/production/',
];

// Padrões de caminho SEMPRE excluídos (inclui a denylist do validador do QA:
// .env*, *.pem/key/pkcs8/pfx/p12, *.dump/backup/bak, tests/.git/node_modules).
export const EXCLUDE_GLOBS = [
  '**/.env',
  '**/.env.*',
  '**/node_modules/**',
  '**/dist/**',
  '**/*.test.*',
  '**/*.spec.*',
  '**/tests/**',
  '**/.local/**',
  '**/.git/**',
  '**/.cate/**',
  '**/company-reference-assets/**',
  '**/design/**',
  '**/scripts/**',
  'deploy/operations/releases/**',
  '**/*.pem',
  '**/*.key',
  '**/*.pkcs8',
  '**/*.pfx',
  '**/*.p12',
  '**/*.dump',
  '**/*.dump.gz',
  '**/*.backup',
  '**/*.bak',
];

// Assinaturas fortes de segredo no CONTEÚDO (sem falso positivo em código).
export const SECRET_CONTENT_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/i,
  /-----BEGIN PGP PRIVATE KEY BLOCK-----/i,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
];

export function isAllowed(relPosix) {
  if (!relPosix || relPosix.startsWith('..')) return false;
  return ALLOW.some((entry) => {
    if (entry.endsWith('/')) return relPosix === entry.slice(0, -1) || relPosix.startsWith(entry);
    return relPosix === entry || relPosix.startsWith(entry + '/');
  });
}

export function isExcluded(relPosix) {
  return EXCLUDE_GLOBS.some((glob) => matchesGlob(glob, relPosix));
}

export function isForbiddenName(relPosix) {
  // Denylist explícita do QA (FORBIDDEN_FILE_PATTERNS), independente do allowlist.
  const base = relPosix.split('/').pop();
  if (/^\.env(?:\..+)?$/i.test(base)) return true;
  if (/\.(?:pem|key|pkcs8|pfx|p12)$/i.test(relPosix)) return true;
  if (/\.(?:dump|dump\.gz|backup|bak)$/i.test(relPosix)) return true;
  if (/(?:^|[/\\])(?:tests|test-fixtures|\.local|\.git|node_modules)(?:[/\\]|$)/i.test(relPosix)) return true;
  return false;
}
