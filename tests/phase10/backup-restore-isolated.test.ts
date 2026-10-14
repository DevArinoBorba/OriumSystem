import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  assertDatabaseIsolation,
  verifyRuntimeContainerIsolation,
  verifyBackupArtifact,
  verifyRestoredDatabaseSchema,
  CANONICAL_ROLE_PERMISSIONS_HASH,
  EXPECTED_PERMISSIONS_COUNT,
  MANDATORY_APPLICATION_TABLES,
} from '../../deploy/verification/backup-restore-verifier.js';

describe('Phase 10: Isolated Backup & Restore Verification (deploy/verification)', () => {
  const sandboxDir = path.resolve(process.cwd(), '.local', 'phase10', 'sandbox-backup-test');
  const validBackupPath = path.join(sandboxDir, 'valid_backup.sql');
  const emptyBackupPath = path.join(sandboxDir, 'empty_backup.sql');
  const dangerousBackupPath = path.join(sandboxDir, 'dangerous_backup.sql');

  let validBackupHash = '';

  beforeAll(async () => {
    await fs.mkdir(sandboxDir, { recursive: true });

    // 1. Cria dump seguro e válido
    const validContent = Buffer.from(
      `-- Orium System Isolated Backup Dump
CREATE TABLE IF NOT EXISTS public.client (id UUID PRIMARY KEY, name VARCHAR(160));
CREATE TABLE IF NOT EXISTS public.role_permission (role_id VARCHAR(50), permission_id VARCHAR(50), PRIMARY KEY(role_id, permission_id));
-- End of dump
`,
      'utf8'
    );
    await fs.writeFile(validBackupPath, validContent);
    validBackupHash = createHash('sha256').update(validContent).digest('hex');

    // 2. Cria dump vazio
    await fs.writeFile(emptyBackupPath, Buffer.alloc(0));

    // 3. Cria dump perigoso com comando destrutivo contra DEV
    const dangerousContent = Buffer.from(
      `-- Malicious dump trying to wipe DEV
DROP DATABASE IF EXISTS orium_dev;
CREATE TABLE client (id UUID);
`,
      'utf8'
    );
    await fs.writeFile(dangerousBackupPath, dangerousContent);
  });

  afterAll(async () => {
    try {
      await fs.rm(sandboxDir, { recursive: true, force: true });
    } catch {}
  });

  describe('Skill: Accidental Data Loss Prevention (Isolation Gates)', () => {
    it('strictly forbids targeting DEV database port 55432 or db orium_dev', () => {
      const devUrl = 'postgresql://orium_app:secret@127.0.0.1:55432/orium_dev';
      const check = assertDatabaseIsolation(devUrl);
      expect(check.isIsolated).toBe(false);
      expect(check.violations.some((v) => v.includes('55432'))).toBe(true);
      expect(check.violations.some((v) => v.includes('orium_dev'))).toBe(true);
    });

    it('strictly forbids targeting TEST database port 5433 or db orium_test', () => {
      const testUrl = 'postgresql://orium_app:secret@127.0.0.1:5433/orium_test';
      const check = assertDatabaseIsolation(testUrl);
      expect(check.isIsolated).toBe(false);
      expect(check.violations.some((v) => v.includes('5433'))).toBe(true);
      expect(check.violations.some((v) => v.includes('orium_test'))).toBe(true);
    });

    it('strictly forbids targeting production database name orium_production or orium_prod', () => {
      const prodUrl = 'postgresql://orium_app:secret@127.0.0.1:5434/orium_production';
      const check1 = assertDatabaseIsolation(prodUrl);
      expect(check1.isIsolated).toBe(false);
      expect(check1.violations.some((v) => v.includes('orium_production'))).toBe(true);

      const prodShortUrl = 'postgresql://orium_app:secret@127.0.0.1:5434/orium_prod';
      const check2 = assertDatabaseIsolation(prodShortUrl);
      expect(check2.isIsolated).toBe(false);
      expect(check2.violations.some((v) => v.includes('orium_prod'))).toBe(true);
    });

    it('strictly forbids default postgres or template databases', () => {
      const defaultDbUrl = 'postgresql://orium_app:secret@127.0.0.1:5434/postgres';
      const check = assertDatabaseIsolation(defaultDbUrl);
      expect(check.isIsolated).toBe(false);
      expect(check.violations.some((v) => v.includes('postgres'))).toBe(true);
    });

    it('strictly forbids non-postgres protocols', () => {
      const nonPgUrl = 'mysql://sandbox_user:secret@127.0.0.1:5434/sandbox_test';
      const check = assertDatabaseIsolation(nonPgUrl);
      expect(check.isIsolated).toBe(false);
      expect(check.violations.some((v) => v.includes('Protocolo'))).toBe(true);
    });

    it('strictly forbids non-local remote hosts for sandbox tests', () => {
      const remoteUrl = 'postgresql://orium_app:secret@187.77.251.41:5434/sandbox_restore';
      const check = assertDatabaseIsolation(remoteUrl);
      expect(check.isIsolated).toBe(false);
      expect(check.violations.some((v) => v.includes('187.77.251.41'))).toBe(true);
    });

    it('approves a genuine, isolated sandbox database URL with correct prefix and port', () => {
      const sandboxUrl = 'postgresql://sandbox_user:secret@127.0.0.1:5434/sandbox_restore_verify_20261014';
      const check = assertDatabaseIsolation(sandboxUrl);
      expect(check.isIsolated).toBe(true);
      expect(check.violations).toHaveLength(0);
      expect(check.port).toBe(5434);
      expect(check.dbName).toBe('sandbox_restore_verify_20261014');
    });

    it('verifies runtime container isolation and enforces project/phase/role labels', () => {
      // 1. Container válido com labels, volume efêmero e ID único
      const validRuntime = verifyRuntimeContainerIsolation({
        containerId: 'sandbox-cont-12345',
        labels: {
          project: 'orium',
          phase: '10',
          role: 'qa-sandbox',
        },
        volumeName: 'orium-qa-sandbox-vol-20261014-abc',
        hostPort: 54400,
      }, ['c7bb848812b9', 'c1dda95a8d1b']);
      expect(validRuntime.isIsolated).toBe(true);
      expect(validRuntime.violations).toHaveLength(0);

      // 2. Container rejeitado por colisão com container ID de DEV/TEST
      const collidedRuntime = verifyRuntimeContainerIsolation({
        containerId: 'c7bb848812b9', // DEV container ID
        labels: {
          project: 'orium',
          phase: '10',
          role: 'qa-sandbox',
        },
        volumeName: 'orium-qa-sandbox-vol-20261014-abc',
      }, ['c7bb848812b9', 'c1dda95a8d1b']);
      expect(collidedRuntime.isIsolated).toBe(false);
      expect(collidedRuntime.violations.some((v) => v.includes('DEV/TEST'))).toBe(true);

      // 3. Container rejeitado por ausência de labels obrigatórias
      const missingLabelsRuntime = verifyRuntimeContainerIsolation({
        containerId: 'sandbox-cont-unknown',
        labels: {},
      });
      expect(missingLabelsRuntime.isIsolated).toBe(false);
      expect(missingLabelsRuntime.violations.some((v) => v.includes('project'))).toBe(true);
      expect(missingLabelsRuntime.violations.some((v) => v.includes('phase'))).toBe(true);
      expect(missingLabelsRuntime.violations.some((v) => v.includes('role'))).toBe(true);

      // 4. Container rejeitado por tentar montar volume de dados protegido
      const dangerousVolumeRuntime = verifyRuntimeContainerIsolation({
        containerId: 'sandbox-cont-safe',
        labels: { project: 'orium', phase: '10', role: 'qa-sandbox' },
        volumeName: 'orium-dev',
      });
      expect(dangerousVolumeRuntime.isIsolated).toBe(false);
      expect(dangerousVolumeRuntime.violations.some((v) => v.includes('volume protegido'))).toBe(true);
    });
  });

  describe('Backup Artifact Verification', () => {
    it('authenticates a valid backup file with matching sha256 checksum', async () => {
      const result = await verifyBackupArtifact(validBackupPath, validBackupHash);
      expect(result.valid).toBe(true);
      expect(result.sha256).toBe(validBackupHash);
      expect(result.sizeBytes).toBeGreaterThan(0);
      expect(result.violations).toHaveLength(0);
    });

    it('fails closed when backup file is empty (0 bytes)', async () => {
      const result = await verifyBackupArtifact(emptyBackupPath);
      expect(result.valid).toBe(false);
      expect(result.violations.some((v) => v.includes('0 bytes'))).toBe(true);
    });

    it('fails closed on checksum mismatch (tampered backup)', async () => {
      const fakeHash = '0000000000000000000000000000000000000000000000000000000000000000';
      const result = await verifyBackupArtifact(validBackupPath, fakeHash);
      expect(result.valid).toBe(false);
      expect(result.violations.some((v) => v.includes('diverge'))).toBe(true);
    });

    it('detects dangerous destructive SQL inside dump targeting active databases', async () => {
      const result = await verifyBackupArtifact(dangerousBackupPath);
      expect(result.valid).toBe(false);
      expect(result.violations.some((v) => v.includes('DROP DATABASE'))).toBe(true);
    });
  });

  describe('Restore Schema & Grants Verification', () => {
    it('verifies a fully restored schema with all mandatory tables and 23 canonical grants', async () => {
      // Mock de conexão de query com o estado perfeito pós-restore
      const mockQuery = async (sql: string) => {
        if (sql.includes('information_schema.tables')) {
          return {
            rows: MANDATORY_APPLICATION_TABLES.map((t) => ({ table_name: t })),
          };
        }
        if (sql.includes('role_permission')) {
          // Os 23 grants canônicos que geram exatamente o hash CANONICAL_ROLE_PERMISSIONS_HASH
          const canonicalRolesAndPerms = [
            ['administrator', 'clients.archive'],
            ['administrator', 'clients.read'],
            ['administrator', 'clients.write'],
            ['administrator', 'demands.read'],
            ['administrator', 'demands.write'],
            ['administrator', 'materials.archive'],
            ['administrator', 'materials.read'],
            ['administrator', 'materials.write'],
            ['administrator', 'protected.read'],
            ['administrator', 'roles.manage'],
            ['administrator', 'tasks.execute'],
            ['administrator', 'tasks.manage'],
            ['administrator', 'tasks.read'],
            ['administrator', 'tasks.review'],
            ['administrator', 'users.create'],
            ['administrator', 'users.deactivate'],
            ['administrator', 'users.read'],
            ['collaborator', 'demands.read'],
            ['collaborator', 'materials.read'],
            ['collaborator', 'materials.write'],
            ['collaborator', 'protected.read'],
            ['collaborator', 'tasks.execute'],
            ['collaborator', 'tasks.read'],
          ];
          return {
            rows: canonicalRolesAndPerms.map(([r, p]) => ({ role_id: r, permission_id: p })),
          };
        }
        return { rows: [] };
      };

      const result = await verifyRestoredDatabaseSchema(mockQuery);
      expect(result.restoredSuccessfully).toBe(true);
      expect(result.tablesVerified).toBe(true);
      expect(result.missingTables).toHaveLength(0);
      expect(result.grantsCount).toBe(EXPECTED_PERMISSIONS_COUNT);
      expect(result.grantsFingerprint).toBe(CANONICAL_ROLE_PERMISSIONS_HASH);
      expect(result.grantsMatchCanonical).toBe(true);
    });

    it('fails closed when required application tables are missing from restored database', async () => {
      const incompleteQuery = async (sql: string) => {
        if (sql.includes('information_schema.tables')) {
          // Omite auth_user e notification
          return {
            rows: [{ table_name: 'client' }, { table_name: 'demand' }],
          };
        }
        return { rows: [] };
      };

      const result = await verifyRestoredDatabaseSchema(incompleteQuery);
      expect(result.restoredSuccessfully).toBe(false);
      expect(result.tablesVerified).toBe(false);
      expect(result.missingTables).toContain('auth_user');
      expect(result.missingTables).toContain('notification');
    });

    it('fails closed when restored role permissions diverge from canonical baseline', async () => {
      const corruptedGrantsQuery = async (sql: string) => {
        if (sql.includes('information_schema.tables')) {
          return { rows: MANDATORY_APPLICATION_TABLES.map((t) => ({ table_name: t })) };
        }
        if (sql.includes('role_permission')) {
          // Apenas 2 grants em vez de 23
          return {
            rows: [
              { role_id: 'administrator', permission_id: 'protected.read' },
              { role_id: 'collaborator', permission_id: 'protected.read' },
            ],
          };
        }
        return { rows: [] };
      };

      const result = await verifyRestoredDatabaseSchema(corruptedGrantsQuery);
      expect(result.restoredSuccessfully).toBe(false);
      expect(result.grantsMatchCanonical).toBe(false);
      expect(result.grantsCount).toBe(2);
      expect(result.violations.some((v) => v.includes('Grants divergentes'))).toBe(true);
    });
  });
});
