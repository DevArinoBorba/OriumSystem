import { randomBytes, randomUUID } from 'node:crypto';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { clientSchema, type Client, type Role } from '@orium/contracts';
import { buildApp } from '../apps/api/src/app.js';
import { loadConfig } from '../apps/api/src/config.js';
import { connectDatabase, assertApplicationDatabase, type Database } from '../apps/api/src/db.js';
import { migrateDatabase } from '../apps/api/src/migrate.js';
import { IDENTITY_LOCK, changeIdentity, provisionUser } from '../apps/api/src/identity.js';

const connectPoolClient = (dbInstance: Database) => dbInstance.pool.connect();
type ConnectedPoolClient = Awaited<ReturnType<typeof connectPoolClient>>;

// Fase 6 incremento 3 — autorização transacional de clientes
// (docs/PHASE6-CLIENT-AUTHORIZATION-CONTRACT.md). Real PostgreSQL orium_test only.
// Barriers observe real pg_locks filtered by the current database OID; no sleeps as proof.
// No mocks, no skips. Cleanup only of this run's own fixtures.

function testDatabaseUrl(key: string, expectedRole: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`${key} is required: integration tests need real PostgreSQL, without skips.`);
  const parsed = new URL(value);
  if (parsed.pathname !== '/orium_test' || parsed.username !== expectedRole ||
      !['postgres:', 'postgresql:'].includes(parsed.protocol) ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)) {
    throw new Error(`${key} must target local orium_test using ${expectedRole}.`);
  }
  return value;
}

type Fixture = { id: string; email: string };

// Waiters filtered by the current database OID so orium_test is isolated from orium_dev.
const ADVISORY_WAITERS = `SELECT count(*)::int AS n FROM pg_locks
  WHERE database = (SELECT oid FROM pg_database WHERE datname = current_database())
    AND locktype='advisory' AND classid=0 AND objid=$1 AND objsubid=1 AND NOT granted`;

describe('client transactional authorization against real PostgreSQL', () => {
  let app: FastifyInstance | undefined;
  let database: Database | undefined;
  let migrator: Database | undefined;
  let migrationUrl: string;
  const prefix = `client-auth-${randomUUID().slice(0, 8)}-`;
  const clientNamePrefix = `ClientAuth-${randomUUID().slice(0, 8)}-`;
  const password = randomBytes(24).toString('hex');
  const origin = 'http://127.0.0.1:5173';
  const userIds = new Set<string>();
  const clientIds = new Set<string>();
  const removedGrantsBySuite = new Set<string>();
  const insertedGrantsBySuite = new Set<string>();
  let rolesBefore: string[] = [];
  let identityEventsTotalBefore = 0;
  let policyAdmin: Fixture;
  let requestIndex = 0;

  const suiteClientName = (label: string) =>
    label.startsWith(clientNamePrefix) ? label : `${clientNamePrefix}${label}`;

  const db = () => { if (!database) throw new Error('Integration database was not initialized.'); return database; };
  const mig = () => { if (!migrator) throw new Error('Migrator connection was not initialized.'); return migrator; };
  const queryRolePermissionSnapshot = async (): Promise<string[]> => {
    const res = await mig().pool.query<{ role_id: string; permission_id: string }>(
      `SELECT role_id, permission_id FROM role_permission
       WHERE (role_id = 'administrator' AND permission_id IN ('clients.read', 'clients.write', 'clients.archive'))
          OR (role_id = 'collaborator' AND permission_id IN ('clients.read', 'clients.write', 'clients.archive'))
       ORDER BY role_id, permission_id`,
    );
    return res.rows.map((r) => `${r.role_id}:${r.permission_id}`);
  };
  const inject = (options: Omit<InjectOptions, 'remoteAddress'>) => {
    if (!app) throw new Error('Integration application was not initialized.');
    requestIndex += 1;
    return app.inject({ ...options, remoteAddress: `127.2.${Math.floor(requestIndex / 250)}.${(requestIndex % 250) + 1}` });
  };
  let fixtureSeq = 0;
  const fixture = async (role: Role): Promise<Fixture> => {
    fixtureSeq += 1;
    const email = `${prefix}${fixtureSeq}-${randomUUID().slice(0, 8)}@example.test`;
    const created = await provisionUser(db(), { name: `Client Auth ${role}`, email, password, role });
    userIds.add(created.id);
    return { id: created.id, email };
  };

  const login = (email: string) => inject({
    method: 'POST',
    url: '/api/v1/auth/sign-in/email',
    headers: { origin, 'content-type': 'application/json' },
    payload: { email, password },
  });

  const cookieFor = async (email: string) => {
    const response = await login(email);
    expect(response.statusCode).toBe(200);
    const values = response.headers['set-cookie'];
    const cookies = Array.isArray(values) ? values : values ? [values] : [];
    expect(cookies.length).toBeGreaterThan(0);
    return cookies.map((value) => value.split(';')[0]).join('; ');
  };

  const trackClientResponse = (res: Awaited<ReturnType<typeof inject>>) => {
    if (res.statusCode === 201) {
      try {
        const body = res.json() as { client?: { id?: string } };
        if (typeof body?.client?.id === 'string') {
          clientIds.add(body.client.id);
        }
      } catch {
        // Ignore parse failures on unexpected payloads
      }
    }
    return res;
  };

  const createClientHttp = async (cookie: string, label: string) => {
    const res = await inject({
      method: 'POST',
      url: '/api/v1/clients',
      headers: { origin, cookie, 'content-type': 'application/json' },
      payload: { name: suiteClientName(label) },
    });
    return trackClientResponse(res);
  };

  const updateClientHttp = async (cookie: string, id: string, version: number, label = 'Updated Name') => {
    const res = await inject({
      method: 'PATCH',
      url: `/api/v1/clients/${id}`,
      headers: { origin, cookie, 'content-type': 'application/json' },
      payload: { version, name: suiteClientName(label) },
    });
    return res;
  };

  const archiveClientHttp = async (cookie: string, id: string, version: number) => {
    const res = await inject({
      method: 'POST',
      url: `/api/v1/clients/${id}/archive`,
      headers: { origin, cookie, 'content-type': 'application/json' },
      payload: { version },
    });
    return res;
  };

  const restoreClientHttp = async (cookie: string, id: string, version: number) => {
    const res = await inject({
      method: 'POST',
      url: `/api/v1/clients/${id}/restore`,
      headers: { origin, cookie, 'content-type': 'application/json' },
      payload: { version },
    });
    return res;
  };

  const clientRow = async (id: string) => {
    const res = await (database?.pool ?? (() => { throw new Error('db not initialized'); })()).query<{
      name: string; notes: string; archived_at: Date | null; version: number; created_at: Date; updated_at: Date;
    }>('SELECT name, notes, archived_at, version, created_at, updated_at FROM client WHERE id = $1', [id]);
    return res.rows[0];
  };

  // Barrier: wait until at least `n` backends are blocked on IDENTITY_LOCK in orium_test.
  const waitForWaiters = async (n: number, timeoutMs = 15000) => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const current = (await mig().pool.query<{ n: number }>(ADVISORY_WAITERS, [IDENTITY_LOCK])).rows[0]!.n;
      if (current >= n) return current;
      if (Date.now() > deadline) throw new Error(`Barrier timeout: expected ${n} IDENTITY_LOCK waiters, saw ${current}`);
      await new Promise((resolve) => setImmediate(resolve));
    }
  };

  const holdIdentityLock = async (): Promise<ConnectedPoolClient> => {
    const client = await connectPoolClient(mig());
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [IDENTITY_LOCK]);
    return client;
  };

  const releaseIdentityLock = async (client: ConnectedPoolClient) => {
    try { await client.query('COMMIT'); } finally { client.release(); }
  };

  // Temporarily remove a permission from the administrator role (by role_id), verifying precondition and restoring snapshot in finally.
  const withRevokedPermission = async (permission: 'clients.write' | 'clients.archive', body: () => Promise<void>) => {
    const roleId = 'administrator';
    const key = `${roleId}:${permission}`;
    const snapshot = await mig().pool.query<{ role_id: string; permission_id: string }>(
      'SELECT role_id, permission_id FROM role_permission WHERE role_id = $1 AND permission_id = $2',
      [roleId, permission],
    );
    expect(snapshot.rowCount).toBe(1);
    const deleted = await mig().pool.query(
      'DELETE FROM role_permission WHERE role_id = $1 AND permission_id = $2',
      [roleId, permission],
    );
    expect(deleted.rowCount).toBe(1);
    if (deleted.rowCount === 1) removedGrantsBySuite.add(key);
    try {
      await body();
    } finally {
      for (const row of snapshot.rows) {
        await mig().pool.query(
          'INSERT INTO role_permission (role_id, permission_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [row.role_id, row.permission_id],
        );
      }
      removedGrantsBySuite.delete(key);
    }
    const restored = await mig().pool.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM role_permission WHERE role_id = $1 AND permission_id = $2',
      [roleId, permission],
    );
    if (restored.rows[0]!.n !== snapshot.rowCount) {
      throw new Error(`Permission ${permission} was not restored on ${roleId}`);
    }
  };

  beforeAll(async () => {
    const applicationUrl = testDatabaseUrl('TEST_DATABASE_URL', 'orium_app');
    migrationUrl = testDatabaseUrl('TEST_MIGRATION_DATABASE_URL', 'orium_migrator');
    const a = new URL(applicationUrl);
    const b = new URL(migrationUrl);
    if (a.hostname !== b.hostname || a.port !== b.port || a.pathname !== b.pathname) {
      throw new Error('Application and migration URLs must target the same test database.');
    }
    await migrateDatabase(migrationUrl);
    database = connectDatabase(applicationUrl);
    migrator = connectDatabase(migrationUrl);
    await assertApplicationDatabase(database);
    app = await buildApp({ database, logger: false, config: loadConfig({
      NODE_ENV: 'test', DATABASE_URL: applicationUrl,
      BETTER_AUTH_SECRET: randomBytes(32).toString('hex'), WEB_ORIGIN: origin,
      API_ORIGIN: 'http://127.0.0.1:3001', API_HOST: '127.0.0.1', API_PORT: '3001',
    }) });
    rolesBefore = await queryRolePermissionSnapshot();
    identityEventsTotalBefore = (await mig().pool.query<{ n: number }>('SELECT count(*)::int AS n FROM identity_event')).rows[0]!.n;
    policyAdmin = await fixture('administrator');
  }, 60000);

  afterAll(async () => {
    const report: Record<string, unknown> = {
      prefix: prefix.slice(0, 12),
      clientNamePrefix,
      at: new Date().toISOString(),
    };
    try {
      await app?.close();
    } finally {
      if (database && migrator) {
        try {
          // Restore only permission diffs originated by this suite if a test aborted mid-flight.
          if (removedGrantsBySuite.size > 0 || insertedGrantsBySuite.size > 0) {
            const txClient = await mig().pool.connect();
            try {
              await txClient.query('BEGIN');
              for (const key of removedGrantsBySuite) {
                const [roleId, permissionId] = key.split(':');
                await txClient.query(
                  'INSERT INTO role_permission (role_id, permission_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
                  [roleId, permissionId],
                );
              }
              for (const key of insertedGrantsBySuite) {
                const [roleId, permissionId] = key.split(':');
                await txClient.query(
                  'DELETE FROM role_permission WHERE role_id = $1 AND permission_id = $2',
                  [roleId, permissionId],
                );
              }
              await txClient.query('COMMIT');
              removedGrantsBySuite.clear();
              insertedGrantsBySuite.clear();
            } catch (err) {
              await txClient.query('ROLLBACK');
              throw err;
            } finally {
              txClient.release();
            }
          }

          const ids = [...userIds];
          const trackedClientIds = [...clientIds];
          const clientDeleted = await mig().pool.query(
            'DELETE FROM client WHERE id = ANY($1::uuid[]) OR name LIKE $2',
            [trackedClientIds, `${clientNamePrefix}%`],
          );
          report.clientsTrackedCount = trackedClientIds.length;
          report.clientsDeleted = clientDeleted.rowCount;

          const events = await mig().pool.query(
            'DELETE FROM identity_event WHERE actor_id = ANY($1::text[]) OR target_user_id = ANY($1::text[])',
            [ids],
          );
          report.eventsDeleted = events.rowCount;
          await mig().pool.query('DELETE FROM identity_event_subject WHERE user_id = ANY($1::text[])', [ids]);
          const users = await mig().pool.query('DELETE FROM auth_user WHERE id = ANY($1::text[])', [ids]);
          report.usersDeleted = users.rowCount;

          report.remainingClientsById = (await mig().pool.query<{ n: number }>(
            'SELECT count(*)::int AS n FROM client WHERE id = ANY($1::uuid[])',
            [trackedClientIds],
          )).rows[0]!.n;
          report.remainingClientsByPrefix = (await mig().pool.query<{ n: number }>(
            'SELECT count(*)::int AS n FROM client WHERE name LIKE $1',
            [`${clientNamePrefix}%`],
          )).rows[0]!.n;
          report.remainingEvents = (await mig().pool.query<{ n: number }>(
            'SELECT count(*)::int AS n FROM identity_event WHERE actor_id = ANY($1::text[]) OR target_user_id = ANY($1::text[])',
            [ids],
          )).rows[0]!.n;
          report.remainingUsers = (await mig().pool.query<{ n: number }>(
            'SELECT count(*)::int AS n FROM auth_user WHERE id = ANY($1::text[])',
            [ids],
          )).rows[0]!.n;

          const rolesAfter = await queryRolePermissionSnapshot();
          const identityEventsTotalAfter = (await mig().pool.query<{ n: number }>('SELECT count(*)::int AS n FROM identity_event')).rows[0]!.n;
          report.rolesBefore = rolesBefore;
          report.rolesAfter = rolesAfter;
          report.rolesEqual = JSON.stringify(rolesBefore) === JSON.stringify(rolesAfter);
          report.identityEventsTotalBefore = identityEventsTotalBefore;
          report.identityEventsTotalAfter = identityEventsTotalAfter;

          const { writeFileSync, mkdirSync } = await import('node:fs');
          mkdirSync('.local', { recursive: true });
          writeFileSync('.local/phase6-client-authorization-cleanup.json', JSON.stringify(report, null, 2) + '\n');
          expect(rolesAfter).toEqual(rolesBefore);
          expect(identityEventsTotalAfter).toBe(identityEventsTotalBefore);
        } finally {
          await database.pool.end();
          await migrator.pool.end();
        }
      }
    }
  }, 60000);

  // ── C1 ─────────────────────────────────────────────────────────────────────
  it('C1: administrator happy path — create/update/archive/restore with version increments and no identity_event', async () => {
    const admin = await fixture('administrator');
    const cookie = await cookieFor(admin.email);
    const eventsBefore = (await mig().pool.query<{ n: number }>('SELECT count(*)::int AS n FROM identity_event WHERE actor_id=$1', [admin.id])).rows[0]!.n;

    const created = await createClientHttp(cookie, 'C1 Create');
    expect(created.statusCode).toBe(201);
    const client = clientSchema.parse(created.json().client) as Client & { version: number };
    expect(client.archivedAt).toBeNull();
    expect(client.version).toBe(1);

    const updated = await updateClientHttp(cookie, client.id, client.version, 'C1 Updated');
    expect(updated.statusCode).toBe(200);
    const afterUpdate = clientSchema.parse(updated.json().client) as Client & { version: number };
    expect(afterUpdate.name).toBe(suiteClientName('C1 Updated'));
    expect(afterUpdate.version).toBe(2);

    const archived = await archiveClientHttp(cookie, client.id, afterUpdate.version);
    expect(archived.statusCode).toBe(200);
    const afterArchive = clientSchema.parse(archived.json().client) as Client & { version: number };
    expect(afterArchive.archivedAt).not.toBeNull();
    expect(afterArchive.version).toBe(3);

    const restored = await restoreClientHttp(cookie, client.id, afterArchive.version);
    expect(restored.statusCode).toBe(200);
    const afterRestore = clientSchema.parse(restored.json().client) as Client & { version: number };
    expect(afterRestore.archivedAt).toBeNull();
    expect(afterRestore.version).toBe(4);

    const eventsAfter = (await mig().pool.query<{ n: number }>('SELECT count(*)::int AS n FROM identity_event WHERE actor_id=$1', [admin.id])).rows[0]!.n;
    expect(eventsAfter).toBe(eventsBefore);

    const row = await clientRow(client.id);
    expect(row).toMatchObject({ name: suiteClientName('C1 Updated'), version: 4 });
    expect(row!.archived_at).toBeNull();
  }, 60000);

  // ── C2 ─────────────────────────────────────────────────────────────────────
  it('C2: anonymous 401, collaborator 403, granular permission admin — 403 on archive/restore when clients.archive removed', async () => {
    const admin = await fixture('administrator');
    const cookie = await cookieFor(admin.email);
    const created = await createClientHttp(cookie, 'C2 Granular');
    expect(created.statusCode).toBe(201);
    const client = clientSchema.parse(created.json().client) as Client & { version: number };

    // Anonymous requests (no cookie) on all 4 mutations must return 401 without side effects.
    expect(trackClientResponse(await inject({
      method: 'POST', url: '/api/v1/clients',
      headers: { origin, 'content-type': 'application/json' },
      payload: { name: suiteClientName('C2 Anon Create') },
    })).statusCode).toBe(401);
    expect((await inject({
      method: 'PATCH', url: `/api/v1/clients/${client.id}`,
      headers: { origin, 'content-type': 'application/json' },
      payload: { version: client.version, name: suiteClientName('C2 Anon Update') },
    })).statusCode).toBe(401);
    expect((await inject({
      method: 'POST', url: `/api/v1/clients/${client.id}/archive`,
      headers: { origin, 'content-type': 'application/json' },
      payload: { version: client.version },
    })).statusCode).toBe(401);
    expect((await inject({
      method: 'POST', url: `/api/v1/clients/${client.id}/restore`,
      headers: { origin, 'content-type': 'application/json' },
      payload: { version: client.version },
    })).statusCode).toBe(401);

    // Without clients.archive on administrator role: archive/restore 403, while clients.write survives.
    await withRevokedPermission('clients.archive', async () => {
      const archived = await archiveClientHttp(cookie, client.id, client.version);
      expect(archived.statusCode).toBe(403);
      const restored = await restoreClientHttp(cookie, client.id, client.version);
      expect(restored.statusCode).toBe(403);
      // clients.write is untouched: update and create still authorized (createClientHttp tracks the created ID).
      expect((await updateClientHttp(cookie, client.id, client.version, 'C2 Granular Updated')).statusCode).toBe(200);
      expect((await createClientHttp(cookie, 'C2 Granular Write')).statusCode).toBe(201);
    });
  }, 60000);

  it('C2: removing clients.write denies create/update 403 and a collaborator (even with clients.write) is 403 on all 4 mutations', async () => {
    const admin = await fixture('administrator');
    const cookie = await cookieFor(admin.email);
    const created = await createClientHttp(cookie, 'C2 Write');
    expect(created.statusCode).toBe(201);
    const client = clientSchema.parse(created.json().client) as Client & { version: number };

    await withRevokedPermission('clients.write', async () => {
      expect((await createClientHttp(cookie, 'C2 Denied Write')).statusCode).toBe(403);
      expect((await updateClientHttp(cookie, client.id, client.version, 'C2 Denied Update')).statusCode).toBe(403);
      // clients.archive remains functional while clients.write is revoked.
      const archRes = await archiveClientHttp(cookie, client.id, client.version);
      expect(archRes.statusCode).toBe(200);
      const restRes = await restoreClientHttp(cookie, client.id, client.version + 1);
      expect(restRes.statusCode).toBe(200);
    });

    const currentVersion = client.version + 2;

    // Default collaborator and collaborator explicitly granted clients.write in role_permission: both must receive 403.
    const collaborator = await fixture('collaborator');
    const collabCookie = await cookieFor(collaborator.email);
    for (const op of [
      await createClientHttp(collabCookie, 'C2 Collab Default'),
      await updateClientHttp(collabCookie, client.id, currentVersion, 'C2 Collab Default Update'),
      await archiveClientHttp(collabCookie, client.id, currentVersion),
      await restoreClientHttp(collabCookie, client.id, currentVersion),
    ]) {
      expect(op.statusCode).toBe(403);
    }

    const collabGrantKey = 'collaborator:clients.write';
    const preGrantCount = (await mig().pool.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM role_permission WHERE role_id = $1 AND permission_id = $2',
      ['collaborator', 'clients.write'],
    )).rows[0]!.n;
    expect(preGrantCount).toBe(0);

    const insertedGrant = await mig().pool.query(
      'INSERT INTO role_permission (role_id, permission_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      ['collaborator', 'clients.write'],
    );
    expect(insertedGrant.rowCount).toBe(1);
    if (insertedGrant.rowCount === 1) insertedGrantsBySuite.add(collabGrantKey);
    try {
      for (const op of [
        await createClientHttp(collabCookie, 'C2 Collab Granted'),
        await updateClientHttp(collabCookie, client.id, currentVersion, 'C2 Collab Granted Update'),
        await archiveClientHttp(collabCookie, client.id, currentVersion),
        await restoreClientHttp(collabCookie, client.id, currentVersion),
      ]) {
        expect(op.statusCode).toBe(403);
      }
    } finally {
      if (insertedGrant.rowCount === 1 && preGrantCount === 0) {
        await mig().pool.query(
          'DELETE FROM role_permission WHERE role_id = $1 AND permission_id = $2',
          ['collaborator', 'clients.write'],
        );
      }
      insertedGrantsBySuite.delete(collabGrantKey);
    }
    const collabStill = await mig().pool.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM role_permission WHERE role_id = $1 AND permission_id = $2',
      ['collaborator', 'clients.write'],
    );
    expect(collabStill.rows[0]!.n).toBe(preGrantCount);
  }, 60000);

  it('C2: revoked/inactive session is refused 401 before every mutation and a new login fails 401', async () => {
    const admin = await fixture('administrator');
    const cookie = await cookieFor(admin.email);
    const created = await createClientHttp(cookie, 'C2 Revoked');
    expect(created.statusCode).toBe(201);
    const client = clientSchema.parse(created.json().client) as Client & { version: number };

    await changeIdentity(db(), policyAdmin.id, admin.id, { active: false });
    // Old cookie must not resurface (401 on all 4 mutations) and new login must fail (401).
    expect((await createClientHttp(cookie, 'C2 Revoked Create')).statusCode).toBe(401);
    expect((await updateClientHttp(cookie, client.id, client.version, 'C2 Revoked Update')).statusCode).toBe(401);
    expect((await archiveClientHttp(cookie, client.id, client.version)).statusCode).toBe(401);
    expect((await restoreClientHttp(cookie, client.id, client.version)).statusCode).toBe(401);
    expect((await login(admin.email)).statusCode).toBe(401);
    // Previous requests made no change: version intact.
    const row = await clientRow(client.id);
    expect(row!.version).toBe(client.version);
  }, 60000);

  // ── C3 ─────────────────────────────────────────────────────────────────────
  it('C3: revocation ordered first — deactivation before PATCH update causes rollback 401 and keeps prior snapshot', async () => {
    const admin = await fixture('administrator');
    const cookie = await cookieFor(admin.email);
    const created = await createClientHttp(cookie, 'C3 Update Target');
    expect(created.statusCode).toBe(201);
    const client = clientSchema.parse(created.json().client) as Client & { version: number };
    const beforeSnapshot = await clientRow(client.id);

    const holder = await holdIdentityLock();
    let released = false;
    const pending: Promise<unknown>[] = [];
    try {
      const revocation = changeIdentity(db(), policyAdmin.id, admin.id, { active: false });
      pending.push(revocation);
      await waitForWaiters(1);
      const write = updateClientHttp(cookie, client.id, client.version, 'C3 Should Not Persist');
      pending.push(write);
      await waitForWaiters(2);
      await releaseIdentityLock(holder);
      released = true;

      await revocation;
      const res = await write;
      expect(res.statusCode).toBe(401);
    } finally {
      if (!released) await releaseIdentityLock(holder);
      await Promise.allSettled(pending);
    }

    const row = await clientRow(client.id);
    expect(row).toEqual(beforeSnapshot);
  }, 60000);

  it('C3: revocation ordered first — demotion before POST create rolls back to no row (403)', async () => {
    const admin = await fixture('administrator');
    const cookie = await cookieFor(admin.email);
    const deniedLabel = 'C3 Demoted Create';

    const holder = await holdIdentityLock();
    let released = false;
    const pending: Promise<unknown>[] = [];
    try {
      const revocation = changeIdentity(db(), policyAdmin.id, admin.id, { role: 'collaborator' });
      pending.push(revocation);
      await waitForWaiters(1);
      const write = createClientHttp(cookie, deniedLabel);
      pending.push(write);
      await waitForWaiters(2);
      await releaseIdentityLock(holder);
      released = true;

      await revocation;
      const res = await write;
      expect(res.statusCode).toBe(403);
    } finally {
      if (!released) await releaseIdentityLock(holder);
      await Promise.allSettled(pending);
    }

    const found = await mig().pool.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM client WHERE name = $1',
      [suiteClientName(deniedLabel)],
    );
    expect(found.rows[0]!.n).toBe(0);
  }, 60000);

  it('C3: revocation ordered first — deactivation before archive and demotion before restore on genuinely archived client roll back (401/403) preserving full snapshots', async () => {
    // 1. Archive barrier test against active client
    const adminArchive = await fixture('administrator');
    const cookieArchive = await cookieFor(adminArchive.email);
    const createdActive = await createClientHttp(cookieArchive, 'C3 Archive Target');
    expect(createdActive.statusCode).toBe(201);
    const activeClient = clientSchema.parse(createdActive.json().client) as Client & { version: number };
    const activeSnapshot = await clientRow(activeClient.id);
    expect(activeSnapshot!.archived_at).toBeNull();
    expect(activeSnapshot!.version).toBe(1);

    const holderArchive = await holdIdentityLock();
    let releasedArchive = false;
    const pendingArchive: Promise<unknown>[] = [];
    try {
      const revocation = changeIdentity(db(), policyAdmin.id, adminArchive.id, { active: false });
      pendingArchive.push(revocation);
      await waitForWaiters(1);
      const archive = archiveClientHttp(cookieArchive, activeClient.id, activeClient.version);
      pendingArchive.push(archive);
      await waitForWaiters(2);
      await releaseIdentityLock(holderArchive);
      releasedArchive = true;

      await revocation;
      const archiveRes = await archive;
      expect(archiveRes.statusCode).toBe(401);
    } finally {
      if (!releasedArchive) await releaseIdentityLock(holderArchive);
      await Promise.allSettled(pendingArchive);
    }
    expect(await clientRow(activeClient.id)).toEqual(activeSnapshot);

    // 2. Restore barrier test against a genuinely archived client (archived_at != null, version=2)
    const adminRestore = await fixture('administrator');
    const cookieRestore = await cookieFor(adminRestore.email);
    const createdForRestore = await createClientHttp(cookieRestore, 'C3 Restore Target');
    expect(createdForRestore.statusCode).toBe(201);
    const baseClient = clientSchema.parse(createdForRestore.json().client) as Client & { version: number };
    const archivedSetup = await archiveClientHttp(cookieRestore, baseClient.id, baseClient.version);
    expect(archivedSetup.statusCode).toBe(200);
    const archivedClient = clientSchema.parse(archivedSetup.json().client) as Client & { version: number };
    const archivedSnapshot = await clientRow(archivedClient.id);
    expect(archivedSnapshot!.archived_at).not.toBeNull();
    expect(archivedSnapshot!.version).toBe(2);

    const holderRestore = await holdIdentityLock();
    let releasedRestore = false;
    const pendingRestore: Promise<unknown>[] = [];
    try {
      const demotion = changeIdentity(db(), policyAdmin.id, adminRestore.id, { role: 'collaborator' });
      pendingRestore.push(demotion);
      await waitForWaiters(1);
      const restore = restoreClientHttp(cookieRestore, archivedClient.id, archivedClient.version);
      pendingRestore.push(restore);
      await waitForWaiters(2);
      await releaseIdentityLock(holderRestore);
      releasedRestore = true;

      await demotion;
      const restoreRes = await restore;
      expect(restoreRes.statusCode).toBe(403);
    } finally {
      if (!releasedRestore) await releaseIdentityLock(holderRestore);
      await Promise.allSettled(pendingRestore);
    }
    expect(await clientRow(archivedClient.id)).toEqual(archivedSnapshot);

    // Confirm neither mutating admin generated any identity_event during client operations.
    const clientAdminEvents = await mig().pool.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM identity_event WHERE actor_id = ANY($1::text[])',
      [[adminArchive.id, adminRestore.id]],
    );
    expect(clientAdminEvents.rows[0]!.n).toBe(0);
  }, 60000);

  // ── C4 ─────────────────────────────────────────────────────────────────────
  it('C4: mutation ordered first — write commits legitimately before later revocation, and revocation still completes', async () => {
    const admin = await fixture('administrator');
    const cookie = await cookieFor(admin.email);
    const existing = await createClientHttp(cookie, 'C4 Target');
    expect(existing.statusCode).toBe(201);
    const inserted = clientSchema.parse(existing.json().client) as Client & { version: number };

    const holder = await holdIdentityLock();
    let released = false;
    const pending: Promise<unknown>[] = [];
    try {
      const write = updateClientHttp(cookie, inserted.id, inserted.version, 'C4 Legitimate Commit');
      pending.push(write);
      await waitForWaiters(1);
      const revocation = changeIdentity(db(), policyAdmin.id, admin.id, { active: false });
      pending.push(revocation);
      await waitForWaiters(2);
      await releaseIdentityLock(holder);
      released = true;

      const writeRes = await write;
      expect(writeRes.statusCode).toBe(200);
      await revocation;
    } finally {
      if (!released) await releaseIdentityLock(holder);
      await Promise.allSettled(pending);
    }

    const row = await clientRow(inserted.id);
    expect(row).toMatchObject({ name: suiteClientName('C4 Legitimate Commit'), version: inserted.version + 1 });
    expect((await updateClientHttp(cookie, inserted.id, inserted.version + 1, 'C4 Post Revocation')).statusCode).toBe(401);
  }, 60000);

  // ── C5 ─────────────────────────────────────────────────────────────────────
  it('C5: version conflict 409 and unknown id 404 rollback without data change; invalid input 400', async () => {
    const admin = await fixture('administrator');
    const cookie = await cookieFor(admin.email);
    const created = await createClientHttp(cookie, 'C5 Conflict');
    expect(created.statusCode).toBe(201);
    const client = clientSchema.parse(created.json().client) as Client & { version: number };
    const initialSnapshot = await clientRow(client.id);

    for (const op of [
      updateClientHttp(cookie, client.id, client.version + 99, 'C5 Stale Update'),
      archiveClientHttp(cookie, client.id, client.version + 99),
      restoreClientHttp(cookie, client.id, client.version + 99),
    ]) {
      const res = await op;
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe('CLIENT_VERSION_CONFLICT');
    }
    expect(await clientRow(client.id)).toEqual(initialSnapshot);

    const missing = randomUUID();
    expect((await updateClientHttp(cookie, missing, 1, 'C5 Missing')).statusCode).toBe(404);
    expect((await archiveClientHttp(cookie, missing, 1)).statusCode).toBe(404);
    expect((await restoreClientHttp(cookie, missing, 1)).statusCode).toBe(404);

    // Invalid payload (zero/non-positive version) is rejected 400 without side effects.
    const zero = await inject({
      method: 'PATCH', url: `/api/v1/clients/${client.id}`,
      headers: { origin, cookie, 'content-type': 'application/json' },
      payload: { version: 0, name: suiteClientName('Zero') },
    });
    expect(zero.statusCode).toBe(400);
    expect(await clientRow(client.id)).toEqual(initialSnapshot);

    // Unknown body fields are rejected by .strict().
    const extra = await inject({
      method: 'PATCH', url: `/api/v1/clients/${client.id}`,
      headers: { origin, cookie, 'content-type': 'application/json' },
      payload: { version: client.version, name: suiteClientName('Extra'), unexpected: true },
    });
    expect(extra.statusCode).toBe(400);
    expect(await clientRow(client.id)).toEqual(initialSnapshot);
  }, 60000);
});

