import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { expect } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Demand, Task, Role } from '@orium/contracts';
import { buildApp } from '../apps/api/src/app.js';
import { createAuth, type Auth } from '../apps/api/src/auth.js';
import { loadConfig } from '../apps/api/src/config.js';
import { connectDatabase, type Database } from '../apps/api/src/db.js';
import { migrateDatabase } from '../apps/api/src/migrate.js';
import { authenticateInternal, IDENTITY_LOCK, provisionUser, type InternalSessionIdentity } from '../apps/api/src/identity.js';

export type NotificationActor = { id: string; cookie: string; session: InternalSessionIdentity };

export class NotificationFixtures {
  database!: Database;
  migrator!: Database;
  app!: FastifyInstance;
  auth!: Auth;
  readonly namespace = `p7-${randomUUID().slice(0, 8)}`;
  readonly users = new Set<string>();
  readonly clients = new Set<string>();
  readonly demands = new Set<string>();
  readonly revoked = new Set<string>();
  private requestIndex = 0;
  private baseline: unknown;
  constructor(readonly artifactName: string) {}

  private registry() {
    mkdirSync('.local/phase7/increment3/tests', { recursive: true });
    writeFileSync(`.local/phase7/increment3/tests/${this.artifactName}-ids.json`, JSON.stringify({ namespace: this.namespace, users: [...this.users], clients: [...this.clients], demands: [...this.demands] }, null, 2));
  }

  async init() {
    const applicationUrl = process.env.TEST_DATABASE_URL;
    const migrationUrl = process.env.TEST_MIGRATION_DATABASE_URL;
    if (!applicationUrl || !migrationUrl) throw new Error('Local TEST database URLs required; no skips.');
    const appUrl = new URL(applicationUrl);
    const migUrl = new URL(migrationUrl);
    if (!['postgres:', 'postgresql:'].includes(appUrl.protocol) || appUrl.protocol !== migUrl.protocol
      || appUrl.username !== 'orium_app' || migUrl.username !== 'orium_migrator' || appUrl.pathname !== '/orium_test' || migUrl.pathname !== '/orium_test'
      || !['127.0.0.1', 'localhost', '[::1]'].includes(appUrl.hostname) || appUrl.host !== migUrl.host) throw new Error('Refusing database outside isolated TEST.');
    await migrateDatabase(migrationUrl);
    this.database = connectDatabase(applicationUrl);
    this.migrator = connectDatabase(migrationUrl);
    this.baseline = await this.snapshot();
    const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: applicationUrl, BETTER_AUTH_SECRET: randomBytes(32).toString('hex'), WEB_ORIGIN: 'http://127.0.0.1:5173', API_ORIGIN: 'http://127.0.0.1:3001', API_HOST: '127.0.0.1', API_PORT: '3001' });
    this.auth = createAuth(config, this.database);
    this.app = await buildApp({ config, database: this.database, logger: false });
  }

  async snapshot() {
    const grants = (await this.migrator.pool.query('SELECT role_id,permission_id FROM role_permission ORDER BY role_id,permission_id')).rows;
    const history = [];
    for (const table of ['identity_event', 'identity_event_subject']) {
      history.push((await this.migrator.pool.query(`SELECT count(*)::int AS count, md5(coalesce(string_agg(to_jsonb(t)::text,'' ORDER BY to_jsonb(t)::text),'')) AS fingerprint FROM ${table} t`)).rows[0]);
    }
    return { grants, history };
  }

  request(actor: Pick<NotificationActor, 'cookie'>, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: Record<string, unknown>) {
    this.requestIndex++;
    return this.app.inject({ method, url, payload, remoteAddress: `127.6.${Math.floor(this.requestIndex / 250)}.${this.requestIndex % 250 + 1}`, headers: { cookie: actor.cookie, origin: 'http://127.0.0.1:5173', 'content-type': 'application/json' } });
  }

  async user(role: Role) {
    const password = randomBytes(24).toString('hex');
    const email = `${this.namespace}-${randomUUID().slice(0, 8)}@example.test`;
    const user = await provisionUser(this.database, { name: `${this.namespace} ${role}`, email, password, role });
    this.users.add(user.id);
    this.registry();
    const response = await this.request({ cookie: '' }, 'POST', '/api/v1/auth/sign-in/email', { email, password });
    expect(response.statusCode).toBe(200);
    const values = response.headers['set-cookie'];
    const cookies = Array.isArray(values) ? values : values ? [values] : [];
    const cookie = cookies.map((value) => value.split(';')[0]).join('; ');
    const session = await authenticateInternal(this.database, this.auth, { cookie });
    return { id: user.id, cookie, session };
  }

  async demand(actor: NotificationActor, deliveryDate = '2030-12-31'): Promise<Demand> {
    const client = await this.request(actor, 'POST', '/api/v1/clients', { name: `${this.namespace}-${randomUUID().slice(0, 8)}` });
    expect(client.statusCode).toBe(201);
    const clientId = client.json().client.id as string;
    this.clients.add(clientId);
    this.registry();
    const response = await this.request(actor, 'POST', '/api/v1/demands', { clientId, title: `${this.namespace} demand`, priority: 'normal', deliveryDate });
    expect(response.statusCode).toBe(201);
    const demand = response.json().demand as Demand;
    this.demands.add(demand.id);
    this.registry();
    return demand;
  }

  async task(actor: NotificationActor, demand: Demand, assignee: NotificationActor, extra: Record<string, unknown> = {}): Promise<Task> {
    const response = await this.request(actor, 'POST', '/api/v1/tasks', { demandId: demand.id, assignedToUserId: assignee.id, title: `${this.namespace}-${randomUUID().slice(0, 8)}`, priority: 'normal', ...extra });
    expect(response.statusCode).toBe(201);
    return response.json().task as Task;
  }

  async action(actor: NotificationActor, task: Task, action: string, extra: Record<string, unknown> = {}): Promise<Task> {
    const response = await this.request(actor, 'POST', `/api/v1/tasks/${task.id}/${action}`, { version: task.version, ...extra });
    expect(response.statusCode).toBe(200);
    return response.json().task as Task;
  }

  async revoke(role: Role, permission: string) {
    const client = await this.migrator.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock($1)', [IDENTITY_LOCK]);
      const result = await client.query('DELETE FROM role_permission WHERE role_id=$1 AND permission_id=$2 RETURNING role_id', [role, permission]);
      await client.query('COMMIT');
      if (result.rowCount) this.revoked.add(`${role}:${permission}`);
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  async restore() {
    if (!this.revoked.size) return;
    const client = await this.migrator.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock($1)', [IDENTITY_LOCK]);
      for (const key of this.revoked) {
        const [role, permission] = key.split(':');
        await client.query('INSERT INTO role_permission VALUES ($1,$2) ON CONFLICT DO NOTHING', [role, permission]);
      }
      await client.query('COMMIT');
      this.revoked.clear();
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  async cleanup() {
    if (!this.migrator) return;
    this.registry();
    try {
      await this.app?.close();
      await this.restore();
      const client = await this.migrator.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock($1)', [IDENTITY_LOCK]);
        await client.query('DELETE FROM demand WHERE id=ANY($1::uuid[])', [[...this.demands]]);
        await client.query('DELETE FROM client WHERE id=ANY($1::uuid[])', [[...this.clients]]);
        await client.query('DELETE FROM identity_event WHERE actor_id=ANY($1::text[]) OR target_user_id=ANY($1::text[])', [[...this.users]]);
        await client.query('DELETE FROM identity_event_subject WHERE user_id=ANY($1::text[])', [[...this.users]]);
        await client.query('DELETE FROM auth_user WHERE id=ANY($1::text[])', [[...this.users]]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally { client.release(); }
      const after = await this.snapshot();
      const residues = (await this.migrator.pool.query(`SELECT
        (SELECT count(*) FROM auth_user WHERE id=ANY($1::text[]))::int AS users,
        (SELECT count(*) FROM identity_event WHERE target_user_id=ANY($1::text[]) OR actor_id=ANY($1::text[]))::int AS events,
        (SELECT count(*) FROM identity_event_subject WHERE user_id=ANY($1::text[]))::int AS subjects,
        (SELECT count(*) FROM client WHERE id=ANY($2::uuid[]))::int AS clients,
        (SELECT count(*) FROM demand WHERE id=ANY($3::uuid[]))::int AS demands,
        (SELECT count(*) FROM task WHERE demand_id=ANY($3::uuid[]))::int AS tasks,
        (SELECT count(*) FROM notification WHERE demand_id=ANY($3::uuid[]) OR recipient_user_id=ANY($1::text[]))::int AS notifications
      `, [[...this.users], [...this.clients], [...this.demands]])).rows[0];
      writeFileSync(`.local/phase7/increment3/tests/${this.artifactName}-cleanup.json`, JSON.stringify({ before: this.baseline, after, residues }, null, 2));
      expect(after).toEqual(this.baseline);
      expect(Object.values(residues).every((value) => value === 0)).toBe(true);
    } finally {
      await this.migrator.pool.end();
      await this.database?.pool.end();
    }
  }
}
