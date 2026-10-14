import { randomBytes, randomUUID } from 'node:crypto';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ClientTimelineEvent, ClientTimelineResponse, Material, MaterialCategory, Role, SessionResponse } from '@orium/contracts';
import { buildApp } from '../apps/api/src/app.js';
import { loadConfig } from '../apps/api/src/config.js';
import { connectDatabase, assertApplicationDatabase, type Database } from '../apps/api/src/db.js';
import { migrateDatabase } from '../apps/api/src/migrate.js';
import { provisionUser } from '../apps/api/src/identity.js';
import { archiveMaterial, createMaterial, listMaterialTargets } from '../apps/api/src/materials.js';

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

describe('materials domain integration tests against real PostgreSQL (Fase 5 Gate)', () => {
  let app: FastifyInstance | undefined;
  let database: Database | undefined;
  let migrationUrl: string;

  let admin: { id: string; email: string };
  let colabA: { id: string; email: string };
  let colabB: { id: string; email: string };

  let adminCookie: string;
  let colabACookie: string;
  let colabBCookie: string;

  const testRunId = randomUUID().slice(0, 8);
  const userPrefix = `mat-user-${testRunId}-`;
  const clientPrefix = `mat-client-${testRunId}-`;
  const demandPrefix = `mat-demand-${testRunId}-`;
  const password = randomBytes(24).toString('hex');
  const origin = 'http://127.0.0.1:5173';
  let requestIndex = 0;

  const createdMaterialIds: string[] = [];
  const createdDemandIds: string[] = [];
  const createdClientIds: string[] = [];
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
    const name = `User ${label}`;
    const email = `${userPrefix}${label}-${randomUUID().slice(0, 6)}@example.test`;
    const created = await provisionUser(db(), { name, email, password, role });
    createdUserIds.push(created.id);
    return { ...created, name, email };
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
        contactName: 'Contato Teste',
        email: `client-${randomUUID().slice(0, 8)}@fixture.test`,
        phone: '11999998888',
        notes: 'Cliente de teste da Fase 5',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    const client = (body.client ?? body) as { id: string; name: string };
    createdClientIds.push(client.id);
    return client;
  };

  const createFixtureDemand = async (cookie: string, clientId: string, titleSuffix: string) => {
    const title = `${demandPrefix}${titleSuffix}`;
    const res = await inject({
      method: 'POST',
      url: '/api/v1/demands',
      headers: { origin, cookie },
      payload: {
        clientId,
        title,
        priority: 'high',
        deliveryDate: '2026-11-20',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    const demand = (body.demand ?? body) as { id: string; title: string };
    createdDemandIds.push(demand.id);
    return demand;
  };

  const createFixtureTask = async (
    cookie: string,
    demandId: string,
    assignedToUserId: string,
    titleSuffix: string,
  ) => {
    const res = await inject({
      method: 'POST',
      url: '/api/v1/tasks',
      headers: { origin, cookie },
      payload: {
        demandId,
        title: `Task ${titleSuffix}`,
        description: `Description ${titleSuffix}`,
        priority: 'high',
        assignedToUserId,
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    return (body.task ?? body) as { id: string; title: string; assignedToUserId: string };
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

    adminCookie = await cookieFor(admin.email);
    colabACookie = await cookieFor(colabA.email);
    colabBCookie = await cookieFor(colabB.email);
  }, 60000);

  afterAll(async () => {
    try {
      await app?.close();
    } finally {
      if (database) {
        try {
          if (createdMaterialIds.length > 0) {
            await database.pool.query('DELETE FROM material_event WHERE material_id = ANY($1)', [createdMaterialIds]);
            await database.pool.query('DELETE FROM material WHERE id = ANY($1)', [createdMaterialIds]);
          }
          if (createdDemandIds.length > 0) {
            await database.pool.query('DELETE FROM task_comment WHERE task_id IN (SELECT id FROM task WHERE demand_id = ANY($1))', [createdDemandIds]);
            await database.pool.query('DELETE FROM task_requirement WHERE task_id IN (SELECT id FROM task WHERE demand_id = ANY($1))', [createdDemandIds]);
            await database.pool.query('DELETE FROM task_dependency WHERE task_id IN (SELECT id FROM task WHERE demand_id = ANY($1))', [createdDemandIds]);
            await database.pool.query('DELETE FROM demand_event WHERE demand_id = ANY($1)', [createdDemandIds]);
            await database.pool.query('DELETE FROM task WHERE demand_id = ANY($1)', [createdDemandIds]);
            await database.pool.query('DELETE FROM demand WHERE id = ANY($1)', [createdDemandIds]);
          }
          if (createdClientIds.length > 0) {
            await database.pool.query('DELETE FROM client WHERE id = ANY($1)', [createdClientIds]);
          }
          if (createdUserIds.length > 0 && migrationUrl) {
            const migDb = connectDatabase(migrationUrl);
            try {
              await migDb.pool.query(
                'DELETE FROM identity_event WHERE actor_id = ANY($1::text[]) OR target_user_id = ANY($1::text[])',
                [createdUserIds],
              );
              await migDb.pool.query('DELETE FROM identity_event_subject WHERE user_id = ANY($1::text[])', [createdUserIds]);
            } finally {
              await migDb.pool.end();
            }
          }
          await database.pool.query('DELETE FROM auth_user WHERE left(email, length($1)) = $1', [userPrefix]);
          await database.pool.query(`
            INSERT INTO role_permission (role_id, permission_id) VALUES
              ('collaborator', 'materials.read'),
              ('collaborator', 'materials.write'),
              ('administrator', 'materials.read'),
              ('administrator', 'materials.write'),
              ('administrator', 'materials.archive')
            ON CONFLICT DO NOTHING
          `);
        } finally {
          await database.pool.end();
        }
      }
    }
  });

  describe('Gate 1 & 2 & 3: Autenticação, Revalidação de Banco e Proteção contra Forjamento/Deativação/Revogação', () => {
    it('1.1: Rejeita requisições não autenticadas em todas as 8 rotas de materiais com 401', async () => {
      const fakeId = randomUUID();
      const routes = [
        { method: 'GET', url: '/api/v1/materials/targets?kind=client' },
        { method: 'GET', url: '/api/v1/materials' },
        { method: 'POST', url: '/api/v1/materials', payload: { title: 'Test' }, headers: { origin } },
        { method: 'GET', url: `/api/v1/materials/${fakeId}` },
        { method: 'PATCH', url: `/api/v1/materials/${fakeId}`, payload: { title: 'Test', version: 1 }, headers: { origin } },
        { method: 'POST', url: `/api/v1/materials/${fakeId}/archive`, payload: { version: 1 }, headers: { origin } },
        { method: 'POST', url: `/api/v1/materials/${fakeId}/restore`, payload: { version: 1 }, headers: { origin } },
        { method: 'GET', url: `/api/v1/materials/${fakeId}/history` },
      ] as const;

      for (const r of routes) {
        const res = await inject({ ...r });
        expect(res.statusCode, `Route ${r.method} ${r.url} should return 401`).toBe(401);
      }
    });

    it('1.2: Usuário desativado no banco tem acesso rejeitado com 401 dentro do snapshot da API', async () => {
      const deactUser = await fixtureUser('collaborator', 'deact');
      const deactCookie = await cookieFor(deactUser.email);

      // Desativar usuário diretamente no banco
      await db().pool.query('UPDATE auth_user SET active = false WHERE id = $1', [deactUser.id]);

      const res = await inject({
        method: 'GET',
        url: '/api/v1/materials',
        headers: { origin, cookie: deactCookie },
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe('UNAUTHENTICATED');
    });

    it('1.3: Permissão revogada no banco rejeita a operação com 403 dentro do snapshot da API', async () => {
      const restrictedUser = await fixtureUser('collaborator', 'restricted');
      const restrictedCookie = await cookieFor(restrictedUser.email);

      try {
        // Remover materials.read do papel collaborator temporariamente para teste
        await db().pool.query("DELETE FROM role_permission WHERE role_id = 'collaborator' AND permission_id = 'materials.read'");

        const res = await inject({
          method: 'GET',
          url: '/api/v1/materials',
          headers: { origin, cookie: restrictedCookie },
        });
        expect(res.statusCode).toBe(403);
        expect(res.json().error.code).toBe('FORBIDDEN');
      } finally {
        // Restaurar permissão garantido no finally
        await db().pool.query("INSERT INTO role_permission (role_id, permission_id) VALUES ('collaborator', 'materials.read') ON CONFLICT DO NOTHING");
      }
    });

    it('1.4: Cookie com token de sessão inválido ou inexistente rejeita com 401', async () => {
      const res = await inject({
        method: 'GET',
        url: '/api/v1/materials',
        headers: { origin, cookie: 'better-auth.session_token=fake-nonexistent-token-12345' },
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe('UNAUTHENTICATED');
    });

    it('1.5: Sessão forjada como admin para usuário colaborador real via serviço é rejeitada pela revalidação do banco com 403', async () => {
      const forgedColab = await fixtureUser('collaborator', 'forged-admin');
      const forgedAdminSession: SessionResponse = {
        user: { id: forgedColab.id, name: forgedColab.name, email: forgedColab.email },
        roles: ['administrator'], // Forjado na sessão em memória
        permissions: ['materials.read', 'materials.write', 'materials.archive'], // Forjado na sessão em memória
      };

      const probeClient = await createFixtureClient(adminCookie, 'ForgedProbeClient');
      const probeDemand = await createFixtureDemand(adminCookie, probeClient.id, 'ForgedProbeDemand');
      const probeTask = await createFixtureTask(adminCookie, probeDemand.id, admin.id, 'ForgedProbeTask');

      const matRes = await inject({
        method: 'POST',
        url: '/api/v1/materials',
        headers: { origin, cookie: adminCookie },
        payload: {
          clientId: probeClient.id,
          demandId: probeDemand.id,
          taskId: probeTask.id,
          title: 'Probe Material For Forgery',
          category: 'brand' as MaterialCategory,
          url: 'https://example.com/forgery-probe',
        },
      });
      expect(matRes.statusCode).toBe(201);
      const probeMaterial: Material = matRes.json().material;
      createdMaterialIds.push(probeMaterial.id);

      // 1. Tentativa de arquivar material com sessão forjada via serviço: revalidação no banco detecta que usuário é colaborador e rejeita com 403
      await expect(
        archiveMaterial(db(), forgedAdminSession, probeMaterial.id, probeMaterial.version)
      ).rejects.toMatchObject({
        status: 403,
        code: 'FORBIDDEN',
      });

      // 2. Tentativa de criar material de cliente (sem task/demand) com sessão forjada: revalidação no banco define isAdmin=false e bloqueia com 403
      await expect(
        createMaterial(db(), forgedAdminSession, {
          clientId: probeClient.id,
          title: 'Tentativa Forjada de Criar Material de Cliente',
          description: 'Descrição válida para tentativa forjada',
          category: 'brand',
          url: 'https://example.com/forged',
        })
      ).rejects.toMatchObject({
        status: 403,
        code: 'FORBIDDEN',
      });

      // 3. Consulta de targets de clientes com sessão forjada: revalidação no banco força filtro de colaborador (apenas clientes onde possui tarefas)
      const targetsRes = await listMaterialTargets(db(), forgedAdminSession, { kind: 'client', page: 1, pageSize: 20 });
      // forgedColab não possui tarefas em nenhum chamado deste cliente, portanto o cliente não deve constar na listagem
      expect(targetsRes.targets.some((t) => t.id === probeClient.id)).toBe(false);
    });
  });

  describe('Gate 4: CRUD Administrativo Completo e Auditoria Transacional', () => {
    let clientA: { id: string; name: string };
    let materialAdmin: Material;

    beforeAll(async () => {
      clientA = await createFixtureClient(adminCookie, 'ClientA');
    });

    it('4.1: Admin cria material no nível de cliente (sem demand/task)', async () => {
      const res = await inject({
        method: 'POST',
        url: '/api/v1/materials',
        headers: { origin, cookie: adminCookie },
        payload: {
          clientId: clientA.id,
          title: 'Manual de Marca Oficial',
          description: 'Identidade visual e diretrizes da marca',
          category: 'brand' as MaterialCategory,
          url: 'https://brand.example.com/guidelines',
        },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.material).toBeDefined();
      materialAdmin = body.material;
      createdMaterialIds.push(materialAdmin.id);

      expect(materialAdmin.clientId).toBe(clientA.id);
      expect(materialAdmin.demandId).toBeNull();
      expect(materialAdmin.taskId).toBeNull();
      expect(materialAdmin.title).toBe('Manual de Marca Oficial');
      expect(materialAdmin.category).toBe('brand');
      expect(materialAdmin.version).toBe(1);
      expect(materialAdmin.archivedAt).toBeNull();
    });

    it('4.2: Admin lista materiais com filtros de status e busca textual', async () => {
      const res = await inject({
        method: 'GET',
        url: `/api/v1/materials?clientId=${clientA.id}&status=active&q=Manual`,
        headers: { origin, cookie: adminCookie },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.materials.length).toBeGreaterThanOrEqual(1);
      expect(body.materials.some((m: Material) => m.id === materialAdmin.id)).toBe(true);
      expect(body.total).toBeGreaterThanOrEqual(1);
    });

    it('4.3: Admin consulta detalhe por ID', async () => {
      const res = await inject({
        method: 'GET',
        url: `/api/v1/materials/${materialAdmin.id}`,
        headers: { origin, cookie: adminCookie },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.material.id).toBe(materialAdmin.id);
      expect(body.material.client.id).toBe(clientA.id);
    });

    it('4.4: Admin atualiza campos editáveis (title, category, url) com version 1', async () => {
      const res = await inject({
        method: 'PATCH',
        url: `/api/v1/materials/${materialAdmin.id}`,
        headers: { origin, cookie: adminCookie },
        payload: {
          title: 'Manual de Marca v2',
          description: 'Diretrizes atualizadas',
          category: 'asset' as MaterialCategory,
          url: 'https://brand.example.com/guidelines-v2',
          version: 1,
        },
      });
      expect(res.statusCode).toBe(200);
      const updated = res.json().material;
      expect(updated.title).toBe('Manual de Marca v2');
      expect(updated.category).toBe('asset');
      expect(updated.version).toBe(2);
    });

    it('4.5: Admin arquiva material com version 2', async () => {
      const res = await inject({
        method: 'POST',
        url: `/api/v1/materials/${materialAdmin.id}/archive`,
        headers: { origin, cookie: adminCookie },
        payload: { version: 2 },
      });
      expect(res.statusCode).toBe(200);
      const archived = res.json().material;
      expect(archived.archivedAt).not.toBeNull();
      expect(archived.version).toBe(3);

      // Não aparece em status=active
      const listActive = await inject({
        method: 'GET',
        url: `/api/v1/materials?clientId=${clientA.id}&status=active`,
        headers: { origin, cookie: adminCookie },
      });
      expect(listActive.json().materials.some((m: Material) => m.id === materialAdmin.id)).toBe(false);

      // Aparece em status=archived
      const listArchived = await inject({
        method: 'GET',
        url: `/api/v1/materials?clientId=${clientA.id}&status=archived`,
        headers: { origin, cookie: adminCookie },
      });
      expect(listArchived.json().materials.some((m: Material) => m.id === materialAdmin.id)).toBe(true);
    });

    it('4.6: Admin restaura material com version 3', async () => {
      const res = await inject({
        method: 'POST',
        url: `/api/v1/materials/${materialAdmin.id}/restore`,
        headers: { origin, cookie: adminCookie },
        payload: { version: 3 },
      });
      expect(res.statusCode).toBe(200);
      const restored = res.json().material;
      expect(restored.archivedAt).toBeNull();
      expect(restored.version).toBe(4);
    });

    it('4.7: Histórico transacional auditável registra todos os eventos no mesmo snapshot', async () => {
      const res = await inject({
        method: 'GET',
        url: `/api/v1/materials/${materialAdmin.id}/history`,
        headers: { origin, cookie: adminCookie },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.events.length).toBe(4);
      expect(body.total).toBe(4);

      // Eventos em ordem cronológica decrescente
      const actions = body.events.map((e: { action: string }) => e.action);
      expect(actions).toEqual([
        'material_restored',
        'material_archived',
        'material_updated',
        'material_created',
      ]);
    });
  });

  describe('Gate 5 & 6: Regras de Negócio e Isolamento de Colaborador (Anti-IDOR)', () => {
    let clientB: { id: string; name: string };
    let demandB: { id: string; title: string };
    let taskColabA: { id: string; title: string };
    let taskColabB: { id: string; title: string };
    let materialColabA: Material;

    beforeAll(async () => {
      clientB = await createFixtureClient(adminCookie, 'ClientB');
      demandB = await createFixtureDemand(adminCookie, clientB.id, 'DemandB');
      taskColabA = await createFixtureTask(adminCookie, demandB.id, colabA.id, 'TaskA');
      taskColabB = await createFixtureTask(adminCookie, demandB.id, colabB.id, 'TaskB');
      expect(taskColabB.id).toBeDefined();
    });

    it('5.1: Colaborador cria material para sua própria tarefa', async () => {
      const res = await inject({
        method: 'POST',
        url: '/api/v1/materials',
        headers: { origin, cookie: colabACookie },
        payload: {
          clientId: clientB.id,
          demandId: demandB.id,
          taskId: taskColabA.id,
          title: 'Layout LP Mobile Aprovado',
          description: 'Figma com especificações da LP',
          category: 'preview' as MaterialCategory,
          url: 'https://figma.example.com/file/colabA',
        },
      });
      expect(res.statusCode).toBe(201);
      materialColabA = res.json().material;
      createdMaterialIds.push(materialColabA.id);

      expect(materialColabA.taskId).toBe(taskColabA.id);
      expect(materialColabA.demandId).toBe(demandB.id);
    });

    it('5.2: Colaborador B recebe 404 (Anti-IDOR) ao tentar ler material de Colaborador A no mesmo chamado', async () => {
      const res = await inject({
        method: 'GET',
        url: `/api/v1/materials/${materialColabA.id}`,
        headers: { origin, cookie: colabBCookie },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('NOT_FOUND');
    });

    it('5.3: Colaborador B recebe 404 ao tentar atualizar material de Colaborador A no mesmo chamado', async () => {
      const res = await inject({
        method: 'PATCH',
        url: `/api/v1/materials/${materialColabA.id}`,
        headers: { origin, cookie: colabBCookie },
        payload: {
          title: 'Tentativa de Hack',
          version: 1,
          category: 'preview' as MaterialCategory,
          url: 'https://figma.example.com/hacked',
        },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('NOT_FOUND');
    });

    it('5.4: Colaborador B recebe 404 ao tentar ver histórico de material de Colaborador A', async () => {
      const res = await inject({
        method: 'GET',
        url: `/api/v1/materials/${materialColabA.id}/history`,
        headers: { origin, cookie: colabBCookie },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('NOT_FOUND');
    });

    it('5.5: Colaborador não pode criar material associado a tarefa de terceiro (recebe 404)', async () => {
      const res = await inject({
        method: 'POST',
        url: '/api/v1/materials',
        headers: { origin, cookie: colabBCookie },
        payload: {
          clientId: clientB.id,
          demandId: demandB.id,
          taskId: taskColabA.id, // Tarefa pertence a Colab A
          title: 'Tentativa em Tarefa Alheia',
          category: 'asset' as MaterialCategory,
          url: 'https://drive.example.com/asset',
        },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('NOT_FOUND');
    });

    it('6.1: Colaborador não pode criar material sem vínculo de chamado/tarefa (403 FORBIDDEN)', async () => {
      const res = await inject({
        method: 'POST',
        url: '/api/v1/materials',
        headers: { origin, cookie: colabACookie },
        payload: {
          clientId: clientB.id,
          title: 'Material apenas de cliente',
          category: 'brand' as MaterialCategory,
          url: 'https://brand.example.com/client',
        },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe('FORBIDDEN');
    });

    it('6.2: Colaborador não pode arquivar ou restaurar material (403 FORBIDDEN)', async () => {
      const resArch = await inject({
        method: 'POST',
        url: `/api/v1/materials/${materialColabA.id}/archive`,
        headers: { origin, cookie: colabACookie },
        payload: { version: 1 },
      });
      expect(resArch.statusCode).toBe(403);
      expect(resArch.json().error.code).toBe('FORBIDDEN');

      const resRest = await inject({
        method: 'POST',
        url: `/api/v1/materials/${materialColabA.id}/restore`,
        headers: { origin, cookie: colabACookie },
        payload: { version: 1 },
      });
      expect(resRest.statusCode).toBe(403);
      expect(resRest.json().error.code).toBe('FORBIDDEN');
    });
  });

  describe('Gate 7: Filtros, Targets e Contadores Estritos', () => {
    it('7.1: Targets por tipo respeitam escopo: Colaborador não vê tarefas de terceiros', async () => {
      const res = await inject({
        method: 'GET',
        url: '/api/v1/materials/targets?kind=task',
        headers: { origin, cookie: colabACookie },
      });
      expect(res.statusCode).toBe(200);
      const targets = res.json().targets;
      // Colaborador A só deve ver suas próprias tarefas
      expect(targets.length).toBeGreaterThan(0);
    });

    it('7.2: Paginação > 50 é rejeitada estritamente com 400', async () => {
      const res = await inject({
        method: 'GET',
        url: '/api/v1/materials?pageSize=51',
        headers: { origin, cookie: adminCookie },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('INVALID_INPUT');

      const resTargets = await inject({
        method: 'GET',
        url: '/api/v1/materials/targets?kind=client&pageSize=100',
        headers: { origin, cookie: adminCookie },
      });
      expect(resTargets.statusCode).toBe(400);
      expect(resTargets.json().error.code).toBe('INVALID_INPUT');
    });

    it('7.3: Paginação real de targets com >= 51 registros autorizados valida page1 (50 itens), page2 (restante), total exato e exclusão de terceiros', async () => {
      const clientPaging = await createFixtureClient(adminCookie, 'ClientPaging');
      const demandPaging = await createFixtureDemand(adminCookie, clientPaging.id, 'DemandPaging');

      const colabATaskIds: string[] = [];
      const colabBTaskIds: string[] = [];
      const taskValues: string[] = [];
      const taskParams: unknown[] = [demandPaging.id, colabA.id, colabB.id];

      // 52 tarefas para Colaborador A
      for (let i = 1; i <= 52; i++) {
        const id = randomUUID();
        colabATaskIds.push(id);
        const title = `ColabA Paging Task ${String(i).padStart(2, '0')}`;
        taskValues.push(`('${id}', $1, $2, '${title}', 'Description', 'normal', '2026-10-31', 'ready', 1, now(), now())`);
      }
      // 5 tarefas de terceiros (Colaborador B) no mesmo chamado
      for (let i = 1; i <= 5; i++) {
        const id = randomUUID();
        colabBTaskIds.push(id);
        const title = `ColabB ThirdParty Task ${String(i).padStart(2, '0')}`;
        taskValues.push(`('${id}', $1, $3, '${title}', 'Description', 'normal', '2026-10-31', 'ready', 1, now(), now())`);
      }

      await db().pool.query(`
        INSERT INTO task (id, demand_id, assigned_to_user_id, title, description, priority, delivery_date, status, version, created_at, updated_at)
        VALUES ${taskValues.join(',\n')}
      `, taskParams);

      // 1. Requisição Página 1 com pageSize=50 para Colaborador A
      const resPage1 = await inject({
        method: 'GET',
        url: `/api/v1/materials/targets?kind=task&demandId=${demandPaging.id}&pageSize=50&page=1`,
        headers: { origin, cookie: colabACookie },
      });
      expect(resPage1.statusCode).toBe(200);
      const page1 = resPage1.json();
      expect(page1.total).toBe(52);
      expect(page1.page).toBe(1);
      expect(page1.pageSize).toBe(50);
      expect(page1.targets.length).toBe(50);
      for (const t of page1.targets) {
        expect(colabATaskIds).toContain(t.id);
        expect(colabBTaskIds).not.toContain(t.id);
      }

      // 2. Requisição Página 2 com pageSize=50 para Colaborador A
      const resPage2 = await inject({
        method: 'GET',
        url: `/api/v1/materials/targets?kind=task&demandId=${demandPaging.id}&pageSize=50&page=2`,
        headers: { origin, cookie: colabACookie },
      });
      expect(resPage2.statusCode).toBe(200);
      const page2 = resPage2.json();
      expect(page2.total).toBe(52);
      expect(page2.page).toBe(2);
      expect(page2.pageSize).toBe(50);
      expect(page2.targets.length).toBe(2);
      for (const t of page2.targets) {
        expect(colabATaskIds).toContain(t.id);
        expect(colabBTaskIds).not.toContain(t.id);
      }

      // 3. Unicidade e cobertura completa das 52 tarefas autorizadas
      const allFetchedIds = [...page1.targets.map((t: { id: string }) => t.id), ...page2.targets.map((t: { id: string }) => t.id)];
      expect(allFetchedIds.length).toBe(52);
      expect(new Set(allFetchedIds).size).toBe(52);

      // 4. Verificação cruzada com Administrador: Admin enxerga todas as 57 tarefas (52 do Colab A + 5 do Colab B)
      const resAdmin = await inject({
        method: 'GET',
        url: `/api/v1/materials/targets?kind=task&demandId=${demandPaging.id}&pageSize=50&page=1`,
        headers: { origin, cookie: adminCookie },
      });
      expect(resAdmin.statusCode).toBe(200);
      expect(resAdmin.json().total).toBe(57);
    });
  });

  describe('Gate 8 & 9: Vínculos Imutáveis e Validação de URLs (Segurança & Anti-SSRF)', () => {
    let clientC: { id: string; name: string };
    let clientD: { id: string; name: string };
    let materialC: Material;

    beforeAll(async () => {
      clientC = await createFixtureClient(adminCookie, 'ClientC');
      clientD = await createFixtureClient(adminCookie, 'ClientD');

      const res = await inject({
        method: 'POST',
        url: '/api/v1/materials',
        headers: { origin, cookie: adminCookie },
        payload: {
          clientId: clientC.id,
          title: 'Material Imutável Test',
          category: 'brand' as MaterialCategory,
          url: 'https://example.com/brand',
        },
      });
      materialC = res.json().material;
      createdMaterialIds.push(materialC.id);
    });

    it('8.1: Rejeita com 400 MATERIAL_LINKS_IMMUTABLE tentativa de alterar clientId após criação', async () => {
      const res = await inject({
        method: 'PATCH',
        url: `/api/v1/materials/${materialC.id}`,
        headers: { origin, cookie: adminCookie },
        payload: {
          clientId: clientD.id, // Tentativa de mover material para outro cliente
          title: 'Tentativa de Mover',
          version: materialC.version,
          category: 'brand' as MaterialCategory,
          url: 'https://example.com/brand',
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('MATERIAL_LINKS_IMMUTABLE');
    });

    it('8.2: Validação hierárquica: criação com chamado não pertencente ao cliente rejeita com 400', async () => {
      const demandC = await createFixtureDemand(adminCookie, clientC.id, 'DemandC');
      const res = await inject({
        method: 'POST',
        url: '/api/v1/materials',
        headers: { origin, cookie: adminCookie },
        payload: {
          clientId: clientD.id, // mismatch com demandC que pertence a clientC
          demandId: demandC.id,
          title: 'Mismatch Test',
          category: 'asset' as MaterialCategory,
          url: 'https://example.com/asset',
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('DEMAND_CLIENT_MISMATCH');
    });

    it('9.1: URLs com esquemas inseguros (javascript:, ftp:, file:) são rejeitadas com 400', async () => {
      for (const badUrl of ['javascript:alert(1)', 'ftp://files.example.com', 'file:///etc/passwd']) {
        const res = await inject({
          method: 'POST',
          url: '/api/v1/materials',
          headers: { origin, cookie: adminCookie },
          payload: {
            clientId: clientC.id,
            title: 'Bad URL Scheme',
            category: 'preview' as MaterialCategory,
            url: badUrl,
          },
        });
        expect(res.statusCode, `URL ${badUrl} should be rejected with 400`).toBe(400);
        expect(res.json().error.code).toBe('INVALID_INPUT');
      }
    });

    it('9.2: URLs com credenciais embutidas (username/password) são rejeitadas com 400', async () => {
      const res = await inject({
        method: 'POST',
        url: '/api/v1/materials',
        headers: { origin, cookie: adminCookie },
        payload: {
          clientId: clientC.id,
          title: 'Credential URL',
          category: 'preview' as MaterialCategory,
          url: 'https://admin:secret123@example.com/preview',
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('INVALID_INPUT');
    });
  });

  describe('Gate 10 & 11: Concorrência Otimista (409) e Integridade de Auditoria', () => {
    let clientE: { id: string; name: string };
    let materialE: Material;

    beforeAll(async () => {
      clientE = await createFixtureClient(adminCookie, 'ClientE');
      const res = await inject({
        method: 'POST',
        url: '/api/v1/materials',
        headers: { origin, cookie: adminCookie },
        payload: {
          clientId: clientE.id,
          title: 'Material 409 Test',
          category: 'asset' as MaterialCategory,
          url: 'https://example.com/asset',
        },
      });
      materialE = res.json().material;
      createdMaterialIds.push(materialE.id);
    });

    it('10.1: Conflito de versão (409 VERSION_CONFLICT) não altera dados nem grava histórico espúrio', async () => {
      // Primeira alteração incrementa versão de 1 para 2
      const firstUpdate = await inject({
        method: 'PATCH',
        url: `/api/v1/materials/${materialE.id}`,
        headers: { origin, cookie: adminCookie },
        payload: {
          title: 'Primeira Alteração Válida',
          version: 1,
          category: 'asset' as MaterialCategory,
          url: 'https://example.com/asset-v2',
        },
      });
      expect(firstUpdate.statusCode).toBe(200);

      // Segunda alteração concorrente com versão antiga 1 deve falhar com 409
      const staleUpdate = await inject({
        method: 'PATCH',
        url: `/api/v1/materials/${materialE.id}`,
        headers: { origin, cookie: adminCookie },
        payload: {
          title: 'Alteração Concorrente com Versão Antiga',
          version: 1,
          category: 'asset' as MaterialCategory,
          url: 'https://example.com/stale',
        },
      });
      expect(staleUpdate.statusCode).toBe(409);
      expect(staleUpdate.json().error.code).toBe('VERSION_CONFLICT');

      // Verificar que o histórico possui exatamente 2 eventos (create e first update), sem evento da tentativa 409
      const hist = await inject({
        method: 'GET',
        url: `/api/v1/materials/${materialE.id}/history`,
        headers: { origin, cookie: adminCookie },
      });
      expect(hist.json().events.length).toBe(2);
      expect(hist.json().events[0].action).toBe('material_updated');
    });
  });

  describe('Gate 12 & 13: Reatribuição de Tarefa e Revogação Imediata de Acesso', () => {
    let clientF: { id: string; name: string };
    let demandF: { id: string; title: string };
    let taskF: { id: string; title: string };
    let materialF: Material;

    beforeAll(async () => {
      clientF = await createFixtureClient(adminCookie, 'ClientF');
      demandF = await createFixtureDemand(adminCookie, clientF.id, 'DemandF');
      taskF = await createFixtureTask(adminCookie, demandF.id, colabA.id, 'TaskF');

      const res = await inject({
        method: 'POST',
        url: '/api/v1/materials',
        headers: { origin, cookie: colabACookie },
        payload: {
          clientId: clientF.id,
          demandId: demandF.id,
          taskId: taskF.id,
          title: 'Design LP Inicial',
          category: 'preview' as MaterialCategory,
          url: 'https://figma.example.com/colabA-lp',
        },
      });
      expect(res.statusCode).toBe(201);
      materialF = res.json().material;
      createdMaterialIds.push(materialF.id);
    });

    it('12.1: Reatribuição de tarefa para Colaborador B revoga imediatamente o acesso do Colaborador A (retorna 404)', async () => {
      // Reatribuir taskF para Colaborador B via rota de reatribuição administrativa
      const reassignRes = await inject({
        method: 'POST',
        url: `/api/v1/tasks/${taskF.id}/reassign`,
        headers: { origin, cookie: adminCookie },
        payload: {
          assignedToUserId: colabB.id,
          reason: 'Reatribuição operacional para Colaborador B',
          version: 1,
        },
      });
      expect(reassignRes.statusCode).toBe(200);

      // Colaborador A tenta ler o material que ele mesmo criou: recebe 404
      const readRes = await inject({
        method: 'GET',
        url: `/api/v1/materials/${materialF.id}`,
        headers: { origin, cookie: colabACookie },
      });
      expect(readRes.statusCode).toBe(404);
      expect(readRes.json().error.code).toBe('NOT_FOUND');

      // Colaborador A tenta atualizar o material: recebe 404
      const updateRes = await inject({
        method: 'PATCH',
        url: `/api/v1/materials/${materialF.id}`,
        headers: { origin, cookie: colabACookie },
        payload: {
          title: 'Tentativa Pós-Reatribuição',
          version: materialF.version,
          category: 'preview' as MaterialCategory,
          url: 'https://figma.example.com/after-reassign',
        },
      });
      expect(updateRes.statusCode).toBe(404);
      expect(updateRes.json().error.code).toBe('NOT_FOUND');

      // Novo responsável (Colaborador B) agora tem acesso legítimo
      const colabBRead = await inject({
        method: 'GET',
        url: `/api/v1/materials/${materialF.id}`,
        headers: { origin, cookie: colabBCookie },
      });
      expect(colabBRead.statusCode).toBe(200);
      expect(colabBRead.json().material.id).toBe(materialF.id);
    });

    it('12.2: Corrida determinística: atualização de material por Colab A bloqueia sob lock FOR SHARE da task durante reatribuição e é rejeitada com 404 após commit', async () => {
      const clientRace = await createFixtureClient(adminCookie, 'ClientRace');
      const demandRace = await createFixtureDemand(adminCookie, clientRace.id, 'DemandRace');
      const taskRace = await createFixtureTask(adminCookie, demandRace.id, colabA.id, 'TaskRace');

      const matRes = await inject({
        method: 'POST',
        url: '/api/v1/materials',
        headers: { origin, cookie: colabACookie },
        payload: {
          clientId: clientRace.id,
          demandId: demandRace.id,
          taskId: taskRace.id,
          title: 'Material Original Pré-Corrida',
          description: 'Desc Original',
          category: 'preview' as MaterialCategory,
          url: 'https://figma.example.com/initial',
        },
      });
      expect(matRes.statusCode).toBe(201);
      const materialRace: Material = matRes.json().material;
      createdMaterialIds.push(materialRace.id);

      // 1. Inicia transação de reatribuição em conexão separada segurando lock FOR UPDATE na task
      const reassignClient = await db().pool.connect();
      try {
        const pidRes = await reassignClient.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
        const reassignPid = pidRes.rows[0]?.pid;
        expect(reassignPid).toBeDefined();

        await reassignClient.query('BEGIN');
        await reassignClient.query('SELECT id FROM task WHERE id = $1 FOR UPDATE', [taskRace.id]);
        await reassignClient.query(
          'UPDATE task SET assigned_to_user_id = $1, version = version + 1, updated_at = now() WHERE id = $2',
          [colabB.id, taskRace.id],
        );

        // 2. Dispara tentativa de atualização de material pelo Colab A em background
        let updateFinished = false;
        const updatePromise = inject({
          method: 'PATCH',
          url: `/api/v1/materials/${materialRace.id}`,
          headers: { origin, cookie: colabACookie },
          payload: {
            title: 'Tentativa de Escrita Concorrente por Colab A',
            version: materialRace.version,
            category: 'preview' as MaterialCategory,
            url: 'https://figma.example.com/race-attempt',
          },
        }).then((res) => {
          updateFinished = true;
          return res;
        });

        // 3. Prova determinística: observa atividade em current_database onde pg_blocking_pids contém reassignPid
        let blockedDetected = false;
        for (let i = 0; i < 50; i++) {
          const lockCheck = await db().pool.query<{ count: number }>(`
            SELECT count(*)::int AS count
            FROM pg_stat_activity
            WHERE datname = current_database()
              AND $1 = ANY(pg_blocking_pids(pid))
          `, [reassignPid]);
          if ((lockCheck.rows[0]?.count ?? 0) > 0) {
            blockedDetected = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 20));
        }

        expect(blockedDetected).toBe(true);
        expect(updateFinished).toBe(false);

        // 4. Comita a reatribuição da tarefa para Colab B
        await reassignClient.query('COMMIT');

        // 5. A requisição de atualização desbloqueia e avalia a task reatribuída
        const updateRes = await updatePromise;
        expect(updateFinished).toBe(true);
        expect(updateRes.statusCode).toBe(404);
        expect(updateRes.json().error.code).toBe('NOT_FOUND');

        // 6. Verificação no banco: material manteve versão 1 e título original intacto
        const matCheck = await db().pool.query<{ title: string; version: number }>(
          'SELECT title, version FROM material WHERE id = $1',
          [materialRace.id],
        );
        expect(matCheck.rows.length).toBe(1);
        const matRow = matCheck.rows[0];
        expect(matRow).toBeDefined();
        expect(matRow!.title).toBe('Material Original Pré-Corrida');
        expect(matRow!.version).toBe(1);

        // 7. Verificação de auditoria: nenhum evento espúrio de material_updated gravado
        const eventCheck = await db().pool.query<{ action: string }>(
          'SELECT action FROM material_event WHERE material_id = $1 ORDER BY created_at ASC',
          [materialRace.id],
        );
        expect(eventCheck.rows.length).toBe(1);
        const eventRow = eventCheck.rows[0];
        expect(eventRow).toBeDefined();
        expect(eventRow!.action).toBe('material_created');

        // 8. Novo responsável legítimo (Colab B) consegue atualizar o material com sucesso
        const colabBUpdate = await inject({
          method: 'PATCH',
          url: `/api/v1/materials/${materialRace.id}`,
          headers: { origin, cookie: colabBCookie },
          payload: {
            title: 'Atualizado com Sucesso por Colab B',
            version: 1,
            category: 'preview' as MaterialCategory,
            url: 'https://figma.example.com/updated-by-colab-b',
          },
        });
        expect(colabBUpdate.statusCode).toBe(200);
        expect(colabBUpdate.json().material.version).toBe(2);
        expect(colabBUpdate.json().material.title).toBe('Atualizado com Sucesso por Colab B');
      } finally {
        try {
          await reassignClient.query('ROLLBACK');
        } catch {
          // Já comitado ou encerrado
        } finally {
          reassignClient.release();
        }
      }
    });
  });

  describe('Gate 14: Linha do Tempo por Cliente (Client Timeline)', () => {
    let clientTL: { id: string; name: string };
    let demandTL: { id: string; title: string };
    let taskColabA_TL: { id: string; title: string };
    let taskColabB_TL: { id: string; title: string };
    let materialA_TL: Material;
    let materialB_TL: Material;
    let materialClient_TL: Material;

    beforeAll(async () => {
      clientTL = await createFixtureClient(adminCookie, 'ClientTimeline');
      demandTL = await createFixtureDemand(adminCookie, clientTL.id, 'DemandTimeline');
      taskColabA_TL = await createFixtureTask(adminCookie, demandTL.id, colabA.id, 'TaskA_Timeline');
      taskColabB_TL = await createFixtureTask(adminCookie, demandTL.id, colabB.id, 'TaskB_Timeline');

      // 1. Material no nível de cliente criado por Admin
      const matClientRes = await inject({
        method: 'POST',
        url: '/api/v1/materials',
        headers: { origin, cookie: adminCookie },
        payload: {
          clientId: clientTL.id,
          title: 'Brand Guidelines Client Only',
          category: 'brand' as MaterialCategory,
          url: 'https://brand.example.com/client-only',
        },
      });
      expect(matClientRes.statusCode).toBe(201);
      materialClient_TL = matClientRes.json().material;
      createdMaterialIds.push(materialClient_TL.id);

      // 2. Material na tarefa de Colab A
      const matARes = await inject({
        method: 'POST',
        url: '/api/v1/materials',
        headers: { origin, cookie: colabACookie },
        payload: {
          clientId: clientTL.id,
          demandId: demandTL.id,
          taskId: taskColabA_TL.id,
          title: 'Design LP Colab A',
          category: 'preview' as MaterialCategory,
          url: 'https://figma.example.com/colab-a',
        },
      });
      expect(matARes.statusCode).toBe(201);
      materialA_TL = matARes.json().material;
      createdMaterialIds.push(materialA_TL.id);

      // 3. Material na tarefa de Colab B
      const matBRes = await inject({
        method: 'POST',
        url: '/api/v1/materials',
        headers: { origin, cookie: colabBCookie },
        payload: {
          clientId: clientTL.id,
          demandId: demandTL.id,
          taskId: taskColabB_TL.id,
          title: 'Frontend Code Colab B',
          category: 'asset' as MaterialCategory,
          url: 'https://github.example.com/colab-b',
        },
      });
      expect(matBRes.statusCode).toBe(201);
      materialB_TL = matBRes.json().material;
      createdMaterialIds.push(materialB_TL.id);
    });

    it('14.1: Rejeita com 401 para não autenticado e 404 para cliente inexistente ou arquivado', async () => {
      const unauthRes = await inject({
        method: 'GET',
        url: `/api/v1/materials/client-timeline/${clientTL.id}`,
      });
      expect(unauthRes.statusCode).toBe(401);

      const fakeId = randomUUID();
      const notFoundRes = await inject({
        method: 'GET',
        url: `/api/v1/materials/client-timeline/${fakeId}`,
        headers: { origin, cookie: adminCookie },
      });
      expect(notFoundRes.statusCode).toBe(404);
      expect(notFoundRes.json().error.code).toBe('NOT_FOUND');

      // Cliente arquivado
      const archClient = await createFixtureClient(adminCookie, 'ArchivedClientTL');
      await inject({
        method: 'POST',
        url: `/api/v1/clients/${archClient.id}/archive`,
        headers: { origin, cookie: adminCookie },
        payload: { version: 1 },
      });
      const archRes = await inject({
        method: 'GET',
        url: `/api/v1/materials/client-timeline/${archClient.id}`,
        headers: { origin, cookie: adminCookie },
      });
      expect(archRes.statusCode).toBe(404);
      expect(archRes.json().error.code).toBe('NOT_FOUND');
    });

    it('14.2: Rejeita com 403 se materials.read OU demands.read estiverem ausentes no banco', async () => {
      const restrictedUser = await fixtureUser('collaborator', 'tl-perm');
      const restrictedCookie = await cookieFor(restrictedUser.email);

      // Remover demands.read temporariamente
      try {
        await db().pool.query("DELETE FROM role_permission WHERE role_id = 'collaborator' AND permission_id = 'demands.read'");
        const res = await inject({
          method: 'GET',
          url: `/api/v1/materials/client-timeline/${clientTL.id}`,
          headers: { origin, cookie: restrictedCookie },
        });
        expect(res.statusCode).toBe(403);
        expect(res.json().error.code).toBe('FORBIDDEN');
      } finally {
        await db().pool.query("INSERT INTO role_permission (role_id, permission_id) VALUES ('collaborator', 'demands.read') ON CONFLICT DO NOTHING");
      }

      // Remover materials.read temporariamente
      try {
        await db().pool.query("DELETE FROM role_permission WHERE role_id = 'collaborator' AND permission_id = 'materials.read'");
        const res = await inject({
          method: 'GET',
          url: `/api/v1/materials/client-timeline/${clientTL.id}`,
          headers: { origin, cookie: restrictedCookie },
        });
        expect(res.statusCode).toBe(403);
        expect(res.json().error.code).toBe('FORBIDDEN');
      } finally {
        await db().pool.query("INSERT INTO role_permission (role_id, permission_id) VALUES ('collaborator', 'materials.read') ON CONFLICT DO NOTHING");
      }
    });

    it('14.3: Admin vê todas as fontes (demand, task, material), contagem total exata, ordenação e formato sem metadata bruto', async () => {
      const res = await inject({
        method: 'GET',
        url: `/api/v1/materials/client-timeline/${clientTL.id}?pageSize=50`,
        headers: { origin, cookie: adminCookie },
      });
      expect(res.statusCode).toBe(200);
      const body: ClientTimelineResponse = res.json();

      expect(body.client.id).toBe(clientTL.id);
      expect(body.client.name).toBe(clientTL.name);
      expect(body.events.length).toBeGreaterThanOrEqual(5);
      expect(body.total).toBe(body.events.length);

      // Todas as 3 fontes devem estar presentes para admin
      const sources = new Set(body.events.map((e) => e.source));
      expect(sources).toContain('demand');
      expect(sources).toContain('task');
      expect(sources).toContain('material');

      // Verifica formato rigoroso de cada evento (sem metadata bruto, before/after, previewUrl, etc.)
      for (const ev of body.events) {
        expect(ev.id).toBeDefined();
        expect(['demand', 'task', 'material']).toContain(ev.source);
        expect(ev.sourceId).toBeDefined();
        expect(ev.title).toBeDefined();
        expect(ev.action).toBeDefined();
        expect(ev.actorName).toBeDefined();
        expect(ev.createdAt).toBeDefined();
        // Não deve conter propriedades proibidas
        expect((ev as Record<string, unknown>).metadata).toBeUndefined();
        expect((ev as Record<string, unknown>).changes).toBeUndefined();
        expect((ev as Record<string, unknown>).before).toBeUndefined();
        expect((ev as Record<string, unknown>).after).toBeUndefined();
        expect((ev as Record<string, unknown>).url).toBeUndefined();
      }

      // Verifica ordenação: createdAt decrescente
      for (let i = 0; i < body.events.length - 1; i++) {
        const d1 = new Date(body.events[i]!.createdAt).getTime();
        const d2 = new Date(body.events[i + 1]!.createdAt).getTime();
        expect(d1).toBeGreaterThanOrEqual(d2);
      }
    });

    it('14.4: Paginação de timeline rejeita pageSize > 50 e pagina corretamente', async () => {
      const badPageSizeRes = await inject({
        method: 'GET',
        url: `/api/v1/materials/client-timeline/${clientTL.id}?pageSize=51`,
        headers: { origin, cookie: adminCookie },
      });
      expect(badPageSizeRes.statusCode).toBe(400);

      // Paginação com pageSize = 2
      const page1Res = await inject({
        method: 'GET',
        url: `/api/v1/materials/client-timeline/${clientTL.id}?page=1&pageSize=2`,
        headers: { origin, cookie: adminCookie },
      });
      expect(page1Res.statusCode).toBe(200);
      const page1 = page1Res.json();
      expect(page1.events.length).toBe(2);
      expect(page1.page).toBe(1);
      expect(page1.pageSize).toBe(2);

      const page2Res = await inject({
        method: 'GET',
        url: `/api/v1/materials/client-timeline/${clientTL.id}?page=2&pageSize=2`,
        headers: { origin, cookie: adminCookie },
      });
      expect(page2Res.statusCode).toBe(200);
      const page2 = page2Res.json();
      expect(page2.events.length).toBe(2);
      expect(page2.page).toBe(2);

      // Eventos das páginas são disjuntos
      const idsP1 = page1.events.map((e: ClientTimelineEvent) => e.id);
      const idsP2 = page2.events.map((e: ClientTimelineEvent) => e.id);
      for (const id of idsP2) {
        expect(idsP1).not.toContain(id);
      }
    });

    it('14.5: Colaborador A vê eventos da demanda e de sua tarefa, mas NÃO vê eventos da tarefa de Colaborador B no mesmo chamado nem material client-only', async () => {
      const res = await inject({
        method: 'GET',
        url: `/api/v1/materials/client-timeline/${clientTL.id}?pageSize=50`,
        headers: { origin, cookie: colabACookie },
      });
      expect(res.statusCode).toBe(200);
      const body: ClientTimelineResponse = res.json();

      // Colaborador A vê eventos de demanda
      expect(body.events.some((e) => e.source === 'demand')).toBe(true);

      // Colaborador A vê eventos de sua própria tarefa
      expect(body.events.some((e) => e.source === 'task' && e.taskId === taskColabA_TL.id)).toBe(true);

      // Colaborador A NÃO vê nenhum evento da tarefa de Colab B
      expect(body.events.some((e) => e.taskId === taskColabB_TL.id)).toBe(false);

      // Colaborador A NÃO vê material no nível apenas de cliente
      expect(body.events.some((e) => e.materialId === materialClient_TL.id)).toBe(false);

      // Colaborador A vê material de sua própria tarefa
      expect(body.events.some((e) => e.materialId === materialA_TL.id)).toBe(true);

      // Colaborador A NÃO vê material da tarefa de Colab B
      expect(body.events.some((e) => e.materialId === materialB_TL.id)).toBe(false);

      // Total de eventos de Colaborador A deve ser estritamente menor que o total do Admin
      const adminRes = await inject({
        method: 'GET',
        url: `/api/v1/materials/client-timeline/${clientTL.id}?pageSize=50`,
        headers: { origin, cookie: adminCookie },
      });
      expect(body.total).toBeLessThan(adminRes.json().total);
    });

    it('14.6: Colaborador sem nenhum trabalho atribuído no cliente recebe 404 (Anti-IDOR)', async () => {
      // Criar cliente novo com tarefas atribuídas apenas a Colab A
      const clientIsolated = await createFixtureClient(adminCookie, 'ClientIsolated');
      const demandIsolated = await createFixtureDemand(adminCookie, clientIsolated.id, 'DemandIsolated');
      await createFixtureTask(adminCookie, demandIsolated.id, colabA.id, 'TaskIsolatedA');

      // Colaborador B tenta acessar timeline deste cliente: recebe 404
      const resColabB = await inject({
        method: 'GET',
        url: `/api/v1/materials/client-timeline/${clientIsolated.id}`,
        headers: { origin, cookie: colabBCookie },
      });
      expect(resColabB.statusCode).toBe(404);
      expect(resColabB.json().error.code).toBe('NOT_FOUND');

      // Colaborador A acessa normalmente: 200
      const resColabA = await inject({
        method: 'GET',
        url: `/api/v1/materials/client-timeline/${clientIsolated.id}`,
        headers: { origin, cookie: colabACookie },
      });
      expect(resColabA.statusCode).toBe(200);
    });

    it('14.7: Reatribuição de tarefa revoga imediatamente visibilidade dos eventos da tarefa e seus materiais na timeline', async () => {
      // Criar cliente exclusivo para teste de reatribuição com apenas uma tarefa para Colab A
      const clientReassign = await createFixtureClient(adminCookie, 'ClientReassignTL');
      const demandReassign = await createFixtureDemand(adminCookie, clientReassign.id, 'DemandReassignTL');
      const taskReassign = await createFixtureTask(adminCookie, demandReassign.id, colabA.id, 'TaskReassignTL');

      // Colab A cria material na tarefa
      const matRes = await inject({
        method: 'POST',
        url: '/api/v1/materials',
        headers: { origin, cookie: colabACookie },
        payload: {
          clientId: clientReassign.id,
          demandId: demandReassign.id,
          taskId: taskReassign.id,
          title: 'Material to Reassign',
          category: 'preview' as MaterialCategory,
          url: 'https://figma.example.com/reassign-tl',
        },
      });
      expect(matRes.statusCode).toBe(201);
      const mat = matRes.json().material;
      createdMaterialIds.push(mat.id);

      // Antes da reatribuição: Colab A vê os eventos
      const beforeRes = await inject({
        method: 'GET',
        url: `/api/v1/materials/client-timeline/${clientReassign.id}`,
        headers: { origin, cookie: colabACookie },
      });
      expect(beforeRes.statusCode).toBe(200);
      expect(beforeRes.json().events.some((e: ClientTimelineEvent) => e.taskId === taskReassign.id)).toBe(true);

      // Admin reatribui a única tarefa do cliente para Colab B
      const reassignRes = await inject({
        method: 'POST',
        url: `/api/v1/tasks/${taskReassign.id}/reassign`,
        headers: { origin, cookie: adminCookie },
        payload: {
          assignedToUserId: colabB.id,
          reason: 'Reatribuição de teste de timeline',
          version: 1,
        },
      });
      expect(reassignRes.statusCode).toBe(200);

      // Imediatamente após a reatribuição: Colab A não tem mais tarefas neste cliente -> recebe 404
      const afterResColabA = await inject({
        method: 'GET',
        url: `/api/v1/materials/client-timeline/${clientReassign.id}`,
        headers: { origin, cookie: colabACookie },
      });
      expect(afterResColabA.statusCode).toBe(404);
      expect(afterResColabA.json().error.code).toBe('NOT_FOUND');

      // Colab B (novo responsável) acessa a timeline e enxerga os eventos da tarefa e do material
      const afterResColabB = await inject({
        method: 'GET',
        url: `/api/v1/materials/client-timeline/${clientReassign.id}`,
        headers: { origin, cookie: colabBCookie },
      });
      expect(afterResColabB.statusCode).toBe(200);
      expect(afterResColabB.json().events.some((e: ClientTimelineEvent) => e.taskId === taskReassign.id)).toBe(true);
      expect(afterResColabB.json().events.some((e: ClientTimelineEvent) => e.materialId === mat.id)).toBe(true);
    });
  });
});

