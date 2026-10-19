import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Role } from '@orium/contracts';
import { connectDatabase, assertApplicationDatabase, type Database } from '../apps/api/src/db.js';
import { migrateDatabase } from '../apps/api/src/migrate.js';
import { provisionUser, publicIdentity } from '../apps/api/src/identity.js';
import { createClient } from '../apps/api/src/clients.js';
import { agencyToday, minutesUntilAgencyTime, normalizeAgentDate, runAgentCommand } from '../apps/api/src/agent.js';

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

type Ok = { ok: true } & Record<string, unknown>;
type Fail = { ok: false; code: string; message: string; needsClarification?: boolean; candidates?: Record<string, unknown>[] };

describe('Orium Agent CLI — mesmas regras da API contra PostgreSQL orium_test', () => {
  let database: Database | undefined;
  let migrationUrl: string;
  const runId = randomUUID().slice(0, 8);
  const userPrefix = `agent-test-user-${runId}-`;
  const clientPrefix = `agent-test-client-${runId}-`;
  const password = randomBytes(24).toString('hex');
  const createdClientIds: string[] = [];
  const createdDemandIds: string[] = [];

  let admin: { id: string; email: string };
  let colabA: { id: string; email: string };
  let colabB: { id: string; email: string };
  let clientGordinho: { id: string; name: string };

  const db = () => {
    if (!database) throw new Error('Integration database was not initialized.');
    return database;
  };
  const run = (command: string, input: Record<string, unknown>) => runAgentCommand(db(), command, input);
  const ok = async (command: string, input: Record<string, unknown>) => {
    const result = await run(command, input);
    if (!result.ok) throw new Error(`${command} falhou: ${JSON.stringify(result)}`);
    return result as Ok;
  };
  const failed = async (command: string, input: Record<string, unknown>) => {
    const result = await run(command, input);
    expect(result.ok).toBe(false);
    return result as Fail;
  };

  const fixtureUser = async (role: Role, label: string) => {
    const email = `${userPrefix}${label}@example.test`;
    const created = await provisionUser(db(), { name: `Agente ${label} ${runId}`, email, password, role });
    return { ...created, email };
  };

  const fixtureClient = async (suffix: string) => {
    const client = await createClient(db(), await publicIdentity(db(), admin.id), {
      name: `${clientPrefix}${suffix}`,
      contactName: 'Contato',
      email: `c-${randomUUID().slice(0, 8)}@fixture.test`,
      phone: '67999990000',
      notes: '',
    } as Parameters<typeof createClient>[2]);
    createdClientIds.push(client.id);
    return { id: client.id, name: client.name };
  };

  beforeAll(async () => {
    const applicationUrl = testDatabaseUrl('TEST_DATABASE_URL', 'orium_app');
    migrationUrl = testDatabaseUrl('TEST_MIGRATION_DATABASE_URL', 'orium_migrator');
    await migrateDatabase(migrationUrl);
    database = connectDatabase(applicationUrl);
    await assertApplicationDatabase(database);
    admin = await fixtureUser('administrator', 'admin');
    colabA = await fixtureUser('collaborator', 'colaba');
    colabB = await fixtureUser('collaborator', 'colabb');
    clientGordinho = await fixtureClient('Gordinho Celulares');
    await fixtureClient('Gordinho Locacoes');
  }, 60000);

  afterAll(async () => {
    if (!database) return;
    const cleanup = connectDatabase(migrationUrl);
    const c = await cleanup.pool.connect();
    try {
      await c.query('BEGIN');
      const demands = (await c.query<{ id: string }>('SELECT id FROM demand WHERE client_id = ANY($1::uuid[])', [createdClientIds])).rows.map((r) => r.id);
      createdDemandIds.push(...demands);
      await c.query('DELETE FROM material_event WHERE material_id IN (SELECT id FROM material WHERE client_id = ANY($1::uuid[]))', [createdClientIds]);
      await c.query('DELETE FROM material WHERE client_id = ANY($1::uuid[])', [createdClientIds]);
      await c.query('DELETE FROM notification WHERE demand_id = ANY($1::uuid[])', [createdDemandIds]);
      await c.query('DELETE FROM task_dependency WHERE task_id IN (SELECT id FROM task WHERE demand_id = ANY($1::uuid[]))', [createdDemandIds]);
      await c.query('DELETE FROM task_requirement WHERE task_id IN (SELECT id FROM task WHERE demand_id = ANY($1::uuid[]))', [createdDemandIds]);
      await c.query('DELETE FROM task_comment WHERE task_id IN (SELECT id FROM task WHERE demand_id = ANY($1::uuid[]))', [createdDemandIds]);
      await c.query('DELETE FROM demand_event WHERE demand_id = ANY($1::uuid[])', [createdDemandIds]);
      await c.query('DELETE FROM task WHERE demand_id = ANY($1::uuid[])', [createdDemandIds]);
      await c.query('DELETE FROM demand WHERE id = ANY($1::uuid[])', [createdDemandIds]);
      await c.query('DELETE FROM client_team_member WHERE client_id = ANY($1::uuid[])', [createdClientIds]);
      await c.query('DELETE FROM client WHERE id = ANY($1::uuid[])', [createdClientIds]);
      await c.query('SELECT pg_advisory_xact_lock(712041)');
      const users = (await c.query<{ id: string }>('SELECT id FROM auth_user WHERE left(email,length($1))=$1', [userPrefix])).rows.map((r) => r.id);
      await c.query('DELETE FROM notification WHERE recipient_user_id = ANY($1::text[])', [users]);
      await c.query('DELETE FROM identity_event WHERE actor_id=ANY($1::text[]) OR target_user_id=ANY($1::text[])', [users]);
      await c.query('DELETE FROM identity_event_subject WHERE user_id=ANY($1::text[])', [users]);
      await c.query('DELETE FROM auth_user WHERE id=ANY($1::text[])', [users]);
      await c.query('COMMIT');
    } catch (error) {
      await c.query('ROLLBACK');
      throw error;
    } finally {
      c.release();
      await cleanup.pool.end();
      await database.pool.end();
    }
  });

  it('converte "hoje"/"amanhã" para o fuso da agência e expõe "today" sem actor', async () => {
    const now = new Date('2026-10-20T02:30:00Z'); // ainda dia 19 em Cuiabá (UTC-4)
    expect(normalizeAgentDate('hoje', now)).toBe('2026-10-19');
    expect(normalizeAgentDate('Amanhã', now)).toBe('2026-10-20');
    expect(normalizeAgentDate('2026-12-01', now)).toBe('2026-12-01');
    const today = await ok('today', {});
    expect(today.today).toBe(agencyToday());

    // 14:00Z = 10:00 em Cuiabá → lembrete às 17:00 é daqui a 420 min; horário passado/ inválido pede esclarecimento.
    const at10 = new Date('2026-10-19T14:00:00Z');
    expect(minutesUntilAgencyTime('17:00', at10)).toBe(420);
    expect(minutesUntilAgencyTime('09:30', at10)).toBe(-30);
    expect(minutesUntilAgencyTime('25:00', at10)).toBeNull();
    expect((await failed('today', { at: 'fim do dia' })).code).toBe('VALIDATION_FAILED');
  });

  it('exige actor válido e ativo; comando desconhecido não executa nada', async () => {
    expect((await failed('find-client', { query: 'x' })).code).toBe('ACTOR_REQUIRED');
    expect((await failed('find-client', { actor: 'ninguem@example.test', query: 'x' })).code).toBe('ACTOR_NOT_FOUND');
    expect((await failed('apagar-tudo', { actor: admin.email })).code).toBe('UNKNOWN_COMMAND');
  });

  it('busca ambígua devolve candidatos para o agente perguntar; nome exato resolve', async () => {
    const ambiguous = await failed('find-client', { actor: admin.email, query: `${clientPrefix}Gordinho` });
    expect(ambiguous.code).toBe('AMBIGUOUS');
    expect(ambiguous.needsClarification).toBe(true);
    expect(ambiguous.candidates?.length).toBe(2);

    const exact = await ok('find-client', { actor: admin.email, query: clientGordinho.name });
    expect((exact.match as { id: string }).id).toBe(clientGordinho.id);
  });

  it('cadastra cliente sem duplicar nome existente', async () => {
    const name = `${clientPrefix}Novo Cliente`;
    const created = (await ok('create-client', { actor: admin.email, name, contactName: 'Fulano' })).client as { id: string; name: string };
    createdClientIds.push(created.id);
    expect(created.name).toBe(name);
    const dup = await failed('create-client', { actor: admin.email, name: name.toUpperCase() });
    expect(dup.code).toBe('CLIENT_ALREADY_EXISTS');
    expect(dup.candidates?.[0]?.id).toBe(created.id);
    expect((await failed('create-client', { actor: colabA.email, name: `${clientPrefix}x` })).code).toBe('FORBIDDEN');
  });

  it('colaborador não pode criar demanda nem tarefa (mesma regra da API)', async () => {
    const res = await failed('create-demand', {
      actor: colabA.email, clientId: clientGordinho.id, title: 'Não pode', deliveryDate: 'hoje',
    });
    expect(res.code).toBe('FORBIDDEN');
  });

  it('fluxo completo do exemplo do WhatsApp: demanda, tarefa com prazo hoje, fotos como material, execução e revisão', async () => {
    const demand = (await ok('create-demand', {
      actor: admin.email,
      clientId: clientGordinho.id,
      title: 'Tráfego pago — anúncios',
      priority: 'normal',
      deliveryDate: 'hoje',
    })).demand as { id: string; deliveryDate: string };
    createdDemandIds.push(demand.id);
    expect(demand.deliveryDate).toBe(agencyToday());

    // Sem prazo: o agente precisa perguntar, nada é criado.
    const noDate = await failed('create-task', {
      actor: admin.email, demandId: demand.id, assignedToUserId: colabA.id, title: 'Adicionar 2 anúncios novos',
    });
    expect(noDate.code).toBe('DELIVERY_DATE_REQUIRED');
    expect(noDate.needsClarification).toBe(true);

    const task = (await ok('create-task', {
      actor: admin.email,
      demandId: demand.id,
      assignedToUserId: colabA.id,
      title: 'Adicionar 2 anúncios novos personalizados',
      description: 'Usar as 2 fotos enviadas no WhatsApp.',
      deliveryDate: 'hoje',
    })).task as { id: string; status: string; deliveryDate: string };
    expect(task.status).toBe('ready');
    expect(task.deliveryDate).toBe(agencyToday());

    // Notificação de atribuição gerada pelo domínio, como no app.
    const notif = await db().pool.query('SELECT kind FROM notification WHERE task_id = $1 AND recipient_user_id = $2', [task.id, colabA.id]);
    expect(notif.rows.map((r) => r.kind)).toContain('task_assigned');

    // Fotos enviadas ao Drive viram materiais da tarefa.
    const material = await ok('add-material', {
      actor: admin.email,
      clientId: clientGordinho.id,
      demandId: demand.id,
      taskId: task.id,
      title: 'Foto 1 — referência anúncio',
      category: 'drive',
      url: 'https://drive.google.com/open?id=abc123',
    });
    expect((material.material as { taskId: string }).taskId).toBe(task.id);

    // Administrador não pode iniciar tarefa de outra pessoa; só o responsável.
    expect((await failed('accept-task', { actor: admin.email, taskId: task.id })).code).toBe('FORBIDDEN');
    expect((await failed('start-task', { actor: colabA.email, taskId: task.id })).code).toBe('TASK_NOT_ACCEPTED');
    await ok('accept-task', { actor: colabA.email, taskId: task.id });
    const started = (await ok('start-task', { actor: colabA.email, taskId: task.id })).task as { status: string; startedAt: string };
    expect(started.status).toBe('in_production');
    expect(started.startedAt).toBeTruthy();

    expect((await failed('submit-review', { actor: colabA.email, taskId: task.id })).code).toBe('VALIDATION_FAILED');
    await ok('submit-review', { actor: colabA.email, taskId: task.id, deliveryNotes: 'Anúncios publicados.' });

    expect((await failed('review-task', { actor: colabA.email, taskId: task.id, decision: 'complete', feedback: 'ok' })).code).toBe('FORBIDDEN');
    const done = (await ok('review-task', { actor: admin.email, taskId: task.id, decision: 'complete', feedback: 'Aprovado.' })).task as { status: string };
    expect(done.status).toBe('completed');

    await ok('comment-task', { actor: admin.email, taskId: task.id, content: 'Cliente gostou.' });

    const events = await db().pool.query('SELECT action, actor_id FROM demand_event WHERE task_id = $1 ORDER BY created_at', [task.id]);
    const actions = events.rows.map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(['task_created', 'task_accepted', 'task_started', 'task_completed']));
    // Autor real registrado (não um usuário fixo).
    expect(events.rows.find((r) => r.action === 'task_accepted')?.actor_id).toBe(colabA.id);
  });

  it('pausa segue o fluxo formal: pedido do responsável e aprovação com nova data pelo administrador', async () => {
    const demand = (await ok('create-demand', {
      actor: admin.email, clientId: clientGordinho.id, title: 'Pausa', deliveryDate: 'amanha',
    })).demand as { id: string };
    createdDemandIds.push(demand.id);
    const task = (await ok('create-task', {
      actor: admin.email, demandId: demand.id, assignedToUserId: colabA.id, title: 'Tarefa pausável', deliveryDate: 'amanha',
    })).task as { id: string };
    await ok('accept-task', { actor: colabA.email, taskId: task.id });
    await ok('start-task', { actor: colabA.email, taskId: task.id });

    expect((await failed('approve-pause', { actor: admin.email, taskId: task.id, reason: 'x', deliveryDate: '2026-12-01' })).code).toBe('NO_PENDING_PAUSE_REQUEST');
    await ok('request-pause', { actor: colabA.email, taskId: task.id, reason: 'Aguardando fotos do cliente' });
    expect((await failed('approve-pause', { actor: admin.email, taskId: task.id, reason: 'ok' })).code).toBe('VALIDATION_FAILED');
    const paused = (await ok('approve-pause', { actor: admin.email, taskId: task.id, reason: 'ok', deliveryDate: '2026-12-01' })).task as { status: string; deliveryDate: string };
    expect(paused.status).toBe('paused');
    expect(paused.deliveryDate).toBe('2026-12-01');
  });

  it('colaborador só encontra as próprias tarefas', async () => {
    const demand = (await ok('create-demand', {
      actor: admin.email, clientId: clientGordinho.id, title: 'Visibilidade', deliveryDate: 'amanha',
    })).demand as { id: string };
    createdDemandIds.push(demand.id);
    const title = `Tarefa-visivel-${runId}`;
    await ok('create-task', { actor: admin.email, demandId: demand.id, assignedToUserId: colabA.id, title, deliveryDate: 'amanha' });

    const forA = await ok('find-task', { actor: colabA.email, query: title });
    expect((forA.match as { title: string }).title).toBe(title);
    expect((await failed('find-task', { actor: colabB.email, query: title })).code).toBe('NOT_FOUND');
  });
});
