import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  validateReleaseManifest,
  validateRollbackSafety,
  type ReleaseManifest,
} from '../../deploy/verification/manifest-validator.js';

describe('Phase 10: Release Manifest & Preflight Verification (deploy/verification)', () => {
  const sandboxDir = path.resolve(process.cwd(), '.local', 'phase10', 'sandbox-manifest-test');
  let validManifest: ReleaseManifest;

  beforeAll(async () => {
    await fs.mkdir(sandboxDir, { recursive: true });

    // Cria arquivos fictícios reais no sandbox para teste de integridade física e hash
    const serverJsContent = Buffer.from('console.log("Orium Server Production Build");\n', 'utf8');
    const indexHtmlContent = Buffer.from('<!DOCTYPE html><html><head><title>Orium</title></head><body></body></html>\n', 'utf8');
    const migrationContent = Buffer.from('-- Migration 0005_notifications.sql\nCREATE TABLE IF NOT EXISTS notification (id UUID PRIMARY KEY);\n', 'utf8');

    await fs.writeFile(path.join(sandboxDir, 'server.js'), serverJsContent);
    await fs.writeFile(path.join(sandboxDir, 'index.html'), indexHtmlContent);
    await fs.writeFile(path.join(sandboxDir, '0005_notifications.sql'), migrationContent);

    validManifest = {
      manifestVersion: '1.0',
      releaseId: 'rel-20261014-01',
      version: '1.0.0',
      sourceTreeSHA256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      gitCommit: 'a1b2c3d4e5f6789012345678901234567890abcd',
      createdAt: '2026-10-14T12:00:00.000Z',
      targetEnvironment: 'production',
      appImage: 'orium-app:v1.0.0',
      targetSchemaVersion: '0005_notifications.sql',
      files: [
        {
          path: 'server.js',
          sha256: createHash('sha256').update(serverJsContent).digest('hex'),
          sizeBytes: serverJsContent.length,
        },
        {
          path: 'index.html',
          sha256: createHash('sha256').update(indexHtmlContent).digest('hex'),
          sizeBytes: indexHtmlContent.length,
        },
        {
          path: '0005_notifications.sql',
          sha256: createHash('sha256').update(migrationContent).digest('hex'),
          sizeBytes: migrationContent.length,
        },
      ],
      rollbackPolicy: {
        previousReleaseId: 'rel-20261013-00',
        previousVersion: '0.9.0',
        schemaDowngradeAllowed: false,
      },
    };
  });

  afterAll(async () => {
    try {
      await fs.rm(sandboxDir, { recursive: true, force: true });
    } catch {}
  });

  it('validates a pristine release manifest and authenticates all file checksums', async () => {
    const result = await validateReleaseManifest(validManifest, sandboxDir);
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
    expect(result.verifiedFilesCount).toBe(3);
    expect(result.manifest?.releaseId).toBe('rel-20261014-01');
    expect(result.manifest?.sourceTreeSHA256).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(result.manifest?.gitCommit).toBe('a1b2c3d4e5f6789012345678901234567890abcd');

    const rollbackCheck = validateRollbackSafety(result.manifest!);
    expect(rollbackCheck.safe).toBe(true);
  });

  it('validates a manifest with gitCommit as null when no git repo exists (per Codex rule)', async () => {
    const manifestWithoutGit = {
      ...validManifest,
      gitCommit: null,
    };

    const result = await validateReleaseManifest(manifestWithoutGit, sandboxDir);
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
    expect(result.manifest?.gitCommit).toBeNull();
  });

  it('fails closed when manifest schema has missing mandatory fields', async () => {
    const invalid = {
      ...validManifest,
      gitCommit: undefined, // Commit é obrigatório para rastreabilidade
      files: [], // Pelo menos um arquivo deve ser declarado
    };

    const result = await validateReleaseManifest(invalid);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.field === 'gitCommit')).toBe(true);
    expect(result.issues.some((i) => i.code === 'SCHEMA_VIOLATION')).toBe(true);
  });

  it('fails closed when release bundle includes forbidden secret or env files (Denylist)', async () => {
    const compromisedManifest: ReleaseManifest = {
      ...validManifest,
      files: [
        ...validManifest.files,
        {
          path: '.env',
          sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
          sizeBytes: 0,
        },
        {
          path: 'deploy/certs/server.key',
          sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
          sizeBytes: 0,
        },
        {
          path: 'node_modules/some-pkg/index.js',
          sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
          sizeBytes: 0,
        },
      ],
    };

    const result = await validateReleaseManifest(compromisedManifest);
    expect(result.valid).toBe(false);
    const forbiddenIssues = result.issues.filter((i) => i.code === 'FORBIDDEN_FILE_DETECTED');
    expect(forbiddenIssues.length).toBeGreaterThanOrEqual(3);
    expect(forbiddenIssues.some((i) => i.file === '.env')).toBe(true);
    expect(forbiddenIssues.some((i) => i.file === 'deploy/certs/server.key')).toBe(true);
    expect(forbiddenIssues.some((i) => i.file === 'node_modules/some-pkg/index.js')).toBe(true);
  });

  it('fails closed when a file is corrupted or hash does not match (tampering detection)', async () => {
    const corruptedManifest: ReleaseManifest = {
      ...validManifest,
      files: [
        {
          path: 'server.js',
          sha256: '0000000000000000000000000000000000000000000000000000000000000000', // Hash adulterado
          sizeBytes: validManifest.files[0]!.sizeBytes,
        },
      ],
    };

    const result = await validateReleaseManifest(corruptedManifest, sandboxDir);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === 'CHECKSUM_MISMATCH')).toBe(true);
    expect(result.verifiedFilesCount).toBe(0);
  });

  it('fails closed when a declared file is missing from package', async () => {
    const missingFileManifest: ReleaseManifest = {
      ...validManifest,
      files: [
        {
          path: 'dist/non-existent-bundle.js',
          sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
          sizeBytes: 100,
        },
      ],
    };

    const result = await validateReleaseManifest(missingFileManifest, sandboxDir);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === 'FILE_NOT_FOUND')).toBe(true);
  });

  it('strictly rejects any rollback specification that enables schema downgrade', async () => {
    const illegalRollback = {
      ...validManifest,
      rollbackPolicy: {
        previousReleaseId: 'rel-20261013-00',
        previousVersion: '0.9.0',
        schemaDowngradeAllowed: true as unknown as false, // Violação de contrato
      },
    };

    const result = await validateReleaseManifest(illegalRollback);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.field === 'rollbackPolicy.schemaDowngradeAllowed')).toBe(true);
  });
});
