import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Permission, Role } from '@orium/contracts';
import { buildApp } from '../apps/api/src/app.js';
import { loadConfig } from '../apps/api/src/config.js';
import { connectDatabase, assertApplicationDatabase, type Database } from '../apps/api/src/db.js';
import { migrateDatabase } from '../apps/api/src/migrate.js';
import { IDENTITY_LOCK, provisionUser } from '../apps/api/src/identity.js';

const connectPoolClient = (dbInstance: Database) => dbInstance.pool.connect();
type ConnectedPoolClient = Awaited<ReturnType<typeof connectPoolClient>>;

// Fase 7 incremento 1 — segurança transacional dos 16 produtores de eventos de demandas/tarefas/comentários
// (docs/PHASE7-INCREMENT1-CONTRACT.md). Real PostgreSQL orium_test only.
// Barriers observe real pg_locks filtered by the current database OID; no sleeps as proof.
// No mocks, no skips. Cleanup only of this run's own fixtures and permission diffs.

function testDatabaseUrl(key: string, expectedRole: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`${key} is required: integration tests need real PostgreSQL, without skips.`);
  const parsed = new URL(value);
  if (
    parsed.pathname !== '/orium_test' ||
    parsed.username !== expectedRole ||
    !['postgres:', 'postgresql:'].includes(parsed.protocol) ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)
  ) {
    throw new Error(`${key} must target local orium_test using ${expectedRole}.`);
  }
  return value;
}

type Fixture = { id: string; email: string };

const ADVISORY_WAITERS = `SELECT count(*)::int AS n FROM pg_locks
  WHERE database = (SELECT oid FROM pg_database WHERE datname = current_database())
    AND locktype='advisory' AND classid=0 AND objid=$1 AND objsubid=1 AND NOT granted`;

const ADVISORY_HOLDER_WAITING_ON_ROW = `SELECT count(*)::int AS n FROM pg_locks adv_hold
  JOIN pg_locks row_wait ON adv_hold.pid = row_wait.pid
  WHERE adv_hold.database = (SELECT oid FROM pg_database WHERE datname = current_database())
    AND adv_hold.locktype = 'advisory'
    AND adv_hold.classid = 0
    AND adv_hold.objid = $1
    AND adv_hold.objsubid = 1
    AND adv_hold.granted
    AND NOT row_wait.granted
    AND row_wait.locktype IN ('relation', 'tuple', 'transactionid')
    AND (pg_blocking_pids(row_wait.pid) @> ARRAY[$2::int])`;

describe('demands/tasks/comments transactional authorization against real PostgreSQL', () => {
  let app: FastifyInstance | undefined;
  let database: Database | undefined;
  let migrator: Database | undefined;
  const prefix = `dem-auth-${randomUUID().slice(0, 8)}-`;
  const clientNamePrefix = `DemAuthClient-${randomUUID().slice(0, 8)}-`;
  const password = randomBytes(24).toString('hex');
  const origin = 'http://127.0.0.1:5173';
  const userIds = new Set<string>();
  const clientIds = new Set<string>();
  const demandIds = new Set<string>();
  const removedGrantsBySuite = new Set<string>();
  const insertedGrantsBySuite = new Set<string>();
  let rolesBefore: string[] = [];
  let identityEventsTotalBefore = 0;
  let requestIndex = 0;
  let fixtureSeq = 0;

  const db = () => {
    if (!database) throw new Error('Integration database was not initialized.');
    return database;
  };
  const mig = () => {
    if (!migrator) throw new Error('Migrator connection was not initialized.');
    return migrator;
  };

  const queryRolePermissionSnapshot = async (): Promise<string[]> => {
    const res = await mig().pool.query<{ role_id: string; permission_id: string }>(
      `SELECT role_id, permission_id FROM role_permission ORDER BY role_id, permission_id`,
    );
    return res.rows.map((r) => `${r.role_id}:${r.permission_id}`);
  };

  const inject = (options: Omit<InjectOptions, 'remoteAddress'>) => {
    if (!app) throw new Error('Integration application was not initialized.');
    requestIndex += 1;
    return app.inject({
      ...options,
      remoteAddress: `127.3.${Math.floor(requestIndex / 250)}.${(requestIndex % 250) + 1}`,
    });
  };

  const fixture = async (role: Role): Promise<Fixture> => {
    fixtureSeq += 1;
    const email = `${prefix}${fixtureSeq}-${randomUUID().slice(0, 8)}@example.test`;
    const created = await provisionUser(db(), { name: `Demand Auth ${role} ${fixtureSeq}`, email, password, role });
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

  const waitForHolderBlockedOnRow = async (rowHolderPid: number, timeoutMs = 15000) => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const current = (
        await mig().pool.query<{ n: number }>(ADVISORY_HOLDER_WAITING_ON_ROW, [IDENTITY_LOCK, rowHolderPid])
      ).rows[0]!.n;
      if (current >= 1) return current;
      if (Date.now() > deadline) {
        throw new Error(
          `Barrier timeout: expected IDENTITY_LOCK holder blocked on row lock by PID ${rowHolderPid}, saw ${current}`,
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

  const revokePermissionOnClient = async (client: ConnectedPoolClient, roleId: Role, permission: Permission) => {
    const key = `${roleId}:${permission}`;
    const res = await client.query(
      'DELETE FROM role_permission WHERE role_id = $1 AND permission_id = $2 RETURNING role_id, permission_id',
      [roleId, permission],
    );
    if ((res.rowCount ?? 0) > 0) {
      removedGrantsBySuite.add(key);
    }
  };

  const restorePermission = async (roleId: Role, permission: Permission) => {
    const key = `${roleId}:${permission}`;
    if (!removedGrantsBySuite.has(key)) {
      return;
    }
    await mig().pool.query(
      'INSERT INTO role_permission (role_id, permission_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [roleId, permission],
    );
    removedGrantsBySuite.delete(key);
  };

  const grantExtraPermissionOnClient = async (client: ConnectedPoolClient, roleId: Role, permission: Permission) => {
    const key = `${roleId}:${permission}`;
    const res = await client.query(
      'INSERT INTO role_permission (role_id, permission_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING role_id, permission_id',
      [roleId, permission],
    );
    if ((res.rowCount ?? 0) > 0) {
      insertedGrantsBySuite.add(key);
    }
  };

  const removeExtraPermission = async (roleId: Role, permission: Permission) => {
    const key = `${roleId}:${permission}`;
    if (!insertedGrantsBySuite.has(key)) {
      return;
    }
    const res = await mig().pool.query(
      'DELETE FROM role_permission WHERE role_id = $1 AND permission_id = $2',
      [roleId, permission],
    );
    expect(res.rowCount).toBe(1);
    insertedGrantsBySuite.delete(key);
  };

  const createTestClientRecord = async (adminCookie: string, label: string): Promise<string> => {
    const res = await inject({
      method: 'POST',
      url: '/api/v1/clients',
      headers: { origin, cookie: adminCookie, 'content-type': 'application/json' },
      payload: { name: `${clientNamePrefix}${label}` },
    });
    expect(res.statusCode).toBe(201);
    const id = (res.json() as { client: { id: string } }).client.id;
    clientIds.add(id);
    return id;
  };

  const createTestDemandRecord = async (adminCookie: string, clientId: string, title: string): Promise<{ id: string; version: number }> => {
    const res = await inject({
      method: 'POST',
      url: '/api/v1/demands',
      headers: { origin, cookie: adminCookie, 'content-type': 'application/json' },
      payload: {
        clientId,
        title,
        description: 'Demand for authorization test',
        priority: 'normal',
        deliveryDate: '2026-12-15',
      },
    });
    expect(res.statusCode).toBe(201);
    const demand = (res.json() as { demand: { id: string; version: number } }).demand;
    demandIds.add(demand.id);
    return demand;
  };

  const countDemandEvents = async (demandId: string): Promise<number> => {
    const res = await mig().pool.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM demand_event WHERE demand_id = $1',
      [demandId],
    );
    return res.rows[0]!.n;
  };

  const countTaskComments = async (taskId: string): Promise<number> => {
    const res = await mig().pool.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM task_comment WHERE task_id = $1',
      [taskId],
    );
    return res.rows[0]!.n;
  };

  type DomainSnapshot = {
    demands: Array<{
      id: string;
      client_id: string;
      title: string;
      description: string | null;
      priority: string;
      delivery_date: string | null;
      status: string;
      version: number;
    }>;
    tasks: Array<{
      id: string;
      demand_id: string;
      assigned_to_user_id: string | null;
      title: string;
      description: string | null;
      priority: string;
      delivery_date: string | null;
      status: string;
      version: number;
      pause_reason: string | null;
      pause_requested_at: string | null;
      paused_at: string | null;
      delivery_notes: string | null;
    }>;
    requirements: Array<{
      id: string;
      task_id: string;
      title: string;
      mandatory: boolean;
      satisfied: boolean;
    }>;
    dependencies: Array<{
      task_id: string;
      depends_on_task_id: string;
    }>;
    comments: Array<{
      id: string;
      task_id: string;
      author_id: string;
      content: string;
    }>;
    events: Array<{
      id: string;
      demand_id: string;
      task_id: string | null;
      actor_id: string;
      action: string;
      metadata: unknown;
    }>;
  };

  const captureDomainSnapshot = async (clientIdsInput: string | string[]): Promise<DomainSnapshot> => {
    const cIds = Array.isArray(clientIdsInput) ? clientIdsInput : [clientIdsInput];
    const demandsRes = await mig().pool.query<DomainSnapshot['demands'][number]>(
      `SELECT id, client_id, title, description, priority, delivery_date::text, status, version
       FROM demand
       WHERE client_id = ANY($1::uuid[])
       ORDER BY id ASC`,
      [cIds],
    );
    const demandIdsList = demandsRes.rows.map((r) => r.id);

    if (demandIdsList.length === 0) {
      return {
        demands: [],
        tasks: [],
        requirements: [],
        dependencies: [],
        comments: [],
        events: [],
      };
    }

    const tasksRes = await mig().pool.query<DomainSnapshot['tasks'][number]>(
      `SELECT id, demand_id, assigned_to_user_id, title, description, priority, delivery_date::text,
              status, version, pause_reason, pause_requested_at::text, paused_at::text, delivery_notes
       FROM task
       WHERE demand_id = ANY($1::uuid[])
       ORDER BY id ASC`,
      [demandIdsList],
    );
    const taskIdsList = tasksRes.rows.map((r) => r.id);

    const requirementsRes = taskIdsList.length === 0
      ? { rows: [] as DomainSnapshot['requirements'] }
      : await mig().pool.query<DomainSnapshot['requirements'][number]>(
          `SELECT id, task_id, title, mandatory, satisfied
           FROM task_requirement
           WHERE task_id = ANY($1::uuid[])
           ORDER BY id ASC`,
          [taskIdsList],
        );

    const dependenciesRes = taskIdsList.length === 0
      ? { rows: [] as DomainSnapshot['dependencies'] }
      : await mig().pool.query<DomainSnapshot['dependencies'][number]>(
          `SELECT task_id, depends_on_task_id
           FROM task_dependency
           WHERE task_id = ANY($1::uuid[]) OR depends_on_task_id = ANY($1::uuid[])
           ORDER BY task_id ASC, depends_on_task_id ASC`,
          [taskIdsList],
        );

    const commentsRes = taskIdsList.length === 0
      ? { rows: [] as DomainSnapshot['comments'] }
      : await mig().pool.query<DomainSnapshot['comments'][number]>(
          `SELECT id, task_id, author_id, content
           FROM task_comment
           WHERE task_id = ANY($1::uuid[])
           ORDER BY id ASC`,
          [taskIdsList],
        );

    const eventsRes = await mig().pool.query<DomainSnapshot['events'][number]>(
      `SELECT id, demand_id, task_id, actor_id, action, metadata
       FROM demand_event
       WHERE demand_id = ANY($1::uuid[])
       ORDER BY id ASC`,
      [demandIdsList],
    );

    return {
      demands: demandsRes.rows,
      tasks: tasksRes.rows,
      requirements: requirementsRes.rows,
      dependencies: dependenciesRes.rows,
      comments: commentsRes.rows,
      events: eventsRes.rows,
    };
  };

  beforeAll(async () => {
    const applicationUrl = testDatabaseUrl('TEST_DATABASE_URL', 'orium_app');
    const migrationUrl = testDatabaseUrl('TEST_MIGRATION_DATABASE_URL', 'orium_migrator');
    const a = new URL(applicationUrl);
    const b = new URL(migrationUrl);
    if (a.hostname !== b.hostname || a.port !== b.port || a.pathname !== b.pathname) {
      throw new Error('Application and migration URLs must target the same test database.');
    }
    await migrateDatabase(migrationUrl);
    database = connectDatabase(applicationUrl);
    migrator = connectDatabase(migrationUrl);
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
    rolesBefore = await queryRolePermissionSnapshot();
    identityEventsTotalBefore = (
      await mig().pool.query<{ n: number }>('SELECT count(*)::int AS n FROM identity_event')
    ).rows[0]!.n;
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

          const trackedDemandIds = [...demandIds];
          const trackedClientIds = [...clientIds];
          const ids = [...userIds];

          const demandsDeleted = await mig().pool.query(
            'DELETE FROM demand WHERE id = ANY($1::uuid[]) OR client_id = ANY($2::uuid[])',
            [trackedDemandIds, trackedClientIds],
          );
          report.demandsTrackedCount = trackedDemandIds.length;
          report.demandsDeleted = demandsDeleted.rowCount;

          const clientsDeleted = await mig().pool.query(
            'DELETE FROM client WHERE id = ANY($1::uuid[]) OR name LIKE $2',
            [trackedClientIds, `${clientNamePrefix}%`],
          );
          report.clientsTrackedCount = trackedClientIds.length;
          report.clientsDeleted = clientsDeleted.rowCount;

          const eventsDeleted = await mig().pool.query(
            'DELETE FROM identity_event WHERE actor_id = ANY($1::text[]) OR target_user_id = ANY($1::text[])',
            [ids],
          );
          report.identityEventsDeleted = eventsDeleted.rowCount;
          await mig().pool.query('DELETE FROM identity_event_subject WHERE user_id = ANY($1::text[])', [ids]);
          const usersDeleted = await mig().pool.query('DELETE FROM auth_user WHERE id = ANY($1::text[])', [ids]);
          report.usersTrackedCount = ids.length;
          report.usersDeleted = usersDeleted.rowCount;

          report.remainingDemands = (
            await mig().pool.query<{ n: number }>(
              'SELECT count(*)::int AS n FROM demand WHERE id = ANY($1::uuid[]) OR client_id = ANY($2::uuid[])',
              [trackedDemandIds, trackedClientIds],
            )
          ).rows[0]!.n;
          report.remainingClients = (
            await mig().pool.query<{ n: number }>(
              'SELECT count(*)::int AS n FROM client WHERE id = ANY($1::uuid[]) OR name LIKE $2',
              [trackedClientIds, `${clientNamePrefix}%`],
            )
          ).rows[0]!.n;
          report.remainingUsers = (
            await mig().pool.query<{ n: number }>('SELECT count(*)::int AS n FROM auth_user WHERE id = ANY($1::text[])', [ids])
          ).rows[0]!.n;
          report.remainingIdentityEventsForSuiteUsers = (
            await mig().pool.query<{ n: number }>(
              'SELECT count(*)::int AS n FROM identity_event WHERE actor_id = ANY($1::text[]) OR target_user_id = ANY($1::text[])',
              [ids],
            )
          ).rows[0]!.n;

          const rolesAfter = await queryRolePermissionSnapshot();
          const identityEventsTotalAfter = (
            await mig().pool.query<{ n: number }>('SELECT count(*)::int AS n FROM identity_event')
          ).rows[0]!.n;

          report.rolesBeforeCount = rolesBefore.length;
          report.rolesAfterCount = rolesAfter.length;
          report.rolesEqual = JSON.stringify(rolesBefore) === JSON.stringify(rolesAfter);
          report.identityEventsTotalBefore = identityEventsTotalBefore;
          report.identityEventsTotalAfter = identityEventsTotalAfter;

          const outDir = resolve(process.cwd(), '.local/phase7/increment1');
          mkdirSync(outDir, { recursive: true });
          writeFileSync(resolve(outDir, 'cleanup-report.json'), JSON.stringify(report, null, 2));

          expect(rolesAfter).toEqual(rolesBefore);
          expect(identityEventsTotalAfter).toBe(identityEventsTotalBefore);
          expect(report.remainingDemands).toBe(0);
          expect(report.remainingClients).toBe(0);
          expect(report.remainingUsers).toBe(0);
          expect(report.remainingIdentityEventsForSuiteUsers).toBe(0);
        } finally {
          await migrator.pool.end();
          await database.pool.end();
        }
      }
    }
  }, 60000);

  // Helper that prepares a rich operational fixture state so each of the 16 mutations can be invoked directly
  async function setupSixteenMutationsHarness() {
    const setupAdmin = await fixture('administrator');
    const setupAdminCookie = await cookieFor(setupAdmin.email);
    const collab1 = await fixture('collaborator');
    const collab2 = await fixture('collaborator');

    const clientId = await createTestClientRecord(setupAdminCookie, `Harness-${randomUUID().slice(0, 6)}`);
    const openDemand = await createTestDemandRecord(setupAdminCookie, clientId, 'Open Demand Harness');
    const completableDemand = await createTestDemandRecord(setupAdminCookie, clientId, 'Completable Demand Harness');

    // Create a task on completableDemand, take it to completed so completeDemand is ready to be called
    const compTaskRes = await inject({
      method: 'POST',
      url: '/api/v1/tasks',
      headers: { origin, cookie: setupAdminCookie, 'content-type': 'application/json' },
      payload: {
        demandId: completableDemand.id,
        assignedToUserId: collab1.id,
        title: 'Task for Completable Demand',
        priority: 'normal',
      },
    });
    expect(compTaskRes.statusCode).toBe(201);
    const compTaskId = (compTaskRes.json() as { task: { id: string } }).task.id;
    const collab1Cookie = await cookieFor(collab1.email);

    expect((await inject({
      method: 'POST',
      url: `/api/v1/tasks/${compTaskId}/accept`,
      headers: { origin, cookie: collab1Cookie, 'content-type': 'application/json' },
      payload: { version: 1 },
    })).statusCode).toBe(200);
    expect((await inject({
      method: 'POST',
      url: `/api/v1/tasks/${compTaskId}/start`,
      headers: { origin, cookie: collab1Cookie, 'content-type': 'application/json' },
      payload: { version: 2 },
    })).statusCode).toBe(200);
    expect((await inject({
      method: 'POST',
      url: `/api/v1/tasks/${compTaskId}/submit-review`,
      headers: { origin, cookie: collab1Cookie, 'content-type': 'application/json' },
      payload: { version: 3, deliveryNotes: 'Done' },
    })).statusCode).toBe(200);
    expect((await inject({
      method: 'POST',
      url: `/api/v1/tasks/${compTaskId}/review`,
      headers: { origin, cookie: setupAdminCookie, 'content-type': 'application/json' },
      payload: { version: 4, decision: 'complete', feedback: 'Approved' },
    })).statusCode).toBe(200);

    // Tasks on openDemand for each specific state:
    // 1. unacceptedTask (ready, version 1) -> for acceptTask, reassignTask
    const unacceptedRes = await inject({
      method: 'POST',
      url: '/api/v1/tasks',
      headers: { origin, cookie: setupAdminCookie, 'content-type': 'application/json' },
      payload: {
        demandId: openDemand.id,
        assignedToUserId: collab1.id,
        title: 'Unaccepted Task',
        priority: 'normal',
      },
    });
    expect(unacceptedRes.statusCode).toBe(201);
    const unacceptedTaskId = (unacceptedRes.json() as { task: { id: string } }).task.id;

    // 2. acceptedTask (ready + accepted, version 2) -> for startTask
    const acceptedRes = await inject({
      method: 'POST',
      url: '/api/v1/tasks',
      headers: { origin, cookie: setupAdminCookie, 'content-type': 'application/json' },
      payload: {
        demandId: openDemand.id,
        assignedToUserId: collab1.id,
        title: 'Accepted Task',
        priority: 'normal',
      },
    });
    expect(acceptedRes.statusCode).toBe(201);
    const acceptedTaskId = (acceptedRes.json() as { task: { id: string } }).task.id;
    expect((await inject({
      method: 'POST',
      url: `/api/v1/tasks/${acceptedTaskId}/accept`,
      headers: { origin, cookie: collab1Cookie, 'content-type': 'application/json' },
      payload: { version: 1 },
    })).statusCode).toBe(200);

    // 3. inProdTask (in_production, version 3) -> for submitTaskReview, requestTaskPause
    const inProdRes = await inject({
      method: 'POST',
      url: '/api/v1/tasks',
      headers: { origin, cookie: setupAdminCookie, 'content-type': 'application/json' },
      payload: {
        demandId: openDemand.id,
        assignedToUserId: collab1.id,
        title: 'In Production Task',
        priority: 'normal',
      },
    });
    expect(inProdRes.statusCode).toBe(201);
    const inProdTaskId = (inProdRes.json() as { task: { id: string } }).task.id;
    expect((await inject({
      method: 'POST',
      url: `/api/v1/tasks/${inProdTaskId}/accept`,
      headers: { origin, cookie: collab1Cookie, 'content-type': 'application/json' },
      payload: { version: 1 },
    })).statusCode).toBe(200);
    expect((await inject({
      method: 'POST',
      url: `/api/v1/tasks/${inProdTaskId}/start`,
      headers: { origin, cookie: collab1Cookie, 'content-type': 'application/json' },
      payload: { version: 2 },
    })).statusCode).toBe(200);

    // 4. inReviewTask (in_review, version 4) -> for reviewTask
    const inReviewRes = await inject({
      method: 'POST',
      url: '/api/v1/tasks',
      headers: { origin, cookie: setupAdminCookie, 'content-type': 'application/json' },
      payload: {
        demandId: openDemand.id,
        assignedToUserId: collab1.id,
        title: 'In Review Task',
        priority: 'normal',
      },
    });
    expect(inReviewRes.statusCode).toBe(201);
    const inReviewTaskId = (inReviewRes.json() as { task: { id: string } }).task.id;
    expect((await inject({
      method: 'POST',
      url: `/api/v1/tasks/${inReviewTaskId}/accept`,
      headers: { origin, cookie: collab1Cookie, 'content-type': 'application/json' },
      payload: { version: 1 },
    })).statusCode).toBe(200);
    expect((await inject({
      method: 'POST',
      url: `/api/v1/tasks/${inReviewTaskId}/start`,
      headers: { origin, cookie: collab1Cookie, 'content-type': 'application/json' },
      payload: { version: 2 },
    })).statusCode).toBe(200);
    expect((await inject({
      method: 'POST',
      url: `/api/v1/tasks/${inReviewTaskId}/submit-review`,
      headers: { origin, cookie: collab1Cookie, 'content-type': 'application/json' },
      payload: { version: 3, deliveryNotes: 'Ready for review' },
    })).statusCode).toBe(200);

    // 5. pauseReqTask (in_production with pause_requested_at set, version 4) -> for approveTaskPause
    const pauseReqRes = await inject({
      method: 'POST',
      url: '/api/v1/tasks',
      headers: { origin, cookie: setupAdminCookie, 'content-type': 'application/json' },
      payload: {
        demandId: openDemand.id,
        assignedToUserId: collab1.id,
        title: 'Pause Requested Task',
        priority: 'normal',
      },
    });
    expect(pauseReqRes.statusCode).toBe(201);
    const pauseReqTaskId = (pauseReqRes.json() as { task: { id: string } }).task.id;
    expect((await inject({
      method: 'POST',
      url: `/api/v1/tasks/${pauseReqTaskId}/accept`,
      headers: { origin, cookie: collab1Cookie, 'content-type': 'application/json' },
      payload: { version: 1 },
    })).statusCode).toBe(200);
    expect((await inject({
      method: 'POST',
      url: `/api/v1/tasks/${pauseReqTaskId}/start`,
      headers: { origin, cookie: collab1Cookie, 'content-type': 'application/json' },
      payload: { version: 2 },
    })).statusCode).toBe(200);
    expect((await inject({
      method: 'POST',
      url: `/api/v1/tasks/${pauseReqTaskId}/request-pause`,
      headers: { origin, cookie: collab1Cookie, 'content-type': 'application/json' },
      payload: { version: 3, reason: 'Waiting on asset' },
    })).statusCode).toBe(200);

    // 6. pausedTask (paused, version 5) -> for resumeTask
    const pausedRes = await inject({
      method: 'POST',
      url: '/api/v1/tasks',
      headers: { origin, cookie: setupAdminCookie, 'content-type': 'application/json' },
      payload: {
        demandId: openDemand.id,
        assignedToUserId: collab1.id,
        title: 'Paused Task',
        priority: 'normal',
      },
    });
    expect(pausedRes.statusCode).toBe(201);
    const pausedTaskId = (pausedRes.json() as { task: { id: string } }).task.id;
    expect((await inject({
      method: 'POST',
      url: `/api/v1/tasks/${pausedTaskId}/accept`,
      headers: { origin, cookie: collab1Cookie, 'content-type': 'application/json' },
      payload: { version: 1 },
    })).statusCode).toBe(200);
    expect((await inject({
      method: 'POST',
      url: `/api/v1/tasks/${pausedTaskId}/start`,
      headers: { origin, cookie: collab1Cookie, 'content-type': 'application/json' },
      payload: { version: 2 },
    })).statusCode).toBe(200);
    expect((await inject({
      method: 'POST',
      url: `/api/v1/tasks/${pausedTaskId}/request-pause`,
      headers: { origin, cookie: collab1Cookie, 'content-type': 'application/json' },
      payload: { version: 3, reason: 'Waiting on client' },
    })).statusCode).toBe(200);
    expect((await inject({
      method: 'POST',
      url: `/api/v1/tasks/${pausedTaskId}/approve-pause`,
      headers: { origin, cookie: setupAdminCookie, 'content-type': 'application/json' },
      payload: { version: 4, reason: 'Approved pause', deliveryDate: '2026-12-20' },
    })).statusCode).toBe(200);

    // 7. reqDepTask (with 1 requirement and 1 dependency on unacceptedTaskId, version 1) -> for updateRequirement, addDependency, removeDependency
    const reqDepRes = await inject({
      method: 'POST',
      url: '/api/v1/tasks',
      headers: { origin, cookie: setupAdminCookie, 'content-type': 'application/json' },
      payload: {
        demandId: openDemand.id,
        assignedToUserId: collab1.id,
        title: 'Req and Dep Task',
        priority: 'normal',
        requirements: [{ title: 'Mandatory Briefing', mandatory: true }],
        dependsOnTaskIds: [unacceptedTaskId],
      },
    });
    expect(reqDepRes.statusCode).toBe(201);
    const reqDepTaskId = (reqDepRes.json() as { task: { id: string } }).task.id;
    const reqDepDetailRes = await inject({
      method: 'GET',
      url: `/api/v1/tasks/${reqDepTaskId}`,
      headers: { origin, cookie: setupAdminCookie },
    });
    expect(reqDepDetailRes.statusCode).toBe(200);
    const requirementId = (reqDepDetailRes.json() as { requirements: Array<{ id: string }> }).requirements[0]!.id;

    return {
      clientId,
      openDemand,
      completableDemand,
      collab1,
      collab1Cookie,
      collab2,
      unacceptedTaskId,
      acceptedTaskId,
      inProdTaskId,
      inReviewTaskId,
      pauseReqTaskId,
      pausedTaskId,
      reqDepTaskId,
      requirementId,
    };
  }

  it('rejects all 16 demand/task/comment mutations with 401 when the actor is deactivated while waiting on IDENTITY_LOCK, without altering domain or event history', async () => {
    const h = await setupSixteenMutationsHarness();

    const adminMutations: Array<{
      name: string;
      demandIdToCheck: string;
      request: (cookie: string) => Promise<Awaited<ReturnType<typeof inject>>>;
    }> = [
      {
        name: 'createDemand',
        demandIdToCheck: h.openDemand.id,
        request: (cookie) =>
          inject({
            method: 'POST',
            url: '/api/v1/demands',
            headers: { origin, cookie, 'content-type': 'application/json' },
            payload: { clientId: h.clientId, title: 'Blocked Demand', priority: 'normal', deliveryDate: '2026-12-25' },
          }),
      },
      {
        name: 'updateDemand',
        demandIdToCheck: h.openDemand.id,
        request: (cookie) =>
          inject({
            method: 'PATCH',
            url: `/api/v1/demands/${h.openDemand.id}`,
            headers: { origin, cookie, 'content-type': 'application/json' },
            payload: { version: h.openDemand.version, title: 'Unauthorized Update' },
          }),
      },
      {
        name: 'completeDemand',
        demandIdToCheck: h.completableDemand.id,
        request: (cookie) =>
          inject({
            method: 'POST',
            url: `/api/v1/demands/${h.completableDemand.id}/complete`,
            headers: { origin, cookie, 'content-type': 'application/json' },
            payload: { version: h.completableDemand.version },
          }),
      },
      {
        name: 'createTask',
        demandIdToCheck: h.openDemand.id,
        request: (cookie) =>
          inject({
            method: 'POST',
            url: '/api/v1/tasks',
            headers: { origin, cookie, 'content-type': 'application/json' },
            payload: { demandId: h.openDemand.id, assignedToUserId: h.collab1.id, title: 'Blocked Task', priority: 'normal' },
          }),
      },
      {
        name: 'reviewTask',
        demandIdToCheck: h.openDemand.id,
        request: (cookie) =>
          inject({
            method: 'POST',
            url: `/api/v1/tasks/${h.inReviewTaskId}/review`,
            headers: { origin, cookie, 'content-type': 'application/json' },
            payload: { version: 4, decision: 'complete', feedback: 'Should fail' },
          }),
      },
      {
        name: 'approveTaskPause',
        demandIdToCheck: h.openDemand.id,
        request: (cookie) =>
          inject({
            method: 'POST',
            url: `/api/v1/tasks/${h.pauseReqTaskId}/approve-pause`,
            headers: { origin, cookie, 'content-type': 'application/json' },
            payload: { version: 4, reason: 'Should fail', deliveryDate: '2026-12-28' },
          }),
      },
      {
        name: 'resumeTask',
        demandIdToCheck: h.openDemand.id,
        request: (cookie) =>
          inject({
            method: 'POST',
            url: `/api/v1/tasks/${h.pausedTaskId}/resume`,
            headers: { origin, cookie, 'content-type': 'application/json' },
            payload: { version: 5 },
          }),
      },
      {
        name: 'reassignTask',
        demandIdToCheck: h.openDemand.id,
        request: (cookie) =>
          inject({
            method: 'POST',
            url: `/api/v1/tasks/${h.unacceptedTaskId}/reassign`,
            headers: { origin, cookie, 'content-type': 'application/json' },
            payload: { version: 1, assignedToUserId: h.collab2.id, reason: 'Should fail' },
          }),
      },
      {
        name: 'updateRequirement',
        demandIdToCheck: h.openDemand.id,
        request: (cookie) =>
          inject({
            method: 'PATCH',
            url: `/api/v1/tasks/${h.reqDepTaskId}/requirements/${h.requirementId}`,
            headers: { origin, cookie, 'content-type': 'application/json' },
            payload: { version: 1, satisfied: true },
          }),
      },
      {
        name: 'addDependency',
        demandIdToCheck: h.openDemand.id,
        request: (cookie) =>
          inject({
            method: 'POST',
            url: `/api/v1/tasks/${h.reqDepTaskId}/dependencies`,
            headers: { origin, cookie, 'content-type': 'application/json' },
            payload: { version: 1, dependsOnTaskId: h.acceptedTaskId },
          }),
      },
      {
        name: 'removeDependency',
        demandIdToCheck: h.openDemand.id,
        request: (cookie) =>
          inject({
            method: 'DELETE',
            url: `/api/v1/tasks/${h.reqDepTaskId}/dependencies/${h.unacceptedTaskId}`,
            headers: { origin, cookie, 'content-type': 'application/json' },
            payload: { version: 1 },
          }),
      },
      {
        name: 'createTaskComment (admin)',
        demandIdToCheck: h.openDemand.id,
        request: (cookie) =>
          inject({
            method: 'POST',
            url: `/api/v1/tasks/${h.unacceptedTaskId}/comments`,
            headers: { origin, cookie, 'content-type': 'application/json' },
            payload: { content: 'Should not be saved' },
          }),
      },
    ];

    for (const op of adminMutations) {
      const actor = await fixture('administrator');
      const cookie = await cookieFor(actor.email);
      const snapshotBefore = await captureDomainSnapshot(h.clientId);

      const holder = await holdIdentityLock();
      let pending: Promise<Awaited<ReturnType<typeof inject>>> | undefined;
      try {
        pending = op.request(cookie);
        await waitForWaiters(1);
        await holder.query('UPDATE auth_user SET active = false, updated_at = now() WHERE id = $1', [actor.id]);
      } finally {
        await releaseLockClient(holder);
        if (pending) {
          const res = await pending;
          expect(res.statusCode, `Expected 401 on deactivated actor for ${op.name}`).toBe(401);
        }
      }

      const snapshotAfter = await captureDomainSnapshot(h.clientId);
      expect(snapshotAfter, `Domain snapshot changed on deactivated actor for ${op.name}`).toEqual(snapshotBefore);
    }

    const collabMutations: Array<{
      name: string;
      request: (cookie: string) => Promise<Awaited<ReturnType<typeof inject>>>;
    }> = [
      {
        name: 'acceptTask',
        request: (cookie) =>
          inject({
            method: 'POST',
            url: `/api/v1/tasks/${h.unacceptedTaskId}/accept`,
            headers: { origin, cookie, 'content-type': 'application/json' },
            payload: { version: 1 },
          }),
      },
      {
        name: 'startTask',
        request: (cookie) =>
          inject({
            method: 'POST',
            url: `/api/v1/tasks/${h.acceptedTaskId}/start`,
            headers: { origin, cookie, 'content-type': 'application/json' },
            payload: { version: 2 },
          }),
      },
      {
        name: 'submitTaskReview',
        request: (cookie) =>
          inject({
            method: 'POST',
            url: `/api/v1/tasks/${h.inProdTaskId}/submit-review`,
            headers: { origin, cookie, 'content-type': 'application/json' },
            payload: { version: 3, deliveryNotes: 'Should fail' },
          }),
      },
      {
        name: 'requestTaskPause',
        request: (cookie) =>
          inject({
            method: 'POST',
            url: `/api/v1/tasks/${h.inProdTaskId}/request-pause`,
            headers: { origin, cookie, 'content-type': 'application/json' },
            payload: { version: 3, reason: 'Should fail' },
          }),
      },
      {
        name: 'createTaskComment (collaborator)',
        request: (cookie) =>
          inject({
            method: 'POST',
            url: `/api/v1/tasks/${h.unacceptedTaskId}/comments`,
            headers: { origin, cookie, 'content-type': 'application/json' },
            payload: { content: 'Should fail on deactivated collaborator' },
          }),
      },
    ];

    for (const op of collabMutations) {
      const snapshotBefore = await captureDomainSnapshot(h.clientId);
      const holder = await holdIdentityLock();
      let pending: Promise<Awaited<ReturnType<typeof inject>>> | undefined;
      try {
        pending = op.request(h.collab1Cookie);
        await waitForWaiters(1);
        await holder.query('UPDATE auth_user SET active = false, updated_at = now() WHERE id = $1', [h.collab1.id]);
      } finally {
        await releaseLockClient(holder);
        if (pending) {
          const res = await pending;
          expect(res.statusCode, `Expected 401 on deactivated collaborator for ${op.name}`).toBe(401);
        }
        // Re-enable collab1 and create a fresh session cookie for subsequent iterations in this loop
        await mig().pool.query('UPDATE auth_user SET active = true, updated_at = now() WHERE id = $1', [h.collab1.id]);
      }
      const snapshotAfter = await captureDomainSnapshot(h.clientId);
      expect(snapshotAfter, `Domain snapshot changed on deactivated collaborator for ${op.name}`).toEqual(snapshotBefore);
    }
  });

  it('rejects all 16 demand/task/comment mutations with 403 when the required permission is revoked while waiting on IDENTITY_LOCK, and blocks admin operations when demoted even with extra grants', async () => {
    const h = await setupSixteenMutationsHarness();
    const adminActor = await fixture('administrator');
    const adminCookie = await cookieFor(adminActor.email);

    const permissionChecks: Array<{
      name: string;
      roleId: Role;
      permission: Permission;
      cookie: string;
      demandIdToCheck: string;
      request: (cookie: string) => Promise<Awaited<ReturnType<typeof inject>>>;
    }> = [
      {
        name: 'createDemand',
        roleId: 'administrator',
        permission: 'demands.write',
        cookie: adminCookie,
        demandIdToCheck: h.openDemand.id,
        request: (cookie) =>
          inject({
            method: 'POST',
            url: '/api/v1/demands',
            headers: { origin, cookie, 'content-type': 'application/json' },
            payload: { clientId: h.clientId, title: 'No Perm Demand', priority: 'normal', deliveryDate: '2026-12-25' },
          }),
      },
      {
        name: 'updateDemand',
        roleId: 'administrator',
        permission: 'demands.write',
        cookie: adminCookie,
        demandIdToCheck: h.openDemand.id,
        request: (cookie) =>
          inject({
            method: 'PATCH',
            url: `/api/v1/demands/${h.openDemand.id}`,
            headers: { origin, cookie, 'content-type': 'application/json' },
            payload: { version: h.openDemand.version, title: 'No Perm Update' },
          }),
      },
      {
        name: 'completeDemand',
        roleId: 'administrator',
        permission: 'demands.write',
        cookie: adminCookie,
        demandIdToCheck: h.completableDemand.id,
        request: (cookie) =>
          inject({
            method: 'POST',
            url: `/api/v1/demands/${h.completableDemand.id}/complete`,
            headers: { origin, cookie, 'content-type': 'application/json' },
            payload: { version: h.completableDemand.version },
          }),
      },
      {
        name: 'createTask',
        roleId: 'administrator',
        permission: 'tasks.manage',
        cookie: adminCookie,
        demandIdToCheck: h.openDemand.id,
        request: (cookie) =>
          inject({
            method: 'POST',
            url: '/api/v1/tasks',
            headers: { origin, cookie, 'content-type': 'application/json' },
            payload: { demandId: h.openDemand.id, assignedToUserId: h.collab1.id, title: 'No Perm Task', priority: 'normal' },
          }),
      },
      {
        name: 'acceptTask',
        roleId: 'collaborator',
        permission: 'tasks.execute',
        cookie: h.collab1Cookie,
        demandIdToCheck: h.openDemand.id,
        request: (cookie) =>
          inject({
            method: 'POST',
            url: `/api/v1/tasks/${h.unacceptedTaskId}/accept`,
            headers: { origin, cookie, 'content-type': 'application/json' },
            payload: { version: 1 },
          }),
      },
      {
        name: 'startTask',
        roleId: 'collaborator',
        permission: 'tasks.execute',
        cookie: h.collab1Cookie,
        demandIdToCheck: h.openDemand.id,
        request: (cookie) =>
          inject({
            method: 'POST',
            url: `/api/v1/tasks/${h.acceptedTaskId}/start`,
            headers: { origin, cookie, 'content-type': 'application/json' },
            payload: { version: 2 },
          }),
      },
      {
        name: 'submitTaskReview',
        roleId: 'collaborator',
        permission: 'tasks.execute',
        cookie: h.collab1Cookie,
        demandIdToCheck: h.openDemand.id,
        request: (cookie) =>
          inject({
            method: 'POST',
            url: `/api/v1/tasks/${h.inProdTaskId}/submit-review`,
            headers: { origin, cookie, 'content-type': 'application/json' },
            payload: { version: 3, deliveryNotes: 'No Perm Review' },
          }),
      },
      {
        name: 'reviewTask',
        roleId: 'administrator',
        permission: 'tasks.review',
        cookie: adminCookie,
        demandIdToCheck: h.openDemand.id,
        request: (cookie) =>
          inject({
            method: 'POST',
            url: `/api/v1/tasks/${h.inReviewTaskId}/review`,
            headers: { origin, cookie, 'content-type': 'application/json' },
            payload: { version: 4, decision: 'complete', feedback: 'No Perm' },
          }),
      },
      {
        name: 'requestTaskPause',
        roleId: 'collaborator',
        permission: 'tasks.execute',
        cookie: h.collab1Cookie,
        demandIdToCheck: h.openDemand.id,
        request: (cookie) =>
          inject({
            method: 'POST',
            url: `/api/v1/tasks/${h.inProdTaskId}/request-pause`,
            headers: { origin, cookie, 'content-type': 'application/json' },
            payload: { version: 3, reason: 'No Perm Pause' },
          }),
      },
      {
        name: 'approveTaskPause',
        roleId: 'administrator',
        permission: 'tasks.manage',
        cookie: adminCookie,
        demandIdToCheck: h.openDemand.id,
        request: (cookie) =>
          inject({
            method: 'POST',
            url: `/api/v1/tasks/${h.pauseReqTaskId}/approve-pause`,
            headers: { origin, cookie, 'content-type': 'application/json' },
            payload: { version: 4, reason: 'No Perm Approve', deliveryDate: '2026-12-28' },
          }),
      },
      {
        name: 'resumeTask',
        roleId: 'administrator',
        permission: 'tasks.manage',
        cookie: adminCookie,
        demandIdToCheck: h.openDemand.id,
        request: (cookie) =>
          inject({
            method: 'POST',
            url: `/api/v1/tasks/${h.pausedTaskId}/resume`,
            headers: { origin, cookie, 'content-type': 'application/json' },
            payload: { version: 5 },
          }),
      },
      {
        name: 'reassignTask',
        roleId: 'administrator',
        permission: 'tasks.manage',
        cookie: adminCookie,
        demandIdToCheck: h.openDemand.id,
        request: (cookie) =>
          inject({
            method: 'POST',
            url: `/api/v1/tasks/${h.unacceptedTaskId}/reassign`,
            headers: { origin, cookie, 'content-type': 'application/json' },
            payload: { version: 1, assignedToUserId: h.collab2.id, reason: 'No Perm Reassign' },
          }),
      },
      {
        name: 'updateRequirement',
        roleId: 'administrator',
        permission: 'tasks.manage',
        cookie: adminCookie,
        demandIdToCheck: h.openDemand.id,
        request: (cookie) =>
          inject({
            method: 'PATCH',
            url: `/api/v1/tasks/${h.reqDepTaskId}/requirements/${h.requirementId}`,
            headers: { origin, cookie, 'content-type': 'application/json' },
            payload: { version: 1, satisfied: true },
          }),
      },
      {
        name: 'addDependency',
        roleId: 'administrator',
        permission: 'tasks.manage',
        cookie: adminCookie,
        demandIdToCheck: h.openDemand.id,
        request: (cookie) =>
          inject({
            method: 'POST',
            url: `/api/v1/tasks/${h.reqDepTaskId}/dependencies`,
            headers: { origin, cookie, 'content-type': 'application/json' },
            payload: { version: 1, dependsOnTaskId: h.acceptedTaskId },
          }),
      },
      {
        name: 'removeDependency',
        roleId: 'administrator',
        permission: 'tasks.manage',
        cookie: adminCookie,
        demandIdToCheck: h.openDemand.id,
        request: (cookie) =>
          inject({
            method: 'DELETE',
            url: `/api/v1/tasks/${h.reqDepTaskId}/dependencies/${h.unacceptedTaskId}`,
            headers: { origin, cookie, 'content-type': 'application/json' },
            payload: { version: 1 },
          }),
      },
      {
        name: 'createTaskComment',
        roleId: 'collaborator',
        permission: 'tasks.execute',
        cookie: h.collab1Cookie,
        demandIdToCheck: h.openDemand.id,
        request: (cookie) =>
          inject({
            method: 'POST',
            url: `/api/v1/tasks/${h.unacceptedTaskId}/comments`,
            headers: { origin, cookie, 'content-type': 'application/json' },
            payload: { content: 'No Perm Comment' },
          }),
      },
    ];

    for (const item of permissionChecks) {
      const snapshotBefore = await captureDomainSnapshot(h.clientId);
      const holder = await holdIdentityLock();
      let pending: Promise<Awaited<ReturnType<typeof inject>>> | undefined;
      try {
        pending = item.request(item.cookie);
        await waitForWaiters(1);
        await revokePermissionOnClient(holder, item.roleId, item.permission);
      } finally {
        await releaseLockClient(holder);
        try {
          if (pending) {
            const res = await pending;
            expect(res.statusCode, `Expected 403 on revoked ${item.permission} for ${item.name}`).toBe(403);
          }
        } finally {
          await restorePermission(item.roleId, item.permission);
        }
      }
      const snapshotAfter = await captureDomainSnapshot(h.clientId);
      expect(snapshotAfter, `Domain altered during revoked permission attempt for ${item.name}`).toEqual(snapshotBefore);
    }

    // Verify that administrative operations remain exclusive to administrator role even if collaborator is granted demands.write / tasks.manage / tasks.review,
    // and that 403/401 takes precedence over 404/409 domain decisions.
    const adminExclusivityChecks: Array<{
      permission: Permission;
      request: (cookie: string) => Promise<Awaited<ReturnType<typeof inject>>>;
    }> = [
      {
        permission: 'demands.write',
        request: (cookie) =>
          inject({
            method: 'PATCH',
            url: `/api/v1/demands/${h.openDemand.id}`,
            headers: { origin, cookie, 'content-type': 'application/json' },
            payload: { version: 999, title: 'Demoted Admin With Extra Grant and Version Conflict' },
          }),
      },
      {
        permission: 'tasks.manage',
        request: (cookie) =>
          inject({
            method: 'POST',
            url: `/api/v1/tasks/${randomUUID()}/reassign`,
            headers: { origin, cookie, 'content-type': 'application/json' },
            payload: { version: 999, assignedToUserId: h.collab2.id, reason: 'Demoted Admin With tasks.manage Grant on Nonexistent Task' },
          }),
      },
      {
        permission: 'tasks.review',
        request: (cookie) =>
          inject({
            method: 'POST',
            url: `/api/v1/tasks/${h.inReviewTaskId}/review`,
            headers: { origin, cookie, 'content-type': 'application/json' },
            payload: { version: 999, decision: 'complete', feedback: 'Demoted Admin With tasks.review Grant' },
          }),
      },
    ];

    for (const check of adminExclusivityChecks) {
      const demotedAdmin = await fixture('administrator');
      const demotedCookie = await cookieFor(demotedAdmin.email);
      const snapshotBefore = await captureDomainSnapshot(h.clientId);
      const holder = await holdIdentityLock();
      let pendingReq: Promise<Awaited<ReturnType<typeof inject>>> | undefined;
      try {
        pendingReq = check.request(demotedCookie);
        await waitForWaiters(1);
        await holder.query(`UPDATE user_role SET role_id = 'collaborator' WHERE user_id = $1`, [demotedAdmin.id]);
        await grantExtraPermissionOnClient(holder, 'collaborator', check.permission);
      } finally {
        await releaseLockClient(holder);
        try {
          if (pendingReq) {
            const res = await pendingReq;
            expect(res.statusCode, `Expected 403 (before 404/409) for ${check.permission}`).toBe(403);
          }
        } finally {
          await removeExtraPermission('collaborator', check.permission);
        }
      }
      const snapshotAfter = await captureDomainSnapshot(h.clientId);
      expect(snapshotAfter, `Domain altered during demoted admin attempt for ${check.permission}`).toEqual(snapshotBefore);
    }
  });

  it('evaluates current role inside createTaskComment transaction: demoted admin cannot bypass task assignment even with tasks.manage grant, and promoted collaborator uses tasks.manage instead of stale snapshot', async () => {
    const setupAdmin = await fixture('administrator');
    const setupAdminCookie = await cookieFor(setupAdmin.email);
    const foreignCollab = await fixture('collaborator');
    const clientId = await createTestClientRecord(setupAdminCookie, `CommentRole-${randomUUID().slice(0, 6)}`);
    const demand = await createTestDemandRecord(setupAdminCookie, clientId, 'Comment Role Demand');

    const foreignTaskRes = await inject({
      method: 'POST',
      url: '/api/v1/tasks',
      headers: { origin, cookie: setupAdminCookie, 'content-type': 'application/json' },
      payload: {
        demandId: demand.id,
        assignedToUserId: foreignCollab.id,
        title: 'Foreign Assigned Task',
        priority: 'normal',
      },
    });
    expect(foreignTaskRes.statusCode).toBe(201);
    const foreignTaskId = (foreignTaskRes.json() as { task: { id: string } }).task.id;

    // 1. Stale administrator role -> demoted to collaborator while waiting on IDENTITY_LOCK, even with tasks.manage granted to collaborator:
    //    must require current task assignment and reject comment on foreign task with 404 (and 403 if tasks.execute is revoked).
    const actorDemoted = await fixture('administrator');
    const actorDemotedCookie = await cookieFor(actorDemoted.email);
    const snapshotBefore1 = await captureDomainSnapshot(clientId);

    const holder1 = await holdIdentityLock();
    let pendingDemotedForeign: Promise<Awaited<ReturnType<typeof inject>>> | undefined;
    try {
      pendingDemotedForeign = inject({
        method: 'POST',
        url: `/api/v1/tasks/${foreignTaskId}/comments`,
        headers: { origin, cookie: actorDemotedCookie, 'content-type': 'application/json' },
        payload: { content: 'Stale admin trying to comment on foreign task' },
      });
      await waitForWaiters(1);
      await holder1.query(`UPDATE user_role SET role_id = 'collaborator' WHERE user_id = $1`, [actorDemoted.id]);
      await grantExtraPermissionOnClient(holder1, 'collaborator', 'tasks.manage');
    } finally {
      await releaseLockClient(holder1);
      try {
        if (pendingDemotedForeign) {
          const res = await pendingDemotedForeign;
          expect(res.statusCode).toBe(404);
        }
      } finally {
        await removeExtraPermission('collaborator', 'tasks.manage');
      }
    }
    const snapshotAfter1 = await captureDomainSnapshot(clientId);
    expect(snapshotAfter1).toEqual(snapshotBefore1);

    // 1b. Stale administrator role -> demoted to collaborator while waiting on IDENTITY_LOCK, with tasks.execute revoked and tasks.manage granted:
    //     must check tasks.execute (for collaborator) rather than tasks.manage (from stale administrator snapshot), returning 403.
    const actorDemotedNoExec = await fixture('administrator');
    const actorDemotedNoExecCookie = await cookieFor(actorDemotedNoExec.email);
    const snapshotBefore1b = await captureDomainSnapshot(clientId);
    const holder1b = await holdIdentityLock();
    let pendingDemotedNoExec: Promise<Awaited<ReturnType<typeof inject>>> | undefined;
    try {
      pendingDemotedNoExec = inject({
        method: 'POST',
        url: `/api/v1/tasks/${foreignTaskId}/comments`,
        headers: { origin, cookie: actorDemotedNoExecCookie, 'content-type': 'application/json' },
        payload: { content: 'Stale admin without tasks.execute' },
      });
      await waitForWaiters(1);
      await holder1b.query(`UPDATE user_role SET role_id = 'collaborator' WHERE user_id = $1`, [actorDemotedNoExec.id]);
      await grantExtraPermissionOnClient(holder1b, 'collaborator', 'tasks.manage');
      await revokePermissionOnClient(holder1b, 'collaborator', 'tasks.execute');
    } finally {
      await releaseLockClient(holder1b);
      try {
        if (pendingDemotedNoExec) {
          const res = await pendingDemotedNoExec;
          expect(res.statusCode).toBe(403);
        }
      } finally {
        await restorePermission('collaborator', 'tasks.execute');
        await removeExtraPermission('collaborator', 'tasks.manage');
      }
    }
    const snapshotAfter1b = await captureDomainSnapshot(clientId);
    expect(snapshotAfter1b).toEqual(snapshotBefore1b);

    // 2. Stale collaborator role -> promoted to administrator while waiting on IDENTITY_LOCK:
    //    must choose tasks.manage (not tasks.execute from stale collaborator snapshot) and allow commenting on foreignTaskId even when tasks.execute is revoked on administrator.
    const actorPromoted = await fixture('collaborator');
    const actorPromotedCookie = await cookieFor(actorPromoted.email);
    const countBefore2Events = await countDemandEvents(demand.id);
    const countBefore2Comments = await countTaskComments(foreignTaskId);
    const holder2 = await holdIdentityLock();
    let pendingPromoted: Promise<Awaited<ReturnType<typeof inject>>> | undefined;
    try {
      pendingPromoted = inject({
        method: 'POST',
        url: `/api/v1/tasks/${foreignTaskId}/comments`,
        headers: { origin, cookie: actorPromotedCookie, 'content-type': 'application/json' },
        payload: { content: 'Promoted to administrator in-flight' },
      });
      await waitForWaiters(1);
      await holder2.query(`UPDATE user_role SET role_id = 'administrator' WHERE user_id = $1`, [actorPromoted.id]);
      await revokePermissionOnClient(holder2, 'administrator', 'tasks.execute');
    } finally {
      await releaseLockClient(holder2);
      try {
        if (pendingPromoted) {
          const res = await pendingPromoted;
          expect(res.statusCode).toBe(201);
        }
      } finally {
        await restorePermission('administrator', 'tasks.execute');
      }
    }
    expect(await countTaskComments(foreignTaskId)).toBe(countBefore2Comments + 1);
    expect(await countDemandEvents(demand.id)).toBe(countBefore2Events + 1);

    // 2b. Stale collaborator role -> promoted to administrator while waiting on IDENTITY_LOCK, but tasks.manage is revoked on administrator (while tasks.execute remains):
    //     must reject with 403 because current role is administrator (which requires tasks.manage), even on a task assigned to the actor!
    const actorPromotedNoManage = await fixture('collaborator');
    const actorPromotedNoManageCookie = await cookieFor(actorPromotedNoManage.email);
    const ownTaskRes = await inject({
      method: 'POST',
      url: '/api/v1/tasks',
      headers: { origin, cookie: setupAdminCookie, 'content-type': 'application/json' },
      payload: {
        demandId: demand.id,
        assignedToUserId: actorPromotedNoManage.id,
        title: 'Own Task Before Promotion',
        priority: 'normal',
      },
    });
    expect(ownTaskRes.statusCode).toBe(201);
    const ownTaskId = (ownTaskRes.json() as { task: { id: string } }).task.id;
    const snapshotBefore2b = await captureDomainSnapshot(clientId);

    const holder2b = await holdIdentityLock();
    let pendingPromotedNoManage: Promise<Awaited<ReturnType<typeof inject>>> | undefined;
    try {
      pendingPromotedNoManage = inject({
        method: 'POST',
        url: `/api/v1/tasks/${ownTaskId}/comments`,
        headers: { origin, cookie: actorPromotedNoManageCookie, 'content-type': 'application/json' },
        payload: { content: 'Should require tasks.manage after promotion' },
      });
      await waitForWaiters(1);
      await holder2b.query(`UPDATE user_role SET role_id = 'administrator' WHERE user_id = $1`, [actorPromotedNoManage.id]);
      await revokePermissionOnClient(holder2b, 'administrator', 'tasks.manage');
    } finally {
      await releaseLockClient(holder2b);
      try {
        if (pendingPromotedNoManage) {
          const res = await pendingPromotedNoManage;
          expect(res.statusCode).toBe(403);
        }
      } finally {
        await restorePermission('administrator', 'tasks.manage');
      }
    }
    const snapshotAfter2b = await captureDomainSnapshot(clientId);
    expect(snapshotAfter2b).toEqual(snapshotBefore2b);
  });

  it('prevents previous assignee from writing a comment after concurrent reassignTask commits, verified via pg_locks barrier', async () => {
    const admin = await fixture('administrator');
    const adminCookie = await cookieFor(admin.email);
    const oldAssignee = await fixture('collaborator');
    const oldAssigneeCookie = await cookieFor(oldAssignee.email);
    const newAssignee = await fixture('collaborator');

    const clientId = await createTestClientRecord(adminCookie, `ReassignRace-${randomUUID().slice(0, 6)}`);
    const demand = await createTestDemandRecord(adminCookie, clientId, 'Reassign Concurrency Demand');

    const createRes = await inject({
      method: 'POST',
      url: '/api/v1/tasks',
      headers: { origin, cookie: adminCookie, 'content-type': 'application/json' },
      payload: {
        demandId: demand.id,
        assignedToUserId: oldAssignee.id,
        title: 'Task To Be Reassigned',
        priority: 'high',
      },
    });
    expect(createRes.statusCode).toBe(201);
    const taskId = (createRes.json() as { task: { id: string } }).task.id;

    const eventsBefore = await countDemandEvents(demand.id);
    const commentsBefore = await countTaskComments(taskId);

    // Hold row-level FOR UPDATE lock on the demand so reassignTask acquires IDENTITY_LOCK and then blocks on the demand row lock.
    const rowHolder = await connectPoolClient(mig());
    await rowHolder.query('BEGIN');
    const pidRes = await rowHolder.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
    const rowHolderPid = pidRes.rows[0]!.pid;
    await rowHolder.query('SELECT id FROM demand WHERE id = $1 FOR UPDATE', [demand.id]);

    let reassignPromise: Promise<Awaited<ReturnType<typeof inject>>> | undefined;
    let commentPromise: Promise<Awaited<ReturnType<typeof inject>>> | undefined;
    let settled: PromiseSettledResult<Awaited<ReturnType<typeof inject>>>[] = [];

    try {
      reassignPromise = inject({
        method: 'POST',
        url: `/api/v1/tasks/${taskId}/reassign`,
        headers: { origin, cookie: adminCookie, 'content-type': 'application/json' },
        payload: {
          version: 1,
          assignedToUserId: newAssignee.id,
          reason: 'Reassigning to new collaborator before comment executes',
        },
      });

      // Wait until reassignTask holds IDENTITY_LOCK and is blocked on the demand row lock held by rowHolderPid in current_database()
      await waitForHolderBlockedOnRow(rowHolderPid);

      // Now launch createTaskComment as oldAssignee: authenticate() runs, then createTaskComment queues on IDENTITY_LOCK behind reassignTask
      commentPromise = inject({
        method: 'POST',
        url: `/api/v1/tasks/${taskId}/comments`,
        headers: { origin, cookie: oldAssigneeCookie, 'content-type': 'application/json' },
        payload: { content: 'Comment from previous assignee queued behind reassignTask' },
      });

      await waitForWaiters(1);
    } finally {
      await releaseLockClient(rowHolder);
      const pendingList = [reassignPromise, commentPromise].filter(
        (p): p is Promise<Awaited<ReturnType<typeof inject>>> => Boolean(p),
      );
      settled = await Promise.allSettled(pendingList);
    }

    expect(settled).toHaveLength(2);
    expect(settled[0]?.status).toBe('fulfilled');
    expect(settled[1]?.status).toBe('fulfilled');
    if (settled[0]?.status === 'fulfilled' && settled[1]?.status === 'fulfilled') {
      expect(settled[0].value.statusCode).toBe(200);
      expect(settled[1].value.statusCode).toBe(404);
    }

    const taskSnapshot = await mig().pool.query<{ assigned_to_user_id: string; version: number }>(
      'SELECT assigned_to_user_id, version FROM task WHERE id = $1',
      [taskId],
    );
    expect(taskSnapshot.rows[0]?.assigned_to_user_id).toBe(newAssignee.id);
    expect(taskSnapshot.rows[0]?.version).toBe(2);

    expect(await countTaskComments(taskId)).toBe(commentsBefore);

    const eventsAfter = await mig().pool.query<{ action: string }>(
      'SELECT action FROM demand_event WHERE demand_id = $1 ORDER BY created_at ASC, id ASC',
      [demand.id],
    );
    expect(eventsAfter.rows.length).toBe(eventsBefore + 1);
    expect(eventsAfter.rows[eventsAfter.rows.length - 1]?.action).toBe('task_reassigned');
    expect(eventsAfter.rows.some((e) => e.action === 'task_comment_created')).toBe(false);
  });
});
