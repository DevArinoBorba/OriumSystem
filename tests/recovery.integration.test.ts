import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Role } from '@orium/contracts';
import { buildApp } from '../apps/api/src/app.js';
import { loadConfig } from '../apps/api/src/config.js';
import { connectDatabase, assertApplicationDatabase, type Database } from '../apps/api/src/db.js';
import { migrateDatabase } from '../apps/api/src/migrate.js';
import { provisionUser, changeIdentity, IDENTITY_LOCK } from '../apps/api/src/identity.js';
import { recoverUserAccess } from '../apps/api/src/recovery.js';
import { AppError } from '../apps/api/src/errors.js';

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

interface AuditBaseline {
  eventsCount: number;
  eventsFingerprint: string;
  subjectsCount: number;
  subjectsFingerprint: string;
}

interface GrantRow {
  role_id: string;
  permission_id: string;
}

async function snapshotIdentityAudit(db: Database): Promise<AuditBaseline> {
  const eventsRes = await db.pool.query(
    'SELECT * FROM identity_event ORDER BY id'
  );
  const subjectsRes = await db.pool.query(
    'SELECT * FROM identity_event_subject ORDER BY event_id, user_id'
  );
  return {
    eventsCount: eventsRes.rows.length,
    eventsFingerprint: createHash('sha256').update(JSON.stringify(eventsRes.rows)).digest('hex'),
    subjectsCount: subjectsRes.rows.length,
    subjectsFingerprint: createHash('sha256').update(JSON.stringify(subjectsRes.rows)).digest('hex'),
  };
}

async function verifyIdentityAudit(db: Database, baseline: AuditBaseline): Promise<boolean> {
  const current = await snapshotIdentityAudit(db);
  return (
    current.eventsCount === baseline.eventsCount &&
    current.eventsFingerprint === baseline.eventsFingerprint &&
    current.subjectsCount === baseline.subjectsCount &&
    current.subjectsFingerprint === baseline.subjectsFingerprint
  );
}

async function snapshotGrants(db: Database): Promise<GrantRow[]> {
  const res = await db.pool.query<GrantRow>(
    'SELECT role_id, permission_id FROM role_permission ORDER BY role_id, permission_id'
  );
  return res.rows;
}

async function verifyGrants(db: Database, baseline: GrantRow[]): Promise<boolean> {
  const current = await snapshotGrants(db);
  const baseKeys = baseline.map((g) => `${g.role_id}:::${g.permission_id}`).sort();
  const currKeys = current.map((g) => `${g.role_id}:::${g.permission_id}`).sort();
  return (
    baseKeys.length === currKeys.length &&
    baseKeys.every((k, idx) => k === currKeys[idx])
  );
}

describe('recoverUserAccess against real PostgreSQL', () => {
  let app: FastifyInstance | undefined;
  let database: Database | undefined;
  let migrator: Database | undefined;
  let migrationUrl: string;
  let admin: { id: string; email: string };
  let admin2: { id: string; email: string };
  let collaborator: { id: string; email: string };
  let target: { id: string; email: string };
  const trackedUserIds = new Set<string>();
  let baselineAudit: AuditBaseline;
  let baselineGrants: GrantRow[];
  const prefix = `recovery-${randomUUID()}-`;
  // Valid passwords per recoveryInputSchema/createUserSchema (min 1 / max 128, per ADR-0007).
  const oldPassword = randomBytes(24).toString('hex');
  const newPassword = randomBytes(24).toString('hex');
  const origin = 'http://127.0.0.1:5173';
  let requestIndex = 0;
  const db = () => {
    if (!database) throw new Error('Integration database was not initialized.');
    return database;
  };
  const inject = (options: InjectOptions) => {
    if (!app) throw new Error('Integration application was not initialized.');
    // Separate client IPs keep unrelated login scenarios outside the per-IP rate limit.
    requestIndex += 1;
    return app.inject({ ...options, remoteAddress: `127.0.${Math.floor(requestIndex / 250)}.${requestIndex % 250 + 1}` });
  };
  const fixture = async (role: Role) => {
    const email = `${prefix}${randomUUID()}@example.test`;
    const created = await provisionUser(db(), { name: `Recovery ${role}`, email, password: oldPassword, role });
    trackedUserIds.add(created.id);
    return { ...created, email };
  };
  const login = (email: string, password: string) => inject({ method: 'POST', url: '/api/v1/auth/sign-in/email',
    headers: { origin, 'content-type': 'application/json' }, payload: { email, password } });
  const cookieFor = async (email: string, password = oldPassword) => {
    const response = await login(email, password);
    expect(response.statusCode).toBe(200);
    const values = response.headers['set-cookie'];
    const cookies = Array.isArray(values) ? values : values ? [values] : [];
    expect(cookies.length).toBeGreaterThan(0);
    return cookies.map((value) => value.split(';')[0]).join('; ');
  };
  const me = (cookie: string) => inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } });
  const recover = (input: unknown) => recoverUserAccess(db(), input);
  const targetSessionCount = async () =>
    (await db().pool.query('SELECT count(*)::int AS n FROM auth_session WHERE user_id=$1', [target.id])).rows[0].n;
  const activeAdminCount = async () =>
    (await db().pool.query(
      "SELECT count(*)::int AS n FROM auth_user u JOIN user_role r ON r.user_id=u.id WHERE u.active AND r.role_id='administrator'",
    )).rows[0].n;
  const roleOf = async (id: string) =>
    (await db().pool.query('SELECT role_id FROM user_role WHERE user_id=$1', [id])).rows[0]?.role_id;

  // A denial must leave the target untouched: same password hash, same session set, and a
  // pre-existing session keeps working. Hash and sessions are compared immediately before
  // and after the refused recovery; login checks run only afterwards.
  const passwordHashOf = async (userId: string) =>
    (await db().pool.query(
      "SELECT password FROM auth_account WHERE user_id=$1 AND provider_id='credential'",
      [userId],
    )).rows[0]?.password as string | undefined;
  const expectDenyUnchanged = async (input: unknown, targetInactive = false) => {
    // Optionally prove an existing session survives the refused recovery.
    let existingCookie: string | null = null;
    if (!targetInactive) existingCookie = await cookieFor(target.email, oldPassword);
    const hashBefore = await passwordHashOf(target.id);
    const sessionsBefore = await targetSessionCount();
    await expect(recover(input)).rejects.toThrow();
    // No partial effect: hash and sessions are byte-for-byte the same after the refusal.
    expect(await passwordHashOf(target.id)).toBe(hashBefore);
    expect(await targetSessionCount()).toBe(sessionsBefore);
    if (existingCookie) expect((await me(existingCookie)).statusCode).toBe(200);
    // Final login checks only, after the state comparison.
    if (!targetInactive) {
      expect((await login(target.email, oldPassword)).statusCode).toBe(200);
      expect((await login(target.email, newPassword)).statusCode).toBe(401);
    } else {
      // Inactive target: both passwords must be refused.
      expect((await login(target.email, oldPassword)).statusCode).toBe(401);
      expect((await login(target.email, newPassword)).statusCode).toBe(401);
    }
  };

  const cleanTrackedFixtures = async () => {
    if (!migrator) return;
    const client = await migrator.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock($1)', [IDENTITY_LOCK]);

      // Collect any users matching this test's unique random prefix to be 100% comprehensive
      const { rows: prefixUsers } = await client.query<{ id: string }>(
        'SELECT id FROM auth_user WHERE left(email, length($1)) = $1',
        [prefix]
      );
      for (const u of prefixUsers) {
        trackedUserIds.add(u.id);
      }

      if (trackedUserIds.size > 0) {
        const ids = Array.from(trackedUserIds);

        // 1. Identify identity_event IDs strictly associated with our tracked fixture users
        const { rows: eventRows } = await client.query<{ id: string }>(
          `SELECT DISTINCT id FROM identity_event 
           WHERE actor_id = ANY($1) 
              OR target_user_id = ANY($1)
              OR id IN (SELECT event_id FROM identity_event_subject WHERE user_id = ANY($1))`,
          [ids]
        );
        const eventIds = eventRows.map((r) => r.id);

        // 2. Remove identity_event_subject and identity_event exclusively for our tracked fixtures
        if (eventIds.length > 0) {
          await client.query('DELETE FROM identity_event_subject WHERE event_id = ANY($1)', [eventIds]);
          await client.query('DELETE FROM identity_event WHERE id = ANY($1)', [eventIds]);
        }
        await client.query('DELETE FROM identity_event_subject WHERE user_id = ANY($1)', [ids]);

        // 3. Remove sessions, accounts, and roles for our tracked fixture users
        await client.query('DELETE FROM auth_session WHERE user_id = ANY($1)', [ids]);
        await client.query('DELETE FROM auth_account WHERE user_id = ANY($1)', [ids]);
        await client.query('DELETE FROM user_role WHERE user_id = ANY($1)', [ids]);

        // 4. Remove auth_user for tracked fixture users
        await client.query('DELETE FROM auth_user WHERE id = ANY($1)', [ids]);
      }

      await client.query('COMMIT');
      trackedUserIds.clear();
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
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
    migrator = connectDatabase(migrationUrl);
    database = connectDatabase(applicationUrl);
    await assertApplicationDatabase(database);

    // Post-migration baseline snapshots: captured strictly after migrateDatabase and assertApplicationDatabase
    baselineGrants = await snapshotGrants(migrator);
    baselineAudit = await snapshotIdentityAudit(migrator);

    app = await buildApp({ database, logger: false, config: loadConfig({
      NODE_ENV: 'test', DATABASE_URL: applicationUrl,
      BETTER_AUTH_SECRET: randomBytes(32).toString('hex'), WEB_ORIGIN: origin,
      API_ORIGIN: 'http://127.0.0.1:3001', API_HOST: '127.0.0.1', API_PORT: '3001',
    }) });
  }, 60000);

  beforeEach(async () => {
    await cleanTrackedFixtures();
    admin = await fixture('administrator');
    admin2 = await fixture('administrator');
    collaborator = await fixture('collaborator');
    target = await fixture('collaborator');
  }, 30000);

  afterAll(async () => {
    try {
      await app?.close();
    } finally {
      try {
        await cleanTrackedFixtures();
        // Assert that baseline grants remain 100% identical
        const grantsMatch = await verifyGrants(migrator!, baselineGrants);
        expect(grantsMatch).toBe(true);

        // Assert that un-tracked pre-existing identity audit events remain 100% identical
        const auditMatch = await verifyIdentityAudit(migrator!, baselineAudit);
        expect(auditMatch).toBe(true);
      } finally {
        if (database) await database.pool.end();
        if (migrator) await migrator.pool.end();
      }
    }
  });

  it('valid active administrator resets the target password atomically', async () => {
    const revokedSession = await cookieFor(target.email, oldPassword);
    const result = await recover({
      adminEmail: admin.email, adminPassword: oldPassword,
      targetEmail: target.email, newPassword,
    });
    expect(result.action).toBe('password_recovery');
    expect(result.actorId).toBe(admin.id);
    expect(result.targetId).toBe(target.id);
    expect(new Date(result.at).getTime()).toBeGreaterThan(0);
    expect(result.revokedCount).toBeGreaterThanOrEqual(1);
    // Old password and its session are dead after the reset.
    expect((await login(target.email, oldPassword)).statusCode).toBe(401);
    expect((await me(revokedSession)).statusCode).toBe(401);
    // New password logs in normally with a fresh session.
    const fresh = await login(target.email, newPassword);
    expect(fresh.statusCode).toBe(200);
    const freshCookies = fresh.headers['set-cookie'];
    const freshCookie = (Array.isArray(freshCookies) ? freshCookies : [String(freshCookies)]).map((value) => value.split(';')[0]).join('; ');
    expect((await me(freshCookie)).json().user.id).toBe(target.id);
  }, 30000);

  it('revokes all target sessions but preserves the other account session', async () => {
    const otherCookie = await cookieFor(admin2.email, oldPassword);
    await cookieFor(target.email, oldPassword);
    await cookieFor(target.email, oldPassword);
    const beforeOther = (await db().pool.query('SELECT count(*)::int AS n FROM auth_session WHERE user_id=$1', [admin2.id])).rows[0].n;
    const result = await recover({
      adminEmail: admin.email, adminPassword: oldPassword,
      targetEmail: target.email, newPassword,
    });
    expect(result.revokedCount).toBeGreaterThanOrEqual(2);
    expect((await db().pool.query('SELECT count(*)::int AS n FROM auth_session WHERE user_id=$1', [target.id])).rows[0].n).toBe(0);
    expect((await db().pool.query('SELECT count(*)::int AS n FROM auth_session WHERE user_id=$1', [admin2.id])).rows[0].n).toBe(beforeOther);
    expect((await me(otherCookie)).statusCode).toBe(200);
  }, 30000);

  it('denies collaborator actor without changing hash or sessions', async () => {
    await expectDenyUnchanged({
      adminEmail: collaborator.email, adminPassword: oldPassword,
      targetEmail: target.email, newPassword,
    });
  });

  it('denies wrong administrator password without changing hash or sessions', async () => {
    await expectDenyUnchanged({
      adminEmail: admin.email, adminPassword: randomBytes(24).toString('hex'),
      targetEmail: target.email, newPassword,
    });
  });

  it('denies inactive administrator without changing hash or sessions', async () => {
    await changeIdentity(db(), admin2.id, admin.id, { active: false });
    await expectDenyUnchanged({
      adminEmail: admin.email, adminPassword: oldPassword,
      targetEmail: target.email, newPassword,
    });
  }, 30000);

  it.each(['noRole'] as const)('denies administrator lacking roles.manage grant without changing anything', async () => {
    // Grants are stored per role: remove ONLY roles.manage by direct SQL fixture request
    // under IDENTITY_LOCK tracking rows effectively deleted via RETURNING, and restore
    // exclusively if removed under IDENTITY_LOCK.
    const recoveryAdmin = await fixture('administrator');
    let removedGrant = false;

    const client = await migrator!.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock($1)', [IDENTITY_LOCK]);
      const delRes = await client.query(
        "DELETE FROM role_permission WHERE role_id='administrator' AND permission_id='roles.manage' RETURNING role_id, permission_id"
      );
      await client.query('COMMIT');
      removedGrant = delRes.rows.length > 0;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }

    try {
      await expectDenyUnchanged({
        adminEmail: recoveryAdmin.email, adminPassword: oldPassword,
        targetEmail: target.email, newPassword,
      });
    } finally {
      // Restore exclusively if removed, under IDENTITY_LOCK
      if (removedGrant) {
        const restoreClient = await migrator!.pool.connect();
        try {
          await restoreClient.query('BEGIN');
          await restoreClient.query('SELECT pg_advisory_xact_lock($1)', [IDENTITY_LOCK]);
          await restoreClient.query(
            "INSERT INTO role_permission (role_id, permission_id) VALUES ('administrator','roles.manage') ON CONFLICT DO NOTHING"
          );
          await restoreClient.query('COMMIT');
        } catch (err) {
          await restoreClient.query('ROLLBACK').catch(() => {});
          throw err;
        } finally {
          restoreClient.release();
        }
      }
    }
  }, 30000);

  it('denies inactive target without changing anything', async () => {
    await changeIdentity(db(), admin2.id, target.id, { active: false });
    await expectDenyUnchanged({
      adminEmail: admin.email, adminPassword: oldPassword,
      targetEmail: target.email, newPassword,
    }, true);
  }, 30000);

  it('denies unknown target email without changing anything', async () => {
    await expectDenyUnchanged({
      adminEmail: admin.email, adminPassword: oldPassword,
      targetEmail: `${prefix}ghost@example.test`, newPassword,
    });
    expect((await db().pool.query('SELECT count(*)::int AS n FROM auth_user WHERE email LIKE $1', [`${prefix}ghost@%`])).rows[0].n).toBe(0);
  });

  it('rolls back the written hash when the session deletion fails mid-transaction', async () => {
    const hashBefore = await passwordHashOf(target.id);
    const sessionsBefore = await targetSessionCount();
    // Patch ONLY the pool.connect for the recovery's client so the unique
    // DELETE FROM auth_session of this recovery fails once; restore before verifying.
    const pool = db().pool;
    const originalConnect = pool.connect.bind(pool);
    let injected = false;
    const proxyConnect = (async () => {
      const client = await originalConnect();
      return new Proxy<typeof client>(client, {
        get(target, prop, receiver) {
          if (prop === 'query') {
            return (...args: unknown[]) => {
              const sql = typeof args[0] === 'string' ? args[0] : (args[0] as { text?: string })?.text ?? '';
              if (!injected && /DELETE FROM auth_session/i.test(sql)) {
                injected = true;
                return Promise.reject(new Error('injected session delete failure'));
              }
              return Reflect.apply(Reflect.get(target, prop) as (...a: unknown[]) => unknown, target, args);
            };
          }
          return Reflect.get(target, prop, receiver);
        },
      });
    }) as unknown as typeof pool.connect;
    pool.connect = proxyConnect;
    try {
      await expect(recover({
        adminEmail: admin.email, adminPassword: oldPassword,
        targetEmail: target.email, newPassword,
      })).rejects.toThrow('injected session delete failure');
    } finally {
      pool.connect = originalConnect;
    }
    expect(injected).toBe(true);
    // PostgreSQL rollback preserved the old hash and the pre-existing sessions.
    expect(await passwordHashOf(target.id)).toBe(hashBefore);
    expect(await targetSessionCount()).toBe(sessionsBefore);
    expect((await login(target.email, oldPassword)).statusCode).toBe(200);
    expect((await login(target.email, newPassword)).statusCode).toBe(401);
  }, 30000);

  it('rejects invalid new password without partial changes', async () => {
    // Under ADR-0007 / recoveryInputSchema, passwords must be between 1 and 128 chars.
    // Invalid boundaries: empty string (length 0 < min 1) and length 129 (> max 128).
    const invalidPasswords = ['', 'a'.repeat(129)];
    for (const invalidPassword of invalidPasswords) {
      const hashBefore = await passwordHashOf(target.id);
      const sessionsBefore = await targetSessionCount();
      await expect(recover({
        adminEmail: admin.email, adminPassword: oldPassword,
        targetEmail: target.email, newPassword: invalidPassword,
      })).rejects.toThrow();
      // No partial effect: hash and sessions are compared immediately after the refusal,
      // before any verification login that would create a session.
      expect(await passwordHashOf(target.id)).toBe(hashBefore);
      expect(await targetSessionCount()).toBe(sessionsBefore);
      expect((await login(target.email, oldPassword)).statusCode).toBe(200);
      expect([400, 401]).toContain((await login(target.email, invalidPassword)).statusCode);
    }
  }, 20000);

  it('recovers access using a valid short password with session revocation and successful login', async () => {
    // Valid short passwords (boundary length 1..4 per ADR-0007: min 1, max 128)
    const validShortPassword = 'tiny';
    const revokedSession = await cookieFor(target.email, oldPassword);
    const sessionsBefore = await targetSessionCount();
    expect(sessionsBefore).toBeGreaterThanOrEqual(1);
    expect((await me(revokedSession)).statusCode).toBe(200);

    const result = await recover({
      adminEmail: admin.email, adminPassword: oldPassword,
      targetEmail: target.email, newPassword: validShortPassword,
    });
    expect(result.action).toBe('password_recovery');
    expect(result.actorId).toBe(admin.id);
    expect(result.targetId).toBe(target.id);
    expect(result.revokedCount).toBeGreaterThanOrEqual(1);

    // Old password and previous sessions are revoked
    expect((await login(target.email, oldPassword)).statusCode).toBe(401);
    expect((await me(revokedSession)).statusCode).toBe(401);
    expect(await targetSessionCount()).toBe(0);

    // New valid short password authenticates and creates a fresh valid session
    const fresh = await login(target.email, validShortPassword);
    expect(fresh.statusCode).toBe(200);
    const freshCookies = fresh.headers['set-cookie'];
    const freshCookie = (Array.isArray(freshCookies) ? freshCookies : [String(freshCookies)]).map((value) => value.split(';')[0]).join('; ');
    expect((await me(freshCookie)).json().user.id).toBe(target.id);
  }, 30000);

  it('rejects unknown input fields without any effect', async () => {
    const hashBefore = await passwordHashOf(target.id);
    const sessionsBefore = await targetSessionCount();
    await expect(recover({
      adminEmail: admin.email, adminPassword: oldPassword,
      targetEmail: target.email, newPassword, extra: 'ignored',
    })).rejects.toThrow();
    // Same order: state comparison first, verification logins afterwards.
    expect(await passwordHashOf(target.id)).toBe(hashBefore);
    expect(await targetSessionCount()).toBe(sessionsBefore);
    expect((await login(target.email, oldPassword)).statusCode).toBe(200);
  });

  it('serializes a concurrent reset against an in-flight old-password login', async () => {
    // One real session exists before the race; whichever order the lock serializes,
    // after both operations resolve no session from the old-password login survives.
    await cookieFor(target.email, oldPassword);
    const [result, oldLogin] = await Promise.all([
      recover({ adminEmail: admin.email, adminPassword: oldPassword, targetEmail: target.email, newPassword }),
      login(target.email, oldPassword),
    ]);
    // Deterministic: either the login won under the lock (200) or recovery did (401).
    expect([200, 401]).toContain(oldLogin.statusCode);
    if (oldLogin.statusCode === 200) {
      // The in-flight login session (created with the old password) was revoked by recovery.
      expect(result.revokedCount).toBeGreaterThanOrEqual(2); // pre-existing + in-flight
      const oldCookies = oldLogin.headers['set-cookie'];
      const oldCookie = (Array.isArray(oldCookies) ? oldCookies : [String(oldCookies)]).map((value) => value.split(';')[0]).join('; ');
      expect((await me(oldCookie)).statusCode).toBe(401);
    } else {
      expect(result.revokedCount).toBeGreaterThanOrEqual(1); // only the pre-existing session
    }
    expect((await db().pool.query('SELECT count(*)::int AS n FROM auth_session WHERE user_id=$1', [target.id])).rows[0].n).toBe(0);
    expect((await login(target.email, newPassword)).statusCode).toBe(200);
  }, 30000);

  it('serializes concurrent mutual demotions to exactly one surviving administrator', async () => {
    // Exactly two active real administrators exist for this case (suite-only reset above
    // never deletes users outside this exclusive prefix).
    expect(await activeAdminCount()).toBe(2);
    const settled = await Promise.allSettled([
      changeIdentity(db(), admin.id, admin2.id, { role: 'collaborator' }),
      changeIdentity(db(), admin2.id, admin.id, { role: 'collaborator' }),
    ]);
    const fulfilled = settled.filter((item) => item.status === 'fulfilled');
    const rejected = settled.filter((item) => item.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const reason = (rejected[0] as PromiseRejectedResult).reason;
    expect(reason).toBeInstanceOf(AppError);
    expect(['FORBIDDEN', 'LAST_ADMINISTRATOR']).toContain((reason as AppError).code);
    expect(await activeAdminCount()).toBe(1);
    // The surviving administrator can no longer deactivate or self-demote the last admin.
    const survivor = (await db().pool.query(
      "SELECT u.id FROM auth_user u JOIN user_role r ON r.user_id=u.id WHERE u.active AND r.role_id='administrator'",
    )).rows[0]?.id;
    if (!survivor) throw new Error('Expected exactly one surviving administrator.');
    const changes: ({ active: false } | { role: string })[] = [{ active: false }, { role: 'collaborator' }];
    for (const change of changes) {
      await expect(changeIdentity(db(), survivor, survivor, change))
        .rejects.toMatchObject({ code: 'LAST_ADMINISTRATOR' });
    }
    expect(await activeAdminCount()).toBe(1);
    expect(await roleOf(survivor)).toBe('administrator');
  }, 30000);

  it('rejects self-demotion of the sole remaining administrator after deactivating the other', async () => {
    expect(await activeAdminCount()).toBe(2);
    await changeIdentity(db(), admin.id, admin2.id, { active: false });
    expect(await activeAdminCount()).toBe(1);
    // Only the survivor remains; self-demotion and self-deactivation are refused.
    await expect(changeIdentity(db(), admin.id, admin.id, { role: 'collaborator' }))
      .rejects.toMatchObject({ code: 'LAST_ADMINISTRATOR' });
    await expect(changeIdentity(db(), admin.id, admin.id, { active: false }))
      .rejects.toMatchObject({ code: 'LAST_ADMINISTRATOR' });
    expect(await activeAdminCount()).toBe(1);
    expect(await roleOf(admin.id)).toBe('administrator');
  }, 30000);

  it('keeps a queue above the pool size alive without deadlock, with explicit results', async () => {
    // pool max is 10; launch more identity logins + successful mutations than the pool
    // can hold at once. serializeIdentity must prevent the pool from being exhausted and
    // deadlocking. Every result is asserted explicitly (no swallowed mutation failures).
    const actors = await Promise.all(Array.from({ length: 12 }, () => fixture('collaborator')));
    const burstTargets = Array.from({ length: 3 }, () => ({ email: `${prefix}burst-${randomUUID()}@example.test` }));
    const burstIds = await Promise.all(burstTargets.map(async (t) => {
      const created = await provisionUser(db(), { name: 'Burst Target', email: t.email, password: oldPassword, role: 'collaborator' });
      trackedUserIds.add(created.id);
      return created.id;
    }));
    await cookieFor(admin.email, oldPassword); // warm the lock path before the burst
    const logins = actors.map((actor) => login(actor.email, oldPassword));
    const mutations = burstTargets.map((t) => recover({
      adminEmail: admin.email, adminPassword: oldPassword,
      targetEmail: t.email, newPassword,
    }));
    const [results, receipts] = await Promise.all([Promise.all(logins), Promise.all(mutations)]);
    expect(results).toHaveLength(actors.length);
    for (const [index, response] of results.entries()) {
      expect(response.statusCode).toBe(200);
      expect((await login(actors[index]!.email, oldPassword)).statusCode).toBe(200);
    }
    // Explicit success of every concurrent mutation (no silent failures).
    expect(receipts).toHaveLength(burstTargets.length);
    for (const [index, receipt] of receipts.entries()) {
      expect(receipt.action).toBe('password_recovery');
      expect(burstIds).toContain(receipt.targetId);
      expect((await login(burstTargets[index]!.email, newPassword)).statusCode).toBe(200);
    }
  }, 60000);
});
