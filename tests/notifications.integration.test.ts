import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Permission, Role } from '@orium/contracts';
import {
  listNotificationsQuerySchema,
  notificationSchema,
  notificationListResponseSchema,
  notificationResponseSchema,
} from '@orium/contracts';
import { buildApp } from '../apps/api/src/app.js';
import { loadConfig } from '../apps/api/src/config.js';
import { connectDatabase, assertApplicationDatabase, type Database } from '../apps/api/src/db.js';
import { migrateDatabase } from '../apps/api/src/migrate.js';
import { IDENTITY_LOCK, provisionUser, authenticateInternal } from '../apps/api/src/identity.js';
import { createAuth, type Auth } from '../apps/api/src/auth.js';
import { markNotificationAsRead } from '../apps/api/src/notifications.js';

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

// Fase 7 incremento 2 — persistência e API pessoal da central de notificações
// (docs/PHASE7-INCREMENT2-CONTRACT.md). Real PostgreSQL orium_test only.
// Barriers observe real pg_locks filtered by current_database(); no sleeps as proof.

const ADVISORY_WAITERS = `SELECT count(*)::int AS n FROM pg_locks
  WHERE database = (SELECT oid FROM pg_database WHERE datname = current_database())
    AND locktype='advisory' AND classid=0 AND objid=$1 AND objsubid=1 AND NOT granted`;

// A waiter blocked on the row that belongs to a specific Holder PID.
const SESSION_ROW_WAITERS_ON_HOLDER = `SELECT count(*)::int AS n
  FROM pg_stat_activity
  WHERE datname = current_database()
    AND pid != pg_backend_pid()
    AND $1::int = ANY(pg_blocking_pids(pid))`;

const connectPoolClient = (dbInstance: Database) => dbInstance.pool.connect();
type ConnectedPoolClient = Awaited<ReturnType<typeof connectPoolClient>>;

describe('notifications central privacy/API/persistence against real PostgreSQL (Fase 7 incremento 2)', () => {
  let app: FastifyInstance | undefined;
  let database: Database | undefined;
  let authInstance: Auth | undefined;
  let migrator: Database | undefined;
  let migrationUrl: string;
  let admin: Fixture;
  let colabA: Fixture;
  let colabB: Fixture;
  let colabPg: Fixture;
  let colabPgCookie: string;
  const prefix = `notif-${randomUUID().slice(0, 8)}-`;
  const clientNamespace = `NotifyClient-${randomUUID().slice(0, 8)}-`;
  const password = randomBytes(24).toString('hex');
  const origin = 'http://127.0.0.1:5173';
  let requestIndex = 0;
  let fixtureSeq = 0;
  const userIds = new Set<string>();
  const clientIds = new Set<string>();
  const demandIds = new Set<string>();
  const taskIds = new Set<string>();
  const notificationIds = new Set<string>();
  const removedGrantsBySuite = new Set<string>();
  const insertedGrantsBySuite = new Set<string>();
  let baseline: Awaited<ReturnType<typeof captureBaseline>> | undefined;

  const persistFixtureIds = () => {
    mkdirSync('.local/phase7/increment2/tests', { recursive: true });
    writeFileSync('.local/phase7/increment2/tests/fixture-ids.json', JSON.stringify({ prefix, userIds: [...userIds], clientIds: [...clientIds], demandIds: [...demandIds], taskIds: [...taskIds], notificationIds: [...notificationIds] }, null, 2));
  };

  async function captureBaseline() {
    const grants = (await mig().pool.query<{ role_id: string; permission_id: string }>('SELECT role_id, permission_id FROM role_permission ORDER BY role_id, permission_id')).rows;
    const history: Record<string, { count: number; fingerprint: string }> = {};
    for (const table of ['identity_event', 'identity_event_subject']) {
      history[table] = (await mig().pool.query<{ count: number; fingerprint: string }>(`SELECT count(*)::int AS count, md5(coalesce(string_agg(to_jsonb(t)::text, '' ORDER BY to_jsonb(t)::text), '')) AS fingerprint FROM ${table} t`)).rows[0]!;
    }
    return { grants, history };
  }

  const db = () => {
    if (!database) throw new Error('Integration database was not initialized.');
    return database;
  };
  const mig = () => {
    if (!migrator) throw new Error('Migrator connection was not initialized.');
    return migrator;
  };

  const inject = (options: Omit<InjectOptions, 'remoteAddress'>) => {
    if (!app) throw new Error('Integration application was not initialized.');
    requestIndex += 1;
    return app.inject({
      ...options,
      remoteAddress: `127.2.${Math.floor(requestIndex / 250)}.${(requestIndex % 250) + 1}`,
    });
  };

  const fixtureUser = async (role: Role, label: string): Promise<Fixture> => {
    fixtureSeq += 1;
    const email = `${prefix}${label}-${fixtureSeq}-${randomUUID().slice(0, 8)}@example.test`;
    const created = await provisionUser(db(), { name: `Notify ${label} ${fixtureSeq}`, email, password, role });
    userIds.add(created.id);
    return { id: created.id, email };
  };

  const cookieFor = async (email: string): Promise<string> => {
    const response = await inject({
      method: 'POST',
      url: '/api/v1/auth/sign-in/email',
      headers: { origin, 'content-type': 'application/json' },
      payload: { email, password },
    });
    expect(response.statusCode).toBe(200);
    const values = response.headers['set-cookie'];
    const cookies = Array.isArray(values) ? values : values ? [values] : [];
    expect(cookies.length).toBeGreaterThan(0);
    return cookies.map((value) => value.split(';')[0]).join('; ');
  };

  const createFixtureClient = async (adminCookie: string, label: string): Promise<{ id: string; name: string }> => {
    const res = await inject({
      method: 'POST',
      url: '/api/v1/clients',
      headers: { origin, cookie: adminCookie, 'content-type': 'application/json' },
      payload: { name: `${clientNamespace}${label}` },
    });
    expect(res.statusCode).toBe(201);
    const client = (res.json() as { client: { id: string; name: string } }).client;
    clientIds.add(client.id);
    return client;
  };

  const createFixtureTask = async (
    adminCookie: string,
    demandId: string,
    assignedToUserId: string,
    label: string,
  ): Promise<{ id: string; assignedToUserId: string }> => {
    const res = await inject({
      method: 'POST',
      url: '/api/v1/tasks',
      headers: { origin, cookie: adminCookie, 'content-type': 'application/json' },
      payload: { demandId, assignedToUserId, title: `${label}`, priority: 'normal' },
    });
    expect(res.statusCode).toBe(201);
    const task = (res.json() as { task: { id: string; assignedToUserId: string } }).task;
    taskIds.add(task.id);
    return task;
  };

  interface InsertNotificationInput {
    recipientUserId: string;
    demandId: string;
    taskId: string | null;
    kind: string;
    sourceEventId?: string | null;
    sourceDeliveryDate?: string | null;
    createdAt?: string;
    readAt?: string | null;
    id?: string;
  }

  const insertNotification = async (input: InsertNotificationInput): Promise<void> => {
    const id = input.id ?? randomUUID();
    const createdAt = input.createdAt ?? 'now()';
    await mig().pool.query(
      `INSERT INTO notification
        (id, recipient_user_id, demand_id, task_id, kind, source_event_id, source_delivery_date, created_at, read_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, ${createdAt}, $8)`,
      [
        id,
        input.recipientUserId,
        input.demandId,
        input.taskId,
        input.kind,
        input.sourceEventId ?? null,
        input.sourceDeliveryDate ?? null,
        input.readAt ?? null,
      ],
    );
    notificationIds.add(id);
  };

  const insertDemandEvent = async (demandId: string, actorId: string, action: string): Promise<string> => {
    const id = randomUUID();
    await mig().pool.query(
      `INSERT INTO demand_event (id, demand_id, actor_id, actor_name, action, metadata)
       VALUES ($1, $2, $3, 'Notifica', $4, '{}'::jsonb)`,
      [id, demandId, actorId, action],
    );
    return id;
  };

  const revokePermissionOnMigrator = async (roleId: Role, permission: Permission) => {
    const key = `${roleId}:${permission}`;
    const res = await mig().pool.query(
      'DELETE FROM role_permission WHERE role_id = $1 AND permission_id = $2 RETURNING role_id, permission_id',
      [roleId, permission],
    );
    if ((res.rowCount ?? 0) > 0) removedGrantsBySuite.add(key);
  };

  const restorePermissionIfRevoked = async (roleId: Role, permission: Permission) => {
    const key = `${roleId}:${permission}`;
    if (!removedGrantsBySuite.has(key)) return;
    await mig().pool.query(
      'INSERT INTO role_permission (role_id, permission_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [roleId, permission],
    );
    removedGrantsBySuite.delete(key);
  };

  const waitForWaiters = async (n: number, timeoutMs = 15000) => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const current = (await mig().pool.query<{ n: number }>(ADVISORY_WAITERS, [IDENTITY_LOCK])).rows[0]!.n;
      if (current >= n) return current;
      if (Date.now() > deadline) {
        throw new Error(`Barrier timeout: expected ${n} IDENTITY_LOCK waiters, saw ${current}`);
      }
      await new Promise((resolve) => setImmediate(resolve));
    }
  };

  const waitForSessionRowBlockedOnHolder = async (holderPid: number, timeoutMs = 15000) => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const current = (
        await mig().pool.query<{ n: number }>(SESSION_ROW_WAITERS_ON_HOLDER, [holderPid])
      ).rows[0]!.n;
      if (current >= 1) return current;
      if (Date.now() > deadline) {
        throw new Error(
          `Barrier timeout: expected a session-row waiter blocked by holder PID ${holderPid}, saw ${current}`,
        );
      }
      await new Promise((resolve) => setImmediate(resolve));
    }
  };

  const holdIdentityLock = async (): Promise<ConnectedPoolClient> => {
    const client = await connectPoolClient(mig());
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [IDENTITY_LOCK]);
    return client;
  };

  const releaseLockClient = async (client: ConnectedPoolClient) => {
    try {
      await client.query('COMMIT');
    } finally {
      client.release();
    }
  };

  const releaseAndDrain = async <T,>(client: ConnectedPoolClient, requests: Array<Promise<T> | undefined>) => {
    let settled: PromiseSettledResult<T>[] = [];
    try {
      await releaseLockClient(client);
    } finally {
      settled = await Promise.allSettled(requests.filter((request): request is Promise<T> => request !== undefined));
    }
    return settled;
  };

  const sessionIdsFor = async (userId: string): Promise<string[]> => {
    const res = await mig().pool.query<{ id: string }>('SELECT id FROM auth_session WHERE user_id = $1', [userId]);
    return res.rows.map((r) => r.id);
  };

  const listHttp = async (cookie: string, query = '') => {
    return inject({
      method: 'GET',
      url: `/api/v1/notifications${query}`,
      headers: { origin, cookie },
    });
  };

  const readHttp = async (cookie: string, id: string) => {
    return inject({
      method: 'POST',
      url: `/api/v1/notifications/${id}/read`,
      headers: { origin, cookie, 'content-type': 'application/json' },
      payload: {},
    });
  };

  let adminCookie: string;
  let colabACookie: string;
  let colabBCookie: string;
  let clientA: { id: string; name: string };
  let demandA: { id: string; title: string; deliveryDate: string | null };

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
    baseline = await captureBaseline();
    const config = loadConfig({
      NODE_ENV: 'test',
      DATABASE_URL: applicationUrl,
      BETTER_AUTH_SECRET: randomBytes(32).toString('hex'),
      WEB_ORIGIN: origin,
      API_ORIGIN: 'http://127.0.0.1:3001',
      API_HOST: '127.0.0.1',
      API_PORT: '3001',
    });
    authInstance = createAuth(config, database);
    app = await buildApp({
      database,
      logger: false,
      config,
    });

    admin = await fixtureUser('administrator', 'admin');
    colabA = await fixtureUser('collaborator', 'colabA');
    colabB = await fixtureUser('collaborator', 'colabB');
    colabPg = await fixtureUser('collaborator', 'colabPg');
    adminCookie = await cookieFor(admin.email);
    colabACookie = await cookieFor(colabA.email);
    colabBCookie = await cookieFor(colabB.email);
    colabPgCookie = await cookieFor(colabPg.email);

    clientA = await createFixtureClient(adminCookie, 'Cliente-A');

    const resDemand = await inject({
      method: 'POST',
      url: '/api/v1/demands',
      headers: { origin, cookie: adminCookie, 'content-type': 'application/json' },
      payload: {
        clientId: clientA.id,
        title: `${prefix}Demanda Compartilhada`,
        description: 'Fixtures da central de notificações',
        priority: 'normal',
        deliveryDate: '2099-10-25',
      },
    });
    expect(resDemand.statusCode).toBe(201);
    demandA = (resDemand.json() as { demand: { id: string; title: string; deliveryDate: string } }).demand;
    demandIds.add(demandA.id);

    await createFixtureTask(adminCookie, demandA.id, colabA.id, `${prefix}Tarefa do Colab A`);
    await createFixtureTask(adminCookie, demandA.id, colabB.id, `${prefix}Tarefa do Colab B`);
    await createFixtureTask(adminCookie, demandA.id, colabPg.id, `${prefix}Tarefa do Colab Pg`);
  }, 60000);

  afterAll(async () => {
    persistFixtureIds();
    try {
      await app?.close();
    } finally {
      if (database && migrator) {
        try {
          const cleanupClient = await mig().pool.connect();
          try {
            await cleanupClient.query('BEGIN');
            await cleanupClient.query('SELECT pg_advisory_xact_lock($1)', [IDENTITY_LOCK]);
            for (const key of insertedGrantsBySuite) {
              const [roleId, permissionId] = key.split(':');
              await cleanupClient.query('DELETE FROM role_permission WHERE role_id=$1 AND permission_id=$2', [roleId, permissionId]);
            }
            for (const key of removedGrantsBySuite) {
              const [roleId, permissionId] = key.split(':');
              await cleanupClient.query('INSERT INTO role_permission VALUES ($1,$2) ON CONFLICT DO NOTHING', [roleId, permissionId]);
            }
            await cleanupClient.query('DELETE FROM notification WHERE id=ANY($1::uuid[]) OR recipient_user_id=ANY($2::text[])', [[...notificationIds], [...userIds]]);
            await cleanupClient.query('DELETE FROM demand WHERE id=ANY($1::uuid[])', [[...demandIds]]);
            await cleanupClient.query('DELETE FROM client WHERE id=ANY($1::uuid[])', [[...clientIds]]);
            await cleanupClient.query('DELETE FROM identity_event WHERE actor_id=ANY($1::text[]) OR target_user_id=ANY($1::text[])', [[...userIds]]);
            await cleanupClient.query('DELETE FROM identity_event_subject WHERE user_id=ANY($1::text[])', [[...userIds]]);
            await cleanupClient.query('DELETE FROM auth_user WHERE id=ANY($1::text[])', [[...userIds]]);
            await cleanupClient.query('COMMIT');
          } catch (error) {
            await cleanupClient.query('ROLLBACK');
            throw error;
          } finally {
            cleanupClient.release();
          }
          const after = await captureBaseline();
          const residues: Record<string, number> = {};
          for (const [table, column, ids, type] of [
            ['auth_user', 'id', [...userIds], 'text'], ['client', 'id', [...clientIds], 'uuid'],
            ['demand', 'id', [...demandIds], 'uuid'], ['task', 'id', [...taskIds], 'uuid'],
            ['notification', 'recipient_user_id', [...userIds], 'text'],
            ['demand_event', 'demand_id', [...demandIds], 'uuid'],
            ['identity_event', 'target_user_id', [...userIds], 'text'],
            ['identity_event_subject', 'user_id', [...userIds], 'text'],
          ] as const) {
            residues[table] = (await mig().pool.query<{ count: number }>(`SELECT count(*)::int AS count FROM ${table} WHERE ${column}=ANY($1::${type}[])`, [ids])).rows[0]!.count;
          }
          writeFileSync('.local/phase7/increment2/tests/cleanup-report.json', JSON.stringify({ at: new Date().toISOString(), baseline, after, residues }, null, 2));
          expect(after).toEqual(baseline);
          expect(Object.values(residues).every((count) => count === 0)).toBe(true);
        } finally {
          await migrator?.pool.end();
          await database.pool.end();
        }
      }
    }
  });

  describe('1. Schemas, vazio real e inputs estritos', () => {
    it('response e query validam os schemas públicos strict (sem campos privados de sessão)', async () => {
      const parsedQuery = listNotificationsQuerySchema.parse({ page: '1', pageSize: '20', unreadOnly: 'false' });
      expect(parsedQuery.unreadOnly).toBe(false);
      const parsedBool = listNotificationsQuerySchema.parse({ unreadOnly: 'true' });
      expect(parsedBool.unreadOnly).toBe(true);
      const parsedBoolean = listNotificationsQuerySchema.parse({ unreadOnly: false });
      expect(parsedBoolean.unreadOnly).toBe(false);
      expect(() => listNotificationsQuerySchema.parse({ unreadOnly: 'yes' })).toThrow();
      expect(() => listNotificationsQuerySchema.parse({ page: '0' })).toThrow();
      expect(() => listNotificationsQuerySchema.parse({ pageSize: '51' })).toThrow();
      expect(() => listNotificationsQuerySchema.parse({ extra: 'x' })).toThrow();
    });

    it('caixa vazia real retorna 200 com projeção vazia válida', async () => {
      const res = await listHttp(adminCookie, `?page=1&pageSize=20&unreadOnly=false`);
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(notificationListResponseSchema.safeParse(body).success).toBe(true);
      expect(body.notifications).toEqual([]);
      expect(body.total).toBe(0);
      expect(body.unreadCount).toBe(0);
      expect(body.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('rejeita query desconhecida e parâmetros inválidos na rota com 400', async () => {
      const a = await listHttp(adminCookie, '?unknown=1');
      expect(a.statusCode).toBe(400);
      const b = await listHttp(adminCookie, '?page=0');
      expect(b.statusCode).toBe(400);
      const c = await listHttp(adminCookie, '?pageSize=51');
      expect(c.statusCode).toBe(400);
      const d = await listHttp(adminCookie, '?unreadOnly=yes');
      expect(d.statusCode).toBe(400);
    });

    it('rejeita id não-UUID e corpo não-{} no POST read com 400', async () => {
      const internalOnly = await inject({
        method: 'POST',
        url: '/api/v1/notifications/not-a-uuid/read',
        headers: { origin, cookie: adminCookie, 'content-type': 'application/json' },
        payload: {},
      });
      expect(internalOnly.statusCode).toBe(400); // 400 (id inválido)
      const bodyStrict = await readHttp(adminCookie, randomUUID()); // body {} válido, aviso inexistente -> 404
      expect(bodyStrict.statusCode).toBe(404);

      // Rejeita corpo ausente com 400
      const noBody = await inject({
        method: 'POST',
        url: `/api/v1/notifications/${randomUUID()}/read`,
        headers: { origin, cookie: adminCookie, 'content-type': 'application/json' },
      });
      expect(noBody.statusCode).toBe(400);

      // Rejeita corpo null com 400
      const nullBody = await inject({
        method: 'POST',
        url: `/api/v1/notifications/${randomUUID()}/read`,
        headers: { origin, cookie: adminCookie, 'content-type': 'application/json' },
        payload: 'null',
      });
      expect(nullBody.statusCode).toBe(400);

      // Rejeita corpo array [] com 400
      const arrayBody = await inject({
        method: 'POST',
        url: `/api/v1/notifications/${randomUUID()}/read`,
        headers: { origin, cookie: adminCookie, 'content-type': 'application/json' },
        payload: [],
      });
      expect(arrayBody.statusCode).toBe(400);

      // Rejeita propriedades extras com 400
      const badBody = await inject({
        method: 'POST',
        url: `/api/v1/notifications/${randomUUID()}/read`,
        headers: { origin, cookie: adminCookie, 'content-type': 'application/json' },
        payload: { extra: 'x' },
      });
      expect(badBody.statusCode).toBe(400);
    });

    it('rejeita sem autenticação com 401 em GET e POST read', async () => {
      const g = await inject({ method: 'GET', url: '/api/v1/notifications', headers: { origin } });
      expect(g.statusCode).toBe(401);
      const p = await inject({
        method: 'POST',
        url: `/api/v1/notifications/${randomUUID()}/read`,
        headers: { origin, 'content-type': 'application/json' },
        payload: {},
      });
      expect(p.statusCode).toBe(401);
    });
  });

  describe('2. Persistência, ordenação, títulos atuais e paginação (recipiente dedicado colabPg, uma atribuição real)', () => {
    it('lista cronológica DESC, títulos atuais e deliveryDate da fonte', async () => {
      const oldEv = await insertDemandEvent(demandA.id, admin.id, 'demand_updated');
      await insertNotification({ recipientUserId: colabPg.id, demandId: demandA.id, taskId: null, kind: 'demand_important_change', sourceEventId: oldEv, createdAt: `'2026-10-01T00:00:00-04:00'::timestamptz` });
      const newEv = await insertDemandEvent(demandA.id, admin.id, 'demand_updated');
      await insertNotification({ recipientUserId: colabPg.id, demandId: demandA.id, taskId: null, kind: 'demand_important_change', sourceEventId: newEv, createdAt: `'2026-10-05T00:00:00-04:00'::timestamptz` });

      const res = await listHttp(colabPgCookie, '?page=1&pageSize=20');
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.notifications.length).toBe(3);
      expect(body.notifications[0].kind).toBe('task_assigned');
      const items = body.notifications.filter((item: { kind: string }) => item.kind === 'demand_important_change');
      expect(items.length).toBe(2);
      // created_at desc: a de 10-05 vem antes da de 10-01
      expect(new Date(items[0].createdAt).getTime()).toBeGreaterThan(new Date(items[1].createdAt).getTime());
      // títulos vêm dos recursos atuais
      expect(items[0].demandTitle).toBe(demandA.title);
      expect(items[0].taskId).toBeNull();
      expect(items[0].deliveryDate).toBe('2099-10-25'); // da demand corrente, não payload histórico
      expect(items[0].kind).toBe('demand_important_change');
      // não devolve campos de origem nem dados privados de sessão
      expect(body.notifications[0]).not.toHaveProperty('sourceEventId');
      expect(body.notifications[0]).not.toHaveProperty('recipientUserId');
      expect(body.notifications[0]).not.toHaveProperty('sessionId');
      expect(notificationSchema.safeParse(body.notifications[0]).success).toBe(true);
    });

    it('total/unreadCount independentes de página e unreadOnly filtra corretamente', async () => {
      // 3 avisos para colabPg: 2 não lidos + 1 lido
      const ev1 = await insertDemandEvent(demandA.id, admin.id, 'demand_updated');
      await insertNotification({ recipientUserId: colabPg.id, demandId: demandA.id, taskId: null, kind: 'demand_important_change', sourceEventId: ev1, createdAt: `'2026-10-06T00:00:00-04:00'::timestamptz` });
      const ev2 = await insertDemandEvent(demandA.id, admin.id, 'demand_updated');
      await insertNotification({ recipientUserId: colabPg.id, demandId: demandA.id, taskId: null, kind: 'demand_important_change', sourceEventId: ev2, createdAt: `'2026-10-07T00:00:00-04:00'::timestamptz` });
      const ev3 = await insertDemandEvent(demandA.id, admin.id, 'demand_updated');
      await insertNotification({ recipientUserId: colabPg.id, demandId: demandA.id, taskId: null, kind: 'demand_important_change', sourceEventId: ev3, createdAt: `'2026-10-08T00:00:00-04:00'::timestamptz`, readAt: '2026-10-09T00:00:00-04:00' });

      const all = await listHttp(colabPgCookie, '?page=1&pageSize=2');
      expect(all.statusCode).toBe(200);
      expect(all.json().total).toBe(6); // uma atribuição real + 2 do teste anterior + 3 deste
      expect(all.json().unreadCount).toBe(5); // uma atribuição real + 2 + 2 não lidos
      expect(all.json().notifications.length).toBe(2);

      const unread = await listHttp(colabPgCookie, '?page=1&pageSize=50&unreadOnly=true');
      expect(unread.statusCode).toBe(200);
      expect(unread.json().total).toBe(5);
      expect(unread.json().notifications.every((n: { readAt: string | null }) => n.readAt === null)).toBe(true);
      expect(unread.json().unreadCount).toBe(5);

      const page2 = await listHttp(colabPgCookie, '?page=2&pageSize=2');
      expect(page2.statusCode).toBe(200);
      expect(page2.json().total).toBe(6);
      expect(page2.json().unreadCount).toBe(5); // independente da página
    });
  });

  describe('3. Caixa pessoal, visibilidade e 404', () => {
    it('admin só lê avisos destinados a ele próprio; colaborador sem atribuição não vê avisos de demanda de terceiro', async () => {
      // Aviso de demanda destinado a colabA (que tem tarefa na demanda)
      const evA = await insertDemandEvent(demandA.id, admin.id, 'demand_updated');
      const colabAId = randomUUID();
      await insertNotification({ id: colabAId, recipientUserId: colabA.id, demandId: demandA.id, taskId: null, kind: 'demand_important_change', sourceEventId: evA });
      // Aviso próprio do admin na mesma demanda (para provar isolamento nos dois sentidos)
      const evAdmin = await insertDemandEvent(demandA.id, admin.id, 'demand_updated');
      const adminOwnId = randomUUID();
      await insertNotification({ id: adminOwnId, recipientUserId: admin.id, demandId: demandA.id, taskId: null, kind: 'demand_important_change', sourceEventId: evAdmin });

      // admin recebe o próprio, mas não o de colabA (caixa pessoal)
      const adminList = await listHttp(adminCookie, '?page=1&pageSize=50');
      const adminIds = adminList.json().notifications.map((n: { id: string }) => n.id);
      expect(adminIds).toContain(adminOwnId);
      expect(adminIds).not.toContain(colabAId);

      // colabA vê o próprio
      const colabAList = await listHttp(colabACookie, '?page=1&pageSize=50');
      const colabAIds = colabAList.json().notifications.map((n: { id: string }) => n.id);
      expect(colabAIds).toContain(colabAId);

      // Aviso alheio destinado ao colabB não aparece na caixa do colabA
      const evForeign = await insertDemandEvent(demandA.id, admin.id, 'demand_updated');
      const foreignId = randomUUID();
      await insertNotification({ id: foreignId, recipientUserId: colabB.id, demandId: demandA.id, taskId: null, kind: 'demand_important_change', sourceEventId: evForeign });
      const colabAList2 = await listHttp(colabACookie, '?page=1&pageSize=50');
      expect(colabAList2.json().notifications.some((n: { id: string }) => n.id === foreignId)).toBe(false);
    });

    it('aviso alheio responde 404 no POST read sem alterar o aviso', async () => {
      const ev = await insertDemandEvent(demandA.id, admin.id, 'demand_updated');
      const nid = randomUUID();
      await insertNotification({ id: nid, recipientUserId: colabB.id, demandId: demandA.id, taskId: null, kind: 'demand_important_change', sourceEventId: ev });
      const res = await readHttp(colabACookie, nid);
      expect(res.statusCode).toBe(404);
      // nada foi marcado como lido
      const row = await mig().pool.query<{ read_at: string | null }>('SELECT read_at FROM notification WHERE id = $1', [nid]);
      expect(row.rows[0]!.read_at).toBeNull();
    });

    it('404 após reatribuição (colaborador perde visibilidade da tarefa)', async () => {
      const taskColabA = (await inject({
        method: 'POST',
        url: '/api/v1/tasks',
        headers: { origin, cookie: adminCookie, 'content-type': 'application/json' },
        payload: { demandId: demandA.id, assignedToUserId: colabA.id, title: `${prefix}Reatribuída`, priority: 'normal' },
      }).then((r) => r.json()) as { task: { id: string } }).task;

      const ev = await insertDemandEvent(demandA.id, admin.id, 'task_assigned');
      const nid = randomUUID();
      await insertNotification({ id: nid, recipientUserId: colabA.id, demandId: demandA.id, taskId: taskColabA.id, kind: 'task_assigned', sourceEventId: ev });

      // visível para colabA agora (tarefa atribuída a ele)
      const before = await readHttp(colabACookie, nid);
      expect(before.statusCode).toBe(200);
      expect(before.json().notification.readAt).not.toBeNull();

      // admin reatribui a tarefa para colabB
      const reassign = await inject({
        method: 'POST',
        url: `/api/v1/tasks/${taskColabA.id}/reassign`,
        headers: { origin, cookie: adminCookie, 'content-type': 'application/json' },
        payload: { version: 1, assignedToUserId: colabB.id, reason: 'Reassigning for read test' },
      });
      expect(reassign.statusCode).toBe(200);

      // colabA perdeu a visibilidade: read da mesma notificação → 404
      const afterRead = await readHttp(colabACookie, nid);
      expect(afterRead.statusCode).toBe(404);
      // e a notificação não aparece mais na listagem do colabA
      const afterList = await listHttp(colabACookie, '?page=1&pageSize=50');
      expect(afterList.json().notifications.some((n: { id: string }) => n.id === nid)).toBe(false);
    });
  });

  describe('3b. Recurso atual mesmo quando a caixa é pessoal', () => {
    it('oculta tarefa de colega no mesmo chamado em items/counts/read', async () => {
      const task = (await mig().pool.query<{ id: string }>('SELECT id FROM task WHERE demand_id=$1 AND assigned_to_user_id=$2 LIMIT 1', [demandA.id, colabB.id])).rows[0]!;
      const before = (await listHttp(colabACookie, '?pageSize=50')).json();
      const id = randomUUID();
      const eventId = await insertDemandEvent(demandA.id, admin.id, 'task_created');
      await insertNotification({ id, recipientUserId: colabA.id, demandId: demandA.id, taskId: task.id, kind: 'task_assigned', sourceEventId: eventId });
      const response = await listHttp(colabACookie, '?pageSize=50');
      expect(response.statusCode).toBe(200);
      expect(response.json().total).toBe(before.total);
      expect(response.json().unreadCount).toBe(before.unreadCount);
      expect(response.json().notifications.some((item: { id: string }) => item.id === id)).toBe(false);
      expect((await readHttp(colabACookie, id)).statusCode).toBe(404);
      expect((await mig().pool.query('SELECT read_at FROM notification WHERE id=$1', [id])).rows[0].read_at).toBeNull();
    });

    it('nega tarefa/chamado incoerentes mesmo ao administrador destinatário', async () => {
      const response = await inject({ method: 'POST', url: '/api/v1/demands', headers: { origin, cookie: adminCookie, 'content-type': 'application/json' }, payload: { clientId: clientA.id, title: `${prefix}Other demand`, priority: 'normal', deliveryDate: '2099-10-25' } });
      expect(response.statusCode).toBe(201);
      const otherDemandId = response.json().demand.id as string;
      demandIds.add(otherDemandId);
      const ownTask = await createFixtureTask(adminCookie, demandA.id, colabA.id, `${prefix}Coherence task`);
      const eventId = await insertDemandEvent(otherDemandId, admin.id, 'task_created');
      for (const [recipient, cookie] of [[colabA, colabACookie], [admin, adminCookie]] as const) {
        const before = (await listHttp(cookie, '?pageSize=50')).json();
        const id = randomUUID();
        await insertNotification({ id, recipientUserId: recipient.id, demandId: otherDemandId, taskId: ownTask.id, kind: 'task_assigned', sourceEventId: eventId });
        const after = await listHttp(cookie, '?pageSize=50');
        expect(after.statusCode).toBe(200);
        expect(after.json().total).toBe(before.total);
        expect(after.json().unreadCount).toBe(before.unreadCount);
        expect(after.json().notifications.some((item: { id: string }) => item.id === id)).toBe(false);
        expect((await readHttp(cookie, id)).statusCode).toBe(404);
        expect((await mig().pool.query('SELECT read_at FROM notification WHERE id=$1', [id])).rows[0].read_at).toBeNull();
      }
    });
  });

  describe('4. Leitura idempotente, concorrente e proteções de transporte', () => {
    it('POST read marca e a segunda chamada preserva o primeiro readAt', async () => {
      const ev = await insertDemandEvent(demandA.id, admin.id, 'demand_updated');
      const nid = randomUUID();
      await insertNotification({ id: nid, recipientUserId: admin.id, demandId: demandA.id, taskId: null, kind: 'demand_important_change', sourceEventId: ev });

      const r1 = await readHttp(adminCookie, nid);
      expect(r1.statusCode).toBe(200);
      expect(notificationResponseSchema.safeParse(r1.json()).success).toBe(true);
      expect(r1.json().notification.id).toBe(nid);
      const readAt1 = r1.json().notification.readAt;
      expect(readAt1).not.toBeNull();

      // aguardar mínimo para diferenciar timestamp de leitura (clock_timestamp distinto se reexecutasse)
      await new Promise((resolve) => setTimeout(resolve, 30));
      const r2 = await readHttp(adminCookie, nid);
      expect(r2.statusCode).toBe(200);
      expect(r2.json().notification.readAt).toBe(readAt1);
    });

    it('leituras concorrentes do mesmo aviso preservam um único readAt (sem duplicação)', async () => {
      const ev = await insertDemandEvent(demandA.id, admin.id, 'demand_updated');
      const nid = randomUUID();
      await insertNotification({ id: nid, recipientUserId: admin.id, demandId: demandA.id, taskId: null, kind: 'demand_important_change', sourceEventId: ev });

      const [a, b] = await Promise.all([readHttp(adminCookie, nid), readHttp(adminCookie, nid)]);
      expect(a.statusCode).toBe(200);
      expect(b.statusCode).toBe(200);
      expect(a.json().notification.readAt).toBe(b.json().notification.readAt);
      const row = await mig().pool.query<{ read_at: string | Date }>('SELECT read_at FROM notification WHERE id = $1', [nid]);
      expect(row.rows[0]?.read_at).toBeTruthy();
    });

    it('404 não altera o aviso; mutation sem origin → 403; content-type errado → 415', async () => {
      const ev = await insertDemandEvent(demandA.id, admin.id, 'demand_updated');
      const nid = randomUUID();
      await insertNotification({ id: nid, recipientUserId: colabB.id, demandId: demandA.id, taskId: null, kind: 'demand_important_change', sourceEventId: ev });

      // colabB vê e lê sua própria notificação
      const ok = await readHttp(colabBCookie, nid);
      expect(ok.statusCode).toBe(200);

      // Origin estrangeira/ausente em POST read → 403 ORIGIN_REJECTED ou 415 JSON (a hook aplica antes da rota)
      const crossOrigin = await inject({
        method: 'POST',
        url: `/api/v1/notifications/${nid}/read`,
        headers: { origin: 'http://evil.example', cookie: colabBCookie, 'content-type': 'application/json' },
        payload: {},
      });
      expect(crossOrigin.statusCode).toBe(403);

      const missingContentType = await inject({
        method: 'POST',
        url: `/api/v1/notifications/${nid}/read`,
        headers: { origin, cookie: colabBCookie, 'content-type': 'text/plain' },
        payload: '{}',
      });
      expect(missingContentType.statusCode).toBe(415);

      // headers de segurança presentes em respostas de erro
      for (const res of [crossOrigin, missingContentType]) {
        expect(res.headers['x-content-type-options']).toBe('nosniff');
      }
    });
  });

  describe('5. Sessão e autorização em voo (barreiras pg_locks/current_database e PID)', () => {
    it('expiração durante espera pelo advisory → 401, sem prender o recurso', async () => {
      const ev = await insertDemandEvent(demandA.id, admin.id, 'demand_updated');
      await insertNotification({ recipientUserId: admin.id, demandId: demandA.id, taskId: null, kind: 'demand_important_change', sourceEventId: ev });
      const holder = await holdIdentityLock();
      let pending: Promise<Awaited<ReturnType<typeof inject>>> | undefined;
      let settled: PromiseSettledResult<Awaited<ReturnType<typeof inject>>>[] = [];
      try {
        pending = listHttp(adminCookie, '?page=1&pageSize=20');
        await waitForWaiters(1);
        // expire enquanto espera
        await mig().pool.query('UPDATE auth_session SET expires_at = now() - interval \'1 second\' WHERE user_id = $1', [admin.id]);
      } finally {
        settled = await releaseAndDrain(holder, [pending]);
      }
      expect(settled[0]?.status).toBe('fulfilled');
      const res = (settled[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof inject>>>).value;
      expect(res.statusCode).toBe(401);
    });

    it('sessão revogada (linha removida durante espera) → 401', async () => {
      const ev = await insertDemandEvent(demandA.id, admin.id, 'demand_updated');
      await insertNotification({ recipientUserId: colabB.id, demandId: demandA.id, taskId: null, kind: 'demand_important_change', sourceEventId: ev });
      const newCookie = await cookieFor(colabB.email);
      const sessionIds = await sessionIdsFor(colabB.id);
      expect(sessionIds.length).toBeGreaterThan(0);

      const holder = await holdIdentityLock();
      let pending: Promise<Awaited<ReturnType<typeof inject>>> | undefined;
      let settled: PromiseSettledResult<Awaited<ReturnType<typeof inject>>>[] = [];
      try {
        pending = listHttp(newCookie, '?page=1&pageSize=20');
        await waitForWaiters(1);
        await mig().pool.query('DELETE FROM auth_session WHERE id = ANY($1::text[])', [sessionIds]);
      } finally {
        settled = await releaseAndDrain(holder, [pending]);
      }
      expect(settled[0]?.status).toBe('fulfilled');
      const res = (settled[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof inject>>>).value;
      expect(res.statusCode).toBe(401);
    });

    it('desativação em voo → 401 e revogação de grants em voo → 403', async () => {
      const ev = await insertDemandEvent(demandA.id, admin.id, 'demand_updated');
      const notifId = randomUUID();
      await insertNotification({ id: notifId, recipientUserId: colabB.id, demandId: demandA.id, taskId: null, kind: 'demand_important_change', sourceEventId: ev });
      const newCookieB = await cookieFor(colabB.email);

      // desativação em voo
      const deactHolder = await holdIdentityLock();
      let deactPending: Promise<Awaited<ReturnType<typeof inject>>> | undefined;
      let deactSettled: PromiseSettledResult<Awaited<ReturnType<typeof inject>>>[] = [];
      try {
        deactPending = listHttp(newCookieB, '?page=1&pageSize=20');
        await waitForWaiters(1);
        await mig().pool.query('UPDATE auth_user SET active = false, updated_at = now() WHERE id = $1', [colabB.id]);
      } finally {
        try {
          deactSettled = await releaseAndDrain(deactHolder, [deactPending]);
        } finally {
          await mig().pool.query('UPDATE auth_user SET active = true, updated_at = now() WHERE id = $1', [colabB.id]);
        }
      }
      expect(deactSettled[0]?.status).toBe('fulfilled');
      const deactRes = (deactSettled[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof inject>>>).value;
      expect(deactRes.statusCode).toBe(401);

      // revogação de grant em voo: cookieFor obtido ANTES do advisory lock!
      const rebooted = await cookieFor(colabB.email);
      const revokeHolder = await holdIdentityLock();
      let revokePending: Promise<Awaited<ReturnType<typeof inject>>> | undefined;
      let revokeSettled: PromiseSettledResult<Awaited<ReturnType<typeof inject>>>[] = [];
      try {
        revokePending = listHttp(rebooted, '?page=1&pageSize=20');
        await waitForWaiters(1);
        await revokePermissionOnMigrator('collaborator', 'demands.read');
        await revokePermissionOnMigrator('collaborator', 'tasks.read');
      } finally {
        try {
          revokeSettled = await releaseAndDrain(revokeHolder, [revokePending]);
        } finally {
          await restorePermissionIfRevoked('collaborator', 'demands.read');
          await restorePermissionIfRevoked('collaborator', 'tasks.read');
        }
      }
      expect(revokeSettled[0]?.status).toBe('fulfilled');
      const revokeRes = (revokeSettled[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof inject>>>).value;
      expect(revokeRes.statusCode).toBe(403);

      // POST read negativo também comprova que readAt permanece NULL
      const postNegCookie = await cookieFor(colabB.email);
      const postHolder = await holdIdentityLock();
      let postPending: Promise<Awaited<ReturnType<typeof inject>>> | undefined;
      let postSettled: PromiseSettledResult<Awaited<ReturnType<typeof inject>>>[] = [];
      try {
        postPending = readHttp(postNegCookie, notifId);
        await waitForWaiters(1);
        await revokePermissionOnMigrator('collaborator', 'demands.read');
      } finally {
        try {
          postSettled = await releaseAndDrain(postHolder, [postPending]);
        } finally {
          await restorePermissionIfRevoked('collaborator', 'demands.read');
        }
      }
      expect(postSettled[0]?.status).toBe('fulfilled');
      const postRes = (postSettled[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof inject>>>).value;
      expect(postRes.statusCode).toBe(403);
      const row = await mig().pool.query<{ read_at: string | null }>('SELECT read_at FROM notification WHERE id = $1', [notifId]);
      expect(row.rows[0]?.read_at).toBeNull();
    });

    it('expiração natural durante a espera na linha da sessão após advisory → 401', async () => {
      const ev = await insertDemandEvent(demandA.id, admin.id, 'demand_updated');
      const notifId = randomUUID();
      await insertNotification({ id: notifId, recipientUserId: colabA.id, demandId: demandA.id, taskId: null, kind: 'demand_important_change', sourceEventId: ev });

      const colabCookie = await cookieFor(colabA.email);

      // 1. Autentica contexto interno real antes
      const sessionAuth = await authenticateInternal(db(), authInstance!, { cookie: colabCookie });
      const sessionId = sessionAuth.sessionId;

      // 2. Fixa expires_at no banco com clock_timestamp() + deadline curto
      await mig().pool.query("UPDATE auth_session SET expires_at = clock_timestamp() + interval '250 milliseconds' WHERE id = $1", [sessionId]);

      // 3. Holder no migrator trava a linha da sessão FOR UPDATE sem modificar
      const holder = await connectPoolClient(mig());
      await holder.query('BEGIN');
      const holderPid = (await holder.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
      await holder.query('SELECT id FROM auth_session WHERE id = $1 FOR UPDATE', [sessionId]);

      let pending: Promise<unknown> | undefined;
      let settled: PromiseSettledResult<unknown>[] = [];
      try {
        // 4. Serviço real recebe o contexto interno autenticado e inicia markNotificationAsRead
        pending = markNotificationAsRead(db(), sessionAuth, notifId);

        // 5. Barreira: confirma que o serviço está bloqueado na linha da sessão esperando o holderPid
        await waitForSessionRowBlockedOnHolder(holderPid);
        const heldAdvisory = await mig().pool.query<{ count: number }>(`SELECT count(*)::int AS count FROM pg_locks WHERE database=(SELECT oid FROM pg_database WHERE datname=current_database()) AND locktype='advisory' AND objid=$1 AND granted AND $2::int=ANY(pg_blocking_pids(pid))`, [IDENTITY_LOCK, holderPid]);
        expect(heldAdvisory.rows[0]!.count).toBe(1);

        // 6. Aguarda o banco clock_timestamp() >= expires_at com polling limitado
        const pollDeadline = Date.now() + 5000;
        let expired = false;
        while (Date.now() < pollDeadline) {
          const check = await mig().pool.query<{ is_expired: boolean }>(
            'SELECT (clock_timestamp() >= expires_at) AS is_expired FROM auth_session WHERE id = $1',
            [sessionId],
          );
          if (check.rows[0]?.is_expired) {
            expired = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 30));
        }
        expect(expired).toBe(true);
      } finally {
        // 7. Libera o holder
        settled = await releaseAndDrain(holder, [pending]);
      }

      // 8. Drena: o serviço adquire o lock FOR SHARE e na validação subsequente detecta expiração temporal -> 401
      expect(settled[0]?.status).toBe('rejected');
      const err = (settled[0] as PromiseRejectedResult).reason;
      expect(err).toMatchObject({ status: 401, code: 'UNAUTHENTICATED' });

      // Confirma que o aviso não foi marcado como lido
      const notifCheck = await mig().pool.query<{ read_at: string | null }>('SELECT read_at FROM notification WHERE id = $1', [notifId]);
      expect(notifCheck.rows[0]?.read_at).toBeNull();
    });

    it('sign-out concorrente bloqueado pela linha da sessão mantida pelo serviço notification (barreiras reais PID)', async () => {
      const ev = await insertDemandEvent(demandA.id, admin.id, 'demand_updated');
      const notifId = randomUUID();
      await insertNotification({ id: notifId, recipientUserId: colabA.id, demandId: demandA.id, taskId: null, kind: 'demand_important_change', sourceEventId: ev });

      const colabCookie = await cookieFor(colabA.email);
      const sessionIds = await sessionIdsFor(colabA.id);
      expect(sessionIds.length).toBeGreaterThan(0);
      const currentSessionId = (await authenticateInternal(db(), authInstance!, { cookie: colabCookie })).sessionId;

      // 1. Holder manual no migrator bloqueia a linha da NOTIFICATION (FOR UPDATE)
      const notifHolder = await connectPoolClient(mig());
      await notifHolder.query('BEGIN');
      const notifHolderPid = (await notifHolder.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
      await notifHolder.query('SELECT id FROM notification WHERE id = $1 FOR UPDATE', [notifId]);

      let readPending: Promise<Awaited<ReturnType<typeof inject>>> | undefined;
      let signOutPending: Promise<Awaited<ReturnType<typeof inject>>> | undefined;
      let settled: PromiseSettledResult<Awaited<ReturnType<typeof inject>>>[] = [];

      try {
        // 2. Serviço real de notificações inicia POST read.
        // Adquire advisory e FOR SHARE em auth_session, e bloqueia em notification FOR UPDATE
        readPending = readHttp(colabCookie, notifId);

        // 3. Aguarda o backend do serviço estar esperando pelo notifHolderPid
        const pollDeadline = Date.now() + 15000;
        let centralPid: number | undefined;
        while (Date.now() < pollDeadline) {
          const res = await mig().pool.query<{ pid: number }>(
            `SELECT a.pid
             FROM pg_stat_activity a
             WHERE a.datname = current_database()
               AND a.pid != pg_backend_pid()
               AND $1::int = ANY(pg_blocking_pids(a.pid))`,
            [notifHolderPid],
          );
          if (res.rows.length > 0) {
            centralPid = res.rows[0]!.pid;
            break;
          }
          await new Promise((resolve) => setImmediate(resolve));
        }
        expect(centralPid).toBeDefined();

        // 4. Inicia sign-out do colabA (DELETE FROM auth_session espera centralPid que mantém FOR SHARE)
        signOutPending = inject({
          method: 'POST',
          url: '/api/v1/auth/sign-out',
          headers: { origin, cookie: colabCookie, 'content-type': 'application/json' },
          payload: {},
        });

        // 5. Confirma barreira: sign-out está bloqueado na linha da sessão esperando centralPid
        await waitForSessionRowBlockedOnHolder(centralPid!);
      } finally {
        // 6. Libera o holder da notificação
        settled = await releaseAndDrain(notifHolder, [readPending, signOutPending]);
      }

      // 7. Drena ambas as operações
      expect(settled[0]?.status).toBe('fulfilled');
      expect(settled[1]?.status).toBe('fulfilled');

      const readRes = (settled[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof inject>>>).value;
      const signOutRes = (settled[1] as PromiseFulfilledResult<Awaited<ReturnType<typeof inject>>>).value;

      expect(readRes.statusCode).toBe(200);
      expect(signOutRes.statusCode).toBe(200);

      // Confirma que a notificação foi marcada como lida
      const notifCheck = await mig().pool.query<{ read_at: string | null }>('SELECT read_at FROM notification WHERE id = $1', [notifId]);
      expect(notifCheck.rows[0]?.read_at).not.toBeNull();

      // Confirma que a sessão foi removida
      const afterSessions = await sessionIdsFor(colabA.id);
      expect(afterSessions).not.toContain(currentSessionId);
      expect(afterSessions.sort()).toEqual(sessionIds.filter((id) => id !== currentSessionId).sort());
    });

    it('exclui os quatro kinds temporais em listagem, total, unreadCount e POST read (404 com readAt intacto)', async () => {
      const temporalKinds = ['task_due_today', 'task_due_soon', 'task_overdue', 'demand_overdue'] as const;
      const taskColabA = await createFixtureTask(await cookieFor(admin.email), demandA.id, colabA.id, `${prefix}Temporal Task Scope`);

      const createdIds: string[] = [];
      for (const kind of temporalKinds) {
        const id = randomUUID();
        createdIds.push(id);
        const isTask = kind.startsWith('task_');
        await insertNotification({
          id,
          recipientUserId: colabA.id,
          demandId: demandA.id,
          taskId: isTask ? taskColabA.id : null,
          kind,
          sourceDeliveryDate: '2099-10-25',
          createdAt: `'2026-10-10T10:00:00-04:00'::timestamptz`,
        });
      }

      // listagem do colabA não deve conter nenhum dos kinds temporais
      const listRes = await listHttp(colabACookie, '?page=1&pageSize=50');
      expect(listRes.statusCode).toBe(200);
      const listData = listRes.json();
      for (const id of createdIds) {
        expect(listData.notifications.some((n: { id: string }) => n.id === id)).toBe(false);
      }

      // POST read para cada aviso temporal deve retornar 404 e manter read_at intacto
      for (const id of createdIds) {
        const readRes = await readHttp(colabACookie, id);
        expect(readRes.statusCode).toBe(404);

        const check = await mig().pool.query<{ read_at: string | null }>('SELECT read_at FROM notification WHERE id = $1', [id]);
        expect(check.rows[0]?.read_at).toBeNull();
      }
    });
  });

  describe('6. Constraints, deduplicação, FKs e privilégios do papel app', () => {
    it('aplica CHECK de kind, origem única e coerência kind/recurso', async () => {
      // kind inválido
      await expect(mig().pool.query(
        `INSERT INTO notification (id, recipient_user_id, demand_id, task_id, kind, source_event_id, source_delivery_date, created_at)
         VALUES ($1, $2, $3, NULL, 'invalid_kind', $4, NULL, now())`,
        [randomUUID(), colabB.id, demandA.id, randomUUID()],
      )).rejects.toMatchObject({ code: '23514' });

      // ambas as origens → viola XOR
      await expect(mig().pool.query(
        `INSERT INTO notification (id, recipient_user_id, demand_id, task_id, kind, source_event_id, source_delivery_date, created_at)
         VALUES ($1, $2, $3, NULL, 'task_assigned', $4, '2099-10-25', now())`,
        [randomUUID(), colabB.id, demandA.id, randomUUID()],
      )).rejects.toMatchObject({ code: '23514' });

      // task_assigned sem task_id → viola notification_kind_task_check
      await expect(mig().pool.query(
        `INSERT INTO notification (id, recipient_user_id, demand_id, task_id, kind, source_event_id, source_delivery_date, created_at)
         VALUES ($1, $2, $3, NULL, 'task_assigned', $4, NULL, now())`,
        [randomUUID(), colabB.id, demandA.id, randomUUID()],
      )).rejects.toMatchObject({ code: '23514' });

      // kind de calendário exige source_delivery_date (notification_kind_source_check)
      await expect(mig().pool.query(
        `INSERT INTO notification (id, recipient_user_id, demand_id, task_id, kind, source_event_id, source_delivery_date, created_at)
         VALUES ($1, $2, $3, NULL, 'demand_overdue', NULL, NULL, now())`,
        [randomUUID(), colabB.id, demandA.id],
      )).rejects.toMatchObject({ code: '23514' });
    });

    it('deduplica evento/recipiente e calendário com task NULL; repete sem duplicar', async () => {
      const ev = await insertDemandEvent(demandA.id, admin.id, 'task_assigned_1');
      const firstEventId = randomUUID();
      await insertNotification({ id: firstEventId, recipientUserId: colabA.id, demandId: demandA.id, taskId: null, kind: 'demand_important_change', sourceEventId: ev, createdAt: `'2026-10-02T09:00:00-04:00'::timestamptz` });

      // mesmo recipiente+kind+source_event_id → unique (parcial) rejeita
      await expect(mig().pool.query(
        `INSERT INTO notification (id, recipient_user_id, demand_id, task_id, kind, source_event_id, source_delivery_date, created_at)
         VALUES ($1, $2, $3, NULL, 'demand_important_change', $4, NULL, now())`,
        [randomUUID(), colabA.id, demandA.id, ev],
      )).rejects.toMatchObject({ code: '23505' });

      // calendário com task NULL: mesma base (recipient, kind, demand, delivery) → unique rejeita 2ª quando mesmas data
      const calId = randomUUID();
      await mig().pool.query(
        `INSERT INTO notification (id, recipient_user_id, demand_id, task_id, kind, source_event_id, source_delivery_date, created_at)
         VALUES ($1, $2, $3, NULL, 'demand_overdue', NULL, '2099-10-25', now())`,
        [calId, colabB.id, demandA.id],
      );
      notificationIds.add(calId);
      await expect(mig().pool.query(
        `INSERT INTO notification (id, recipient_user_id, demand_id, task_id, kind, source_event_id, source_delivery_date, created_at)
         VALUES ($1, $2, $3, NULL, 'demand_overdue', NULL, '2099-10-25', now())`,
        [randomUUID(), colabB.id, demandA.id],
      )).rejects.toMatchObject({ code: '23505' });
    });

    it('FK deleta aviso em cascata quando recurso/usuário é removido (cleanup cirúrgico preserva baseline)', async () => {
      const ev = await insertDemandEvent(demandA.id, admin.id, 'demand_updated');
      const nid = randomUUID();
      await insertNotification({ id: nid, recipientUserId: colabA.id, demandId: demandA.id, taskId: null, kind: 'demand_important_change', sourceEventId: ev });

      // notificação existe
      expect((await mig().pool.query<{ n: number }>('SELECT count(*)::int AS n FROM notification WHERE id = $1', [nid])).rows[0]!.n).toBe(1);

      // remover o demand_event da origem cascateia para a notificação
      await mig().pool.query('DELETE FROM demand_event WHERE id = $1', [ev]);
      notificationIds.delete(nid);
      expect((await mig().pool.query<{ n: number }>('SELECT count(*)::int AS n FROM notification WHERE id = $1', [nid])).rows[0]!.n).toBe(0);
    });

    it('concede apenas SELECT/INSERT/UPDATE(read_at) ao papel app e nega DELETE/UPDATE noutras colunas', async () => {
      const ev = await insertDemandEvent(demandA.id, admin.id, 'demand_updated');
      const nid = randomUUID();
      await insertNotification({ id: nid, recipientUserId: admin.id, demandId: demandA.id, taskId: null, kind: 'demand_important_change', sourceEventId: ev });

      // app consegue SELECT e UPDATE(read_at)
      const select = await db().pool.query('SELECT id FROM notification WHERE id = $1', [nid]);
      expect(select.rows.length).toBe(1);
      await db().pool.query('UPDATE notification SET read_at = now() WHERE id = $1', [nid]);

      // app NÃO pode apagar avisos (DELETE negado)
      await expect(db().pool.query('DELETE FROM notification WHERE id = $1', [nid])).rejects.toMatchObject({ code: '42501' });
      // app NÃO pode alterar colunas imutáveis (kind/recipient/etc. — UPDATE apenas para read_at)
      await expect(db().pool.query('UPDATE notification SET kind = \'task_approved\' WHERE id = $1', [nid])).rejects.toMatchObject({ code: '42501' });
      await expect(db().pool.query('UPDATE notification SET recipient_user_id = $1 WHERE id = $2', [colabA.id, nid])).rejects.toMatchObject({ code: '42501' });
      // TRUNCATE negado
      await expect(db().pool.query('TRUNCATE notification')).rejects.toMatchObject({ code: '42501' });
    });
  });
});
