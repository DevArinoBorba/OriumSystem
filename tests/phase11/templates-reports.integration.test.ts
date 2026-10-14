import { randomBytes, randomUUID } from 'node:crypto';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Role } from '@orium/contracts';
import {
  bottlenecksReportResponseSchema,
  demandResponseSchema,
  demandTemplateListResponseSchema,
  demandTemplateResponseSchema,
  productivityReportResponseSchema,
} from '@orium/contracts';
import { buildApp } from '../../apps/api/src/app.js';
import { loadConfig } from '../../apps/api/src/config.js';
import { connectDatabase, assertApplicationDatabase, type Database } from '../../apps/api/src/db.js';
import { migrateDatabase } from '../../apps/api/src/migrate.js';
import { provisionUser } from '../../apps/api/src/identity.js';

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

describe('Fase 11 — Templates de Demandas e Relatórios Operacionais', () => {
  let app: FastifyInstance | undefined;
  let database: Database | undefined;
  let migrationUrl: string;
  let admin: { id: string; email: string };
  let colabA: { id: string; email: string };
  let colabB: { id: string; email: string };

  const userPrefix = `p11-test-user-${randomUUID().slice(0, 8)}-`;
  const clientPrefix = `p11-test-client-${randomUUID().slice(0, 8)}-`;
  const password = randomBytes(24).toString('hex');
  const origin = 'http://127.0.0.1:5173';
  let requestIndex = 0;

  const createdTemplateIds: string[] = [];
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
        contactName: 'Contato Operacional Fase 11',
        email: `client-${randomUUID().slice(0, 8)}@fixture.test`,
        phone: '65999990000',
        notes: 'Cliente para testes de relatórios e templates',
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

    // Aplica migrações na base de teste isolada
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
          const cleanupDatabase = connectDatabase(migrationUrl);
          const cleanupClient = await cleanupDatabase.pool.connect();
          try {
            await cleanupClient.query('BEGIN');
            await cleanupClient.query('SELECT pg_advisory_xact_lock(712041)');

            // Limpeza cirúrgica de notificações e demandas criadas no teste
            if (createdDemandIds.length > 0) {
              await cleanupClient.query('DELETE FROM notification WHERE demand_id = ANY($1)', [createdDemandIds]);
              await cleanupClient.query('DELETE FROM task_dependency WHERE task_id IN (SELECT id FROM task WHERE demand_id = ANY($1))', [createdDemandIds]);
              await cleanupClient.query('DELETE FROM task_requirement WHERE task_id IN (SELECT id FROM task WHERE demand_id = ANY($1))', [createdDemandIds]);
              await cleanupClient.query('DELETE FROM demand_event WHERE demand_id = ANY($1)', [createdDemandIds]);
              await cleanupClient.query('DELETE FROM task WHERE demand_id = ANY($1)', [createdDemandIds]);
              await cleanupClient.query('DELETE FROM demand WHERE id = ANY($1)', [createdDemandIds]);
            }

            // Limpeza cirúrgica de templates criados no teste
            if (createdTemplateIds.length > 0) {
              await cleanupClient.query('DELETE FROM demand_template_task_dependency WHERE template_task_id IN (SELECT id FROM demand_template_task WHERE template_id = ANY($1))', [createdTemplateIds]);
              await cleanupClient.query('DELETE FROM demand_template_task_requirement WHERE template_task_id IN (SELECT id FROM demand_template_task WHERE template_id = ANY($1))', [createdTemplateIds]);
              await cleanupClient.query('DELETE FROM demand_template_task WHERE template_id = ANY($1)', [createdTemplateIds]);
              await cleanupClient.query('DELETE FROM demand_template WHERE id = ANY($1)', [createdTemplateIds]);
            }

            // Limpeza de clientes do teste
            if (createdClientIds.length > 0) {
              await cleanupClient.query('DELETE FROM client WHERE id = ANY($1)', [createdClientIds]);
            }

            // Limpeza sob lock dos usuários e auditorias de identidade da suíte
            const users = (await cleanupClient.query<{ id: string }>('SELECT id FROM auth_user WHERE left(email,length($1))=$1', [userPrefix])).rows.map(row => row.id);
            if (users.length > 0) {
              await cleanupClient.query('DELETE FROM identity_event WHERE actor_id=ANY($1::text[]) OR target_user_id=ANY($1::text[])', [users]);
              await cleanupClient.query('DELETE FROM identity_event_subject WHERE user_id=ANY($1::text[])', [users]);
              await cleanupClient.query('DELETE FROM auth_user WHERE id=ANY($1::text[])', [users]);
            }
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

  describe('1. CRUD de Templates de Demandas (/api/v1/demand-templates)', () => {
    it('rejeita criação sem autenticação com 401', async () => {
      const res = await inject({
        method: 'POST',
        url: '/api/v1/demand-templates',
        headers: { origin },
        payload: {
          title: 'Template Anônimo',
          tasks: [{ title: 'Task 1' }],
        },
      });
      expect(res.statusCode).toBe(401);
    });

    it('rejeita criação por colaborador não-administrador com 403', async () => {
      const colabCookie = await cookieFor(colabA.email);
      const res = await inject({
        method: 'POST',
        url: '/api/v1/demand-templates',
        headers: { origin, cookie: colabCookie },
        payload: {
          title: 'Template Colaborador',
          tasks: [{ title: 'Task 1' }],
        },
      });
      expect(res.statusCode).toBe(403);
    });

    it('cria template de demanda estruturado com tarefas, requisitos e dependências por administrador', async () => {
      const adminCookie = await cookieFor(admin.email);
      const res = await inject({
        method: 'POST',
        url: '/api/v1/demand-templates',
        headers: { origin, cookie: adminCookie },
        payload: {
          title: 'Template Landing Page Completa',
          description: 'Fluxo padronizado de criação de Landing Page',
          category: 'web',
          defaultPriority: 'high',
          estimatedDays: 7,
          tasks: [
            {
              tempId: 't0',
              title: 'Briefing e Copywriting',
              description: 'Definir proposta de valor e textos persuasivos',
              suggestedRole: 'collaborator',
              priority: 'high',
              dayOffsetStart: 0,
              durationDays: 2,
              orderIndex: 0,
              requirements: [
                { title: 'Aprovação do cliente sobre a persona', mandatory: false, orderIndex: 0 },
              ],
              dependsOnTempIds: [],
            },
            {
              tempId: 't1',
              title: 'Design UI/UX no Figma',
              description: 'Desenvolvimento do layout responsivo desktop e mobile',
              suggestedRole: 'collaborator',
              priority: 'high',
              dayOffsetStart: 2,
              durationDays: 3,
              orderIndex: 1,
              requirements: [
                { title: 'Paleta de cores e tipografia validadas', mandatory: true, orderIndex: 0 },
              ],
              dependsOnTempIds: ['t0'], // Depende da tarefa 0 (Briefing)
            },
            {
              tempId: 't2',
              title: 'Implementação Frontend',
              description: 'Codificação em React + Tailwind com acessibilidade',
              suggestedRole: 'collaborator',
              priority: 'normal',
              dayOffsetStart: 5,
              durationDays: 2,
              orderIndex: 2,
              requirements: [],
              dependsOnTempIds: ['t1'], // Depende da tarefa 1 (Design)
            },
          ],
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      const parsed = demandTemplateResponseSchema.parse(body);
      const template = parsed.template;

      expect(template.title).toBe('Template Landing Page Completa');
      expect(template.category).toBe('web');
      expect(template.version).toBe(1);
      expect(template.active).toBe(true);
      expect(template.tasks.length).toBe(3);

      // Tarefa 0
      const t0 = template.tasks[0]!;
      expect(t0.title).toBe('Briefing e Copywriting');
      expect(t0.requirements.length).toBe(1);
      expect(t0.requirements[0]!.mandatory).toBe(false);
      expect(t0.dependsOnTaskIds.length).toBe(0);

      // Tarefa 1
      const t1 = template.tasks[1]!;
      expect(t1.title).toBe('Design UI/UX no Figma');
      expect(t1.requirements.length).toBe(1);
      expect(t1.requirements[0]!.mandatory).toBe(true);
      expect(t1.dependsOnTaskIds).toContain(t0.id);

      // Tarefa 2
      const t2 = template.tasks[2]!;
      expect(t2.title).toBe('Implementação Frontend');
      expect(t2.dependsOnTaskIds).toContain(t1.id);

      createdTemplateIds.push(template.id);
    });

    it('permite listagem de templates tanto para admin quanto para colaborador com demands.read', async () => {
      const adminCookie = await cookieFor(admin.email);
      const colabCookie = await cookieFor(colabA.email);

      const resAdmin = await inject({
        method: 'GET',
        url: '/api/v1/demand-templates',
        headers: { origin, cookie: adminCookie },
      });
      expect(resAdmin.statusCode).toBe(200);
      const bodyAdmin = demandTemplateListResponseSchema.parse(resAdmin.json());
      expect(bodyAdmin.templates.length).toBeGreaterThan(0);

      const resColab = await inject({
        method: 'GET',
        url: '/api/v1/demand-templates',
        headers: { origin, cookie: colabCookie },
      });
      expect(resColab.statusCode).toBe(200);
      const bodyColab = demandTemplateListResponseSchema.parse(resColab.json());
      expect(bodyColab.templates.length).toBeGreaterThan(0);
    });

    it('busca template por ID e retorna 404 para identificador inexistente', async () => {
      const colabCookie = await cookieFor(colabA.email);
      const templateId = createdTemplateIds[0]!;

      const res = await inject({
        method: 'GET',
        url: `/api/v1/demand-templates/${templateId}`,
        headers: { origin, cookie: colabCookie },
      });
      expect(res.statusCode).toBe(200);
      const body = demandTemplateResponseSchema.parse(res.json());
      expect(body.template.id).toBe(templateId);

      const fakeRes = await inject({
        method: 'GET',
        url: `/api/v1/demand-templates/${randomUUID()}`,
        headers: { origin, cookie: colabCookie },
      });
      expect(fakeRes.statusCode).toBe(404);
    });

    it('valida controle de concorrência otimista (version) e RBAC no PATCH /api/v1/demand-templates/:id', async () => {
      const adminCookie = await cookieFor(admin.email);
      const colabCookie = await cookieFor(colabA.email);
      const templateId = createdTemplateIds[0]!;

      // 1. Colaborador tenta editar -> 403
      const colabEdit = await inject({
        method: 'PATCH',
        url: `/api/v1/demand-templates/${templateId}`,
        headers: { origin, cookie: colabCookie },
        payload: { version: 1, title: 'Título Não Permitido' },
      });
      expect(colabEdit.statusCode).toBe(403);

      // 2. Admin tenta editar com versão incorreta (ex: version 99) -> 409 Conflict
      const conflictEdit = await inject({
        method: 'PATCH',
        url: `/api/v1/demand-templates/${templateId}`,
        headers: { origin, cookie: adminCookie },
        payload: { version: 99, title: 'Conflito de Versão' },
      });
      expect(conflictEdit.statusCode).toBe(409);

      // 3. Admin edita com versão correta (version 1) -> 200, nova versão é 2
      const validEdit = await inject({
        method: 'PATCH',
        url: `/api/v1/demand-templates/${templateId}`,
        headers: { origin, cookie: adminCookie },
        payload: {
          version: 1,
          title: 'Template Landing Page Otimizada',
          estimatedDays: 10,
        },
      });
      expect(validEdit.statusCode).toBe(200);
      const body = demandTemplateResponseSchema.parse(validEdit.json());
      expect(body.template.title).toBe('Template Landing Page Otimizada');
      expect(body.template.estimatedDays).toBe(10);
      expect(body.template.version).toBe(2);
    });
  });

  describe('2. Instanciação Atômica de Demandas (/api/v1/demand-templates/:id/instantiate)', () => {
    it('rejeita instanciação sem autenticação com 401', async () => {
      const templateId = createdTemplateIds[0]!;
      const res = await inject({
        method: 'POST',
        url: `/api/v1/demand-templates/${templateId}/instantiate`,
        headers: { origin },
        payload: { clientId: randomUUID() },
      });
      expect(res.statusCode).toBe(401);
    });

    it('instancia demanda e tarefas com status inicial coerente (ready vs blocked) e notificações', async () => {
      const adminCookie = await cookieFor(admin.email);
      const client = await createFixtureClient(adminCookie, 'Cliente LP');
      const templateId = createdTemplateIds[0]!;

      const instantiateRes = await inject({
        method: 'POST',
        url: `/api/v1/demand-templates/${templateId}/instantiate`,
        headers: { origin, cookie: adminCookie },
        payload: {
          clientId: client.id,
          title: 'Campanha de Lançamento Produto X',
          assignments: {
            '0': colabA.id,
            '1': colabB.id,
            '2': colabA.id,
          },
        },
      });

      expect(instantiateRes.statusCode).toBe(201);
      const demandBody = demandResponseSchema.parse(instantiateRes.json());
      const demand = demandBody.demand;
      createdDemandIds.push(demand.id);

      expect(demand.title).toBe('Campanha de Lançamento Produto X');
      expect(demand.clientId).toBe(client.id);
      expect(demand.status).toBe('open');

      // Inspeciona tarefas criadas diretamente no banco de teste
      const tasksRes = await db().pool.query<{
        id: string;
        title: string;
        assigned_to_user_id: string;
        status: string;
        ready_at: Date | null;
        delivery_date: Date | string;
      }>(`SELECT * FROM task WHERE demand_id = $1 ORDER BY delivery_date ASC, title ASC`, [demand.id]);

      expect(tasksRes.rows.length).toBe(3);

      const briefingTask = tasksRes.rows.find((t) => t.title === 'Briefing e Copywriting')!;
      const designTask = tasksRes.rows.find((t) => t.title === 'Design UI/UX no Figma')!;
      const devTask = tasksRes.rows.find((t) => t.title === 'Implementação Frontend')!;

      // Briefing não tem dependência nem requisito obrigatório -> deve ser ready
      expect(briefingTask.status).toBe('ready');
      expect(briefingTask.ready_at).not.toBeNull();
      expect(briefingTask.assigned_to_user_id).toBe(colabA.id);

      // Design tem dependência e requisito obrigatório -> deve ser blocked
      expect(designTask.status).toBe('blocked');
      expect(designTask.ready_at).toBeNull();
      expect(designTask.assigned_to_user_id).toBe(colabB.id);

      // Dev tem dependência em Design -> deve ser blocked
      expect(devTask.status).toBe('blocked');
      expect(devTask.ready_at).toBeNull();
      expect(devTask.assigned_to_user_id).toBe(colabA.id);

      // Valida que dependências entre as novas tarefas foram criadas corretamente
      const depsRes = await db().pool.query<{ task_id: string; depends_on_task_id: string }>(`
        SELECT task_id, depends_on_task_id FROM task_dependency
        WHERE task_id IN ($1, $2, $3)
      `, [briefingTask.id, designTask.id, devTask.id]);

      const designDeps = depsRes.rows.filter((d) => d.task_id === designTask.id);
      expect(designDeps.length).toBe(1);
      expect(designDeps[0]!.depends_on_task_id).toBe(briefingTask.id);

      const devDeps = depsRes.rows.filter((d) => d.task_id === devTask.id);
      expect(devDeps.length).toBe(1);
      expect(devDeps[0]!.depends_on_task_id).toBe(designTask.id);

      // Valida requisitos criados
      const reqsRes = await db().pool.query<{ task_id: string; title: string; mandatory: boolean }>(`
        SELECT task_id, title, mandatory FROM task_requirement
        WHERE task_id IN ($1, $2, $3)
      `, [briefingTask.id, designTask.id, devTask.id]);
      expect(reqsRes.rows.length).toBe(2);

      // Valida evento de auditoria demand_created_from_template
      const eventRes = await db().pool.query<{ action: string; metadata: { templateId: string } }>(`
        SELECT action, metadata FROM demand_event WHERE demand_id = $1
      `, [demand.id]);
      expect(eventRes.rows.length).toBeGreaterThan(0);
      const tmplEvent = eventRes.rows.find((e) => e.action === 'demand_created_from_template');
      expect(tmplEvent).toBeDefined();
      expect(tmplEvent!.metadata.templateId).toBe(templateId);

      // Valida notificações associadas à demanda instanciada
      const notifRes = await db().pool.query<{ recipient_user_id: string; kind: string }>(`
        SELECT recipient_user_id, kind FROM notification WHERE demand_id = $1
      `, [demand.id]);
      expect(Array.isArray(notifRes.rows)).toBe(true);
    });
  });

  describe('3. Relatórios Operacionais (/api/v1/reports)', () => {
    it('rejeita consultas de produtividade sem autenticação ou com datas inválidas', async () => {
      // 1. Sem autenticação
      const noAuth = await inject({
        method: 'GET',
        url: '/api/v1/reports/productivity?startDate=2026-01-01&endDate=2026-01-31',
        headers: { origin },
      });
      expect(noAuth.statusCode).toBe(401);

      // 2. startDate posterior a endDate -> 400
      const adminCookie = await cookieFor(admin.email);
      const invalidDates = await inject({
        method: 'GET',
        url: '/api/v1/reports/productivity?startDate=2026-12-31&endDate=2026-01-01',
        headers: { origin, cookie: adminCookie },
      });
      expect(invalidDates.statusCode).toBe(400);
    });

    it('administrador visualiza métricas agregadas de produtividade e agregação por colaborador', async () => {
      const adminCookie = await cookieFor(admin.email);
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Cuiaba' }).format(new Date());

      const res = await inject({
        method: 'GET',
        url: `/api/v1/reports/productivity?startDate=${today}&endDate=${today}`,
        headers: { origin, cookie: adminCookie },
      });

      expect(res.statusCode).toBe(200);
      const report = productivityReportResponseSchema.parse(res.json());

      expect(report.period.startDate).toBe(today);
      expect(report.period.endDate).toBe(today);
      expect(typeof report.summary.demandsCreated).toBe('number');
      expect(typeof report.summary.onTimeDeliveryRate).toBe('number');
      expect(Array.isArray(report.byAssignee)).toBe(true);
    });

    it('aplica isolamento anti-IDOR estrito em produtividade para colaboradores', async () => {
      const colabACookie = await cookieFor(colabA.email);
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Cuiaba' }).format(new Date());

      // Colaborador A tenta forçar a consulta com userId do Colaborador B
      const res = await inject({
        method: 'GET',
        url: `/api/v1/reports/productivity?startDate=${today}&endDate=${today}&userId=${colabB.id}`,
        headers: { origin, cookie: colabACookie },
      });

      expect(res.statusCode).toBe(200);
      const report = productivityReportResponseSchema.parse(res.json());

      // O relatório retornado para colabA não pode conter métricas de colabB no byAssignee
      for (const item of report.byAssignee) {
        expect(item.userId).not.toBe(colabB.id);
      }
    });

    it('administrador visualiza relatório de gargalos e pausas operacionais', async () => {
      const adminCookie = await cookieFor(admin.email);

      const res = await inject({
        method: 'GET',
        url: '/api/v1/reports/bottlenecks',
        headers: { origin, cookie: adminCookie },
      });

      expect(res.statusCode).toBe(200);
      const bottlenecks = bottlenecksReportResponseSchema.parse(res.json());

      expect(typeof bottlenecks.summary.currentlyBlockedTasks).toBe('number');
      expect(typeof bottlenecks.summary.currentlyPausedTasks).toBe('number');
      expect(typeof bottlenecks.summary.overdueOpenTasks).toBe('number');
      expect(typeof bottlenecks.stageAverages.averageReadyWaitHours).toBe('number');
      expect(Array.isArray(bottlenecks.pausedTasks)).toBe(true);
    });

    it('colaborador visualiza apenas seus próprios itens no relatório de gargalos', async () => {
      const colabBCookie = await cookieFor(colabB.email);

      const res = await inject({
        method: 'GET',
        url: '/api/v1/reports/bottlenecks',
        headers: { origin, cookie: colabBCookie },
      });

      expect(res.statusCode).toBe(200);
      const bottlenecks = bottlenecksReportResponseSchema.parse(res.json());

      // As tarefas listadas em pausedTasks devem pertencer exclusivamente a colabB
      for (const item of bottlenecks.pausedTasks) {
        expect(item.assignedToName).toBe('User colabB');
      }
    });
  });
});
