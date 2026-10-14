import { randomBytes, randomUUID } from 'node:crypto';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  identityEventSchema, identityEventsQuerySchema, identityEventsResponseSchema,
  permissionSchema, type Permission, type Role, type SessionResponse,
} from '@orium/contracts';
import { buildApp } from '../apps/api/src/app.js';
import { loadConfig } from '../apps/api/src/config.js';
import { connectDatabase, assertApplicationDatabase, type Database } from '../apps/api/src/db.js';
import { migrateDatabase } from '../apps/api/src/migrate.js';
import {
  IDENTITY_LOCK, changeIdentity, changeRolePermissions, provisionUser, publicIdentity,
} from '../apps/api/src/identity.js';
import { recoverUserAccess } from '../apps/api/src/recovery.js';
import { listIdentityEvents } from '../apps/api/src/identity-audit.js';
import { AppError } from '../apps/api/src/errors.js';

const connectPoolClient = (dbInstance: Database) => dbInstance.pool.connect();
type ConnectedPoolClient = Awaited<ReturnType<typeof connectPoolClient>>;

// Fase 6 incremento 2 — auditoria de identidade (docs/PHASE6-IDENTITY-IMPLEMENTATION-CONTRACT.md).
// Real PostgreSQL orium_test only. The migrator connection is used exclusively for: privilege
// inspection, temporary privilege revocation (restored in finally), back-dating THIS run's own
// events (retention/tie fixtures) and cleanup of THIS run's events. No mocks, no production hooks.

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
type EventRow = {
  id: string; created_at: Date; actor_id: string | null; action: string;
  target_user_id: string | null; target_role_id: string | null;
  previous_role: string | null; new_role: string | null;
  previous_active: boolean | null; new_active: boolean | null;
  previous_permissions: string[] | null; new_permissions: string[] | null; revoked_count: number;
};

const EXPECTED_COLUMNS = [
  'action', 'actor_id', 'created_at', 'id', 'new_active', 'new_permissions', 'new_role',
  'previous_active', 'previous_permissions', 'previous_role', 'revoked_count',
  'target_role_id', 'target_user_id',
];
const PUBLIC_KEYS = new Set([
  'id', 'createdAt', 'actorId', 'action', 'targetUserId', 'targetRoleId', 'previousRole', 'newRole',
  'previousActive', 'newActive', 'previousPermissions', 'newPermissions', 'revokedCount',
]);
const ADVISORY_WAITERS = `SELECT count(*)::int AS n FROM pg_locks
  WHERE locktype='advisory' AND NOT granted AND classid=0 AND objid=$1 AND objsubid=1`;

describe('identity audit trail against real PostgreSQL', () => {
  let app: FastifyInstance | undefined;
  let database: Database | undefined;
  let migrator: Database | undefined;
  let migrationUrl: string;
  let appRole: string;
  const prefix = `identity-audit-${randomUUID()}-`;
  const password = randomBytes(24).toString('hex');
  const origin = 'http://127.0.0.1:5173';
  const userIds = new Set<string>();
  const extraEventIds = new Set<string>();
  let originalCollaboratorPermissions: Permission[] = [];
  let policyAdmin: Fixture;
  let requestIndex = 0;

  const db = () => { if (!database) throw new Error('Integration database was not initialized.'); return database; };
  const mig = () => { if (!migrator) throw new Error('Migrator connection was not initialized.'); return migrator; };
  const inject = (options: InjectOptions) => {
    if (!app) throw new Error('Integration application was not initialized.');
    requestIndex += 1;
    return app.inject({ ...options, remoteAddress: `127.1.${Math.floor(requestIndex / 250)}.${requestIndex % 250 + 1}` });
  };
  const fixture = async (role: Role, actorId?: string): Promise<Fixture> => {
    const email = `${prefix}${randomUUID()}@example.test`;
    const created = await provisionUser(db(), { name: `Audit ${role}`, email, password, role }, actorId);
    userIds.add(created.id);
    return { ...created, email };
  };
  const login = (email: string, pass = password) => inject({ method: 'POST', url: '/api/v1/auth/sign-in/email',
    headers: { origin, 'content-type': 'application/json' }, payload: { email, password: pass } });
  const cookieFor = async (email: string, pass = password) => {
    const response = await login(email, pass);
    expect(response.statusCode).toBe(200);
    const values = response.headers['set-cookie'];
    const cookies = Array.isArray(values) ? values : values ? [values] : [];
    expect(cookies.length).toBeGreaterThan(0);
    return cookies.map((value) => value.split(';')[0]).join('; ');
  };
  const listHttp = (cookie: string | undefined, query = '') =>
    inject({ method: 'GET', url: `/api/v1/identity-events${query}`, headers: cookie ? { cookie } : {} });
  const eventsOf = async (where: string, params: unknown[]) =>
    (await mig().pool.query<EventRow>(`SELECT * FROM identity_event WHERE ${where} ORDER BY created_at DESC, id DESC`, params)).rows;
  const subjectsOf = async (eventId: string) =>
    (await mig().pool.query<{ user_id: string }>('SELECT user_id FROM identity_event_subject WHERE event_id=$1 ORDER BY user_id', [eventId]))
      .rows.map((row) => row.user_id);
  const countEvents = async (action: string, targetUserId: string) =>
    (await mig().pool.query<{ n: number }>('SELECT count(*)::int AS n FROM identity_event WHERE action=$1 AND target_user_id=$2', [action, targetUserId])).rows[0]!.n;
  const sessionCount = async (userId: string) =>
    (await db().pool.query<{ n: number }>('SELECT count(*)::int AS n FROM auth_session WHERE user_id=$1', [userId])).rows[0]!.n;
  const roleOf = async (userId: string) =>
    (await db().pool.query<{ role_id: string }>('SELECT role_id FROM user_role WHERE user_id=$1', [userId])).rows[0]?.role_id;
  const rolePermissions = async (role: Role) =>
    (await db().pool.query<{ permission_id: string }>('SELECT permission_id FROM role_permission WHERE role_id=$1 ORDER BY permission_id', [role]))
      .rows.map((row) => row.permission_id);
  const passwordHashOf = async (userId: string) =>
    (await db().pool.query<{ password: string }>("SELECT password FROM auth_account WHERE user_id=$1 AND provider_id='credential'", [userId])).rows[0]?.password;
  const singleEvent = async (action: string, targetUserId: string) => {
    const rows = await eventsOf('action=$1 AND target_user_id=$2', [action, targetUserId]);
    expect(rows).toHaveLength(1);
    return rows[0]!;
  };
  // Barrier: wait until exactly `n` backends are blocked on IDENTITY_LOCK. This observes real
  // lock state; it never substitutes a fixed sleep for ordering proof.
  const waitForWaiters = async (n: number, timeoutMs = 10000) => {
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
  const withRevokedInsert = async (table: 'identity_event' | 'identity_event_subject', body: () => Promise<void>) => {
    await mig().pool.query(`REVOKE INSERT ON ${table} FROM "${appRole}"`);
    try { await body(); }
    finally { await mig().pool.query(`GRANT INSERT ON ${table} TO "${appRole}"`); }
    expect((await mig().pool.query<{ ok: boolean }>('SELECT has_table_privilege($1, $2, \'INSERT\') AS ok', [appRole, table])).rows[0]!.ok).toBe(true);
  };

  beforeAll(async () => {
    const applicationUrl = testDatabaseUrl('TEST_DATABASE_URL', 'orium_app');
    migrationUrl = testDatabaseUrl('TEST_MIGRATION_DATABASE_URL', 'orium_migrator');
    const a = new URL(applicationUrl);
    const b = new URL(migrationUrl);
    if (a.hostname !== b.hostname || a.port !== b.port || a.pathname !== b.pathname) {
      throw new Error('Application and migration URLs must target the same test database.');
    }
    appRole = a.username;
    await migrateDatabase(migrationUrl);
    database = connectDatabase(applicationUrl);
    migrator = connectDatabase(migrationUrl);
    await assertApplicationDatabase(database);
    app = await buildApp({ database, logger: false, config: loadConfig({
      NODE_ENV: 'test', DATABASE_URL: applicationUrl,
      BETTER_AUTH_SECRET: randomBytes(32).toString('hex'), WEB_ORIGIN: origin,
      API_ORIGIN: 'http://127.0.0.1:3001', API_HOST: '127.0.0.1', API_PORT: '3001',
    }) });
    originalCollaboratorPermissions = (await rolePermissions('collaborator')).map((item) => permissionSchema.parse(item));
    policyAdmin = await fixture('administrator');
  }, 60000);

  afterAll(async () => {
    const report: Record<string, unknown> = { prefix: prefix.slice(0, 15), at: new Date().toISOString() };
    try {
      if (database && policyAdmin && originalCollaboratorPermissions.length) {
        const current = await rolePermissions('collaborator');
        if (JSON.stringify(current) !== JSON.stringify([...originalCollaboratorPermissions].sort())) {
          await changeRolePermissions(db(), policyAdmin.id, 'collaborator', originalCollaboratorPermissions);
        }
        report.collaboratorPermissionsRestored = JSON.stringify(await rolePermissions('collaborator')) === JSON.stringify([...originalCollaboratorPermissions].sort());
      }
      await app?.close();
    } finally {
      if (database && migrator) {
        try {
          const prefixed = await db().pool.query<{ id: string }>('SELECT id FROM auth_user WHERE left(email, length($1))=$1', [prefix]);
          for (const row of prefixed.rows) userIds.add(row.id);
          const ids = [...userIds];
          const events = await mig().pool.query(
            'DELETE FROM identity_event WHERE id = ANY($1::uuid[]) OR actor_id = ANY($2::text[]) OR target_user_id = ANY($2::text[])',
            [[...extraEventIds], ids]);
          report.eventsDeleted = events.rowCount;
          await db().pool.query('DELETE FROM auth_session WHERE user_id = ANY($1::text[])', [ids]);
          const users = await db().pool.query('DELETE FROM auth_user WHERE left(email, length($1))=$1', [prefix]);
          report.usersDeleted = users.rowCount;
          report.remainingEvents = (await mig().pool.query<{ n: number }>(
            'SELECT count(*)::int AS n FROM identity_event WHERE actor_id = ANY($1::text[]) OR target_user_id = ANY($1::text[])', [ids])).rows[0]!.n;
          report.remainingSubjectsOfOwnEvents = (await mig().pool.query<{ n: number }>(
            'SELECT count(*)::int AS n FROM identity_event_subject s LEFT JOIN identity_event e ON e.id=s.event_id WHERE e.id IS NULL')).rows[0]!.n;
          report.remainingUsers = (await db().pool.query<{ n: number }>('SELECT count(*)::int AS n FROM auth_user WHERE left(email, length($1))=$1', [prefix])).rows[0]!.n;
          const { writeFileSync, mkdirSync } = await import('node:fs');
          mkdirSync('.local', { recursive: true });
          writeFileSync('.local/phase6-identity-qa-cleanup.json', JSON.stringify(report, null, 2) + '\n');
        } finally {
          await database.pool.end();
          await migrator.pool.end();
        }
      }
    }
  }, 60000);

  // ── Critério 1 ──────────────────────────────────────────────────────────────
  it('C1: additive migration is repeatable and preserves accounts and audit rows', async () => {
    const user = await fixture('collaborator');
    const before = await eventsOf('target_user_id=$1', [user.id]);
    expect(before.length).toBe(1);
    await migrateDatabase(migrationUrl);
    await migrateDatabase(migrationUrl);
    expect((await db().pool.query('SELECT id FROM auth_user WHERE id=$1', [user.id])).rowCount).toBe(1);
    expect((await eventsOf('target_user_id=$1', [user.id])).map((row) => row.id)).toEqual(before.map((row) => row.id));
    expect(await subjectsOf(before[0]!.id)).toEqual([user.id]);
  }, 60000);

  it('C1: schema has exactly the minimal privacy-safe columns and indexes', async () => {
    const columns = await mig().pool.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='identity_event' ORDER BY column_name");
    expect(columns.rows.map((row) => row.column_name)).toEqual(EXPECTED_COLUMNS);
    const subjectColumns = await mig().pool.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='identity_event_subject' ORDER BY column_name");
    expect(subjectColumns.rows.map((row) => row.column_name)).toEqual(['event_id', 'user_id']);
    const fks = await mig().pool.query<{ table: string; ref: string; deltype: string }>(`
      SELECT c.conrelid::regclass::text AS table, c.confrelid::regclass::text AS ref, c.confdeltype AS deltype
      FROM pg_constraint c WHERE c.contype='f' AND c.conrelid IN ('public.identity_event'::regclass, 'public.identity_event_subject'::regclass)`);
    // Only subject→event (cascade); no FK to auth_user on historical IDs.
    expect(fks.rows).toEqual([{ table: 'identity_event_subject', ref: 'identity_event', deltype: 'c' }]);
    const indexes = await mig().pool.query<{ def: string }>(
      "SELECT indexdef AS def FROM pg_indexes WHERE schemaname='public' AND tablename IN ('identity_event','identity_event_subject')");
    const defs = indexes.rows.map((row) => row.def.replace(/\s+/g, ' '));
    expect(defs.some((def) => /identity_event .*\(created_at DESC, id DESC\)/.test(def))).toBe(true);
    expect(defs.some((def) => /identity_event_subject .*\(user_id, event_id\)/.test(def))).toBe(true);
    // Coherence constraints reject an unknown action even for the INSERT-capable app role.
    await expect(db().pool.query("INSERT INTO identity_event (id, action) VALUES (gen_random_uuid(), 'login_succeeded')"))
      .rejects.toMatchObject({ code: '23514' });
  });

  it('C1: app role is append-only (SELECT/INSERT) and prune is the only delete path', async () => {
    for (const table of ['identity_event', 'identity_event_subject']) {
      const privileges = await mig().pool.query<Record<string, boolean>>(`SELECT
        has_table_privilege($1, $2, 'SELECT') AS select, has_table_privilege($1, $2, 'INSERT') AS insert,
        has_table_privilege($1, $2, 'UPDATE') AS update, has_table_privilege($1, $2, 'DELETE') AS delete,
        has_table_privilege($1, $2, 'TRUNCATE') AS truncate`, [appRole, `public.${table}`]);
      expect(privileges.rows[0]).toEqual({ select: true, insert: true, update: false, delete: false, truncate: false });
    }
    const fn = await mig().pool.query<{ secdef: boolean; config: string[] | null; nargs: number; public_exec: number; app_exec: boolean; def: string }>(`
      SELECT p.prosecdef AS secdef, p.proconfig AS config, p.pronargs::int AS nargs,
        (SELECT count(*)::int FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') AS public_exec,
        has_function_privilege($1, p.oid, 'EXECUTE') AS app_exec, pg_get_functiondef(p.oid) AS def
      FROM pg_proc p WHERE p.oid='public.prune_identity_events()'::regprocedure`, [appRole]);
    const row = fn.rows[0]!;
    expect(row).toMatchObject({ secdef: true, nargs: 0, public_exec: 0, app_exec: true });
    expect((row.config ?? []).some((item) => item.startsWith('search_path='))).toBe(true);
    expect(row.def).toMatch(/interval\s*'12 months'/i);
    expect(row.def).not.toMatch(/365|1 year/i);
    const target = await fixture('collaborator');
    const [event] = await eventsOf('target_user_id=$1', [target.id]);
    await expect(db().pool.query('UPDATE identity_event SET created_at=created_at - interval \'2 years\' WHERE id=$1', [event!.id])).rejects.toMatchObject({ code: '42501' });
    await expect(db().pool.query('DELETE FROM identity_event WHERE id=$1', [event!.id])).rejects.toMatchObject({ code: '42501' });
    await expect(db().pool.query('DELETE FROM identity_event_subject WHERE event_id=$1', [event!.id])).rejects.toMatchObject({ code: '42501' });
    await expect(db().pool.query('TRUNCATE identity_event_subject')).rejects.toMatchObject({ code: '42501' });
    await expect(db().pool.query('UPDATE identity_event_subject SET user_id=$1 WHERE event_id=$2', [policyAdmin.id, event!.id])).rejects.toMatchObject({ code: '42501' });
    await expect(db().pool.query("SELECT public.prune_identity_events(now() + interval '1 day')")).rejects.toMatchObject({ code: '42883' });
    const pruned = await db().pool.query<{ n: string | number }>('SELECT public.prune_identity_events() AS n');
    expect(Number(pruned.rows[0]!.n)).toBeGreaterThanOrEqual(0);
    expect((await eventsOf('id=$1', [event!.id])).length).toBe(1);
    expect(await subjectsOf(event!.id)).toEqual([target.id]);
  });

  // ── Critério 2 ──────────────────────────────────────────────────────────────
  it('C2: provisioning records user_created with actor (admin route) or NULL (trusted bootstrap primitive)', async () => {
    const technical = await fixture('collaborator');
    const technicalEvent = await singleEvent('user_created', technical.id);
    expect(technicalEvent).toMatchObject({ actor_id: null, target_user_id: technical.id, target_role_id: null, revoked_count: 0, new_role: 'collaborator' });
    expect(await subjectsOf(technicalEvent.id)).toEqual([technical.id]);

    const cookie = await cookieFor(policyAdmin.email);
    const email = `${prefix}http-${randomUUID()}@example.test`;
    const created = await inject({ method: 'POST', url: '/api/v1/users', headers: { origin, cookie },
      payload: { name: 'Audit Created', email, password, role: 'collaborator' } });
    expect(created.statusCode).toBe(201);
    const createdId = created.json().id as string;
    userIds.add(createdId);
    const event = await singleEvent('user_created', createdId);
    expect(event).toMatchObject({ actor_id: policyAdmin.id, target_user_id: createdId, new_role: 'collaborator', revoked_count: 0 });
    expect(await subjectsOf(event.id)).toEqual([createdId]);
    expect(JSON.stringify(event)).not.toContain(email);
    expect(JSON.stringify(event)).not.toContain(password);
  });

  it('C2: role change and deactivation record before/after state and the real revoked session count', async () => {
    const target = await fixture('collaborator');
    await cookieFor(target.email);
    await cookieFor(target.email);
    expect(await sessionCount(target.id)).toBe(2);
    await changeIdentity(db(), policyAdmin.id, target.id, { role: 'administrator' });
    const roleEvent = await singleEvent('user_role_changed', target.id);
    expect(roleEvent).toMatchObject({ actor_id: policyAdmin.id, previous_role: 'collaborator', new_role: 'administrator', revoked_count: 2, target_role_id: null });
    expect(await subjectsOf(roleEvent.id)).toEqual([target.id]);

    // Semantically identical change still revokes sessions: still one event with real count.
    await cookieFor(target.email);
    await changeIdentity(db(), policyAdmin.id, target.id, { role: 'administrator' });
    const sameRole = await eventsOf('action=$1 AND target_user_id=$2', ['user_role_changed', target.id]);
    expect(sameRole).toHaveLength(2);
    expect(sameRole[0]).toMatchObject({ previous_role: 'administrator', new_role: 'administrator', revoked_count: 1 });

    await cookieFor(target.email);
    await changeIdentity(db(), policyAdmin.id, target.id, { active: false });
    const deactivated = await singleEvent('user_deactivated', target.id);
    expect(deactivated).toMatchObject({ actor_id: policyAdmin.id, previous_active: true, new_active: false, revoked_count: 1 });
    expect(await subjectsOf(deactivated.id)).toEqual([target.id]);
  });

  it('C2: denied identity changes record no success event', async () => {
    const collaborator = await fixture('collaborator');
    const victim = await fixture('collaborator');
    await expect(changeIdentity(db(), collaborator.id, victim.id, { role: 'administrator' })).rejects.toMatchObject({ status: 403 });
    await expect(changeIdentity(db(), collaborator.id, victim.id, { active: false })).rejects.toMatchObject({ status: 403 });
    await expect(changeIdentity(db(), policyAdmin.id, randomUUID(), { active: false })).rejects.toMatchObject({ status: 404 });
    await expect(changeRolePermissions(db(), collaborator.id, 'collaborator', ['protected.read'])).rejects.toMatchObject({ status: 403 });
    await expect(changeRolePermissions(db(), policyAdmin.id, 'collaborator', ['users.read'])).rejects.toMatchObject({ status: 400 });
    await expect(provisionUser(db(), { name: 'Denied', email: `${prefix}denied-${randomUUID()}@example.test`, password, role: 'collaborator' }, collaborator.id))
      .rejects.toMatchObject({ status: 403 });
    expect(await countEvents('user_role_changed', victim.id)).toBe(0);
    expect(await countEvents('user_deactivated', victim.id)).toBe(0);
    expect((await eventsOf('actor_id=$1', [collaborator.id])).length).toBe(0);
    expect(await rolePermissions('collaborator')).toEqual([...originalCollaboratorPermissions].sort());
  });

  it('C2: role permission change records sorted before/after lists, all members as subjects and real count', async () => {
    const memberA = await fixture('collaborator');
    const memberB = await fixture('collaborator');
    await cookieFor(memberA.email);
    await cookieFor(memberB.email);
    const members = (await db().pool.query<{ user_id: string }>("SELECT user_id FROM user_role WHERE role_id='collaborator' ORDER BY user_id")).rows.map((row) => row.user_id);
    const sessions = (await db().pool.query<{ n: number }>("SELECT count(*)::int AS n FROM auth_session s JOIN user_role r ON r.user_id=s.user_id WHERE r.role_id='collaborator'")).rows[0]!.n;
    expect(sessions).toBeGreaterThanOrEqual(2);
    const reduced = originalCollaboratorPermissions.filter((item) => item !== 'materials.write');
    const input: Permission[] = [...reduced].reverse().concat(reduced[0]!); // unsorted + duplicate input
    const before = (await eventsOf("action='role_permissions_changed' AND actor_id=$1", [policyAdmin.id])).length;
    await changeRolePermissions(db(), policyAdmin.id, 'collaborator', input);
    const rows = await eventsOf("action='role_permissions_changed' AND actor_id=$1", [policyAdmin.id]);
    expect(rows.length).toBe(before + 1);
    const event = rows[0]!;
    expect(event).toMatchObject({ target_user_id: null, target_role_id: 'collaborator', revoked_count: sessions });
    expect(event.previous_permissions).toEqual([...originalCollaboratorPermissions].sort());
    expect(event.new_permissions).toEqual([...new Set(reduced)].sort());
    expect(await subjectsOf(event.id)).toEqual(members);
    expect(await sessionCount(memberA.id)).toBe(0);
    // Restore through the audited path (one more event, cleaned by actor id).
    await changeRolePermissions(db(), policyAdmin.id, 'collaborator', originalCollaboratorPermissions);
    expect(await rolePermissions('collaborator')).toEqual([...originalCollaboratorPermissions].sort());

    // Identical administrator policy still revokes and is still one event.
    const admins = (await db().pool.query<{ n: number }>("SELECT count(*)::int AS n FROM auth_session s JOIN user_role r ON r.user_id=s.user_id WHERE r.role_id='administrator'")).rows[0]!.n;
    await changeRolePermissions(db(), policyAdmin.id, 'administrator', [...permissionSchema.options]);
    const adminEvent = (await eventsOf("action='role_permissions_changed' AND actor_id=$1 AND target_role_id='administrator'", [policyAdmin.id]))[0]!;
    expect(adminEvent.previous_permissions).toEqual(adminEvent.new_permissions);
    expect(adminEvent.revoked_count).toBe(admins);
  });

  it('C2: recovery records actor/target/real count only, with real reauthentication and no secret material', async () => {
    const admin = await fixture('administrator');
    const target = await fixture('collaborator');
    await cookieFor(target.email);
    await cookieFor(target.email);
    const newPassword = randomBytes(24).toString('hex');
    await expect(recoverUserAccess(db(), { adminEmail: admin.email, adminPassword: randomBytes(24).toString('hex'), targetEmail: target.email, newPassword }))
      .rejects.toThrow();
    expect(await countEvents('password_recovered', target.id)).toBe(0);
    const receipt = await recoverUserAccess(db(), { adminEmail: admin.email, adminPassword: password, targetEmail: target.email, newPassword });
    expect(receipt.revokedCount).toBe(2);
    const event = await singleEvent('password_recovered', target.id);
    expect(event).toMatchObject({ actor_id: admin.id, target_user_id: target.id, revoked_count: 2, previous_role: null, new_role: null, previous_permissions: null, new_permissions: null });
    expect(await subjectsOf(event.id)).toEqual([target.id]);
    const hash = await passwordHashOf(target.id);
    const serialized = JSON.stringify(event);
    expect(serialized).not.toContain(newPassword);
    expect(serialized).not.toContain(password);
    expect(hash && serialized.includes(hash)).toBeFalsy();
    expect((await login(target.email, newPassword)).statusCode).toBe(200);
    expect((await login(target.email, password)).statusCode).toBe(401);
    const adminCookie = await cookieFor(admin.email);
    const api = await listHttp(adminCookie, `?targetUserId=${target.id}&action=password_recovered`);
    expect(api.statusCode).toBe(200);
    expect(api.body).not.toContain(newPassword);
    expect(hash && api.body.includes(hash)).toBeFalsy();
    expect(api.json().events.map((item: { id: string }) => item.id)).toEqual([event.id]);
  });

  // ── Critério 3 ──────────────────────────────────────────────────────────────
  it('C3: failing audit INSERT rolls back the whole identity mutation (event table)', async () => {
    const admin = await fixture('administrator');
    const target = await fixture('collaborator');
    await cookieFor(target.email);
    const hashBefore = await passwordHashOf(target.id);
    const permsBefore = await rolePermissions('collaborator');
    const deniedEmail = `${prefix}rollback-${randomUUID()}@example.test`;
    const eventsBefore = (await eventsOf('target_user_id=$1', [target.id])).length;
    await withRevokedInsert('identity_event', async () => {
      await expect(changeIdentity(db(), admin.id, target.id, { role: 'administrator' })).rejects.toMatchObject({ code: '42501' });
      await expect(changeIdentity(db(), admin.id, target.id, { active: false })).rejects.toMatchObject({ code: '42501' });
      await expect(changeRolePermissions(db(), admin.id, 'collaborator', ['protected.read'])).rejects.toMatchObject({ code: '42501' });
      await expect(recoverUserAccess(db(), { adminEmail: admin.email, adminPassword: password, targetEmail: target.email, newPassword: randomBytes(24).toString('hex') }))
        .rejects.toMatchObject({ code: '42501' });
      await expect(provisionUser(db(), { name: 'Rollback', email: deniedEmail, password, role: 'collaborator' }, admin.id)).rejects.toMatchObject({ code: '42501' });
    });
    expect(await roleOf(target.id)).toBe('collaborator');
    expect((await db().pool.query<{ active: boolean }>('SELECT active FROM auth_user WHERE id=$1', [target.id])).rows[0]!.active).toBe(true);
    expect(await sessionCount(target.id)).toBe(1);
    expect(await passwordHashOf(target.id)).toBe(hashBefore);
    expect(await rolePermissions('collaborator')).toEqual(permsBefore);
    expect((await db().pool.query('SELECT 1 FROM auth_user WHERE email=$1', [deniedEmail])).rowCount).toBe(0);
    expect((await eventsOf('target_user_id=$1', [target.id])).length).toBe(eventsBefore);
    expect((await login(target.email)).statusCode).toBe(200);
  }, 60000);

  it('C3: failing subject INSERT also rolls back mutation and the event row', async () => {
    const admin = await fixture('administrator');
    const target = await fixture('collaborator');
    await cookieFor(target.email);
    const eventsBefore = (await eventsOf('actor_id=$1', [admin.id])).length;
    await withRevokedInsert('identity_event_subject', async () => {
      await expect(changeIdentity(db(), admin.id, target.id, { active: false })).rejects.toMatchObject({ code: '42501' });
      await expect(changeRolePermissions(db(), admin.id, 'collaborator', ['protected.read'])).rejects.toMatchObject({ code: '42501' });
    });
    expect((await db().pool.query<{ active: boolean }>('SELECT active FROM auth_user WHERE id=$1', [target.id])).rows[0]!.active).toBe(true);
    expect(await sessionCount(target.id)).toBe(1);
    expect(await rolePermissions('collaborator')).toEqual([...originalCollaboratorPermissions].sort());
    expect((await eventsOf('actor_id=$1', [admin.id])).length).toBe(eventsBefore);
  }, 60000);

  // ── Critério 4 ──────────────────────────────────────────────────────────────
  it('C4: administrator sees all; collaborator only own subjects; foreign filter 403; anonymous/inactive 401', async () => {
    const admin = await fixture('administrator');
    const own = await fixture('collaborator');
    const other = await fixture('collaborator');
    await changeIdentity(db(), admin.id, other.id, { role: 'collaborator' });
    const adminCookie = await cookieFor(admin.email);
    const adminView = await listHttp(adminCookie, `?targetUserId=${other.id}`);
    expect(adminView.statusCode).toBe(200);
    expect(identityEventsResponseSchema.parse(adminView.json()).events.map((item) => item.action).sort()).toEqual(['user_created', 'user_role_changed']);

    const ownCookie = await cookieFor(own.email);
    const ownView = await listHttp(ownCookie, '?limit=100');
    expect(ownView.statusCode).toBe(200);
    const body = identityEventsResponseSchema.parse(ownView.json());
    expect(body.events.length).toBeGreaterThan(0);
    for (const item of body.events) {
      expect(Object.keys(item).every((key) => PUBLIC_KEYS.has(key))).toBe(true);
      expect(await subjectsOf(item.id)).toContain(own.id);
    }
    expect(body.events.some((item) => item.action === 'user_created' && item.targetUserId === own.id)).toBe(true);
    expect(ownView.body).not.toContain(other.id);
    expect(ownView.body).not.toMatch(/subject|email|password|"name"/i);

    const foreign = await listHttp(ownCookie, `?targetUserId=${other.id}`);
    const unknown = await listHttp(ownCookie, `?targetUserId=${randomUUID()}`);
    expect(foreign.statusCode).toBe(403);
    expect(unknown.statusCode).toBe(403);
    expect(foreign.json().error.code).toBe(unknown.json().error.code);
    expect((await listHttp(ownCookie, `?targetUserId=${own.id}`)).statusCode).toBe(200);

    expect((await listHttp(undefined)).statusCode).toBe(401);
    // Inactive account with a still-present session row: must be refused (401).
    await db().pool.query('UPDATE auth_user SET active=false WHERE id=$1', [own.id]);
    expect((await listHttp(ownCookie)).statusCode).toBe(401);
  });

  it('C4: historical policy subjects are not granted to later members; other subjects are never disclosed', async () => {
    const early = await fixture('collaborator');
    const peer = await fixture('collaborator');
    await changeRolePermissions(db(), policyAdmin.id, 'collaborator', originalCollaboratorPermissions);
    const policyEvent = (await eventsOf("action='role_permissions_changed' AND actor_id=$1", [policyAdmin.id]))[0]!;
    expect(await subjectsOf(policyEvent.id)).toEqual(expect.arrayContaining([early.id, peer.id]));
    const late = await fixture('collaborator');
    const earlyView = await listHttp(await cookieFor(early.email), '?action=role_permissions_changed&limit=100');
    expect(earlyView.statusCode).toBe(200);
    expect(earlyView.json().events.map((item: { id: string }) => item.id)).toContain(policyEvent.id);
    expect(earlyView.body).not.toContain(peer.id);
    const lateView = await listHttp(await cookieFor(late.email), '?action=role_permissions_changed&limit=100');
    expect(lateView.statusCode).toBe(200);
    expect(lateView.json().events.map((item: { id: string }) => item.id)).not.toContain(policyEvent.id);
    // Later promotion to administrator grants the full-trail decision, but a demotion back
    // removes it again: scope follows the current role, not past membership.
    await changeIdentity(db(), policyAdmin.id, late.id, { role: 'administrator' });
    const promoted = await listHttp(await cookieFor(late.email), `?action=role_permissions_changed&limit=100`);
    expect(promoted.json().events.map((item: { id: string }) => item.id)).toContain(policyEvent.id);
    await changeIdentity(db(), policyAdmin.id, late.id, { role: 'collaborator' });
    const demoted = await listHttp(await cookieFor(late.email), `?action=role_permissions_changed&limit=100`);
    expect(demoted.json().events.map((item: { id: string }) => item.id)).not.toContain(policyEvent.id);
  });

  // ── Critério 5 ──────────────────────────────────────────────────────────────
  it('C5: keyset pagination is stable across timestamp ties, without duplicates or scope widening', async () => {
    const target = await fixture('collaborator');
    for (let i = 0; i < 11; i += 1) await changeIdentity(db(), policyAdmin.id, target.id, { role: 'collaborator' });
    const own = await eventsOf('target_user_id=$1', [target.id]);
    expect(own.length).toBe(12);
    // Tie fixture (TEST only, own rows): 8 events share one timestamp.
    await mig().pool.query("UPDATE identity_event SET created_at = date_trunc('second', now()) - interval '1 hour' WHERE id = ANY($1::uuid[])",
      [own.slice(0, 8).map((row) => row.id)]);
    const expected = (await eventsOf('target_user_id=$1', [target.id])).map((row) => row.id);
    const cookie = await cookieFor(policyAdmin.email);
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const query = `?limit=5&targetUserId=${target.id}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const response = await listHttp(cookie, query);
      expect(response.statusCode).toBe(200);
      const page = identityEventsResponseSchema.parse(response.json());
      expect(page.events.length).toBeLessThanOrEqual(5);
      seen.push(...page.events.map((item) => item.id));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor && pages < 10);
    expect(pages).toBe(3);
    expect(seen).toEqual(expected);
    expect(new Set(seen).size).toBe(seen.length);

    const filtered = await listHttp(cookie, `?targetUserId=${target.id}&action=user_created`);
    expect(filtered.json().events.map((item: { action: string }) => item.action)).toEqual(['user_created']);

    for (const bad of ['?cursor=not-a-cursor', '?cursor=', '?limit=0', '?limit=101', '?limit=abc', '?action=login', '?targetUserId=x', '?unexpected=1']) {
      const response = await listHttp(cookie, bad);
      expect(response.statusCode, bad).toBe(400);
      expect(response.json().error.code).toBe('INVALID_INPUT');
      expect(response.body).not.toMatch(/stack|select|identity_event/i);
    }
    // A cursor minted by an administrator does not widen a collaborator's scope.
    const firstPage = identityEventsResponseSchema.parse((await listHttp(cookie, `?limit=1&targetUserId=${target.id}`)).json());
    const stranger = await fixture('collaborator');
    const strangerView = await listHttp(await cookieFor(stranger.email), `?limit=100&cursor=${encodeURIComponent(firstPage.nextCursor!)}`);
    if (strangerView.statusCode === 200) {
      for (const item of identityEventsResponseSchema.parse(strangerView.json()).events) expect(await subjectsOf(item.id)).toContain(stranger.id);
      expect(strangerView.body).not.toContain(target.id);
    } else {
      expect(strangerView.statusCode).toBe(400);
    }
  });

  // ── Critério 6 ──────────────────────────────────────────────────────────────
  it('C6: 12-calendar-month retention removes only expired rows (with cascade) and keeps boundary-recent rows', async () => {
    const target = await fixture('collaborator');
    await changeIdentity(db(), policyAdmin.id, target.id, { role: 'collaborator' });
    await changeIdentity(db(), policyAdmin.id, target.id, { role: 'collaborator' });
    const [newest, middle, oldest] = await eventsOf('target_user_id=$1', [target.id]);
    await mig().pool.query("UPDATE identity_event SET created_at = statement_timestamp() - interval '12 months' - interval '1 minute' WHERE id=$1", [oldest!.id]);
    await mig().pool.query("UPDATE identity_event SET created_at = statement_timestamp() - interval '12 months' + interval '1 minute' WHERE id=$1", [middle!.id]);
    expect(await subjectsOf(oldest!.id)).toEqual([target.id]);
    const pruned = await db().pool.query<{ n: string | number }>('SELECT public.prune_identity_events() AS n');
    expect(Number(pruned.rows[0]!.n)).toBeGreaterThanOrEqual(1);
    expect((await eventsOf('id=$1', [oldest!.id])).length).toBe(0);
    expect(await subjectsOf(oldest!.id)).toEqual([]);
    expect((await eventsOf('id = ANY($1::uuid[])', [[middle!.id, newest!.id]])).length).toBe(2);
    const view = await listHttp(await cookieFor(policyAdmin.email), `?targetUserId=${target.id}`);
    expect(view.json().events.map((item: { id: string }) => item.id)).toEqual([newest!.id, middle!.id]);

    // Visibility cut is independent of physical pruning: an expired row created after the read
    // started cannot appear; and the read itself prunes opportunistically.
    await mig().pool.query("UPDATE identity_event SET created_at = statement_timestamp() - interval '12 months' - interval '1 second' WHERE id=$1", [middle!.id]);
    const after = await listHttp(await cookieFor(policyAdmin.email), `?targetUserId=${target.id}`);
    expect(after.json().events.map((item: { id: string }) => item.id)).toEqual([newest!.id]);
    expect((await eventsOf('id=$1', [middle!.id])).length).toBe(0);
    // App role cannot back-date nor force deletion of recent rows.
    await expect(db().pool.query("UPDATE identity_event SET created_at = now() - interval '13 months' WHERE id=$1", [newest!.id])).rejects.toMatchObject({ code: '42501' });
    await db().pool.query('SELECT public.prune_identity_events()');
    expect((await eventsOf('id=$1', [newest!.id])).length).toBe(1);
  });

  // ── Critério 7 ──────────────────────────────────────────────────────────────
  it('C7: deactivation serialized BEFORE a pending admin write prevents that write and its event', async () => {
    const victim = await fixture('administrator');
    const target = await fixture('collaborator');
    const holder = await holdIdentityLock();
    let revocation: Promise<void>;
    let write: Promise<void>;
    try {
      revocation = changeIdentity(db(), policyAdmin.id, victim.id, { active: false });
      await waitForWaiters(1);
      write = changeIdentity(db(), victim.id, target.id, { role: 'administrator' });
    } finally { await releaseIdentityLock(holder); }
    await expect(revocation!).resolves.toBeUndefined();
    await expect(write!).rejects.toMatchObject({ status: 403 });
    expect(await roleOf(target.id)).toBe('collaborator');
    expect((await eventsOf('actor_id=$1', [victim.id])).length).toBe(0);
    expect(await countEvents('user_deactivated', victim.id)).toBe(1);
  });

  it('C7: admin write serialized BEFORE a later deactivation legitimately commits and keeps its event', async () => {
    const actor = await fixture('administrator');
    const target = await fixture('collaborator');
    const holder = await holdIdentityLock();
    let write: Promise<void>;
    let revocation: Promise<void>;
    try {
      write = changeIdentity(db(), actor.id, target.id, { role: 'administrator' });
      await waitForWaiters(1);
      revocation = changeIdentity(db(), policyAdmin.id, actor.id, { active: false });
    } finally { await releaseIdentityLock(holder); }
    await expect(write!).resolves.toBeUndefined();
    await expect(revocation!).resolves.toBeUndefined();
    expect(await roleOf(target.id)).toBe('administrator');
    const event = await singleEvent('user_role_changed', target.id);
    expect(event.actor_id).toBe(actor.id);
    expect(await countEvents('user_deactivated', actor.id)).toBe(1);
  });

  it('C7: read revalidates under IDENTITY_LOCK — revocation ordered first denies/limits, read ordered first is preserved', async () => {
    const reader = await fixture('administrator');
    const foreign = await fixture('collaborator');
    const staleAdmin: SessionResponse = await publicIdentity(db(), reader.id);
    const query = identityEventsQuerySchema.parse({ targetUserId: foreign.id });

    // Read first, demotion second: the read legitimately completed with administrator scope.
    let holder = await holdIdentityLock();
    let read: ReturnType<typeof listIdentityEvents>;
    let demotion: Promise<void>;
    try {
      read = listIdentityEvents(db(), staleAdmin, query);
      await waitForWaiters(1);
      demotion = changeIdentity(db(), policyAdmin.id, reader.id, { role: 'collaborator' });
    } finally { await releaseIdentityLock(holder); }
    const firstResult = await read!;
    await demotion!;
    expect(
      firstResult.events.flatMap((item) => {
        const parsed = identityEventSchema.parse(item);
        return 'targetUserId' in parsed ? [parsed.targetUserId] : [];
      }),
    ).toContain(foreign.id);
    expect(await countEvents('user_role_changed', reader.id)).toBe(1);

    // Revocation (deactivation) first, read second with the stale admin identity: refused.
    holder = await holdIdentityLock();
    let deactivation: Promise<void>;
    let staleRead: ReturnType<typeof listIdentityEvents>;
    try {
      deactivation = changeIdentity(db(), policyAdmin.id, reader.id, { active: false });
      await waitForWaiters(1);
      staleRead = listIdentityEvents(db(), staleAdmin, query);
    } finally { await releaseIdentityLock(holder); }
    await deactivation!;
    const outcome = await staleRead!.then(() => null, (error: unknown) => error);
    expect(outcome).toBeInstanceOf(AppError);
    expect([401, 403]).toContain((outcome as AppError).status);
  });

  it('C7: demotion completed before revalidation reduces a stale administrator identity to own scope', async () => {
    const reader = await fixture('administrator');
    const foreign = await fixture('collaborator');
    const staleAdmin = await publicIdentity(db(), reader.id);
    await changeIdentity(db(), policyAdmin.id, reader.id, { role: 'collaborator' });
    const outcome = await listIdentityEvents(db(), staleAdmin, identityEventsQuerySchema.parse({ targetUserId: foreign.id }))
      .then(() => null, (error: unknown) => error);
    expect(outcome).toBeInstanceOf(AppError);
    expect((outcome as AppError).status).toBe(403);
    const ownScope = await listIdentityEvents(db(), staleAdmin, identityEventsQuerySchema.parse({ limit: 100 }));
    for (const item of ownScope.events) expect(await subjectsOf(item.id)).toContain(reader.id);
  });
});
