import { randomBytes, randomUUID } from 'node:crypto';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sessionResponseSchema, type Role } from '@orium/contracts';
import { buildApp } from '../apps/api/src/app.js';
import { loadConfig } from '../apps/api/src/config.js';
import { connectDatabase, assertApplicationDatabase, type Database } from '../apps/api/src/db.js';
import { migrateDatabase } from '../apps/api/src/migrate.js';
import { provisionUser } from '../apps/api/src/identity.js';

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

describe('foundation against real PostgreSQL', () => {
  let app: FastifyInstance | undefined;
  let database: Database | undefined;
  let migrationUrl: string;
  let admin: { id: string; email: string };
  let collaborator: { id: string; email: string };
  const prefix = `integration-${randomUUID()}-`;
  const password = randomBytes(24).toString('hex');
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
    const created = await provisionUser(db(), { name: `Integration ${role}`, email, password, role });
    return { ...created, email };
  };
  const login = (email: string) => inject({ method: 'POST', url: '/api/v1/auth/sign-in/email',
    headers: { origin, 'content-type': 'application/json' }, payload: { email, password } });
  const cookieFor = async (email: string) => {
    const response = await login(email);
    expect(response.statusCode).toBe(200);
    const values = response.headers['set-cookie'];
    const cookies = Array.isArray(values) ? values : values ? [values] : [];
    expect(cookies.length).toBeGreaterThan(0);
    return cookies.map((value) => value.split(';')[0]).join('; ');
  };
  const me = (cookie: string) => inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } });

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
    await assertApplicationDatabase(database);
    app = await buildApp({ database, logger: false, config: loadConfig({
      NODE_ENV: 'test', DATABASE_URL: applicationUrl,
      BETTER_AUTH_SECRET: randomBytes(32).toString('hex'), WEB_ORIGIN: origin,
      API_ORIGIN: 'http://127.0.0.1:3001', API_HOST: '127.0.0.1', API_PORT: '3001',
    }) });
  }, 60000);

  beforeEach(async () => {
    admin = await fixture('administrator');
    collaborator = await fixture('collaborator');
  }, 30000);

  afterAll(async () => {
    try { await app?.close(); }
    finally {
      if (database) {
        try { await database.pool.query('DELETE FROM auth_user WHERE left(email, length($1))=$1', [prefix]); }
        finally { await database.pool.end(); }
      }
    }
  });

  it('runs migrations repeatedly without destroying existing data', async () => {
    await migrateDatabase(migrationUrl);
    await migrateDatabase(migrationUrl);
    expect((await db().pool.query('SELECT id FROM auth_user WHERE id=$1', [admin.id])).rowCount).toBe(1);
  }, 30000);

  it('uses a non-superuser application role and reports live/ready', async () => {
    const result = await db().pool.query('SELECT current_user AS name, rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user');
    expect(result.rows[0]).toMatchObject({ name: 'orium_app', rolsuper: false, rolbypassrls: false });
    expect((await inject({ method: 'GET', url: '/health/live' })).statusCode).toBe(200);
    expect((await inject({ method: 'GET', url: '/health/ready' })).statusCode).toBe(200);
    expect((await inject({ method: 'GET', url: '/api/v1/me' })).statusCode).toBe(401);
  });

  it('logs in with an HttpOnly cookie and returns only public identity', async () => {
    const response = await login(collaborator.email);
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(Object.keys(body).sort()).toEqual(['permissions', 'roles', 'user']);
    expect(Object.keys(body.user).sort()).toEqual(['email', 'id', 'name']);
    const session = sessionResponseSchema.parse(body);
    expect(session).toMatchObject({ user: { id: collaborator.id }, roles: ['collaborator'] });
    expect(session.permissions).toContain('protected.read');
    for (const forbidden of [
      'demands.write', 'tasks.manage', 'tasks.review',
      'clients.read', 'clients.write', 'clients.archive',
      'users.read', 'users.create', 'users.deactivate', 'roles.manage',
    ]) {
      expect(session.permissions).not.toContain(forbidden);
    }
    const cookies = response.headers['set-cookie'];
    expect(String(cookies)).toMatch(/HttpOnly/i);
    expect(String(cookies)).toMatch(/SameSite=Lax/i);
    const sessions = await db().pool.query('SELECT token FROM auth_session WHERE user_id=$1', [collaborator.id]);
    expect(sessions.rowCount).toBe(1);
    expect(response.body).not.toContain(sessions.rows[0].token);
    const cookie = (Array.isArray(cookies) ? cookies : [String(cookies)]).map((value) => value.split(';')[0]).join('; ');
    expect((await me(cookie)).json().user.id).toBe(collaborator.id);
  });

  it('rejects wrong credentials without creating a session', async () => {
    const response = await inject({ method: 'POST', url: '/api/v1/auth/sign-in/email', headers: { origin },
      payload: { email: collaborator.email, password: randomBytes(24).toString('hex') } });
    expect(response.statusCode).toBe(401);
    expect(response.headers['set-cookie']).toBeUndefined();
    expect((await db().pool.query('SELECT id FROM auth_session WHERE user_id=$1', [collaborator.id])).rowCount).toBe(0);
  });

  it('does not expose public signup', async () => {
    const email = `${prefix}signup@example.test`;
    const response = await inject({ method: 'POST', url: '/api/v1/auth/sign-up/email', headers: { origin },
      payload: { email, password, name: 'Public Signup' } });
    expect(response.statusCode).toBe(404);
    expect((await db().pool.query('SELECT id FROM auth_user WHERE email=$1', [email])).rowCount).toBe(0);
  });

  it('revokes the old cookie on logout', async () => {
    const cookie = await cookieFor(collaborator.email);
    expect((await inject({ method: 'POST', url: '/api/v1/auth/sign-out', headers: { origin, cookie }, payload: {} })).statusCode).toBe(200);
    expect((await me(cookie)).statusCode).toBe(401);
    expect((await db().pool.query('SELECT id FROM auth_session WHERE user_id=$1', [collaborator.id])).rowCount).toBe(0);
  });

  it('denies all administrative user operations to collaborator', async () => {
    const cookie = await cookieFor(collaborator.email);
    for (const operation of [
      { method: 'GET', url: '/api/v1/users' },
      { method: 'POST', url: '/api/v1/users', payload: { name: 'Denied', email: `${prefix}denied@example.test`, password } },
      { method: 'PATCH', url: `/api/v1/users/${admin.id}`, payload: { active: false } },
      { method: 'PUT', url: `/api/v1/users/${collaborator.id}/role`, payload: { role: 'administrator' } },
    ] as const) expect((await inject({ ...operation, headers: { origin, cookie } })).statusCode).toBe(403);
    expect((await db().pool.query('SELECT active FROM auth_user WHERE id=$1', [admin.id])).rows[0].active).toBe(true);
    expect((await db().pool.query('SELECT role_id FROM user_role WHERE user_id=$1', [collaborator.id])).rows[0].role_id).toBe('collaborator');
  });

  it('lets administrator list and provision a new internal account', async () => {
    const cookie = await cookieFor(admin.email);
    const listed = await inject({ method: 'GET', url: '/api/v1/users', headers: { cookie } });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().users).toContainEqual(expect.objectContaining({ id: collaborator.id, active: true, role: 'collaborator' }));
    const email = `${prefix}created@example.test`;
    const created = await inject({ method: 'POST', url: '/api/v1/users', headers: { origin, cookie },
      payload: { name: 'Created Internally', email, password, role: 'collaborator' } });
    expect(created.statusCode).toBe(201);
    expect((await me(await cookieFor(email))).json().user.id).toBe(created.json().id);
  });

  it.each([undefined, 'http://foreign.example', 'http://127.0.0.1:5173.evil.example'])('rejects mutation origin %s without effects', async (badOrigin) => {
    const cookie = await cookieFor(admin.email);
    const headers = { cookie, ...(badOrigin ? { origin: badOrigin } : {}) };
    expect((await inject({ method: 'PATCH', url: `/api/v1/users/${collaborator.id}`, headers, payload: { active: false } })).statusCode).toBe(403);
    expect((await db().pool.query('SELECT active FROM auth_user WHERE id=$1', [collaborator.id])).rows[0].active).toBe(true);
    expect((await inject({ method: 'POST', url: '/api/v1/auth/sign-in/email', headers,
      payload: { email: collaborator.email, password } })).statusCode).toBe(403);
  });

  it('deactivation immediately invalidates existing sessions and new login', async () => {
    const oldCookie = await cookieFor(collaborator.email);
    const cookie = await cookieFor(admin.email);
    expect((await inject({ method: 'PATCH', url: `/api/v1/users/${collaborator.id}`, headers: { origin, cookie }, payload: { active: false } })).statusCode).toBe(200);
    expect((await me(oldCookie)).statusCode).toBe(401);
    expect((await inject({ method: 'POST', url: '/api/v1/auth/sign-out', headers: { origin, cookie: oldCookie }, payload: {} })).statusCode).toBe(401);
    expect((await login(collaborator.email)).statusCode).toBe(401);
  });

  it('role demotion revokes old administrator session immediately', async () => {
    const target = await fixture('administrator');
    const oldCookie = await cookieFor(target.email);
    const cookie = await cookieFor(admin.email);
    expect((await inject({ method: 'PUT', url: `/api/v1/users/${target.id}/role`, headers: { origin, cookie }, payload: { role: 'collaborator' } })).statusCode).toBe(200);
    expect((await me(oldCookie)).statusCode).toBe(401);
    const newCookie = await cookieFor(target.email);
    expect((await me(newCookie)).json().roles).toEqual(['collaborator']);
    expect((await inject({ method: 'GET', url: '/api/v1/users', headers: { cookie: newCookie } })).statusCode).toBe(403);
  });

  it.each(['idle', 'absolute', 'expired'] as const)('rejects %s session using persisted timestamps', async (kind) => {
    const cookie = await cookieFor(collaborator.email);
    const changes = {
      idle: "last_seen_at=now()-interval '12 hours 1 minute'",
      absolute: "created_at=now()-interval '7 days 1 minute', last_seen_at=now(), expires_at=now()+interval '1 day'",
      expired: "expires_at=now()-interval '1 minute'",
    };
    const result = await db().pool.query(`UPDATE auth_session SET ${changes[kind]} WHERE user_id=$1`, [collaborator.id]);
    expect(result.rowCount).toBe(1);
    expect((await me(cookie)).statusCode).toBe(401);
  });

  it('records activity without extending absolute expiration', async () => {
    const cookie = await cookieFor(collaborator.email);
    await db().pool.query("UPDATE auth_session SET last_seen_at=now()-interval '1 hour' WHERE user_id=$1", [collaborator.id]);
    const before = (await db().pool.query('SELECT created_at, expires_at, last_seen_at FROM auth_session WHERE user_id=$1', [collaborator.id])).rows[0];
    expect((await me(cookie)).statusCode).toBe(200);
    const after = (await db().pool.query('SELECT created_at, expires_at, last_seen_at FROM auth_session WHERE user_id=$1', [collaborator.id])).rows[0];
    expect(after.last_seen_at.getTime()).toBeGreaterThan(before.last_seen_at.getTime());
    expect(after.created_at).toEqual(before.created_at);
    expect(after.expires_at).toEqual(before.expires_at);
  });
});
