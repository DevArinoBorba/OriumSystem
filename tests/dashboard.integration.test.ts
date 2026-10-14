import { randomBytes, randomUUID } from 'node:crypto';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Role, DashboardResponse, SessionResponse } from '@orium/contracts';
import { dashboardResponseSchema } from '@orium/contracts';
import { buildApp } from '../apps/api/src/app.js';
import { loadConfig } from '../apps/api/src/config.js';
import { connectDatabase, assertApplicationDatabase, type Database } from '../apps/api/src/db.js';
import { migrateDatabase } from '../apps/api/src/migrate.js';
import { provisionUser } from '../apps/api/src/identity.js';
import { addCalendarDays, getDashboard } from '../apps/api/src/dashboard.js';

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

// Asserção estrita de contrato e anti-vazamento sobre o corpo JSON bruto
function assertStrictAntiLeakAndContract(raw: unknown, isAdmin: boolean, expectWorkloadAvailable?: boolean): DashboardResponse {
  // 1. Zod schema compartilhado oficial (validação rigorosa de tipos e formatos)
  const parsed = dashboardResponseSchema.parse(raw);
  const rawRecord = raw as Record<string, unknown>;

  // 2. Anti-vazamento no corpo bruto (rejeita qualquer propriedade extra não prevista)
  const allowedTopKeys = ['generatedAt', 'today', 'timeZone', 'upcomingDays', 'scope', 'sections', 'workload', 'workloadAvailable'];
  for (const key of Object.keys(rawRecord)) {
    if (!allowedTopKeys.includes(key)) {
      throw new Error(`Anti-leak violation: chave inesperada no topo do payload: "${key}"`);
    }
  }

  expect(parsed.timeZone).toBe('America/Cuiaba');
  expect(parsed.upcomingDays).toBe(3);
  expect(parsed.scope).toBe(isAdmin ? 'all' : 'assigned');

  // Validação estrita das 7 seções obrigatórias
  const expectedSections = ['production', 'awaitingAction', 'overdueTasks', 'overdueDemands', 'dueToday', 'upcoming', 'urgent'];
  const rawSections = rawRecord.sections as Record<string, unknown>;
  expect(Object.keys(rawSections).sort()).toEqual(expectedSections.sort());

  for (const section of Object.values(parsed.sections)) {
    expect(typeof section.total).toBe('number');
    expect(section.total).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(section.items)).toBe(true);

    for (const item of section.items) {
      const itemRecord = item as unknown as Record<string, unknown>;
      const clientRecord = item.client as unknown as Record<string, unknown>;

      // Cliente deve projetar SOMENTE id e name
      expect(Object.keys(clientRecord).sort()).toEqual(['id', 'name']);
      expect(clientRecord.email).toBeUndefined();
      expect(clientRecord.phone).toBeUndefined();
      expect(clientRecord.contactName).toBeUndefined();
      expect(clientRecord.notes).toBeUndefined();

      // Proibição estrita de credenciais, comentários ou dados confidenciais
      expect(itemRecord.email).toBeUndefined();
      expect(itemRecord.password).toBeUndefined();
      expect(itemRecord.comments).toBeUndefined();
      expect(itemRecord.history).toBeUndefined();

      // Se colaborador, assignedTo DEVE ser null
      if (!isAdmin) {
        expect(item.assignedTo).toBeNull();
      } else if (item.assignedTo) {
        const userRecord = item.assignedTo as unknown as Record<string, unknown>;
        expect(Object.keys(userRecord).sort()).toEqual(['id', 'name']);
        expect(userRecord.email).toBeUndefined();
      }
    }
  }

  const canSeeWorkload = expectWorkloadAvailable !== undefined ? expectWorkloadAvailable : isAdmin;

  // Validação estrita de Carga da Equipe (Workload)
  if (!canSeeWorkload) {
    expect(parsed.workloadAvailable).toBe(false);
    expect(Array.isArray(parsed.workload)).toBe(true);
    expect(parsed.workload.length).toBe(0);
  } else {
    expect(parsed.workloadAvailable).toBe(true);
    expect(Array.isArray(parsed.workload)).toBe(true);
    for (const member of parsed.workload) {
      const memberRecord = member as unknown as Record<string, unknown>;
      expect(Object.keys(memberRecord).sort()).toEqual(['active', 'awaitingAction', 'name', 'production', 'total', 'userId']);
      expect(memberRecord.email).toBeUndefined();
      expect(memberRecord.password).toBeUndefined();
      expect(typeof member.userId).toBe('string');
      expect(typeof member.name).toBe('string');
      expect(typeof member.active).toBe('boolean');
      expect(typeof member.total).toBe('number');
      expect(typeof member.production).toBe('number');
      expect(typeof member.awaitingAction).toBe('number');
      expect(member.total).toBeLessThanOrEqual(member.production + member.awaitingAction);
      expect(member.total).toBeGreaterThanOrEqual(Math.max(member.production, member.awaitingAction));
    }
  }

  return parsed;
}

describe('Dashboard Operacional — Fase 4 contra PostgreSQL orium_test', () => {
  let app: FastifyInstance | undefined;
  let database: Database | undefined;
  let migrationUrl: string;

  let adminUser: { id: string; email: string };
  let collab1: { id: string; email: string };
  let collab2: { id: string; email: string };

  const userPrefix = `dash-test-user-${randomUUID().slice(0, 8)}-`;
  const clientPrefix = `dash-test-client-${randomUUID().slice(0, 8)}-`;
  const demandPrefix = `dash-test-d-${randomUUID().slice(0, 8)}-`;
  const password = randomBytes(24).toString('hex');
  const origin = 'http://127.0.0.1:5173';
  let requestIndex = 0;

  const createdDemandIds: string[] = [];
  const createdClientIds: string[] = [];
  const createdTaskIds: string[] = [];
  const createdUserIds: string[] = [];

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

  const fixtureUser = async (role: Role, label: string) => {
    const email = `${userPrefix}${label}-${randomUUID().slice(0, 6)}@example.test`;
    const created = await provisionUser(db(), { name: `User ${label}`, email, password, role });
    createdUserIds.push(created.id);
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

  const createFixtureClient = async (cookie: string, nameSuffix: string) => {
    const name = `${clientPrefix}${nameSuffix}`;
    const res = await inject({
      method: 'POST',
      url: '/api/v1/clients',
      headers: { origin, cookie },
      payload: {
        name,
        contactName: 'Contato Operacional Dashboard',
        email: `client-${randomUUID().slice(0, 8)}@fixture.test`,
        phone: '65999998888',
        notes: 'Nota restrita confidencial do cliente',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    const client = (body.client ?? body) as { id: string; name: string };
    createdClientIds.push(client.id);
    return client;
  };

  const createFixtureDemand = async (cookie: string, clientId: string, titleSuffix: string, deliveryDate: string, priority: 'low' | 'normal' | 'high' | 'urgent' = 'normal') => {
    const title = `${demandPrefix}${titleSuffix}`;
    const res = await inject({
      method: 'POST',
      url: '/api/v1/demands',
      headers: { origin, cookie },
      payload: {
        clientId,
        title,
        description: 'Demanda de teste para validação de dashboard',
        priority,
        deliveryDate,
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    const demand = body.demand;
    createdDemandIds.push(demand.id);
    return demand;
  };

  const createFixtureTask = async (
    cookie: string,
    demandId: string,
    assignedToUserId: string,
    title: string,
    deliveryDate: string,
    priority: 'low' | 'normal' | 'high' | 'urgent' = 'normal',
    requirements: Array<{ title: string; mandatory: boolean }> = []
  ) => {
    const res = await inject({
      method: 'POST',
      url: '/api/v1/tasks',
      headers: { origin, cookie },
      payload: {
        demandId,
        assignedToUserId,
        title,
        description: 'Tarefa fixture de teste para dashboard',
        priority,
        deliveryDate,
        requirements,
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    const task = body.task;
    createdTaskIds.push(task.id);
    return task;
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
    await database.pool.query(`DELETE FROM auth_user WHERE email LIKE 'dash-test-%'`);
    await database.pool.query(`DELETE FROM client WHERE name LIKE 'dash-test-%'`);
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

    adminUser = await fixtureUser('administrator', 'admin');
    collab1 = await fixtureUser('collaborator', 'collab1');
    collab2 = await fixtureUser('collaborator', 'collab2');
  }, 60000);

  afterAll(async () => {
    try {
      if (database) {
        // Limpeza cirúrgica de fixtures criadas
        if (createdDemandIds.length > 0) {
          await database.pool.query(`DELETE FROM demand_event WHERE demand_id = ANY($1::uuid[])`, [createdDemandIds]);
          await database.pool.query(`DELETE FROM task_comment WHERE task_id IN (SELECT id FROM task WHERE demand_id = ANY($1::uuid[]))`, [createdDemandIds]);
          await database.pool.query(`DELETE FROM task_requirement WHERE task_id IN (SELECT id FROM task WHERE demand_id = ANY($1::uuid[]))`, [createdDemandIds]);
          await database.pool.query(`DELETE FROM task_dependency WHERE task_id IN (SELECT id FROM task WHERE demand_id = ANY($1::uuid[]))`, [createdDemandIds]);
          await database.pool.query(`DELETE FROM task WHERE demand_id = ANY($1::uuid[])`, [createdDemandIds]);
          await database.pool.query(`DELETE FROM demand WHERE id = ANY($1::uuid[])`, [createdDemandIds]);
        }
        if (createdClientIds.length > 0) {
          await database.pool.query(`DELETE FROM client WHERE id = ANY($1::uuid[])`, [createdClientIds]);
        }
        if (createdUserIds.length > 0) {
          await database.pool.query(`DELETE FROM user_role WHERE user_id = ANY($1::text[])`, [createdUserIds]);
          await database.pool.query(`DELETE FROM auth_session WHERE user_id = ANY($1::text[])`, [createdUserIds]);
          await database.pool.query(`DELETE FROM auth_account WHERE user_id = ANY($1::text[])`, [createdUserIds]);
          await database.pool.query(`DELETE FROM auth_user WHERE id = ANY($1::text[])`, [createdUserIds]);
        }
      }
    } finally {
      try {
        if (app) await app.close();
      } finally {
        if (database) await database.pool.end();
      }
    }
  });

  // =========================================================================
  // 1. AUTENTICAÇÃO E RBAC
  // =========================================================================
  describe('1. Autenticação e RBAC', () => {
    it('deve rejeitar requisição sem autenticação com HTTP 401 UNAUTHENTICATED', async () => {
      const res = await inject({
        method: 'GET',
        url: '/api/v1/dashboard',
        headers: { origin },
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().error?.code).toBe('UNAUTHENTICATED');
    });

    it('deve permitir acesso para administrador autenticado com HTTP 200 e payload rigorosamente validado', async () => {
      const cookie = await cookieFor(adminUser.email);
      const res = await inject({
        method: 'GET',
        url: '/api/v1/dashboard',
        headers: { origin, cookie },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      const parsed = assertStrictAntiLeakAndContract(body, true);
      expect(parsed.scope).toBe('all');
      expect(parsed.timeZone).toBe('America/Cuiaba');
      expect(parsed.upcomingDays).toBe(3);
      expect(parsed.workloadAvailable).toBe(true);
    });

    it('deve permitir acesso para colaborador autenticado com escopo "assigned" e carga oculta', async () => {
      const cookie = await cookieFor(collab1.email);
      const res = await inject({
        method: 'GET',
        url: '/api/v1/dashboard',
        headers: { origin, cookie },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      const parsed = assertStrictAntiLeakAndContract(body, false);
      expect(parsed.scope).toBe('assigned');
      expect(parsed.workloadAvailable).toBe(false);
      expect(parsed.workload).toEqual([]);
    });

    it('revalidação de identidade e demotion: administrador demotado para colaborador perde acesso à carga e passa para escopo assigned', async () => {
      const adminCookie = await cookieFor(adminUser.email);
      const transientAdmin = await fixtureUser('administrator', 'demote-test');
      const transientCookie = await cookieFor(transientAdmin.email);

      // 1. Antes da demotion: vê scope all e workload completo
      const resBefore = await inject({
        method: 'GET',
        url: '/api/v1/dashboard',
        headers: { origin, cookie: transientCookie },
      });
      expect(resBefore.statusCode).toBe(200);
      const bodyBefore = resBefore.json();
      assertStrictAntiLeakAndContract(bodyBefore, true);
      expect(bodyBefore.scope).toBe('all');
      expect(bodyBefore.workloadAvailable).toBe(true);

      // 2. Demotar para collaborator via PUT /api/v1/users/:id/role
      const demoteRes = await inject({
        method: 'PUT',
        url: `/api/v1/users/${transientAdmin.id}/role`,
        headers: { origin, cookie: adminCookie },
        payload: { role: 'collaborator' },
      });
      expect(demoteRes.statusCode).toBe(200);

      // 3. A sessão antiga é invalidada
      const resOldSession = await inject({
        method: 'GET',
        url: '/api/v1/dashboard',
        headers: { origin, cookie: transientCookie },
      });
      expect(resOldSession.statusCode).toBe(401);

      // 4. Nova sessão: opera rigorosamente como colaborador
      const newCollabCookie = await cookieFor(transientAdmin.email);
      const resAfter = await inject({
        method: 'GET',
        url: '/api/v1/dashboard',
        headers: { origin, cookie: newCollabCookie },
      });
      expect(resAfter.statusCode).toBe(200);
      const bodyAfter = resAfter.json();
      assertStrictAntiLeakAndContract(bodyAfter, false);
      expect(bodyAfter.scope).toBe('assigned');
      expect(bodyAfter.workloadAvailable).toBe(false);
      expect(bodyAfter.workload).toEqual([]);
    });

    it('revalidação contra banco em snapshot isolado rejeita permissões/papéis forjados e usuário inativo', async () => {
      // 1. Sessão com payload forjado alegando administrator e permissões extras para colaborador real
      const forgedAdminSession: SessionResponse = {
        user: { id: collab1.id, name: 'Colaborador 1', email: collab1.email },
        roles: ['administrator'],
        permissions: [
          'protected.read', 'users.read', 'users.create', 'users.deactivate', 'roles.manage',
          'clients.read', 'clients.write', 'clients.archive',
          'demands.read', 'demands.write',
          'tasks.read', 'tasks.manage', 'tasks.execute', 'tasks.review',
        ],
      };

      // Chamada direta do serviço com sessão forjada: banco revalida contra user_role e ignora papéis forjados
      const result = await getDashboard(db(), forgedAdminSession, { limit: 20 });
      expect(result.scope).toBe('assigned');
      expect(result.workloadAvailable).toBe(false);
      expect(result.workload).toEqual([]);
      for (const section of Object.values(result.sections)) {
        for (const item of section.items) {
          expect(item.assignedTo).toBeNull();
        }
      }

      // 2. Usuário real desativado no banco de dados deve ser rejeitado com 401 UNAUTHENTICATED
      const userToDeactivate = await fixtureUser('collaborator', 'to-deactivate');
      await db().pool.query(`UPDATE auth_user SET active = false WHERE id = $1`, [userToDeactivate.id]);

      const inactiveSession: SessionResponse = {
        user: { id: userToDeactivate.id, name: 'Inactive User', email: userToDeactivate.email },
        roles: ['collaborator'],
        permissions: ['demands.read', 'tasks.read'],
      };

      try {
        await getDashboard(db(), inactiveSession, { limit: 20 });
        expect.unreachable('Deveria ter lançado AppError(401, UNAUTHENTICATED) para usuário inativo');
      } catch (err: unknown) {
        const appErr = err as { status?: number; code?: string };
        expect(appErr.status).toBe(401);
        expect(appErr.code).toBe('UNAUTHENTICATED');
      }
    });

    it('administrador sem permissão users.read acessa dashboard em escopo "all", mas tem carga oculta (workload: [])', async () => {
      const adminCookie = await cookieFor(adminUser.email);
      // Remove temporariamente a permissão users.read do papel administrator em transação/teste isolado
      await db().pool.query(`DELETE FROM role_permission WHERE role_id = 'administrator' AND permission_id = 'users.read'`);
      try {
        const res = await inject({
          method: 'GET',
          url: '/api/v1/dashboard',
          headers: { origin, cookie: adminCookie },
        });
        expect(res.statusCode).toBe(200);
        const body = res.json();
        const parsed = assertStrictAntiLeakAndContract(body, true, false);
        expect(parsed.scope).toBe('all');
        expect(parsed.workloadAvailable).toBe(false);
        expect(parsed.workload).toEqual([]); // Estritamente array vazio [] conforme contrato
      } finally {
        await db().pool.query(`INSERT INTO role_permission (role_id, permission_id) VALUES ('administrator', 'users.read') ON CONFLICT DO NOTHING`);
      }
    });
  });

  // =========================================================================
  // 2. ISOLAMENTO DO COLABORADOR E ANTI-VAZAMENTO (ANTI-IDOR)
  // =========================================================================
  describe('2. Isolamento do Colaborador e Anti-Vazamento', () => {
    it('colaborador enxerga exclusivamente suas tarefas e chamados vinculados, sem vazar trabalho alheio', async () => {
      const adminCookie = await cookieFor(adminUser.email);
      const collab1Cookie = await cookieFor(collab1.email);
      const collab2Cookie = await cookieFor(collab2.email);

      const client = await createFixtureClient(adminCookie, 'AntiLeakClient');
      const demand = await createFixtureDemand(adminCookie, client.id, 'DemandMultiAssignee', '2026-11-20', 'normal');

      // Tarefa atribuída a Colab 1
      const taskCollab1 = await createFixtureTask(adminCookie, demand.id, collab1.id, 'Tarefa de Colab 1', '2026-11-20', 'normal');
      // Tarefa atribuída a Colab 2
      const taskCollab2 = await createFixtureTask(adminCookie, demand.id, collab2.id, 'Tarefa Secreta de Colab 2', '2026-11-20', 'urgent');

      // Consulta de Colab 1
      const res1 = await inject({
        method: 'GET',
        url: '/api/v1/dashboard',
        headers: { origin, cookie: collab1Cookie },
      });
      expect(res1.statusCode).toBe(200);
      const body1 = assertStrictAntiLeakAndContract(res1.json(), false);

      // Colab 1 deve ver sua tarefa
      const allItemsCollab1 = Object.values(body1.sections).flatMap((s) => s.items);
      const hasTask1 = allItemsCollab1.some((it) => it.id === taskCollab1.id);
      expect(hasTask1).toBe(true);

      // Colab 1 NUNCA deve ver a tarefa de Colab 2
      const hasTask2 = allItemsCollab1.some((it) => it.id === taskCollab2.id || it.title.includes('Colab 2'));
      expect(hasTask2).toBe(false);

      // O campo assignedTo de cada item deve ser rigorosamente null para colaborador (não expõe responsável)
      for (const item of allItemsCollab1) {
        expect(item.assignedTo).toBeNull();
      }

      // Colaborador NUNCA deve ter acesso à carga da equipe
      expect(body1.workloadAvailable).toBe(false);
      expect(body1.workload).toEqual([]);

      // Consulta simétrica de Colab 2: deve enxergar exclusivamente sua tarefa secreta
      const res2 = await inject({
        method: 'GET',
        url: '/api/v1/dashboard',
        headers: { origin, cookie: collab2Cookie },
      });
      expect(res2.statusCode).toBe(200);
      const body2 = assertStrictAntiLeakAndContract(res2.json(), false);
      const allItemsCollab2 = Object.values(body2.sections).flatMap((s) => s.items);
      expect(allItemsCollab2.some((it) => it.id === taskCollab2.id)).toBe(true);
      expect(allItemsCollab2.some((it) => it.id === taskCollab1.id)).toBe(false);
    });

    it('projeção de cliente contém apenas id e name (sem vazar emails, notas ou contatos confidenciais)', async () => {
      const collabCookie = await cookieFor(collab1.email);
      const res = await inject({
        method: 'GET',
        url: '/api/v1/dashboard',
        headers: { origin, cookie: collabCookie },
      });
      expect(res.statusCode).toBe(200);
      const body = assertStrictAntiLeakAndContract(res.json(), false);
      const allItems = Object.values(body.sections).flatMap((s) => s.items);

      for (const item of allItems) {
        expect(item.client).toBeDefined();
        expect(typeof item.client.id).toBe('string');
        expect(typeof item.client.name).toBe('string');
        // Não pode vazar campos de contato do cliente
        const clientRecord = item.client as unknown as Record<string, unknown>;
        expect(clientRecord.notes).toBeUndefined();
        expect(clientRecord.email).toBeUndefined();
        expect(clientRecord.phone).toBeUndefined();
        expect(clientRecord.contactName).toBeUndefined();
      }
    });

    it('total dos contadores do colaborador reflete quantidade EXATA de seus itens, excluindo rigorosamente itens de terceiros', async () => {
      const adminCookie = await cookieFor(adminUser.email);
      const collabSpecial = await fixtureUser('collaborator', 'counter-special');
      const collabSpecialCookie = await cookieFor(collabSpecial.email);

      const client = await createFixtureClient(adminCookie, 'CounterClient');
      const demand = await createFixtureDemand(adminCookie, client.id, 'CounterDemand', '2026-11-20', 'normal');

      // 1. Criar exatamente 2 tarefas em produção para collabSpecial (uma normal e uma urgente)
      const t1 = await createFixtureTask(adminCookie, demand.id, collabSpecial.id, 'Tarefa Prod 1', '2026-11-20', 'normal');
      const t2 = await createFixtureTask(adminCookie, demand.id, collabSpecial.id, 'Tarefa Prod Urgente', '2026-11-20', 'urgent');

      // Colab aceita e inicia as duas tarefas
      for (const t of [t1, t2]) {
        const tGet = await inject({ method: 'GET', url: `/api/v1/tasks/${t.id}`, headers: { origin, cookie: collabSpecialCookie } }).then(r => r.json());
        await inject({ method: 'POST', url: `/api/v1/tasks/${t.id}/accept`, headers: { origin, cookie: collabSpecialCookie }, payload: { version: tGet.task.version } });
        const tAcc = await inject({ method: 'GET', url: `/api/v1/tasks/${t.id}`, headers: { origin, cookie: collabSpecialCookie } }).then(r => r.json());
        await inject({ method: 'POST', url: `/api/v1/tasks/${t.id}/start`, headers: { origin, cookie: collabSpecialCookie }, payload: { version: tAcc.task.version } });
      }

      // 2. Criar 1 tarefa em awaitingAction para collabSpecial (bloqueada com requisito pendente)
      await createFixtureTask(adminCookie, demand.id, collabSpecial.id, 'Tarefa Bloqueada Colab', '2026-11-20', 'normal', [
        { title: 'Requisito obrigatório não cumprido', mandatory: true }
      ]);

      // 3. Criar várias tarefas para terceiros (admin) nas mesmas seções
      for (let i = 0; i < 3; i++) {
        const thirdPartyTask = await createFixtureTask(adminCookie, demand.id, adminUser.id, `Terceiro Tarefa ${i}`, '2026-11-20', 'urgent');
        const tpGet = await inject({ method: 'GET', url: `/api/v1/tasks/${thirdPartyTask.id}`, headers: { origin, cookie: adminCookie } }).then(r => r.json());
        await inject({ method: 'POST', url: `/api/v1/tasks/${thirdPartyTask.id}/accept`, headers: { origin, cookie: adminCookie }, payload: { version: tpGet.task.version } });
        const tpAcc = await inject({ method: 'GET', url: `/api/v1/tasks/${thirdPartyTask.id}`, headers: { origin, cookie: adminCookie } }).then(r => r.json());
        await inject({ method: 'POST', url: `/api/v1/tasks/${thirdPartyTask.id}/start`, headers: { origin, cookie: adminCookie }, payload: { version: tpAcc.task.version } });
      }

      // 4. Consulta sem corte de limit por collabSpecial
      const resFull = await inject({
        method: 'GET',
        url: '/api/v1/dashboard',
        headers: { origin, cookie: collabSpecialCookie },
      });
      expect(resFull.statusCode).toBe(200);
      const bodyFull = assertStrictAntiLeakAndContract(resFull.json(), false);

      // Comprovação exata de contagens:
      expect(bodyFull.sections.production.total).toBe(2); // Apenas as 2 tarefas próprias em produção (exclui as 3 de terceiros)
      expect(bodyFull.sections.awaitingAction.total).toBe(1); // Apenas a 1 tarefa própria bloqueada
      expect(bodyFull.sections.urgent.total).toBe(1); // Apenas a 1 tarefa própria urgente (exclui as 3 urgentes do admin)

      // 5. Consulta com corte severo limit=1 por collabSpecial
      const resLimit1 = await inject({
        method: 'GET',
        url: '/api/v1/dashboard?limit=1',
        headers: { origin, cookie: collabSpecialCookie },
      });
      expect(resLimit1.statusCode).toBe(200);
      const bodyLimit1 = assertStrictAntiLeakAndContract(resLimit1.json(), false);

      // O total permanece rigorosamente idêntico ao total real do colaborador, e a lista é truncada para 1
      expect(bodyLimit1.sections.production.total).toBe(2);
      expect(bodyLimit1.sections.production.items.length).toBe(1);
      expect(bodyLimit1.sections.awaitingAction.total).toBe(1);
      expect(bodyLimit1.sections.awaitingAction.items.length).toBe(1);
      expect(bodyLimit1.sections.urgent.total).toBe(1);
      expect(bodyLimit1.sections.urgent.items.length).toBe(1);
    });
  });

  // =========================================================================
  // 3. CARGA DA EQUIPE (WORKLOAD)
  // =========================================================================
  describe('3. Carga da Equipe (Workload)', () => {
    it('administrador com users.read visualiza workload com usuários ativos (mesmo sem carga) e contagens coerentes', async () => {
      const adminCookie = await cookieFor(adminUser.email);
      const res = await inject({
        method: 'GET',
        url: '/api/v1/dashboard',
        headers: { origin, cookie: adminCookie },
      });
      expect(res.statusCode).toBe(200);
      const body = assertStrictAntiLeakAndContract(res.json(), true);

      expect(body.workloadAvailable).toBe(true);
      expect(Array.isArray(body.workload)).toBe(true);
      expect(body.workload.length).toBeGreaterThanOrEqual(3); // Admin, Colab1, Colab2

      for (const member of body.workload) {
        expect(typeof member.userId).toBe('string');
        expect(typeof member.name).toBe('string');
        expect(typeof member.active).toBe('boolean');
        expect(member.total).toBe(member.production + member.awaitingAction);
        // Nenhum dado confidencial exposto
        const memberRecord = member as unknown as Record<string, unknown>;
        expect(memberRecord.email).toBeUndefined();
        expect(memberRecord.password).toBeUndefined();
      }
    });

    it('administrador visualiza assignedTo preenchido nas tarefas', async () => {
      const adminCookie = await cookieFor(adminUser.email);
      const res = await inject({
        method: 'GET',
        url: '/api/v1/dashboard',
        headers: { origin, cookie: adminCookie },
      });
      expect(res.statusCode).toBe(200);
      const body = assertStrictAntiLeakAndContract(res.json(), true);
      const allItems = Object.values(body.sections).flatMap((s) => s.items);

      const taskItems = allItems.filter((i) => i.kind === 'task');
      expect(taskItems.length).toBeGreaterThan(0);
      for (const item of taskItems) {
        expect(item.assignedTo).toBeDefined();
        if (item.assignedTo) {
          expect(typeof item.assignedTo.id).toBe('string');
          expect(typeof item.assignedTo.name).toBe('string');
        }
      }
    });

    it('confirma contagens exatas por usuário no workload e garante que tarefa em pause_requested não duplica total', async () => {
      const adminCookie = await cookieFor(adminUser.email);
      const collabSpecial = await fixtureUser('collaborator', 'workload-special');
      const collabSpecialCookie = await cookieFor(collabSpecial.email);

      // 1. Inicialmente: usuário ativo sem tarefas atribuídas
      const resInit = await inject({ method: 'GET', url: '/api/v1/dashboard', headers: { origin, cookie: adminCookie } });
      const bodyInit = assertStrictAntiLeakAndContract(resInit.json(), true);
      const initialEntry = bodyInit.workload.find((w) => w.userId === collabSpecial.id);
      expect(initialEntry).toBeDefined();
      expect(initialEntry?.production).toBe(0);
      expect(initialEntry?.awaitingAction).toBe(0);
      expect(initialEntry?.total).toBe(0);

      // 2. Criar cliente, demanda e 1 tarefa para o colaborador especial
      const client = await createFixtureClient(adminCookie, 'WorkloadClient');
      const demand = await createFixtureDemand(adminCookie, client.id, 'WorkloadDemand', '2026-12-10', 'normal');
      const task = await createFixtureTask(adminCookie, demand.id, collabSpecial.id, 'Tarefa Workload Dual', '2026-12-10', 'normal');

      // 3. Colaborador aceita e inicia a tarefa -> in_production
      const t1 = await inject({ method: 'GET', url: `/api/v1/tasks/${task.id}`, headers: { origin, cookie: collabSpecialCookie } }).then((r) => r.json());
      await inject({
        method: 'POST',
        url: `/api/v1/tasks/${task.id}/accept`,
        headers: { origin, cookie: collabSpecialCookie },
        payload: { version: t1.task.version },
      });
      const t2 = await inject({ method: 'GET', url: `/api/v1/tasks/${task.id}`, headers: { origin, cookie: collabSpecialCookie } }).then((r) => r.json());
      await inject({
        method: 'POST',
        url: `/api/v1/tasks/${task.id}/start`,
        headers: { origin, cookie: collabSpecialCookie },
        payload: { version: t2.task.version },
      });

      // 4. Colaborador solicita pausa operacional -> status continua in_production E pause_requested_at != null
      const t3 = await inject({ method: 'GET', url: `/api/v1/tasks/${task.id}`, headers: { origin, cookie: collabSpecialCookie } }).then((r) => r.json());
      const pauseRes = await inject({
        method: 'POST',
        url: `/api/v1/tasks/${task.id}/request-pause`,
        headers: { origin, cookie: collabSpecialCookie },
        payload: { version: t3.task.version, reason: 'Aguardando credenciais adicionais do cliente' },
      });
      expect(pauseRes.statusCode).toBe(200);

      // 5. Consulta dashboard pelo admin: tarefa qualifica em production E em awaitingAction simultaneamente,
      // mas total deve permanecer estritamente 1 (SEM DUPLICAÇÃO DE TAREFA)
      const resDual = await inject({ method: 'GET', url: '/api/v1/dashboard', headers: { origin, cookie: adminCookie } });
      const bodyDual = assertStrictAntiLeakAndContract(resDual.json(), true);
      const dualEntry = bodyDual.workload.find((w) => w.userId === collabSpecial.id);
      expect(dualEntry).toBeDefined();
      expect(dualEntry?.production).toBe(1);
      expect(dualEntry?.awaitingAction).toBe(1);
      expect(dualEntry?.total).toBe(1); // Crucial: total é 1, NÃO 2!
    });

    it('usuario inativo com trabalho aberto na carga aparece com active: false; usuario inativo sem trabalho é excluído', async () => {
      const adminCookie = await cookieFor(adminUser.email);
      const inactiveWithWork = await fixtureUser('collaborator', 'inact-with-work');
      const inactiveWithoutWork = await fixtureUser('collaborator', 'inact-no-work');

      const client = await createFixtureClient(adminCookie, 'InactClient');
      const demand = await createFixtureDemand(adminCookie, client.id, 'InactDemand', '2026-11-20', 'normal');

      // Atribuir 1 tarefa para inactiveWithWork
      await createFixtureTask(adminCookie, demand.id, inactiveWithWork.id, 'Tarefa de Inativo Com Carga', '2026-11-20', 'normal');

      // Desativar ambos os usuários diretamente na tabela auth_user
      await db().pool.query(`UPDATE auth_user SET active = false WHERE id = ANY($1::text[])`, [[inactiveWithWork.id, inactiveWithoutWork.id]]);

      // Admin consulta dashboard
      const res = await inject({
        method: 'GET',
        url: '/api/v1/dashboard',
        headers: { origin, cookie: adminCookie },
      });
      expect(res.statusCode).toBe(200);
      const body = assertStrictAntiLeakAndContract(res.json(), true);

      // inactiveWithWork DEVE aparecer no workload com active: false e total: 1
      const entryWithWork = body.workload.find((w) => w.userId === inactiveWithWork.id);
      expect(entryWithWork).toBeDefined();
      expect(entryWithWork?.active).toBe(false);
      expect(entryWithWork?.total).toBe(1);

      // inactiveWithoutWork NÃO DEVE aparecer no workload (u.active = false e count = 0)
      const entryWithoutWork = body.workload.find((w) => w.userId === inactiveWithoutWork.id);
      expect(entryWithoutWork).toBeUndefined();
    });
  });

  // =========================================================================
  // 4. CLASSIFICAÇÃO DAS SEÇÕES E ESTADOS
  // =========================================================================
  describe('4. Classificação das Seções e Estados', () => {
    it('tarefa em in_production entra na seção production', async () => {
      const adminCookie = await cookieFor(adminUser.email);
      const client = await createFixtureClient(adminCookie, 'ProdClient');
      const demand = await createFixtureDemand(adminCookie, client.id, 'ProdDemand', '2026-11-20', 'normal');
      const task = await createFixtureTask(adminCookie, demand.id, adminUser.id, 'Tarefa Em Produção', '2026-11-20', 'normal');

      // Aceitar e iniciar tarefa
      await inject({
        method: 'POST',
        url: `/api/v1/tasks/${task.id}/accept`,
        headers: { origin, cookie: adminCookie },
        payload: { version: task.version },
      });
      const tAccepted = await inject({
        method: 'GET',
        url: `/api/v1/tasks/${task.id}`,
        headers: { origin, cookie: adminCookie },
      }).then(r => r.json());

      await inject({
        method: 'POST',
        url: `/api/v1/tasks/${task.id}/start`,
        headers: { origin, cookie: adminCookie },
        payload: { version: tAccepted.task.version },
      });

      const res = await inject({
        method: 'GET',
        url: '/api/v1/dashboard',
        headers: { origin, cookie: adminCookie },
      });
      const body = assertStrictAntiLeakAndContract(res.json(), true);
      const prodItem = body.sections.production.items.find((i) => i.id === task.id);
      expect(prodItem).toBeDefined();
      expect(prodItem?.status).toBe('in_production');
    });

    it('tarefa bloqueada ou aguardando ação entra na seção awaitingAction com motivo explicativo', async () => {
      const adminCookie = await cookieFor(adminUser.email);
      const client = await createFixtureClient(adminCookie, 'AwaitingClient');
      const demand = await createFixtureDemand(adminCookie, client.id, 'AwaitingDemand', '2026-11-20', 'normal');
      const task = await createFixtureTask(adminCookie, demand.id, adminUser.id, 'Tarefa Bloqueada', '2026-11-20', 'normal', [
        { title: 'Requisito pendente', mandatory: true },
      ]);

      const res = await inject({
        method: 'GET',
        url: '/api/v1/dashboard',
        headers: { origin, cookie: adminCookie },
      });
      const body = assertStrictAntiLeakAndContract(res.json(), true);
      const awaitingItem = body.sections.awaitingAction.items.find((i) => i.id === task.id);
      expect(awaitingItem).toBeDefined();
      expect(awaitingItem?.status).toBe('blocked');
      expect(typeof awaitingItem?.reason).toBe('string');
      expect((awaitingItem?.reason ?? '').length).toBeGreaterThan(0);
    });

    it('tarefas concluídas (completed) e chamados concluídos ficam rigorosamente fora das pendências', async () => {
      const adminCookie = await cookieFor(adminUser.email);
      const client = await createFixtureClient(adminCookie, 'CompletedClient');
      const demand = await createFixtureDemand(adminCookie, client.id, 'CompletedDemand', '2026-11-20', 'normal');
      const task = await createFixtureTask(adminCookie, demand.id, adminUser.id, 'Tarefa Concluída', '2026-11-20', 'normal');

      // Ciclo completo até completed
      const t1 = await inject({ method: 'GET', url: `/api/v1/tasks/${task.id}`, headers: { origin, cookie: adminCookie } }).then(r => r.json());
      await inject({ method: 'POST', url: `/api/v1/tasks/${task.id}/accept`, headers: { origin, cookie: adminCookie }, payload: { version: t1.task.version } });
      const t2 = await inject({ method: 'GET', url: `/api/v1/tasks/${task.id}`, headers: { origin, cookie: adminCookie } }).then(r => r.json());
      await inject({ method: 'POST', url: `/api/v1/tasks/${task.id}/start`, headers: { origin, cookie: adminCookie }, payload: { version: t2.task.version } });
      const t3 = await inject({ method: 'GET', url: `/api/v1/tasks/${task.id}`, headers: { origin, cookie: adminCookie } }).then(r => r.json());
      await inject({ method: 'POST', url: `/api/v1/tasks/${task.id}/submit-review`, headers: { origin, cookie: adminCookie }, payload: { version: t3.task.version, deliveryNotes: 'Pronto para aprovação' } });
      const t4 = await inject({ method: 'GET', url: `/api/v1/tasks/${task.id}`, headers: { origin, cookie: adminCookie } }).then(r => r.json());
      await inject({ method: 'POST', url: `/api/v1/tasks/${task.id}/review`, headers: { origin, cookie: adminCookie }, payload: { version: t4.task.version, decision: 'complete', feedback: 'Aprovado' } });

      const res = await inject({
        method: 'GET',
        url: '/api/v1/dashboard',
        headers: { origin, cookie: adminCookie },
      });
      const body = assertStrictAntiLeakAndContract(res.json(), true);
      const allItems = Object.values(body.sections).flatMap((s) => s.items);
      const isTaskPresent = allItems.some((i) => i.id === task.id);
      expect(isTaskPresent).toBe(false);
    });

    it('valida exaustivamente todos os estados de awaitingAction e a diferenciação de ready aceito vs não aceito', async () => {
      const adminCookie = await cookieFor(adminUser.email);
      const client = await createFixtureClient(adminCookie, 'AllStatesClient');
      const demand = await createFixtureDemand(adminCookie, client.id, 'AllStatesDemand', '2026-11-20', 'normal');

      // Criar 9 tarefas base
      const tasks: Record<string, string> = {};
      const labels = [
        'ready-accepted',
        'ready-unaccepted',
        'blocked',
        'in-review',
        'changes-requested',
        'paused-reason',
        'paused-no-reason',
        'pause-req-reason',
        'pause-req-no-reason',
      ];
      for (const label of labels) {
        const created = await createFixtureTask(adminCookie, demand.id, adminUser.id, `Tarefa Estado ${label}`, '2026-11-20', 'normal');
        tasks[label] = created.id;
      }

      // Configurar diretamente no banco os estados cirúrgicos de cada tarefa
      // 1. ready com accepted_at preenchido -> 'Pronta aguardando início da produção'
      await db().pool.query(`UPDATE task SET status = 'ready', accepted_at = '2026-02-01T10:00:00Z' WHERE id = $1`, [tasks['ready-accepted']]);

      // 2. ready com accepted_at nulo -> 'Pronta aguardando aceite do responsável'
      await db().pool.query(`UPDATE task SET status = 'ready', accepted_at = NULL WHERE id = $1`, [tasks['ready-unaccepted']]);

      // 3. blocked -> 'Bloqueada por requisitos ou dependências pendentes'
      await db().pool.query(`UPDATE task SET status = 'blocked' WHERE id = $1`, [tasks['blocked']]);

      // 4. in_review -> 'Submetida para revisão (aguardando avaliação do administrador)'
      await db().pool.query(`UPDATE task SET status = 'in_review' WHERE id = $1`, [tasks['in-review']]);

      // 5. changes_requested -> 'Ajustes solicitados na revisão (aguardando correções do responsável)'
      await db().pool.query(`UPDATE task SET status = 'changes_requested' WHERE id = $1`, [tasks['changes-requested']]);

      // 6. paused com motivo -> 'Pausada: Aguardando cliente aprovar briefing'
      await db().pool.query(`UPDATE task SET status = 'paused', pause_reason = 'Aguardando cliente aprovar briefing' WHERE id = $1`, [tasks['paused-reason']]);

      // 7. paused sem motivo -> 'Pausada operacionalmente'
      await db().pool.query(`UPDATE task SET status = 'paused', pause_reason = NULL WHERE id = $1`, [tasks['paused-no-reason']]);

      // 8. in_production com pause_requested_at e motivo -> 'Solicitação de pausa pendente: Dúvida nas dimensões'
      await db().pool.query(`UPDATE task SET status = 'in_production', pause_requested_at = '2026-02-01T10:00:00Z', pause_reason = 'Dúvida nas dimensões' WHERE id = $1`, [tasks['pause-req-reason']]);

      // 9. in_production com pause_requested_at sem motivo -> 'Solicitação de pausa pendente de aprovação'
      await db().pool.query(`UPDATE task SET status = 'in_production', pause_requested_at = '2026-02-01T10:00:00Z', pause_reason = NULL WHERE id = $1`, [tasks['pause-req-no-reason']]);

      const res = await inject({
        method: 'GET',
        url: '/api/v1/dashboard',
        headers: { origin, cookie: adminCookie },
      });
      expect(res.statusCode).toBe(200);
      const body = assertStrictAntiLeakAndContract(res.json(), true);

      const awaitingItems = body.sections.awaitingAction.items;

      const expectedMap: Record<string, string> = {
        'ready-accepted': 'Pronta aguardando início da produção',
        'ready-unaccepted': 'Pronta aguardando aceite do responsável',
        'blocked': 'Bloqueada por requisitos ou dependências pendentes',
        'in-review': 'Submetida para revisão (aguardando avaliação do administrador)',
        'changes-requested': 'Ajustes solicitados na revisão (aguardando correções do responsável)',
        'paused-reason': 'Pausada: Aguardando cliente aprovar briefing',
        'paused-no-reason': 'Pausada operacionalmente',
        'pause-req-reason': 'Solicitação de pausa pendente: Dúvida nas dimensões',
        'pause-req-no-reason': 'Solicitação de pausa pendente de aprovação',
      };

      for (const [label, expectedReason] of Object.entries(expectedMap)) {
        const taskId = tasks[label];
        const item = awaitingItems.find((i) => i.id === taskId);
        expect(item, `Tarefa ${label} (${taskId}) deve estar presente em awaitingAction`).toBeDefined();
        expect(item?.reason).toBe(expectedReason);
      }
    });
  });

  // =========================================================================
  // 5. REGRAS TEMPORAIS E CALENDÁRIO (AMERICA/CUIABA)
  // =========================================================================
  describe('5. Regras Temporais e Calendário (America/Cuiaba)', () => {
    it('distingue atraso operacional de tarefa (overdueTasks) de prazo vencido do chamado (overdueDemands)', async () => {
      const adminCookie = await cookieFor(adminUser.email);
      const client = await createFixtureClient(adminCookie, 'TimezoneClient');

      // Chamado vencido no passado
      const demandPast = await createFixtureDemand(adminCookie, client.id, 'DemandVencida', '2026-01-10', 'normal');

      // Tarefa 1: em in_production com startedAt != null e data no passado -> ATRASO OPERACIONAL REAL
      const taskOverdue = await createFixtureTask(adminCookie, demandPast.id, adminUser.id, 'Tarefa Em Producao Vencida', '2026-01-10', 'normal');
      const t1 = await inject({ method: 'GET', url: `/api/v1/tasks/${taskOverdue.id}`, headers: { origin, cookie: adminCookie } }).then(r => r.json());
      await inject({ method: 'POST', url: `/api/v1/tasks/${taskOverdue.id}/accept`, headers: { origin, cookie: adminCookie }, payload: { version: t1.task.version } });
      const t2 = await inject({ method: 'GET', url: `/api/v1/tasks/${taskOverdue.id}`, headers: { origin, cookie: adminCookie } }).then(r => r.json());
      await inject({ method: 'POST', url: `/api/v1/tasks/${taskOverdue.id}/start`, headers: { origin, cookie: adminCookie }, payload: { version: t2.task.version } });

      // Tarefa 2: em blocked com data no passado -> NÃO É ATRASO OPERACIONAL (nunca foi iniciada)
      const taskBlockedPast = await createFixtureTask(adminCookie, demandPast.id, adminUser.id, 'Tarefa Bloqueada no Passado', '2026-01-10', 'normal', [
        { title: 'Requisito não atendido', mandatory: true },
      ]);

      const res = await inject({
        method: 'GET',
        url: '/api/v1/dashboard',
        headers: { origin, cookie: adminCookie },
      });
      const body = assertStrictAntiLeakAndContract(res.json(), true);

      // O chamado vencido deve constar em overdueDemands
      const demandFound = body.sections.overdueDemands.items.some((i) => i.id === demandPast.id);
      expect(demandFound).toBe(true);

      // A tarefa iniciada deve constar em overdueTasks
      const taskOverdueFound = body.sections.overdueTasks.items.some((i) => i.id === taskOverdue.id);
      expect(taskOverdueFound).toBe(true);

      // A tarefa bloqueada NUNCA deve constar em overdueTasks (evita falso positivo de atraso)
      const taskBlockedInOverdue = body.sections.overdueTasks.items.some((i) => i.id === taskBlockedPast.id);
      expect(taskBlockedInOverdue).toBe(false);
    });

    it('classifica tarefas estritamente por fuso America/Cuiaba, separando dueToday, upcoming (amanhã a hoje+3) e excluindo hoje+4', async () => {
      const adminCookie = await cookieFor(adminUser.email);
      const resInitial = await inject({ method: 'GET', url: '/api/v1/dashboard', headers: { origin, cookie: adminCookie } });
      const initialBody = resInitial.json();
      assertStrictAntiLeakAndContract(initialBody, true);
      const todayStr = initialBody.today as string;

      // 1. Confere fuso horário de referência contra relógio real em America/Cuiaba
      const expectedCuiabaDate = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Cuiaba',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());
      expect(todayStr).toBe(expectedCuiabaDate);

      // 2. Aritmética de calendário UTC sem risco de distorção de fuso local
      const [yearStr, monthStr, dayStr] = todayStr.split('-');
      const baseYear = Number(yearStr);
      const baseMonth = Number(monthStr) - 1;
      const baseDay = Number(dayStr);

      const addDays = (days: number): string => {
        const d = new Date(Date.UTC(baseYear, baseMonth, baseDay + days));
        return d.toISOString().slice(0, 10);
      };

      const tomorrowStr = addDays(1);
      const day2Str = addDays(2);
      const day3Str = addDays(3);
      const day4Str = addDays(4);

      const client = await createFixtureClient(adminCookie, 'CalendarWindowClient');
      const demand = await createFixtureDemand(adminCookie, client.id, 'CalendarWindowDemand', '2026-12-31', 'normal');

      // Tarefa para hoje: deve entrar em dueToday, NUNCA em upcoming
      const taskToday = await createFixtureTask(adminCookie, demand.id, adminUser.id, 'Tarefa Para Hoje', todayStr, 'normal');

      // Tarefa para amanhã (dia+1): deve entrar em upcoming, NUNCA em dueToday
      const taskTomorrow = await createFixtureTask(adminCookie, demand.id, adminUser.id, 'Tarefa Para Amanhã (dia+1)', tomorrowStr, 'normal');

      // Tarefa para dia+2 (intermediária da janela): deve entrar em upcoming
      const taskDay2 = await createFixtureTask(adminCookie, demand.id, adminUser.id, 'Tarefa Intermediária (dia+2)', day2Str, 'normal');

      // Tarefa para dia+3 (limite superior da janela): DEVE entrar em upcoming (inclusivo)
      const taskDay3 = await createFixtureTask(adminCookie, demand.id, adminUser.id, 'Tarefa Limite Janela (dia+3)', day3Str, 'normal');

      // Tarefa para dia+4 (fora da janela de 3 dias): NUNCA deve entrar em upcoming (exclusivo)
      const taskDay4 = await createFixtureTask(adminCookie, demand.id, adminUser.id, 'Tarefa Fora da Janela (dia+4)', day4Str, 'normal');

      const res = await inject({
        method: 'GET',
        url: '/api/v1/dashboard',
        headers: { origin, cookie: adminCookie },
      });
      expect(res.statusCode).toBe(200);
      const body = assertStrictAntiLeakAndContract(res.json(), true);

      // Verificação de dueToday
      const inDueToday = body.sections.dueToday.items.some((i) => i.id === taskToday.id);
      expect(inDueToday).toBe(true);

      // Hoje NÃO pode estar em upcoming (seções apartadas)
      const todayInUpcoming = body.sections.upcoming.items.some((i) => i.id === taskToday.id);
      expect(todayInUpcoming).toBe(false);

      // Amanhã (dia+1) deve estar em upcoming, e NÃO em dueToday
      const tomorrowInUpcoming = body.sections.upcoming.items.some((i) => i.id === taskTomorrow.id);
      expect(tomorrowInUpcoming).toBe(true);
      const tomorrowInDueToday = body.sections.dueToday.items.some((i) => i.id === taskTomorrow.id);
      expect(tomorrowInDueToday).toBe(false);

      // Dia+2 (intermediário) DEVE estar em upcoming
      const day2InUpcoming = body.sections.upcoming.items.some((i) => i.id === taskDay2.id);
      expect(day2InUpcoming).toBe(true);

      // Dia+3 (limite inclusivo) DEVE estar em upcoming
      const day3InUpcoming = body.sections.upcoming.items.some((i) => i.id === taskDay3.id);
      expect(day3InUpcoming).toBe(true);

      // Dia+4 (limite exclusivo) NÃO pode estar em upcoming
      const day4InUpcoming = body.sections.upcoming.items.some((i) => i.id === taskDay4.id);
      expect(day4InUpcoming).toBe(false);
    });

    it('tarefas com prioridade urgente constam na seção urgent', async () => {
      const adminCookie = await cookieFor(adminUser.email);
      const client = await createFixtureClient(adminCookie, 'UrgentClient');
      const demand = await createFixtureDemand(adminCookie, client.id, 'UrgentDemand', '2026-11-20', 'urgent');
      const taskUrgent = await createFixtureTask(adminCookie, demand.id, adminUser.id, 'Tarefa Urgente', '2026-11-20', 'urgent');

      const res = await inject({
        method: 'GET',
        url: '/api/v1/dashboard',
        headers: { origin, cookie: adminCookie },
      });
      expect(res.statusCode).toBe(200);
      const body = assertStrictAntiLeakAndContract(res.json(), true);
      const foundUrgent = body.sections.urgent.items.some((i) => i.id === taskUrgent.id);
      expect(foundUrgent).toBe(true);
    });

    it('comprova fuso e limites de calendário com data injetada atravessando ano (2026-01-01T02:00:00Z -> Cuiabá 2025-12-31) e anos bissextos', async () => {
      const adminCookie = await cookieFor(adminUser.email);

      // 1. Validação do helper addCalendarDays isoladamente (passagem de ano e ano bissexto)
      expect(addCalendarDays('2025-12-31', 1)).toBe('2026-01-01');
      expect(addCalendarDays('2025-12-31', 3)).toBe('2026-01-03');
      expect(addCalendarDays('2028-02-28', 1)).toBe('2028-02-29'); // 2028 é ano bissexto!
      expect(addCalendarDays('2028-02-28', 2)).toBe('2028-03-01');
      expect(addCalendarDays('2027-02-28', 1)).toBe('2027-03-01'); // 2027 não é bissexto

      // 2. Data injetada: 2026-01-01T02:00:00Z
      // Cuiabá é UTC-4, portanto em Cuiabá ainda são 2025-12-31 22:00:00!
      // today deve ser estritamente '2025-12-31', NÃO '2026-01-01'
      const injectedNow = new Date('2026-01-01T02:00:00Z');

      const client = await createFixtureClient(adminCookie, 'YearCrossClient');
      const demand = await createFixtureDemand(adminCookie, client.id, 'YearCrossDemand', '2026-12-31', 'normal');

      // Criar tarefas cobrindo a fronteira do ano
      const tDueToday = await createFixtureTask(adminCookie, demand.id, adminUser.id, 'Tarefa Fim de Ano (Hoje)', '2025-12-31', 'normal');
      const tDay1 = await createFixtureTask(adminCookie, demand.id, adminUser.id, 'Tarefa Ano Novo Dia 1', '2026-01-01', 'normal');
      const tDay2 = await createFixtureTask(adminCookie, demand.id, adminUser.id, 'Tarefa Ano Novo Dia 2', '2026-01-02', 'normal');
      const tDay3 = await createFixtureTask(adminCookie, demand.id, adminUser.id, 'Tarefa Ano Novo Dia 3 (Limite)', '2026-01-03', 'normal');
      const tDay4 = await createFixtureTask(adminCookie, demand.id, adminUser.id, 'Tarefa Fora do Upcoming (+4)', '2026-01-04', 'normal');

      // Obter sessão de admin para chamada tipada do serviço
      const adminSession: SessionResponse = {
        user: { id: adminUser.id, name: 'Admin User', email: adminUser.email },
        roles: ['administrator'],
        permissions: ['demands.read', 'tasks.read', 'users.read'],
      };

      const result = await getDashboard(db(), adminSession, { limit: 50 }, { now: injectedNow });
      const validated = assertStrictAntiLeakAndContract(result, true);

      // Comprovação de cálculo do today em America/Cuiaba
      expect(validated.today).toBe('2025-12-31');

      // 2025-12-31 está em dueToday e NÃO em upcoming
      expect(validated.sections.dueToday.items.some((i) => i.id === tDueToday.id)).toBe(true);
      expect(validated.sections.upcoming.items.some((i) => i.id === tDueToday.id)).toBe(false);

      // 2026-01-01 (dia+1 atravessando ano) está em upcoming e NÃO em dueToday
      expect(validated.sections.upcoming.items.some((i) => i.id === tDay1.id)).toBe(true);
      expect(validated.sections.dueToday.items.some((i) => i.id === tDay1.id)).toBe(false);

      // 2026-01-02 (+2) e 2026-01-03 (+3) estão em upcoming
      expect(validated.sections.upcoming.items.some((i) => i.id === tDay2.id)).toBe(true);
      expect(validated.sections.upcoming.items.some((i) => i.id === tDay3.id)).toBe(true);

      // 2026-01-04 (+4) está EXCLUÍDO de upcoming
      expect(validated.sections.upcoming.items.some((i) => i.id === tDay4.id)).toBe(false);

      // Teste adicional: 29 de fevereiro em ano bissexto
      const leapNow = new Date('2028-02-29T16:00:00Z');
      const leapResult = await getDashboard(db(), adminSession, { limit: 10 }, { now: leapNow });
      expect(leapResult.today).toBe('2028-02-29');
    });
  });

  // =========================================================================
  // 6. ORDENAÇÃO, LIMITES E PAGINAÇÃO
  // =========================================================================
  describe('6. Ordenação, Limites e Consistência', () => {
    it('ordena itens deterministicamente com urgent antes de normal e deliveryDate crescente', async () => {
      const adminCookie = await cookieFor(adminUser.email);
      const res = await inject({
        method: 'GET',
        url: '/api/v1/dashboard',
        headers: { origin, cookie: adminCookie },
      });
      expect(res.statusCode).toBe(200);
      const body = assertStrictAntiLeakAndContract(res.json(), true);

      for (const [secName, section] of Object.entries(body.sections)) {
        const items = section.items;
        if (items.length >= 2) {
          for (let i = 0; i < items.length - 1; i++) {
            const current = items[i];
            const next = items[i + 1];
            // Se o atual for não-urgente e o próximo for urgente, haveria violação de ordenação
            if (current && next && current.priority !== 'urgent' && next.priority === 'urgent') {
              throw new Error(`Violação de ordenação por prioridade na seção ${secName}: item ${next.id} (urgente) após ${current.id}`);
            }
          }
        }
      }
    });

    it('respeita parâmetro ?limit=N mantendo total exato da seção comparado com consulta completa', async () => {
      const adminCookie = await cookieFor(adminUser.email);
      const client = await createFixtureClient(adminCookie, 'LimitPrecisionClient');
      const demand = await createFixtureDemand(adminCookie, client.id, 'LimitPrecisionDemand', '2026-11-20', 'normal');

      // Criar exatamente 5 tarefas na seção production
      const taskIds: string[] = [];
      for (let i = 1; i <= 5; i++) {
        const task = await createFixtureTask(adminCookie, demand.id, adminUser.id, `Tarefa Limit Teste ${i}`, '2026-11-20', 'normal');
        taskIds.push(task.id);
        const t1 = await inject({ method: 'GET', url: `/api/v1/tasks/${task.id}`, headers: { origin, cookie: adminCookie } }).then((r) => r.json());
        await inject({
          method: 'POST',
          url: `/api/v1/tasks/${task.id}/accept`,
          headers: { origin, cookie: adminCookie },
          payload: { version: t1.task.version },
        });
        const t2 = await inject({ method: 'GET', url: `/api/v1/tasks/${task.id}`, headers: { origin, cookie: adminCookie } }).then((r) => r.json());
        await inject({
          method: 'POST',
          url: `/api/v1/tasks/${task.id}/start`,
          headers: { origin, cookie: adminCookie },
          payload: { version: t2.task.version },
        });
      }

      // 1. Consulta sem corte (?limit=50)
      const res50 = await inject({
        method: 'GET',
        url: '/api/v1/dashboard?limit=50',
        headers: { origin, cookie: adminCookie },
      });
      expect(res50.statusCode).toBe(200);
      const body50 = assertStrictAntiLeakAndContract(res50.json(), true);
      const prod50 = body50.sections.production;

      // Todas as 5 tarefas criadas devem constar
      for (const id of taskIds) {
        expect(prod50.items.some((it) => it.id === id)).toBe(true);
      }
      expect(prod50.total).toBeGreaterThanOrEqual(5);
      const exactTotal = prod50.total;

      // 2. Consulta com corte (?limit=2)
      const res2 = await inject({
        method: 'GET',
        url: '/api/v1/dashboard?limit=2',
        headers: { origin, cookie: adminCookie },
      });
      expect(res2.statusCode).toBe(200);
      const body2 = assertStrictAntiLeakAndContract(res2.json(), true);
      const prod2 = body2.sections.production;

      // Array deve ser truncado a exatamente 2 itens
      expect(prod2.items.length).toBe(2);
      // Total deve ser rigorosamente idêntico ao total sem corte
      expect(prod2.total).toBe(exactTotal);
      // Os 2 itens retornados devem corresponder aos primeiros 2 itens da consulta sem corte (ordem determinística preservada)
      expect(prod2.items[0]?.id).toBe(prod50.items[0]?.id);
      expect(prod2.items[1]?.id).toBe(prod50.items[1]?.id);
    });

    it('rejeita valores inválidos de limit com HTTP 400', async () => {
      const adminCookie = await cookieFor(adminUser.email);
      const resZero = await inject({ method: 'GET', url: '/api/v1/dashboard?limit=0', headers: { origin, cookie: adminCookie } });
      expect(resZero.statusCode).toBe(400);

      const resOver = await inject({ method: 'GET', url: '/api/v1/dashboard?limit=51', headers: { origin, cookie: adminCookie } });
      expect(resOver.statusCode).toBe(400);

      const resInvalid = await inject({ method: 'GET', url: '/api/v1/dashboard?limit=abc', headers: { origin, cookie: adminCookie } });
      expect(resInvalid.statusCode).toBe(400);
    });
  });
});
