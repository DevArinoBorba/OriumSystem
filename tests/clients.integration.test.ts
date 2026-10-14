import { randomBytes, randomUUID } from 'node:crypto';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { clientSchema, type Client, type Role } from '@orium/contracts';
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

describe('clients domain against real PostgreSQL', () => {
  let app: FastifyInstance | undefined;
  let database: Database | undefined;
  let migrationUrl: string;
  let admin: { id: string; email: string };
  let collaborator: { id: string; email: string };
  const userPrefix = `client-test-user-${randomUUID()}-`;
  const clientPrefix = `client-test-${randomUUID().slice(0, 8)}-`;
  const password = randomBytes(24).toString('hex');
  const origin = 'http://127.0.0.1:5173';
  let requestIndex = 0;
  const createdClientIds: string[] = [];

  const db = () => {
    if (!database) throw new Error('Integration database was not initialized.');
    return database;
  };

  const inject = (options: InjectOptions) => {
    if (!app) throw new Error('Integration application was not initialized.');
    requestIndex += 1;
    return app.inject({
      ...options,
      remoteAddress: `127.0.${Math.floor(requestIndex / 250)}.${(requestIndex % 250) + 1}`,
    });
  };

  const fixtureUser = async (role: Role) => {
    const email = `${userPrefix}${randomUUID()}@example.test`;
    const created = await provisionUser(db(), { name: `Client Test ${role}`, email, password, role });
    return { ...created, email };
  };

  const login = (email: string) =>
    inject({
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
    app = await buildApp({
      database,
      logger: false,
      config: loadConfig({
        NODE_ENV: 'test',
        DATABASE_URL: applicationUrl,
        BETTER_AUTH_SECRET: randomBytes(32).toString('hex'),
        WEB_ORIGIN: origin,
        API_ORIGIN: 'http://127.0.0.1:3001',
        API_HOST: '127.0.0.1',
        API_PORT: '3001',
      }),
    });
    admin = await fixtureUser('administrator');
    collaborator = await fixtureUser('collaborator');
  }, 60000);

  afterAll(async () => {
    try {
      await app?.close();
    } finally {
      if (database) {
        try {
          if (createdClientIds.length > 0) {
            await database.pool.query('DELETE FROM client WHERE id = ANY($1)', [createdClientIds]);
          }
          await database.pool.query('DELETE FROM auth_user WHERE left(email, length($1)) = $1', [userPrefix]);
        } finally {
          await database.pool.end();
        }
      }
    }
  });

  it('rejects unauthenticated requests with 401 across all client endpoints', async () => {
    const fakeId = randomUUID();
    for (const op of [
      { method: 'GET', url: '/api/v1/clients' },
      { method: 'GET', url: `/api/v1/clients/${fakeId}` },
      { method: 'POST', url: '/api/v1/clients', payload: { name: 'Unauth' }, headers: { origin } },
      { method: 'PATCH', url: `/api/v1/clients/${fakeId}`, payload: { version: 1, name: 'Unauth' }, headers: { origin } },
      { method: 'POST', url: `/api/v1/clients/${fakeId}/archive`, payload: { version: 1 }, headers: { origin } },
      { method: 'POST', url: `/api/v1/clients/${fakeId}/restore`, payload: { version: 1 }, headers: { origin } },
    ] as const) {
      const res = await inject({ ...op });
      expect(res.statusCode).toBe(401);
    }
  });

  it('denies collaborator access to all client endpoints with 403 (deny-by-default)', async () => {
    const cookie = await cookieFor(collaborator.email);
    const fakeId = randomUUID();
    for (const op of [
      { method: 'GET', url: '/api/v1/clients' },
      { method: 'GET', url: `/api/v1/clients/${fakeId}` },
      { method: 'POST', url: '/api/v1/clients', payload: { name: 'Collaborator Denied' } },
      { method: 'PATCH', url: `/api/v1/clients/${fakeId}`, payload: { version: 1, name: 'Denied' } },
      { method: 'POST', url: `/api/v1/clients/${fakeId}/archive`, payload: { version: 1 } },
      { method: 'POST', url: `/api/v1/clients/${fakeId}/restore`, payload: { version: 1 } },
    ] as const) {
      const res = await inject({ ...op, headers: { origin, cookie } });
      expect(res.statusCode).toBe(403);
    }
  });

  it('rejects mutations with invalid or foreign origin', async () => {
    const cookie = await cookieFor(admin.email);
    for (const badOrigin of [undefined, 'http://evil.example', 'http://127.0.0.1:5173.attacker.com']) {
      const headers = { cookie, ...(badOrigin ? { origin: badOrigin } : {}) };
      const res = await inject({
        method: 'POST',
        url: '/api/v1/clients',
        headers,
        payload: { name: 'Bad Origin Client' },
      });
      expect(res.statusCode).toBe(403);
    }
  });

  it('validates client creation input strictly (rejects empty name, unknown fields, invalid types)', async () => {
    const cookie = await cookieFor(admin.email);

    // Empty name
    const resEmpty = await inject({
      method: 'POST',
      url: '/api/v1/clients',
      headers: { origin, cookie },
      payload: { name: '   ' },
    });
    expect(resEmpty.statusCode).toBe(400);

    // Unknown field (e.g. client attempting to set id, version, or authors)
    const resUnknown = await inject({
      method: 'POST',
      url: '/api/v1/clients',
      headers: { origin, cookie },
      payload: { name: 'Valid Name', id: randomUUID(), version: 5 },
    });
    expect(resUnknown.statusCode).toBe(400);

    // Name too long (>160 chars)
    const resLong = await inject({
      method: 'POST',
      url: '/api/v1/clients',
      headers: { origin, cookie },
      payload: { name: 'A'.repeat(161) },
    });
    expect(resLong.statusCode).toBe(400);
  });

  it('creates client, retrieves by id, and enforces non-existent 404', async () => {
    const cookie = await cookieFor(admin.email);
    const clientName = `${clientPrefix}Alpha`;

    const createRes = await inject({
      method: 'POST',
      url: '/api/v1/clients',
      headers: { origin, cookie },
      payload: {
        name: clientName,
        contactName: 'Contato Alpha',
        email: 'alpha@example.test',
        phone: '+55 11 99999-0001',
        notes: 'Notas do cliente Alpha',
      },
    });
    expect(createRes.statusCode).toBe(201);
    const created: Client = clientSchema.parse(createRes.json().client);
    createdClientIds.push(created.id);

    expect(created.name).toBe(clientName);
    expect(created.contactName).toBe('Contato Alpha');
    expect(created.email).toBe('alpha@example.test');
    expect(created.phone).toBe('+55 11 99999-0001');
    expect(created.notes).toBe('Notas do cliente Alpha');
    expect(created.archivedAt).toBeNull();
    expect(created.version).toBe(1);

    // Retrieve by ID
    const getRes = await inject({
      method: 'GET',
      url: `/api/v1/clients/${created.id}`,
      headers: { cookie },
    });
    expect(getRes.statusCode).toBe(200);
    const retrieved: Client = clientSchema.parse(getRes.json().client);
    expect(retrieved).toEqual(created);

    // 404 for non-existent UUID
    const notFoundRes = await inject({
      method: 'GET',
      url: `/api/v1/clients/${randomUUID()}`,
      headers: { cookie },
    });
    expect(notFoundRes.statusCode).toBe(404);

    // 400 for invalid UUID param
    const invalidIdRes = await inject({
      method: 'GET',
      url: '/api/v1/clients/not-a-uuid',
      headers: { cookie },
    });
    expect(invalidIdRes.statusCode).toBe(400);
  });

  it('updates client conditionally with version checking and detects 409 conflict', async () => {
    const cookie = await cookieFor(admin.email);
    const initialName = `${clientPrefix}Beta`;

    const createRes = await inject({
      method: 'POST',
      url: '/api/v1/clients',
      headers: { origin, cookie },
      payload: { name: initialName },
    });
    expect(createRes.statusCode).toBe(201);
    const created: Client = createRes.json().client;
    createdClientIds.push(created.id);

    // PATCH requires version and at least one editable field
    const emptyPatchRes = await inject({
      method: 'PATCH',
      url: `/api/v1/clients/${created.id}`,
      headers: { origin, cookie },
      payload: { version: 1 },
    });
    expect(emptyPatchRes.statusCode).toBe(400);

    // Successful update with matching version
    const updatedName = `${clientPrefix}Beta Updated`;
    const patchRes = await inject({
      method: 'PATCH',
      url: `/api/v1/clients/${created.id}`,
      headers: { origin, cookie },
      payload: { version: 1, name: updatedName, notes: 'Novas notas' },
    });
    expect(patchRes.statusCode).toBe(200);
    const updated: Client = clientSchema.parse(patchRes.json().client);
    expect(updated.name).toBe(updatedName);
    expect(updated.notes).toBe('Novas notas');
    expect(updated.version).toBe(2);

    // Attempting update with stale version (1) returns 409 conflict
    const conflictRes = await inject({
      method: 'PATCH',
      url: `/api/v1/clients/${created.id}`,
      headers: { origin, cookie },
      payload: { version: 1, name: 'Stale Update' },
    });
    expect(conflictRes.statusCode).toBe(409);

    // PATCH with non-existent client returns 404
    const notFoundRes = await inject({
      method: 'PATCH',
      url: `/api/v1/clients/${randomUUID()}`,
      headers: { origin, cookie },
      payload: { version: 1, name: 'Does Not Exist' },
    });
    expect(notFoundRes.statusCode).toBe(404);
  });

  it('archives and restores client with version checks and preserves data without physical deletion', async () => {
    const cookie = await cookieFor(admin.email);
    const clientName = `${clientPrefix}Gamma`;

    const createRes = await inject({
      method: 'POST',
      url: '/api/v1/clients',
      headers: { origin, cookie },
      payload: { name: clientName, notes: 'Histórico preservado' },
    });
    const created: Client = createRes.json().client;
    createdClientIds.push(created.id);
    expect(created.version).toBe(1);
    expect(created.archivedAt).toBeNull();

    // Archive with correct version
    const archiveRes = await inject({
      method: 'POST',
      url: `/api/v1/clients/${created.id}/archive`,
      headers: { origin, cookie },
      payload: { version: 1 },
    });
    expect(archiveRes.statusCode).toBe(200);
    const archived: Client = clientSchema.parse(archiveRes.json().client);
    expect(archived.archivedAt).not.toBeNull();
    expect(archived.version).toBe(2);
    expect(archived.name).toBe(clientName);
    expect(archived.notes).toBe('Histórico preservado');

    // Archive with stale version returns 409
    const archiveConflict = await inject({
      method: 'POST',
      url: `/api/v1/clients/${created.id}/archive`,
      headers: { origin, cookie },
      payload: { version: 1 },
    });
    expect(archiveConflict.statusCode).toBe(409);

    // Restore with correct version
    const restoreRes = await inject({
      method: 'POST',
      url: `/api/v1/clients/${created.id}/restore`,
      headers: { origin, cookie },
      payload: { version: 2 },
    });
    expect(restoreRes.statusCode).toBe(200);
    const restored: Client = clientSchema.parse(restoreRes.json().client);
    expect(restored.archivedAt).toBeNull();
    expect(restored.version).toBe(3);
    expect(restored.name).toBe(clientName);

    // Verify row still exists in database
    const dbRow = await db().pool.query('SELECT id, version, archived_at FROM client WHERE id = $1', [created.id]);
    expect(dbRow.rowCount).toBe(1);
    expect(dbRow.rows[0].version).toBe(3);
    expect(dbRow.rows[0].archived_at).toBeNull();
  });

  it('lists clients with status filtering, literal search, and deterministic pagination', async () => {
    const cookie = await cookieFor(admin.email);

    // Create 3 active clients and 1 archived client
    const c1Res = await inject({
      method: 'POST',
      url: '/api/v1/clients',
      headers: { origin, cookie },
      payload: { name: `${clientPrefix}Search 100% Promo`, contactName: 'Ana Special', email: 'promo100@test.local' },
    });
    const c1: Client = c1Res.json().client;
    createdClientIds.push(c1.id);

    const c2Res = await inject({
      method: 'POST',
      url: '/api/v1/clients',
      headers: { origin, cookie },
      payload: { name: `${clientPrefix}Search Standard_A`, contactName: 'Carlos Regular', email: 'standard_a@test.local' },
    });
    const c2: Client = c2Res.json().client;
    createdClientIds.push(c2.id);

    const c3Res = await inject({
      method: 'POST',
      url: '/api/v1/clients',
      headers: { origin, cookie },
      payload: { name: `${clientPrefix}Search Archived`, contactName: 'Marcos Old', email: 'archived@test.local' },
    });
    const c3: Client = c3Res.json().client;
    createdClientIds.push(c3.id);

    // Archive c3
    await inject({
      method: 'POST',
      url: `/api/v1/clients/${c3.id}/archive`,
      headers: { origin, cookie },
      payload: { version: 1 },
    });

    // 1. Status: active (default)
    const listActive = await inject({
      method: 'GET',
      url: `/api/v1/clients?q=${encodeURIComponent(clientPrefix)}`,
      headers: { cookie },
    });
    expect(listActive.statusCode).toBe(200);
    const bodyActive = listActive.json();
    const activeNames = bodyActive.clients.map((c: Client) => c.name);
    expect(activeNames).toContain(c1.name);
    expect(activeNames).toContain(c2.name);
    expect(activeNames).not.toContain(c3.name);

    // 2. Status: archived
    const listArchived = await inject({
      method: 'GET',
      url: `/api/v1/clients?q=${encodeURIComponent(clientPrefix)}&status=archived`,
      headers: { cookie },
    });
    expect(listArchived.statusCode).toBe(200);
    const bodyArchived = listArchived.json();
    const archivedNames = bodyArchived.clients.map((c: Client) => c.name);
    expect(archivedNames).toContain(c3.name);
    expect(archivedNames).not.toContain(c1.name);

    // 3. Status: all
    const listAll = await inject({
      method: 'GET',
      url: `/api/v1/clients?q=${encodeURIComponent(clientPrefix)}&status=all`,
      headers: { cookie },
    });
    expect(listAll.statusCode).toBe(200);
    const bodyAll = listAll.json();
    const allNames = bodyAll.clients.map((c: Client) => c.name);
    expect(allNames).toContain(c1.name);
    expect(allNames).toContain(c2.name);
    expect(allNames).toContain(c3.name);

    // 4. Literal search test with '%'
    const searchPercent = await inject({
      method: 'GET',
      url: `/api/v1/clients?q=100%25`,
      headers: { cookie },
    });
    expect(searchPercent.statusCode).toBe(200);
    const percentMatches = searchPercent.json().clients.map((c: Client) => c.id);
    expect(percentMatches).toContain(c1.id);
    expect(percentMatches).not.toContain(c2.id);

    // 5. Literal search test with '_'
    const searchUnderscore = await inject({
      method: 'GET',
      url: `/api/v1/clients?q=standard_a`,
      headers: { cookie },
    });
    expect(searchUnderscore.statusCode).toBe(200);
    const underscoreMatches = searchUnderscore.json().clients.map((c: Client) => c.id);
    expect(underscoreMatches).toContain(c2.id);
    expect(underscoreMatches).not.toContain(c1.id);

    // 6. Pagination and ordering
    const page1 = await inject({
      method: 'GET',
      url: `/api/v1/clients?q=${encodeURIComponent(clientPrefix)}&status=all&page=1&pageSize=1`,
      headers: { cookie },
    });
    expect(page1.statusCode).toBe(200);
    const p1Body = page1.json();
    expect(p1Body.pageSize).toBe(1);
    expect(p1Body.page).toBe(1);
    expect(p1Body.total).toBeGreaterThanOrEqual(3);
    expect(p1Body.clients.length).toBe(1);
  });

  it('handles two simultaneous edits of the same version so that exactly one succeeds and one gets 409 conflict', async () => {
    const cookie = await cookieFor(admin.email);
    const createRes = await inject({
      method: 'POST',
      url: '/api/v1/clients',
      headers: { origin, cookie },
      payload: { name: `${clientPrefix}Concurrent Base` },
    });
    const created: Client = createRes.json().client;
    createdClientIds.push(created.id);
    expect(created.version).toBe(1);

    // Send two concurrent edits targeting the same initial version 1
    const [editA, editB] = await Promise.all([
      inject({
        method: 'PATCH',
        url: `/api/v1/clients/${created.id}`,
        headers: { origin, cookie },
        payload: { version: 1, name: `${clientPrefix}Concurrent Winner A` },
      }),
      inject({
        method: 'PATCH',
        url: `/api/v1/clients/${created.id}`,
        headers: { origin, cookie },
        payload: { version: 1, name: `${clientPrefix}Concurrent Winner B` },
      }),
    ]);

    const statuses = [editA.statusCode, editB.statusCode].sort();
    expect(statuses).toEqual([200, 409]);

    // Verify current state has incremented version 2
    const finalRes = await inject({
      method: 'GET',
      url: `/api/v1/clients/${created.id}`,
      headers: { cookie },
    });
    expect(finalRes.statusCode).toBe(200);
    const finalClient: Client = finalRes.json().client;
    expect(finalClient.version).toBe(2);
    expect([`${clientPrefix}Concurrent Winner A`, `${clientPrefix}Concurrent Winner B`]).toContain(finalClient.name);
  });

  it('paginates deterministically to page 2 without duplicating any items across pages', async () => {
    const cookie = await cookieFor(admin.email);
    const pagePrefix = `page-test-${randomUUID().slice(0, 8)}-`;

    // Create 5 active clients
    const names = ['Epsilon', 'Delta', 'Zeta', 'Eta', 'Theta'];
    for (const name of names) {
      const res = await inject({
        method: 'POST',
        url: '/api/v1/clients',
        headers: { origin, cookie },
        payload: { name: `${pagePrefix}${name}` },
      });
      expect(res.statusCode).toBe(201);
      createdClientIds.push(res.json().client.id);
    }

    // Page 1 with pageSize = 2
    const resP1 = await inject({
      method: 'GET',
      url: `/api/v1/clients?q=${encodeURIComponent(pagePrefix)}&page=1&pageSize=2`,
      headers: { cookie },
    });
    expect(resP1.statusCode).toBe(200);
    const bodyP1 = resP1.json();
    expect(bodyP1.clients.length).toBe(2);
    expect(bodyP1.page).toBe(1);
    expect(bodyP1.total).toBe(5);

    // Page 2 with pageSize = 2
    const resP2 = await inject({
      method: 'GET',
      url: `/api/v1/clients?q=${encodeURIComponent(pagePrefix)}&page=2&pageSize=2`,
      headers: { cookie },
    });
    expect(resP2.statusCode).toBe(200);
    const bodyP2 = resP2.json();
    expect(bodyP2.clients.length).toBe(2);
    expect(bodyP2.page).toBe(2);
    expect(bodyP2.total).toBe(5);

    // Ensure zero overlap between page 1 and page 2
    const p1Ids = new Set(bodyP1.clients.map((c: Client) => c.id));
    const p2Ids = new Set(bodyP2.clients.map((c: Client) => c.id));
    for (const id of p2Ids) {
      expect(p1Ids.has(id)).toBe(false);
    }

    // Page 3 with pageSize = 2 (should have the 5th item)
    const resP3 = await inject({
      method: 'GET',
      url: `/api/v1/clients?q=${encodeURIComponent(pagePrefix)}&page=3&pageSize=2`,
      headers: { cookie },
    });
    expect(resP3.statusCode).toBe(200);
    const bodyP3 = resP3.json();
    expect(bodyP3.clients.length).toBe(1);
    expect(p1Ids.has(bodyP3.clients[0].id)).toBe(false);
    expect(p2Ids.has(bodyP3.clients[0].id)).toBe(false);
  });
});
