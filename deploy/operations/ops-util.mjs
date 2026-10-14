// ops-util.mjs — utilitários compartilhados de empacotamento/verificação.
// Somente APIs do Node (crypto/fs/path); sem dependências externas.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export function toPosix(p) {
  return p.split('\\').join('/');
}

export function sha256Hex(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

export function sha256File(absPath) {
  return sha256Hex(fs.readFileSync(absPath));
}

export function sha256OfSourceTree(entries) {
  // Snapshot determinístico e ordenado: "rel:sha256" por linha, depois hash.
  const lines = entries
    .map((e) => `${e.path}:${e.sha256}`)
    .sort()
    .join('\n');
  return sha256Hex(Buffer.from(lines, 'utf8'));
}

// Caminha a árvore a partir de root, devolvendo caminhos relativos POSIX de arquivos.
export function walkFiles(rootAbs, prefixRel = '') {
  const out = [];
  const entries = fs.readdirSync(path.join(rootAbs, prefixRel), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1));
  for (const ent of entries) {
    const rel = prefixRel ? `${prefixRel}/${ent.name}` : ent.name;
    if (ent.isDirectory()) {
      out.push(...walkFiles(rootAbs, rel));
    } else if (ent.isFile()) {
      out.push(rel);
    }
  }
  return out;
}

// Matcher de padrões simples com suporte a **, * e ?. Sem regex meta além disso.
export function matchesGlob(pattern, relPosix) {
  if (pattern === relPosix) return true;
  const neg = /^\!/.test(pattern);
  const pat = neg ? pattern.slice(1) : pattern;
  const segments = pat.split('/').filter((s) => s.length > 0);
  const parts = relPosix.split('/');

  // Padrões terminados em '/' cobrem árvore inteira do diretório.
  const match = (pi, si) => {
    if (pi === segments.length) return si === parts.length;
    const seg = segments[pi];
    if (seg === '**') {
      for (let k = si; k <= parts.length; k++) {
        if (match(pi + 1, k)) return true;
      }
      return false;
    }
    if (si >= parts.length) return false;
    if (!wild(seg, parts[si])) return false;
    return match(pi + 1, si + 1);
  };
  const base = match(0, 0);
  return neg ? !base : base;
}

function wild(seg, str) {
  const re = new RegExp(
    '^' +
      seg
        .split('')
        .map((c) => (c === '*' ? '[^/]*' : c === '?' ? '[^/]' : c.replace(/[.+^${}()|[\]\\]/g, '\\$&')))
        .join('') +
      '$'
  );
  return re.test(str);
}
