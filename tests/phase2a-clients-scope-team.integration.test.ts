import { randomBytes, randomUUID } from 'node:crypto';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  clientListResponseSchema,
  clientResponseSchema,
  clientScopeItemResponseSchema,
  clientScopeListResponseSchema,
  clientTeamListResponseSchema,
  clientTeamMemberResponseSchema,
  type Client,
  type Role,
} from '@orium/contracts';
import { buildApp } from '../apps/api/src/app.js';
import { loadConfig } from '../apps/api/src/config.js';
import { connectDatabase, assertApplicationDatabase, type Database } from '../apps/api/src/db.js';
import { migrateDatabase } from '../apps/api/src/migrate.js';
import { provisionUser } from '../apps/api/src/identity.js';

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

describe('Fase 2A — Clientes Avançados, Escopo Contratado, Equipe e Row-Level RBAC (PostgreSQL real)', () => {
  let app: FastifyInstance | undefined;
  let database: Database | undefined;
  let migrationUrl: string;
  let admin: { id: string; email: string };
  let collabDesigner: { id: string; email: string };
  let collabAccountMgr: { id: string; email: string };
  let collabUnassigned: { id: string; email: string };

  const userPrefix = `p2a-user-${randomUUID().slice(0, 8)}-`;
  const clientPrefix = `p2a-client-${randomUUID().slice(0, 8)}-`;
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
      remoteAddress: `127.4.${Math.floor(requestIndex / 250)}.${(requestIndex % 250) + 1}`,
    });
  };

  const fixtureUser = async (role: Role, label: string) => {
    const email = `${userPrefix}${label}-${randomUUID().slice(0, 6)}@example.test`;
    const created = await provisionUser(db(), { name: `Phase2A ${label}`, email, password, role });
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

    admin = await fixtureUser('administrator', 'admin');
    collabDesigner = await fixtureUser('collaborator', 'designer');
    collabAccountMgr = await fixtureUser('collaborator', 'account-mgr');
    collabUnassigned = await fixtureUser('collaborator', 'unassigned');
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

            if (createdClientIds.length > 0) {
              await cleanupClient.query('DELETE FROM client_scope_item WHERE client_id = ANY($1)', [createdClientIds]);
              await cleanupClient.query('DELETE FROM client_team_member WHERE client_id = ANY($1)', [createdClientIds]);
              await cleanupClient.query('DELETE FROM client WHERE id = ANY($1)', [createdClientIds]);
            }

            const users = (
              await cleanupClient.query<{ id: string }>(
                'SELECT id FROM auth_user WHERE left(email, length($1)) = $1',
                [userPrefix],
              )
            ).rows.map((r) => r.id);

            if (users.length > 0) {
              await cleanupClient.query(
                'DELETE FROM identity_event WHERE actor_id = ANY($1::text[]) OR target_user_id = ANY($1::text[])',
                [users],
              );
              await cleanupClient.query('DELETE FROM identity_event_subject WHERE user_id = ANY($1::text[])', [users]);
              await cleanupClient.query('DELETE FROM auth_user WHERE id = ANY($1::text[])', [users]);
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

  it('1. Cria e evolui cliente com metadados operacionais de agência (contract_status, links, active_channels, account_manager)', async () => {
    const adminCookie = await cookieFor(admin.email);

    const createRes = await inject({
      method: 'POST',
      url: '/api/v1/clients',
      headers: { origin, cookie: adminCookie },
      payload: {
        name: `${clientPrefix}Agência Alpha`,
        contactName: 'Marina Diretora',
        email: 'marina@alpha.test',
        phone: '+55 65 99999-1111',
        notes: 'Cliente full-service Orium',
        contractStatus: 'onboarding',
        segment: 'Saúde & Estética',
        accountManagerUserId: collabAccountMgr.id,
        briefingSummary: 'Posicionamento premium em Cuiabá, foco em captação via Meta Ads e Reels.',
        brandKitUrl: 'https://www.figma.com/file/alpha-brand-kit',
        driveFolderUrl: 'https://drive.google.com/drive/folders/alpha-assets',
        activeChannels: ['instagram', 'meta_ads', 'google_ads'],
      },
    });

    expect(createRes.statusCode).toBe(201);
    const created = clientResponseSchema.parse(createRes.json()).client;
    createdClientIds.push(created.id);

    expect(created.contractStatus).toBe('onboarding');
    expect(created.segment).toBe('Saúde & Estética');
    expect(created.accountManagerUserId).toBe(collabAccountMgr.id);
    expect(created.briefingSummary).toContain('Posicionamento premium');
    expect(created.brandKitUrl).toBe('https://www.figma.com/file/alpha-brand-kit');
    expect(created.driveFolderUrl).toBe('https://drive.google.com/drive/folders/alpha-assets');
    expect(created.activeChannels).toEqual(['instagram', 'meta_ads', 'google_ads']);
    expect(created.onboardingCompletedAt).toBeNull();
    expect(created.version).toBe(1);

    // Evolui para active com onboardingCompletedAt e novo canal
    const onboardingTimestamp = new Date().toISOString();
    const patchRes = await inject({
      method: 'PATCH',
      url: `/api/v1/clients/${created.id}`,
      headers: { origin, cookie: adminCookie },
      payload: {
        version: 1,
        contractStatus: 'active',
        activeChannels: ['instagram', 'meta_ads', 'google_ads', 'tiktok'],
        onboardingCompletedAt: onboardingTimestamp,
      },
    });

    expect(patchRes.statusCode).toBe(200);
    const updated = clientResponseSchema.parse(patchRes.json()).client;
    expect(updated.contractStatus).toBe('active');
    expect(updated.activeChannels).toEqual(['instagram', 'meta_ads', 'google_ads', 'tiktok']);
    expect(updated.onboardingCompletedAt).not.toBeNull();
    expect(updated.version).toBe(2);
  });

  it('2. Gerencia alocação de equipe (client_team_member) e itens de escopo contratado (client_scope_item) com controle de concorrência', async () => {
    const adminCookie = await cookieFor(admin.email);
    const collabCookie = await cookieFor(collabDesigner.email);

    const clientRes = await inject({
      method: 'POST',
      url: '/api/v1/clients',
      headers: { origin, cookie: adminCookie },
      payload: {
        name: `${clientPrefix}Cliente Escopo & Equipe`,
        contractStatus: 'active',
      },
    });
    expect(clientRes.statusCode).toBe(201);
    const client = clientResponseSchema.parse(clientRes.json()).client;
    createdClientIds.push(client.id);

    // Colaborador não pode alocar equipe (requer clients.team.manage) -> 403
    const deniedTeamRes = await inject({
      method: 'POST',
      url: `/api/v1/clients/${client.id}/team`,
      headers: { origin, cookie: collabCookie },
      payload: {
        userId: collabDesigner.id,
        functionalRole: 'designer',
      },
    });
    expect(deniedTeamRes.statusCode).toBe(403);

    // Admin aloca Designer e Account Manager na equipe do cliente
    const addDesignerRes = await inject({
      method: 'POST',
      url: `/api/v1/clients/${client.id}/team`,
      headers: { origin, cookie: adminCookie },
      payload: {
        userId: collabDesigner.id,
        functionalRole: 'designer',
        isPrimary: true,
        canCreateDemands: false,
      },
    });
    expect(addDesignerRes.statusCode).toBe(201);
    const designerMember = clientTeamMemberResponseSchema.parse(addDesignerRes.json()).member;
    expect(designerMember.clientId).toBe(client.id);
    expect(designerMember.userId).toBe(collabDesigner.id);
    expect(designerMember.functionalRole).toBe('designer');
    expect(designerMember.isPrimary).toBe(true);

    const addAccountMgrRes = await inject({
      method: 'POST',
      url: `/api/v1/clients/${client.id}/team`,
      headers: { origin, cookie: adminCookie },
      payload: {
        userId: collabAccountMgr.id,
        functionalRole: 'account_manager',
        isPrimary: true,
        canCreateDemands: true,
      },
    });
    expect(addAccountMgrRes.statusCode).toBe(201);

    // Lista equipe do cliente
    const listTeamRes = await inject({
      method: 'GET',
      url: `/api/v1/clients/${client.id}/team`,
      headers: { cookie: adminCookie },
    });
    expect(listTeamRes.statusCode).toBe(200);
    const teamList = clientTeamListResponseSchema.parse(listTeamRes.json());
    expect(teamList.members.length).toBe(2);

    // Colaborador não pode cadastrar item de escopo (requer clients.manage) -> 403
    const deniedScopeRes = await inject({
      method: 'POST',
      url: `/api/v1/clients/${client.id}/scope`,
      headers: { origin, cookie: collabCookie },
      payload: {
        title: 'Criativos Negados',
        category: 'design',
        cadence: 'weekly',
        contractedQuantity: 4,
      },
    });
    expect(deniedScopeRes.statusCode).toBe(403);

    // Admin cadastra itens de escopo contratado (weekly, monthly, one_off)
    const createScope1 = await inject({
      method: 'POST',
      url: `/api/v1/clients/${client.id}/scope`,
      headers: { origin, cookie: adminCookie },
      payload: {
        title: 'Carrosséis para Instagram',
        description: '4 carrosséis semanais com direção de arte',
        category: 'design',
        cadence: 'weekly',
        contractedQuantity: 4,
        slaBusinessDays: 2,
        slaHours: 48,
        isActive: true,
      },
    });
    expect(createScope1.statusCode).toBe(201);
    const scope1 = clientScopeItemResponseSchema.parse(createScope1.json()).scopeItem;
    expect(scope1.title).toBe('Carrosséis para Instagram');
    expect(scope1.cadence).toBe('weekly');
    expect(scope1.contractedQuantity).toBe(4);
    expect(scope1.slaHours).toBe(48);
    expect(scope1.isActive).toBe(true);
    expect(scope1.active).toBe(true);
    expect(scope1.version).toBe(1);

    const createScope2 = await inject({
      method: 'POST',
      url: `/api/v1/clients/${client.id}/scope`,
      headers: { origin, cookie: adminCookie },
      payload: {
        title: 'Landing Page Institucional',
        category: 'web',
        cadence: 'one_off',
        contractedQuantity: 1,
        slaHours: 120,
      },
    });
    expect(createScope2.statusCode).toBe(201);

    // Atualiza escopo com versão correta e testa conflito 409 com versão antiga
    const patchScopeRes = await inject({
      method: 'PATCH',
      url: `/api/v1/clients/${client.id}/scope/${scope1.id}`,
      headers: { origin, cookie: adminCookie },
      payload: {
        version: 1,
        contractedQuantity: 6,
        isActive: false,
      },
    });
    expect(patchScopeRes.statusCode).toBe(200);
    const updatedScope = clientScopeItemResponseSchema.parse(patchScopeRes.json()).scopeItem;
    expect(updatedScope.contractedQuantity).toBe(6);
    expect(updatedScope.isActive).toBe(false);
    expect(updatedScope.active).toBe(false);
    expect(updatedScope.version).toBe(2);

    const conflictScopeRes = await inject({
      method: 'PATCH',
      url: `/api/v1/clients/${client.id}/scope/${scope1.id}`,
      headers: { origin, cookie: adminCookie },
      payload: {
        version: 1,
        contractedQuantity: 10,
      },
    });
    expect(conflictScopeRes.statusCode).toBe(409);

    // Lista itens de escopo do cliente
    const listScopeRes = await inject({
      method: 'GET',
      url: `/api/v1/clients/${client.id}/scope`,
      headers: { cookie: adminCookie },
    });
    expect(listScopeRes.statusCode).toBe(200);
    const scopeList = clientScopeListResponseSchema.parse(listScopeRes.json());
    expect(scopeList.scopeItems.length).toBe(2);
  });

  it('3. Isolamento Row-Level RBAC: colaborador com clients.read.assigned vê apenas Cliente A (alocado) e recebe 403 no Cliente B (não alocado), enquanto administrator vê ambos', async () => {
    const adminCookie = await cookieFor(admin.email);
    const designerCookie = await cookieFor(collabDesigner.email);
    const unassignedCookie = await cookieFor(collabUnassigned.email);

    const isoPrefix = `${clientPrefix}Iso-${randomUUID().slice(0, 6)}-`;

    // Admin cria Cliente A e Cliente B
    const resClientA = await inject({
      method: 'POST',
      url: '/api/v1/clients',
      headers: { origin, cookie: adminCookie },
      payload: {
        name: `${isoPrefix}Cliente A (Atribuído)`,
        contractStatus: 'active',
        briefingSummary: 'Briefing exclusivo do Cliente A',
      },
    });
    expect(resClientA.statusCode).toBe(201);
    const clientA: Client = clientResponseSchema.parse(resClientA.json()).client;
    createdClientIds.push(clientA.id);

    const resClientB = await inject({
      method: 'POST',
      url: '/api/v1/clients',
      headers: { origin, cookie: adminCookie },
      payload: {
        name: `${isoPrefix}Cliente B (Restrito)`,
        contractStatus: 'active',
        briefingSummary: 'Segredo contratual do Cliente B',
      },
    });
    expect(resClientB.statusCode).toBe(201);
    const clientB: Client = clientResponseSchema.parse(resClientB.json()).client;
    createdClientIds.push(clientB.id);

    // Admin aloca collabDesigner APENAS no Cliente A
    const assignRes = await inject({
      method: 'POST',
      url: `/api/v1/clients/${clientA.id}/team`,
      headers: { origin, cookie: adminCookie },
      payload: {
        userId: collabDesigner.id,
        functionalRole: 'designer',
        isPrimary: true,
      },
    });
    expect(assignRes.statusCode).toBe(201);

    // 1. Administrator lista com filtro isoPrefix e vê AMBOS (Cliente A e Cliente B)
    const adminListRes = await inject({
      method: 'GET',
      url: `/api/v1/clients?q=${encodeURIComponent(isoPrefix)}`,
      headers: { cookie: adminCookie },
    });
    expect(adminListRes.statusCode).toBe(200);
    const adminList = clientListResponseSchema.parse(adminListRes.json());
    const adminIds = adminList.clients.map((c) => c.id);
    expect(adminIds).toContain(clientA.id);
    expect(adminIds).toContain(clientB.id);

    // 2. Colaborador (collabDesigner) lista em /api/v1/clients e /api/clients: vê EXCLUSIVAMENTE Cliente A e NÃO vê Cliente B
    for (const baseUrl of ['/api/v1/clients', '/api/clients'] as const) {
      const designerListRes = await inject({
        method: 'GET',
        url: `${baseUrl}?q=${encodeURIComponent(isoPrefix)}`,
        headers: { cookie: designerCookie },
      });
      expect(designerListRes.statusCode).toBe(200);
      const designerList = clientListResponseSchema.parse(designerListRes.json());
      const designerIds = designerList.clients.map((c) => c.id);
      expect(designerIds).toEqual([clientA.id]);
      expect(designerIds).not.toContain(clientB.id);
    }

    // 3. Colaborador acessa detalhes, equipe e escopo do Cliente A -> 200 OK
    const designerGetARes = await inject({
      method: 'GET',
      url: `/api/v1/clients/${clientA.id}`,
      headers: { cookie: designerCookie },
    });
    expect(designerGetARes.statusCode).toBe(200);
    expect(clientResponseSchema.parse(designerGetARes.json()).client.id).toBe(clientA.id);

    const designerTeamARes = await inject({
      method: 'GET',
      url: `/api/v1/clients/${clientA.id}/team`,
      headers: { cookie: designerCookie },
    });
    expect(designerTeamARes.statusCode).toBe(200);

    const designerScopeARes = await inject({
      method: 'GET',
      url: `/api/v1/clients/${clientA.id}/scope`,
      headers: { cookie: designerCookie },
    });
    expect(designerScopeARes.statusCode).toBe(200);

    // 4. Colaborador tenta acessar Cliente B (não vinculado) por ID, equipe ou escopo -> 403 FORBIDDEN (sem vazar dados de B)
    for (const forbiddenUrl of [
      `/api/v1/clients/${clientB.id}`,
      `/api/clients/${clientB.id}`,
      `/api/v1/clients/${clientB.id}/team`,
      `/api/v1/clients/${clientB.id}/scope`,
    ]) {
      const forbiddenRes = await inject({
        method: 'GET',
        url: forbiddenUrl,
        headers: { cookie: designerCookie },
      });
      expect(forbiddenRes.statusCode).toBe(403);
      expect(forbiddenRes.body).not.toContain('Segredo contratual do Cliente B');
    }

    // 5. Colaborador sem nenhum cliente atribuído (collabUnassigned) recebe 403 em qualquer tentativa
    const unassignedGetRes = await inject({
      method: 'GET',
      url: `/api/v1/clients/${clientA.id}`,
      headers: { cookie: unassignedCookie },
    });
    expect(unassignedGetRes.statusCode).toBe(403);

    // 6. Revogação imediata de visibilidade ao remover collabDesigner da equipe do Cliente A
    const removeMemberRes = await inject({
      method: 'DELETE',
      url: `/api/v1/clients/${clientA.id}/team/${collabDesigner.id}/designer`,
      headers: { origin, cookie: adminCookie, 'content-type': 'application/json' },
      payload: {},
    });
    expect(removeMemberRes.statusCode).toBe(200);

    const afterRevokeRes = await inject({
      method: 'GET',
      url: `/api/v1/clients/${clientA.id}`,
      headers: { cookie: designerCookie },
    });
    expect(afterRevokeRes.statusCode).toBe(403);
  });
});
