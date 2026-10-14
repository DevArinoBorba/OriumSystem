import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runDeploymentPreflight } from '../../deploy/verification/preflight-verifier.js';
import type { ReleaseManifest } from '../../deploy/verification/manifest-validator.js';

describe('Phase 10: Preflight Gates & Fail-Closed Negative Checks (deploy/verification)', () => {
  const sandboxDir = path.resolve(process.cwd(), '.local', 'phase10', 'sandbox-preflight-test');
  const pkgDir = path.join(sandboxDir, 'pkg');
  const migrationsDir = path.join(sandboxDir, 'migrations');
  const manifestPath = path.join(sandboxDir, 'release-manifest.json');

  let baseManifest: ReleaseManifest;

  beforeAll(async () => {
    await fs.mkdir(pkgDir, { recursive: true });
    await fs.mkdir(migrationsDir, { recursive: true });

    // Cria arquivos do pacote
    const mainJs = Buffer.from('console.log("App main");\n', 'utf8');
    await fs.writeFile(path.join(pkgDir, 'main.js'), mainJs);

    // Cria arquivos de migração
    await fs.writeFile(path.join(migrationsDir, '0001_initial.sql'), '-- Initial\n');
    await fs.writeFile(path.join(migrationsDir, '0005_notifications.sql'), '-- Notifications\n');

    baseManifest = {
      manifestVersion: '1.0',
      releaseId: 'rel-phase10-preflight-01',
      version: '1.0.0',
      sourceTreeSHA256: 'f4b5c6d7e8f90123456789012345678901234567890123456789012345678901',
      gitCommit: 'b2c3d4e5f6789012345678901234567890123456',
      createdAt: '2026-10-14T12:00:00.000Z',
      targetEnvironment: 'production',
      appImage: 'orium-app:v1.0.0',
      targetSchemaVersion: '0005_notifications.sql',
      files: [
        {
          path: 'main.js',
          sha256: createHash('sha256').update(mainJs).digest('hex'),
          sizeBytes: mainJs.length,
        },
      ],
    };

    await fs.writeFile(manifestPath, JSON.stringify(baseManifest, null, 2), 'utf8');
  });

  afterAll(async () => {
    try {
      await fs.rm(sandboxDir, { recursive: true, force: true });
    } catch {}
  });

  it('approves preflight when all gates pass (manifest, checksum, environment, migrations, port)', async () => {
    const summary = await runDeploymentPreflight({
      manifestPath,
      packageDirectory: pkgDir,
      migrationsDirectory: migrationsDir,
      expectedEnvironment: 'production',
      targetPort: 3150, // Porta livre fora da lista de portas reservadas
    });

    expect(summary.ready).toBe(true);
    expect(summary.checks.every((c) => c.passed)).toBe(true);
  });

  it('fails closed when manifest file does not exist (Gate: MANIFEST_PARSING)', async () => {
    const summary = await runDeploymentPreflight({
      manifestPath: path.join(sandboxDir, 'non-existent-manifest.json'),
      packageDirectory: pkgDir,
      migrationsDirectory: migrationsDir,
      expectedEnvironment: 'production',
    });

    expect(summary.ready).toBe(false);
    const failed = summary.checks.find((c) => c.gate === 'MANIFEST_PARSING');
    expect(failed?.passed).toBe(false);
  });

  it('fails closed when target environment diverges from expected (Gate: TARGET_ENVIRONMENT_MATCH)', async () => {
    const stagingManifestPath = path.join(sandboxDir, 'staging-manifest.json');
    const stagingManifest: ReleaseManifest = {
      ...baseManifest,
      targetEnvironment: 'staging',
    };
    await fs.writeFile(stagingManifestPath, JSON.stringify(stagingManifest, null, 2), 'utf8');

    const summary = await runDeploymentPreflight({
      manifestPath: stagingManifestPath,
      packageDirectory: pkgDir,
      migrationsDirectory: migrationsDir,
      expectedEnvironment: 'production', // Espera produção, mas manifesto é staging
    });

    expect(summary.ready).toBe(false);
    const failed = summary.checks.find((c) => c.gate === 'TARGET_ENVIRONMENT_MATCH');
    expect(failed?.passed).toBe(false);
    expect(failed?.error).toContain('difere do ambiente esperado');
  });

  it('fails closed when declared target schema migration does not exist (Gate: MIGRATION_COMPLETENESS)', async () => {
    const unappliedMigrationManifestPath = path.join(sandboxDir, 'future-migration-manifest.json');
    const futureManifest: ReleaseManifest = {
      ...baseManifest,
      targetSchemaVersion: '0099_unwritten_future_feature.sql',
    };
    await fs.writeFile(unappliedMigrationManifestPath, JSON.stringify(futureManifest, null, 2), 'utf8');

    const summary = await runDeploymentPreflight({
      manifestPath: unappliedMigrationManifestPath,
      packageDirectory: pkgDir,
      migrationsDirectory: migrationsDir,
      expectedEnvironment: 'production',
    });

    expect(summary.ready).toBe(false);
    const failed = summary.checks.find((c) => c.gate === 'MIGRATION_COMPLETENESS');
    expect(failed?.passed).toBe(false);
    expect(failed?.error).toContain('não existe no diretório de migrações');
  });

  it('fails closed when deployment attempts to bind to reserved active ports (Gate: PORT_POLICY_COMPLIANCE)', async () => {
    // Porta 55432 é orium_dev
    const summaryDev = await runDeploymentPreflight({
      manifestPath,
      packageDirectory: pkgDir,
      migrationsDirectory: migrationsDir,
      expectedEnvironment: 'production',
      targetPort: 55432,
    });

    expect(summaryDev.ready).toBe(false);
    const failedDev = summaryDev.checks.find((c) => c.gate === 'PORT_POLICY_COMPLIANCE');
    expect(failedDev?.passed).toBe(false);
    expect(failedDev?.error).toContain('está na lista de portas protegidas/reservadas');

    // Porta 5433 é orium_test
    const summaryTest = await runDeploymentPreflight({
      manifestPath,
      packageDirectory: pkgDir,
      migrationsDirectory: migrationsDir,
      expectedEnvironment: 'production',
      targetPort: 5433,
    });

    expect(summaryTest.ready).toBe(false);
    const failedTest = summaryTest.checks.find((c) => c.gate === 'PORT_POLICY_COMPLIANCE');
    expect(failedTest?.passed).toBe(false);
  });
});
