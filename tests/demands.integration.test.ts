import { randomBytes, randomUUID } from 'node:crypto';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Role } from '@orium/contracts';
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

interface TestDemand {
  id: string;
  clientId: string;
  createdByUserId: string;
  title: string;
  description: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  deliveryDate: string;
  status: 'open' | 'completed';
  version: number;
  client?: { id: string; name: string };
}

interface TestTask {
  id: string;
  demandId: string;
  assignedToUserId: string;
  title: string;
  description: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  deliveryDate: string;
  status: 'blocked' | 'ready' | 'in_production' | 'in_review' | 'changes_requested' | 'paused' | 'completed';
  acceptedAt: string | null;
  readyAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  pauseRequestedAt: string | null;
  pauseReason: string | null;
  deliveryNotes: string | null;
  previewUrl: string | null;
  version: number;
}

describe('demands and tasks domain against real PostgreSQL (Fase 3)', () => {
  let app: FastifyInstance | undefined;
  let database: Database | undefined;
  let migrationUrl: string;
  let admin: { id: string; email: string };
  let colabA: { id: string; email: string };
  let colabB: { id: string; email: string };
  const userPrefix = `demand-test-user-${randomUUID().slice(0, 8)}-`;
  const clientPrefix = `demand-test-client-${randomUUID().slice(0, 8)}-`;
  const demandPrefix = `demand-test-d-${randomUUID().slice(0, 8)}-`;
  const password = randomBytes(24).toString('hex');
  const origin = 'http://127.0.0.1:5173';
  let requestIndex = 0;

  const createdDemandIds: string[] = [];
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

  const fixtureUser = async (role: Role, label: string) => {
    const email = `${userPrefix}${label}-${randomUUID().slice(0, 6)}@example.test`;
    const created = await provisionUser(db(), { name: `User ${label}`, email, password, role });
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
        contactName: 'Contato Operacional',
        email: `client-${randomUUID().slice(0, 8)}@fixture.test`,
        phone: '11999998888',
        notes: 'Informação confidencial interna do cliente',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    const client = (body.client ?? body) as { id: string; name: string };
    createdClientIds.push(client.id);
    return client;
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
    admin = await fixtureUser('administrator', 'admin');
    colabA = await fixtureUser('collaborator', 'colabA');
    colabB = await fixtureUser('collaborator', 'colabB');
  }, 60000);

  afterAll(async () => {
    try {
      await app?.close();
    } finally {
      if (database) {
        try {
          if (createdDemandIds.length > 0) {
            await database.pool.query('DELETE FROM task_dependency WHERE task_id IN (SELECT id FROM task WHERE demand_id = ANY($1))', [createdDemandIds]);
            await database.pool.query('DELETE FROM task_requirement WHERE task_id IN (SELECT id FROM task WHERE demand_id = ANY($1))', [createdDemandIds]);
            await database.pool.query('DELETE FROM task_comment WHERE task_id IN (SELECT id FROM task WHERE demand_id = ANY($1))', [createdDemandIds]);
            await database.pool.query('DELETE FROM demand_event WHERE demand_id = ANY($1)', [createdDemandIds]);
            await database.pool.query('DELETE FROM task WHERE demand_id = ANY($1)', [createdDemandIds]);
            await database.pool.query('DELETE FROM demand WHERE id = ANY($1)', [createdDemandIds]);
          }
          if (createdClientIds.length > 0) {
            await database.pool.query('DELETE FROM client WHERE id = ANY($1)', [createdClientIds]);
          }
          // Audit subjects intentionally survive account removal. Remove only the exact
          // users provisioned by this run before deleting them, using the TEST migrator.
          const cleanupDatabase = connectDatabase(migrationUrl);
          const cleanupClient = await cleanupDatabase.pool.connect();
          try {
            await cleanupClient.query('BEGIN');
            await cleanupClient.query('SELECT pg_advisory_xact_lock(712041)');
            const users = (await cleanupClient.query<{ id: string }>('SELECT id FROM auth_user WHERE left(email,length($1))=$1', [userPrefix])).rows.map(row => row.id);
            await cleanupClient.query('DELETE FROM identity_event WHERE actor_id=ANY($1::text[]) OR target_user_id=ANY($1::text[])', [users]);
            await cleanupClient.query('DELETE FROM identity_event_subject WHERE user_id=ANY($1::text[])', [users]);
            await cleanupClient.query('DELETE FROM auth_user WHERE id=ANY($1::text[])', [users]);
            await cleanupClient.query('COMMIT');
          } catch (error) {
            await cleanupClient.query('ROLLBACK');
            throw error;
          } finally {
            cleanupClient.release();
            await cleanupDatabase.pool.end();
          }
        } finally {
          await database.pool.end();
        }
      }
    }
  });

  describe('1. Autenticação, RBAC e Deny-by-default estrito', () => {
    it('rejeita requisições não autenticadas em demandas e tarefas com 401', async () => {
      const fakeId = randomUUID();
      for (const op of [
        { method: 'GET', url: '/api/v1/demands' },
        { method: 'GET', url: `/api/v1/demands/${fakeId}` },
        { method: 'POST', url: '/api/v1/demands', payload: { title: 'No Auth' }, headers: { origin } },
        { method: 'GET', url: `/api/v1/tasks/${fakeId}` },
        { method: 'POST', url: `/api/v1/tasks/${fakeId}/accept`, payload: { version: 1 }, headers: { origin } },
      ] as const) {
        const res = await inject({ ...op });
        expect(res.statusCode).toBe(401);
      }
    });

    it('mantém GET /api/v1/clients estritamente 403 para colaboradores (não retorna 200 [])', async () => {
      const cookie = await cookieFor(colabA.email);
      const res = await inject({
        method: 'GET',
        url: '/api/v1/clients',
        headers: { origin, cookie },
      });
      expect(res.statusCode).toBe(403);
    });

    it('retorna lista vazia 200 em /demands para colaborador sem atribuições ativas', async () => {
      const cookie = await cookieFor(colabA.email);
      const res = await inject({
        method: 'GET',
        url: '/api/v1/demands',
        headers: { origin, cookie },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.demands).toBeDefined();
      expect(Array.isArray(body.demands)).toBe(true);
      expect(body.demands.length).toBe(0);
    });

    it('bloqueia mutações administrativas de demandas e tarefas por colaborador com 403', async () => {
      const cookie = await cookieFor(colabA.email);
      const fakeId = randomUUID();

      const resCreateDemand = await inject({
        method: 'POST',
        url: '/api/v1/demands',
        headers: { origin, cookie },
        payload: { clientId: fakeId, title: 'Hacked Demand', deliveryDate: '2026-10-30' },
      });
      expect(resCreateDemand.statusCode).toBe(403);

      const resCreateTask = await inject({
        method: 'POST',
        url: '/api/v1/tasks',
        headers: { origin, cookie },
        payload: { demandId: fakeId, assignedToUserId: colabA.id, title: 'Hacked Task' },
      });
      expect(resCreateTask.statusCode).toBe(403);

      const resCompleteDemand = await inject({
        method: 'POST',
        url: `/api/v1/demands/${fakeId}/complete`,
        headers: { origin, cookie },
        payload: { version: 1 },
      });
      expect(resCompleteDemand.statusCode).toBe(403);
    });
  });

  describe('2. Visibilidade Vinculada por Atribuição, Projeção Limitada e Prevenção de IDOR', () => {
    let adminCookie: string;
    let colabACookie: string;
    let clientA: { id: string; name: string };
    let clientB: { id: string; name: string };
    let demandA: TestDemand;
    let demandB: TestDemand;
    let taskB: TestTask;

    beforeAll(async () => {
      adminCookie = await cookieFor(admin.email);
      colabACookie = await cookieFor(colabA.email);

      clientA = await createFixtureClient(adminCookie, 'Cliente-A');
      clientB = await createFixtureClient(adminCookie, 'Cliente-B');

      // Admin cria Demanda A para Cliente A
      const resDA = await inject({
        method: 'POST',
        url: '/api/v1/demands',
        headers: { origin, cookie: adminCookie },
        payload: {
          clientId: clientA.id,
          title: `${demandPrefix}Landing Page Cliente A`,
          description: 'Desenvolvimento de LP para Cliente A',
          priority: 'high',
          deliveryDate: '2026-10-20',
        },
      });
      expect(resDA.statusCode).toBe(201);
      demandA = resDA.json().demand;
      createdDemandIds.push(demandA.id);

      // Admin cria Tarefa A atribuída a Colab A
      const resTA = await inject({
        method: 'POST',
        url: '/api/v1/tasks',
        headers: { origin, cookie: adminCookie },
        payload: {
          demandId: demandA.id,
          assignedToUserId: colabA.id,
          title: 'Criar Identidade Visual A',
          description: 'Definir paleta e tipografia',
          priority: 'high',
        },
      });
      expect(resTA.statusCode).toBe(201);
      expect(resTA.json().task).toBeDefined();

      // Admin cria Demanda B para Cliente B
      const resDB = await inject({
        method: 'POST',
        url: '/api/v1/demands',
        headers: { origin, cookie: adminCookie },
        payload: {
          clientId: clientB.id,
          title: `${demandPrefix}Site Institucional Cliente B`,
          description: 'Criação de site B',
          priority: 'normal',
          deliveryDate: '2026-10-25',
        },
      });
      expect(resDB.statusCode).toBe(201);
      demandB = resDB.json().demand;
      createdDemandIds.push(demandB.id);

      // Admin cria Tarefa B atribuída a Colab B
      const resTB = await inject({
        method: 'POST',
        url: '/api/v1/tasks',
        headers: { origin, cookie: adminCookie },
        payload: {
          demandId: demandB.id,
          assignedToUserId: colabB.id,
          title: 'Criar Criativos B',
          description: 'Banners B',
          priority: 'normal',
        },
      });
      expect(resTB.statusCode).toBe(201);
      taskB = resTB.json().task;
    });

    it('colaborador enxerga apenas a demanda atribuída com projeção limitada de cliente (sem notas confidenciais)', async () => {
      const res = await inject({
        method: 'GET',
        url: '/api/v1/demands',
        headers: { origin, cookie: colabACookie },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.demands.length).toBe(1);
      expect(body.demands[0].id).toBe(demandA.id);
      expect(body.demands[0].title).toBe(demandA.title);

      // Projeção limitada de cliente
      expect(body.demands[0].client).toBeDefined();
      expect(body.demands[0].client.id).toBe(clientA.id);
      expect(body.demands[0].client.name).toBe(clientA.name);
      // Dados estritamente omitidos
      expect(body.demands[0].client.notes).toBeUndefined();
      expect(body.demands[0].client.phone).toBeUndefined();
      expect(body.demands[0].client.email).toBeUndefined();
    });

    it('impede IDOR de leitura horizontal: Colab A não acessa Demanda B (404/403)', async () => {
      const res = await inject({
        method: 'GET',
        url: `/api/v1/demands/${demandB.id}`,
        headers: { origin, cookie: colabACookie },
      });
      expect([403, 404]).toContain(res.statusCode);
    });

    it('impede IDOR de leitura horizontal: Colab A não acessa Tarefa B (404/403)', async () => {
      const res = await inject({
        method: 'GET',
        url: `/api/v1/tasks/${taskB.id}`,
        headers: { origin, cookie: colabACookie },
      });
      expect([403, 404]).toContain(res.statusCode);
    });

    it('impede IDOR de mutação horizontal: Colab A não pode aceitar ou interagir com Tarefa B', async () => {
      const res = await inject({
        method: 'POST',
        url: `/api/v1/tasks/${taskB.id}/accept`,
        headers: { origin, cookie: colabACookie },
        payload: { version: taskB.version },
      });
      expect([403, 404]).toContain(res.statusCode);
    });

    it('impede IDOR em comentários: Colab A não pode comentar nem ler comentários de Tarefa B', async () => {
      const resPost = await inject({
        method: 'POST',
        url: `/api/v1/tasks/${taskB.id}/comments`,
        headers: { origin, cookie: colabACookie },
        payload: { content: 'Tentativa de espionagem' },
      });
      expect([403, 404]).toContain(resPost.statusCode);

      const resGet = await inject({
        method: 'GET',
        url: `/api/v1/tasks/${taskB.id}/comments`,
        headers: { origin, cookie: colabACookie },
      });
      expect([403, 404]).toContain(resGet.statusCode);
    });

    it('impede IDOR no histórico da demanda: Colab A não acessa histórico de Demanda B', async () => {
      const res = await inject({
        method: 'GET',
        url: `/api/v1/demands/${demandB.id}/history`,
        headers: { origin, cookie: colabACookie },
      });
      expect([403, 404]).toContain(res.statusCode);
    });
  });

  describe('3. Privacidade em Demanda Compartilhada entre dois Colaboradores', () => {
    let adminCookie: string;
    let colabACookie: string;
    let sharedDemand: TestDemand;
    let taskForColabA: TestTask;
    let taskForColabB: TestTask;

    beforeAll(async () => {
      adminCookie = await cookieFor(admin.email);
      colabACookie = await cookieFor(colabA.email);

      const client = await createFixtureClient(adminCookie, 'Cliente-Compartilhado');

      const resD = await inject({
        method: 'POST',
        url: '/api/v1/demands',
        headers: { origin, cookie: adminCookie },
        payload: {
          clientId: client.id,
          title: `${demandPrefix}Demanda Compartilhada A e B`,
          deliveryDate: '2026-10-28',
        },
      });
      sharedDemand = resD.json().demand;
      createdDemandIds.push(sharedDemand.id);

      const resTA = await inject({
        method: 'POST',
        url: '/api/v1/tasks',
        headers: { origin, cookie: adminCookie },
        payload: {
          demandId: sharedDemand.id,
          assignedToUserId: colabA.id,
          title: 'Design de Telas',
        },
      });
      taskForColabA = resTA.json().task;

      const resTB = await inject({
        method: 'POST',
        url: '/api/v1/tasks',
        headers: { origin, cookie: adminCookie },
        payload: {
          demandId: sharedDemand.id,
          assignedToUserId: colabB.id,
          title: 'Implementação Backend',
        },
      });
      taskForColabB = resTB.json().task;
    });

    it('colaborador A visualiza a demanda compartilhada contendo APENAS a sua própria tarefa', async () => {
      const res = await inject({
        method: 'GET',
        url: `/api/v1/demands/${sharedDemand.id}`,
        headers: { origin, cookie: colabACookie },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.demand.id).toBe(sharedDemand.id);
      expect(body.tasks).toBeDefined();
      expect(body.tasks.length).toBe(1);
      expect(body.tasks[0].id).toBe(taskForColabA.id);
    });

    it('colaborador A não consegue ler os detalhes da tarefa de colaborador B na mesma demanda', async () => {
      const res = await inject({
        method: 'GET',
        url: `/api/v1/tasks/${taskForColabB.id}`,
        headers: { origin, cookie: colabACookie },
      });
      expect([403, 404]).toContain(res.statusCode);
    });
  });

  describe('4. Ciclo de Vida da Tarefa: Aceite Obrigatório vs Início Explícito (ADR-0005)', () => {
    let adminCookie: string;
    let colabACookie: string;
    let demand: TestDemand;
    let task: TestTask;

    beforeAll(async () => {
      adminCookie = await cookieFor(admin.email);
      colabACookie = await cookieFor(colabA.email);

      const client = await createFixtureClient(adminCookie, 'Cliente-Lifecycle');

      const resD = await inject({
        method: 'POST',
        url: '/api/v1/demands',
        headers: { origin, cookie: adminCookie },
        payload: {
          clientId: client.id,
          title: `${demandPrefix}Lifecycle Test`,
          deliveryDate: '2026-10-31',
        },
      });
      demand = resD.json().demand;
      createdDemandIds.push(demand.id);

      // Cria tarefa com requisito obrigatório pendente
      const resT = await inject({
        method: 'POST',
        url: '/api/v1/tasks',
        headers: { origin, cookie: adminCookie },
        payload: {
          demandId: demand.id,
          assignedToUserId: colabA.id,
          title: 'Criar Landing Page com Requisitos',
          requirements: [
            { title: 'Material Gráfico Logo', mandatory: true },
          ],
        },
      });
      task = resT.json().task;
    });

    it('inicia no estado blocked quando há requisitos obrigatórios não satisfeitos', async () => {
      const res = await inject({
        method: 'GET',
        url: `/api/v1/tasks/${task.id}`,
        headers: { origin, cookie: colabACookie },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.task.status).toBe('blocked');
      expect(body.task.acceptedAt).toBeNull();
      expect(body.task.readyAt).toBeNull();
      expect(body.task.startedAt).toBeNull();
    });

    it('aceite da tarefa grava acceptedAt sem alterar o status e sem iniciar o relógio (startedAt null)', async () => {
      const res = await inject({
        method: 'POST',
        url: `/api/v1/tasks/${task.id}/accept`,
        headers: { origin, cookie: colabACookie },
        payload: { version: task.version },
      });
      expect(res.statusCode).toBe(200);
      const updated = res.json().task;
      expect(updated.acceptedAt).not.toBeNull();
      expect(updated.status).toBe('blocked');
      expect(updated.startedAt).toBeNull();
      task = updated;
    });

    it('impede início explícito (/start) enquanto o status for blocked por requisitos pendentes', async () => {
      const res = await inject({
        method: 'POST',
        url: `/api/v1/tasks/${task.id}/start`,
        headers: { origin, cookie: colabACookie },
        payload: { version: task.version },
      });
      expect([400, 409, 422]).toContain(res.statusCode);
    });

    it('ao satisfazer todos os requisitos obrigatórios, transiciona para ready (grava readyAt) mantendo startedAt null', async () => {
      // Obter id do requirement
      const resDetail = await inject({
        method: 'GET',
        url: `/api/v1/tasks/${task.id}`,
        headers: { origin, cookie: colabACookie },
      });
      const reqId = resDetail.json().requirements[0].id;

      // Admin satisfaz o requisito
      const resReq = await inject({
        method: 'PATCH',
        url: `/api/v1/tasks/${task.id}/requirements/${reqId}`,
        headers: { origin, cookie: adminCookie },
        payload: { version: task.version, satisfied: true },
      });
      expect(resReq.statusCode).toBe(200);

      const resCheck = await inject({
        method: 'GET',
        url: `/api/v1/tasks/${task.id}`,
        headers: { origin, cookie: colabACookie },
      });
      const current = resCheck.json().task;
      expect(current.status).toBe('ready');
      expect(current.readyAt).not.toBeNull();
      expect(current.startedAt).toBeNull();
      task = current;
    });

    it('ação explícita de start inicia o relógio operacional e transiciona para in_production', async () => {
      const res = await inject({
        method: 'POST',
        url: `/api/v1/tasks/${task.id}/start`,
        headers: { origin, cookie: colabACookie },
        payload: { version: task.version },
      });
      expect(res.statusCode).toBe(200);
      const current = res.json().task;
      expect(current.status).toBe('in_production');
      expect(current.startedAt).not.toBeNull();
      task = current;
    });
  });

  describe('5. Grafo de Dependências e Liberação após Conclusão da Revisão Administrativa', () => {
    let adminCookie: string;
    let colabACookie: string;
    let demand: TestDemand;
    let taskArt: TestTask;
    let taskDev: TestTask;

    beforeAll(async () => {
      adminCookie = await cookieFor(admin.email);
      colabACookie = await cookieFor(colabA.email);

      const client = await createFixtureClient(adminCookie, 'Cliente-DAG');

      const resD = await inject({
        method: 'POST',
        url: '/api/v1/demands',
        headers: { origin, cookie: adminCookie },
        payload: { clientId: client.id, title: `${demandPrefix}DAG Test`, deliveryDate: '2026-11-05' },
      });
      demand = resD.json().demand;
      createdDemandIds.push(demand.id);

      // Tarefa 1: Identidade Visual
      const resT1 = await inject({
        method: 'POST',
        url: '/api/v1/tasks',
        headers: { origin, cookie: adminCookie },
        payload: { demandId: demand.id, assignedToUserId: colabA.id, title: 'Arte e Identidade' },
      });
      taskArt = resT1.json().task;

      // Tarefa 2: Desenvolvimento dependente de Tarefa 1
      const resT2 = await inject({
        method: 'POST',
        url: '/api/v1/tasks',
        headers: { origin, cookie: adminCookie },
        payload: {
          demandId: demand.id,
          assignedToUserId: colabA.id,
          title: 'Desenvolvimento Web',
          dependsOnTaskIds: [taskArt.id],
        },
      });
      taskDev = resT2.json().task;
    });

    it('tarefa dependente nasce bloqueada até a conclusão do pré-requisito', async () => {
      const res = await inject({
        method: 'GET',
        url: `/api/v1/tasks/${taskDev.id}`,
        headers: { origin, cookie: colabACookie },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().task.status).toBe('blocked');
    });

    it('submissão para revisão não libera a tarefa dependente (continua bloqueada)', async () => {
      // Aceita e inicia Tarefa 1
      await inject({
        method: 'POST',
        url: `/api/v1/tasks/${taskArt.id}/accept`,
        headers: { origin, cookie: colabACookie },
        payload: { version: taskArt.version },
      });
      const resStart = await inject({
        method: 'POST',
        url: `/api/v1/tasks/${taskArt.id}/start`,
        headers: { origin, cookie: colabACookie },
        payload: { version: taskArt.version + 1 },
      });
      taskArt = resStart.json().task;

      // Submete Tarefa 1 para revisão
      const resSubmit = await inject({
        method: 'POST',
        url: `/api/v1/tasks/${taskArt.id}/submit-review`,
        headers: { origin, cookie: colabACookie },
        payload: { version: taskArt.version, deliveryNotes: 'Arte finalizada para revisão' },
      });
      expect(resSubmit.statusCode).toBe(200);
      taskArt = resSubmit.json().task;
      expect(taskArt.status).toBe('in_review');

      // Tarefa 2 DEVE permanecer bloqueada
      const resDev = await inject({
        method: 'GET',
        url: `/api/v1/tasks/${taskDev.id}`,
        headers: { origin, cookie: colabACookie },
      });
      expect(resDev.json().task.status).toBe('blocked');
    });

    it('solicitação de ajustes pelo administrador mantém a dependente bloqueada', async () => {
      const resReview = await inject({
        method: 'POST',
        url: `/api/v1/tasks/${taskArt.id}/review`,
        headers: { origin, cookie: adminCookie },
        payload: { version: taskArt.version, decision: 'changes_requested', feedback: 'Ajustar contraste do logo' },
      });
      expect(resReview.statusCode).toBe(200);
      taskArt = resReview.json().task;
      expect(taskArt.status).toBe('changes_requested');

      // Tarefa 2 continua bloqueada
      const resDev = await inject({
        method: 'GET',
        url: `/api/v1/tasks/${taskDev.id}`,
        headers: { origin, cookie: colabACookie },
      });
      expect(resDev.json().task.status).toBe('blocked');
    });

    it('aprovação e conclusão pelo administrador libera a tarefa dependente (status ready)', async () => {
      // Re-inicia, ressubmete e aprova
      await inject({
        method: 'POST',
        url: `/api/v1/tasks/${taskArt.id}/start`,
        headers: { origin, cookie: colabACookie },
        payload: { version: taskArt.version },
      });
      const resSub = await inject({
        method: 'POST',
        url: `/api/v1/tasks/${taskArt.id}/submit-review`,
        headers: { origin, cookie: colabACookie },
        payload: { version: taskArt.version + 1, deliveryNotes: 'Ajustes feitos' },
      });
      taskArt = resSub.json().task;

      const resApprove = await inject({
        method: 'POST',
        url: `/api/v1/tasks/${taskArt.id}/review`,
        headers: { origin, cookie: adminCookie },
        payload: { version: taskArt.version, decision: 'complete', feedback: 'Aprovado!' },
      });
      expect(resApprove.statusCode).toBe(200);
      taskArt = resApprove.json().task;
      expect(taskArt.status).toBe('completed');

      // Tarefa dependente agora é automaticamente liberada para ready!
      const resDev = await inject({
        method: 'GET',
        url: `/api/v1/tasks/${taskDev.id}`,
        headers: { origin, cookie: colabACookie },
      });
      expect(resDev.json().task.status).toBe('ready');
      expect(resDev.json().task.readyAt).not.toBeNull();
    });
  });

  describe('6. Inserções Concorrentes de Ciclos no Grafo (Race Condition A ↔ B)', () => {
    let adminCookie: string;
    let demand: TestDemand;
    let taskX: TestTask;
    let taskY: TestTask;

    beforeAll(async () => {
      adminCookie = await cookieFor(admin.email);
      const client = await createFixtureClient(adminCookie, 'Cliente-Cycles');

      const resD = await inject({
        method: 'POST',
        url: '/api/v1/demands',
        headers: { origin, cookie: adminCookie },
        payload: { clientId: client.id, title: `${demandPrefix}Cycles Test`, deliveryDate: '2026-11-10' },
      });
      demand = resD.json().demand;
      createdDemandIds.push(demand.id);

      const resX = await inject({
        method: 'POST',
        url: '/api/v1/tasks',
        headers: { origin, cookie: adminCookie },
        payload: { demandId: demand.id, assignedToUserId: colabA.id, title: 'Tarefa X' },
      });
      taskX = resX.json().task;

      const resY = await inject({
        method: 'POST',
        url: '/api/v1/tasks',
        headers: { origin, cookie: adminCookie },
        payload: { demandId: demand.id, assignedToUserId: colabB.id, title: 'Tarefa Y' },
      });
      taskY = resY.json().task;
    });

    it('sob inserção concorrente cruzada (X depende de Y e Y depende de X), exatamente uma é aceita e o ciclo é rejeitado', async () => {
      const [res1, res2] = await Promise.all([
        inject({
          method: 'POST',
          url: `/api/v1/tasks/${taskX.id}/dependencies`,
          headers: { origin, cookie: adminCookie },
          payload: { version: taskX.version, dependsOnTaskId: taskY.id },
        }),
        inject({
          method: 'POST',
          url: `/api/v1/tasks/${taskY.id}/dependencies`,
          headers: { origin, cookie: adminCookie },
          payload: { version: taskY.version, dependsOnTaskId: taskX.id },
        }),
      ]);

      const statusCodes = [res1.statusCode, res2.statusCode];
      // Exatamente uma teve sucesso (200 ou 201)
      expect(statusCodes.filter((s) => s === 200 || s === 201).length).toBe(1);
      // A outra foi rejeitada com 400 (ciclo) ou 409 (lock/conflito)
      expect(statusCodes.filter((s) => s === 400 || s === 409).length).toBe(1);

      // Verificação de integridade no banco: não pode haver loop
      const rows = await db().pool.query(
        'SELECT task_id, depends_on_task_id FROM task_dependency WHERE task_id IN ($1, $2)',
        [taskX.id, taskY.id]
      );
      expect(rows.rowCount).toBe(1);
    });
  });

  describe('7. Concorrência Otimista (Version 409)', () => {
    let adminCookie: string;
    let demand: TestDemand;

    beforeAll(async () => {
      adminCookie = await cookieFor(admin.email);
      const client = await createFixtureClient(adminCookie, 'Cliente-Version');

      const resD = await inject({
        method: 'POST',
        url: '/api/v1/demands',
        headers: { origin, cookie: adminCookie },
        payload: { clientId: client.id, title: `${demandPrefix}Version 409 Test`, deliveryDate: '2026-11-15' },
      });
      demand = resD.json().demand;
      createdDemandIds.push(demand.id);
    });

    it('rejeita mutação com versão defasada com HTTP 409 VERSION_CONFLICT', async () => {
      // Primeira alteração bem-sucedida avança versão de 1 para 2
      const res1 = await inject({
        method: 'PATCH',
        url: `/api/v1/demands/${demand.id}`,
        headers: { origin, cookie: adminCookie },
        payload: { version: demand.version, description: 'Primeira alteração' },
      });
      expect(res1.statusCode).toBe(200);
      const updated = res1.json().demand;
      expect(updated.version).toBe(demand.version + 1);

      // Segunda alteração tentando usar versão 1 antiga
      const res2 = await inject({
        method: 'PATCH',
        url: `/api/v1/demands/${demand.id}`,
        headers: { origin, cookie: adminCookie },
        payload: { version: demand.version, description: 'Conflito concorrente' },
      });
      expect(res2.statusCode).toBe(409);
    });
  });

  describe('8. Fluxo de Pausa e Prorrogação (Decisão de Negócio Confirmada)', () => {
    let adminCookie: string;
    let colabACookie: string;
    let demand: TestDemand;
    let task: TestTask;

    beforeAll(async () => {
      adminCookie = await cookieFor(admin.email);
      colabACookie = await cookieFor(colabA.email);

      const client = await createFixtureClient(adminCookie, 'Cliente-Pause');

      const resD = await inject({
        method: 'POST',
        url: '/api/v1/demands',
        headers: { origin, cookie: adminCookie },
        payload: { clientId: client.id, title: `${demandPrefix}Pause Test`, deliveryDate: '2026-11-20' },
      });
      demand = resD.json().demand;
      createdDemandIds.push(demand.id);

      const resT = await inject({
        method: 'POST',
        url: '/api/v1/tasks',
        headers: { origin, cookie: adminCookie },
        payload: {
          demandId: demand.id,
          assignedToUserId: colabA.id,
          title: 'Produção com Solicitação de Pausa',
          deliveryDate: '2026-11-20',
        },
      });
      task = resT.json().task;

      // Aceita e inicia
      await inject({
        method: 'POST',
        url: `/api/v1/tasks/${task.id}/accept`,
        headers: { origin, cookie: colabACookie },
        payload: { version: task.version },
      });
      const resStart = await inject({
        method: 'POST',
        url: `/api/v1/tasks/${task.id}/start`,
        headers: { origin, cookie: colabACookie },
        payload: { version: task.version + 1 },
      });
      task = resStart.json().task;
      expect(task.status).toBe('in_production');
    });

    it('solicitação de pausa pelo colaborador NÃO altera o status nem a data de entrega até aprovação de Monique', async () => {
      const resReq = await inject({
        method: 'POST',
        url: `/api/v1/tasks/${task.id}/request-pause`,
        headers: { origin, cookie: colabACookie },
        payload: { version: task.version, reason: 'Aguardando validação de domínio com o cliente' },
      });
      expect(resReq.statusCode).toBe(200);
      const current = resReq.json().task;

      // Status PERMANECE in_production e data de entrega PERMANECE inalterada!
      expect(current.status).toBe('in_production');
      expect(current.deliveryDate).toBe('2026-11-20');
      expect(current.pauseRequestedAt).not.toBeNull();
      expect(current.pauseReason).toBe('Aguardando validação de domínio com o cliente');
      task = current;
    });

    it('aprovação da pausa pelo administrador define nova data explícita e transiciona para paused', async () => {
      const resApprove = await inject({
        method: 'POST',
        url: `/api/v1/tasks/${task.id}/approve-pause`,
        headers: { origin, cookie: adminCookie },
        payload: {
          version: task.version,
          reason: 'Pausa autorizada: prazo redefinido conforme alinhamento',
          deliveryDate: '2026-11-25',
        },
      });
      expect(resApprove.statusCode).toBe(200);
      const current = resApprove.json().task;

      expect(current.status).toBe('paused');
      expect(current.deliveryDate).toBe('2026-11-25');
      task = current;
    });

    it('retomada administrativa (resume) retorna para in_production sem resetar o startedAt original', async () => {
      const originalStartedAt = task.startedAt;
      const resResume = await inject({
        method: 'POST',
        url: `/api/v1/tasks/${task.id}/resume`,
        headers: { origin, cookie: adminCookie },
        payload: { version: task.version },
      });
      expect(resResume.statusCode).toBe(200);
      const current = resResume.json().task;

      expect(current.status).toBe('in_production');
      expect(current.pauseRequestedAt).toBeNull();
      expect(current.startedAt).toBe(originalStartedAt);
    });
  });

  describe('9. Reatribuição e Revogação Imediata de Acesso', () => {
    let adminCookie: string;
    let colabACookie: string;
    let colabBCookie: string;
    let demand: TestDemand;
    let task: TestTask;

    beforeAll(async () => {
      adminCookie = await cookieFor(admin.email);
      colabACookie = await cookieFor(colabA.email);
      colabBCookie = await cookieFor(colabB.email);

      const client = await createFixtureClient(adminCookie, 'Cliente-Reassign');

      const resD = await inject({
        method: 'POST',
        url: '/api/v1/demands',
        headers: { origin, cookie: adminCookie },
        payload: { clientId: client.id, title: `${demandPrefix}Reassign Test`, deliveryDate: '2026-11-30' },
      });
      demand = resD.json().demand;
      createdDemandIds.push(demand.id);

      const resT = await inject({
        method: 'POST',
        url: '/api/v1/tasks',
        headers: { origin, cookie: adminCookie },
        payload: { demandId: demand.id, assignedToUserId: colabA.id, title: 'Tarefa para Reatribuição' },
      });
      task = resT.json().task;

      // Colab A aceita
      const resAcc = await inject({
        method: 'POST',
        url: `/api/v1/tasks/${task.id}/accept`,
        headers: { origin, cookie: colabACookie },
        payload: { version: task.version },
      });
      task = resAcc.json().task;
      expect(task.acceptedAt).not.toBeNull();
    });

    it('reatribuição para Colab B limpa acceptedAt e revoga o acesso de Colab A imediatamente na próxima chamada', async () => {
      const resReassign = await inject({
        method: 'POST',
        url: `/api/v1/tasks/${task.id}/reassign`,
        headers: { origin, cookie: adminCookie },
        payload: {
          version: task.version,
          assignedToUserId: colabB.id,
          reason: 'Ajuste de distribuição interna',
        },
      });
      expect(resReassign.statusCode).toBe(200);
      const reassigned = resReassign.json().task;
      expect(reassigned.assignedToUserId).toBe(colabB.id);
      expect(reassigned.acceptedAt).toBeNull();

      // Colab A tenta ler imediatamente -> 404/403 (acesso revogado na hora!)
      const resColabA = await inject({
        method: 'GET',
        url: `/api/v1/tasks/${task.id}`,
        headers: { origin, cookie: colabACookie },
      });
      expect([403, 404]).toContain(resColabA.statusCode);

      // Colab B agora consegue ler e aceitar
      const resColabB = await inject({
        method: 'GET',
        url: `/api/v1/tasks/${task.id}`,
        headers: { origin, cookie: colabBCookie },
      });
      expect(resColabB.statusCode).toBe(200);
    });
  });

  describe('10. Conclusão da Demanda (Regra Administrativa)', () => {
    let adminCookie: string;
    let colabACookie: string;
    let demand: TestDemand;
    let task: TestTask;

    beforeAll(async () => {
      adminCookie = await cookieFor(admin.email);
      colabACookie = await cookieFor(colabA.email);

      const client = await createFixtureClient(adminCookie, 'Cliente-Complete');

      const resD = await inject({
        method: 'POST',
        url: '/api/v1/demands',
        headers: { origin, cookie: adminCookie },
        payload: { clientId: client.id, title: `${demandPrefix}Complete Demand Test`, deliveryDate: '2026-12-01' },
      });
      demand = resD.json().demand;
      createdDemandIds.push(demand.id);

      const resT = await inject({
        method: 'POST',
        url: '/api/v1/tasks',
        headers: { origin, cookie: adminCookie },
        payload: { demandId: demand.id, assignedToUserId: colabA.id, title: 'Única Tarefa' },
      });
      task = resT.json().task;
    });

    it('rejeita conclusão da demanda enquanto houver tarefas não concluídas', async () => {
      const res = await inject({
        method: 'POST',
        url: `/api/v1/demands/${demand.id}/complete`,
        headers: { origin, cookie: adminCookie },
        payload: { version: demand.version },
      });
      expect([400, 409, 422]).toContain(res.statusCode);
    });

    it('permite conclusão da demanda quando todas as tarefas estiverem completed', async () => {
      // Conclui tarefa (aceita, inicia, submete e aprova)
      await inject({
        method: 'POST',
        url: `/api/v1/tasks/${task.id}/accept`,
        headers: { origin, cookie: colabACookie },
        payload: { version: task.version },
      });
      await inject({
        method: 'POST',
        url: `/api/v1/tasks/${task.id}/start`,
        headers: { origin, cookie: colabACookie },
        payload: { version: task.version + 1 },
      });
      await inject({
        method: 'POST',
        url: `/api/v1/tasks/${task.id}/submit-review`,
        headers: { origin, cookie: colabACookie },
        payload: { version: task.version + 2, deliveryNotes: 'Pronto para entrega' },
      });
      await inject({
        method: 'POST',
        url: `/api/v1/tasks/${task.id}/review`,
        headers: { origin, cookie: adminCookie },
        payload: { version: task.version + 3, decision: 'complete', feedback: 'Perfeito' },
      });

      // Conclui demanda
      const res = await inject({
        method: 'POST',
        url: `/api/v1/demands/${demand.id}/complete`,
        headers: { origin, cookie: adminCookie },
        payload: { version: demand.version },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().demand.status).toBe('completed');
    });
  });

  describe('11. Validação Estrita de Input: Datas Inexistentes no Calendário e URLs Inseguras (Anti-XSS)', () => {
    let adminCookie: string;
    let colabACookie: string;
    let client: { id: string; name: string };
    let validDemand: TestDemand;
    let validTask: TestTask;

    beforeAll(async () => {
      adminCookie = await cookieFor(admin.email);
      colabACookie = await cookieFor(colabA.email);
      client = await createFixtureClient(adminCookie, 'Cliente-Validation');

      const resD = await inject({
        method: 'POST',
        url: '/api/v1/demands',
        headers: { origin, cookie: adminCookie },
        payload: {
          clientId: client.id,
          title: `${demandPrefix}Validation Test Demand`,
          deliveryDate: '2026-11-20',
        },
      });
      validDemand = resD.json().demand;
      createdDemandIds.push(validDemand.id);

      const resT = await inject({
        method: 'POST',
        url: '/api/v1/tasks',
        headers: { origin, cookie: adminCookie },
        payload: {
          demandId: validDemand.id,
          assignedToUserId: colabA.id,
          title: 'Tarefa para Validação de Input',
          deliveryDate: '2026-11-20',
        },
      });
      validTask = resT.json().task;
    });

    it.each([
      '2026-02-30', // Fevereiro não possui dia 30
      '2026-04-31', // Abril possui apenas 30 dias
      '2025-02-29', // 2025 não é bissexto
      '2026-13-01', // Mês 13 inválido
      '2026-00-10', // Mês 00 inválido
      'invalid-date', // Formato não numérico
      '2026-02-29T10:00:00Z', // ISO datetime inválido para data de calendário YYYY-MM-DD
    ])('rejeita criação de demanda com data de calendário inexistente ou inválida %s com HTTP 400', async (invalidDate) => {
      const res = await inject({
        method: 'POST',
        url: '/api/v1/demands',
        headers: { origin, cookie: adminCookie },
        payload: {
          clientId: client.id,
          title: `${demandPrefix}Invalid Date Demand`,
          deliveryDate: invalidDate,
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('INVALID_INPUT');
    });

    it.each([
      '2026-02-30',
      '2026-04-31',
      '2025-02-29',
    ])('rejeita criação de tarefa com data de calendário inexistente %s com HTTP 400', async (invalidDate) => {
      const res = await inject({
        method: 'POST',
        url: '/api/v1/tasks',
        headers: { origin, cookie: adminCookie },
        payload: {
          demandId: validDemand.id,
          assignedToUserId: colabA.id,
          title: 'Tarefa com Data Inexistente',
          deliveryDate: invalidDate,
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('INVALID_INPUT');
    });

    it.each([
      '2026-02-30',
      '2026-04-31',
      '2025-02-29',
    ])('rejeita aprovação de pausa com nova data inexistente %s com HTTP 400', async (invalidDate) => {
      const res = await inject({
        method: 'POST',
        url: `/api/v1/tasks/${validTask.id}/approve-pause`,
        headers: { origin, cookie: adminCookie },
        payload: {
          version: validTask.version,
          reason: 'Pausa com data inválida',
          deliveryDate: invalidDate,
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('INVALID_INPUT');
    });

    it.each([
      'javascript:alert(1)',
      'javascript:void(0)',
      'JAVASCRIPT:alert(document.cookie)',
      'data:text/html,<script>alert(1)</script>',
      'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
      'vbscript:msgbox("xss")',
    ])('rejeita submissão de revisão com previewUrl insegura/XSS (%s) com HTTP 400', async (unsafeUrl) => {
      const res = await inject({
        method: 'POST',
        url: `/api/v1/tasks/${validTask.id}/submit-review`,
        headers: { origin, cookie: colabACookie },
        payload: {
          version: validTask.version,
          deliveryNotes: 'Entrega com URL suspeita',
          previewUrl: unsafeUrl,
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('INVALID_INPUT');
    });

    it.each([
      'https://staging.example.com/preview',
      'http://localhost:3000/preview/item-1',
      null,
      undefined,
    ])('aceita submissão de revisão com previewUrl segura ou nula (%s) no validador de schema', async (safeUrl) => {
      const payload: Record<string, unknown> = {
        version: validTask.version,
        deliveryNotes: 'Entrega válida com URL segura',
      };
      if (safeUrl !== undefined) {
        payload.previewUrl = safeUrl;
      }

      const res = await inject({
        method: 'POST',
        url: `/api/v1/tasks/${validTask.id}/submit-review`,
        headers: { origin, cookie: colabACookie },
        payload,
      });

      // Se falhar em runtime por status da tarefa (ex: não estar in_production/in_review), nunca deve ser INVALID_INPUT
      if (res.statusCode === 400) {
        expect(res.json().error.code).not.toBe('INVALID_INPUT');
      }
    });
  });
});
