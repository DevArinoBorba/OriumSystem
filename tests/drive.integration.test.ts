import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Role } from '@orium/contracts';
import { buildApp } from '../apps/api/src/app.js';
import { loadConfig } from '../apps/api/src/config.js';
import { connectDatabase, assertApplicationDatabase, type Database } from '../apps/api/src/db.js';
import { migrateDatabase } from '../apps/api/src/migrate.js';
import { provisionUser } from '../apps/api/src/identity.js';
import { agencyToday } from '../apps/api/src/agent.js';
import type { DriveGateway } from '../apps/api/src/drive.js';

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

/** Drive em memória: caminho -> conteúdo, com IDs estáveis e MD5 como o rclone devolve. */
class FakeDrive implements DriveGateway {
  files = new Map<string, { id: string; data: Buffer; mime: string }>();
  add(filePath: string, data: Buffer, mime = 'image/jpeg') {
    this.files.set(filePath, { id: `id-${randomUUID().slice(0, 8)}`, data, mime });
  }
  async list(dir: string, options: { recurse?: boolean; hashes?: boolean } = {}) {
    const prefix = dir ? `${dir}/` : '';
    const out = new Map<string, ReturnType<FakeDrive['item']>>();
    for (const [filePath, file] of this.files) {
      if (!filePath.startsWith(prefix)) continue;
      const rest = filePath.slice(prefix.length);
      const parts = rest.split('/');
      if (parts.length === 1 || options.recurse) {
        out.set(rest, this.item(rest, parts.at(-1)!, file, options.hashes));
      }
      if (!options.recurse && parts.length > 1) {
        out.set(parts[0]!, { Path: parts[0]!, Name: parts[0]!, Size: -1, IsDir: true, ID: `dir-${parts[0]}` });
      }
    }
    return [...out.values()];
  }
  private item(relPath: string, name: string, file: { id: string; data: Buffer; mime: string }, hashes?: boolean) {
    return {
      Path: relPath, Name: name, Size: file.data.length, MimeType: file.mime, ModTime: '2026-10-19T12:00:00Z', IsDir: false, ID: file.id,
      ...(hashes ? { Hashes: { md5: createHash('md5').update(file.data).digest('hex') } } : {}),
    };
  }
  async fetchFile(filePath: string, range?: string) {
    const file = this.files.get(filePath);
    if (!file) return new Response('not found', { status: 404 });
    const match = range ? /^bytes=(\d+)-(\d*)$/.exec(range) : null;
    if (match) {
      const start = Number(match[1]);
      const end = match[2] ? Number(match[2]) : file.data.length - 1;
      const part = file.data.subarray(start, end + 1);
      return new Response(part, { status: 206, headers: { 'content-length': String(part.length), 'content-range': `bytes ${start}-${end}/${file.data.length}` } });
    }
    return new Response(file.data, { status: 200, headers: { 'content-length': String(file.data.length) } });
  }
  async upload(dir: string, fileName: string, localPath: string) {
    this.add(`${dir}/${fileName}`, await readFile(localPath), fileName.endsWith('.jpg') ? 'image/jpeg' : 'application/octet-stream');
  }
}

describe('Espelho do Google Drive (Materiais) contra PostgreSQL orium_test', () => {
  let app: FastifyInstance | undefined;
  let database: Database | undefined;
  let migrationUrl: string;
  const drive = new FakeDrive();
  const runId = randomUUID().slice(0, 8);
  const userPrefix = `drive-test-user-${runId}-`;
  const password = randomBytes(24).toString('hex');
  const origin = 'http://127.0.0.1:5173';
  const createdClientIds: string[] = [];
  let requestIndex = 0;
  let adminCookie = '';
  let colabCookie = '';
  let otherCookie = '';
  let colab: { id: string };
  let taskId = '';

  const CLIENT = `Cliente ${runId}`;
  const LOTE = `${CLIENT}/Criativos e Midias/2026-10 Anuncios`;
  const PHOTO = Buffer.from('foto-1-conteudo');

  const inject = (options: InjectOptions) => {
    if (!app) throw new Error('app not initialized');
    requestIndex += 1;
    return app.inject({ ...options, remoteAddress: `127.1.${Math.floor(requestIndex / 250)}.${(requestIndex % 250) + 1}` });
  };
  const db = () => {
    if (!database) throw new Error('db not initialized');
    return database;
  };
  const user = async (role: Role, label: string) => {
    const email = `${userPrefix}${label}@example.test`;
    const created = await provisionUser(db(), { name: `Drive ${label}`, email, password, role });
    const res = await inject({ method: 'POST', url: '/api/v1/auth/sign-in/email', headers: { origin, 'content-type': 'application/json' }, payload: { email, password } });
    expect(res.statusCode).toBe(200);
    const raw = res.headers['set-cookie'];
    const cookies = Array.isArray(raw) ? raw : raw ? [raw] : [];
    return { id: created.id, cookie: cookies.map((c) => c.split(';')[0]).join('; ') };
  };
  const post = (url: string, cookie: string, payload: unknown) =>
    inject({ method: 'POST', url, headers: { origin, cookie, 'content-type': 'application/json' }, payload: payload as Record<string, unknown> });
  const get = (url: string, cookie: string, headers: Record<string, string> = {}) => inject({ method: 'GET', url, headers: { cookie, ...headers } });
  const chunk = (cookie: string, uploadId: string, index: number, data: Buffer) =>
    inject({ method: 'POST', url: `/api/v1/drive/upload/chunk?uploadId=${uploadId}&index=${index}`, headers: { origin, cookie, 'content-type': 'application/octet-stream' }, payload: data });

  beforeAll(async () => {
    const applicationUrl = testDatabaseUrl('TEST_DATABASE_URL', 'orium_app');
    migrationUrl = testDatabaseUrl('TEST_MIGRATION_DATABASE_URL', 'orium_migrator');
    await migrateDatabase(migrationUrl);
    database = connectDatabase(applicationUrl);
    await assertApplicationDatabase(database);
    app = await buildApp({
      database,
      logger: false,
      driveGateway: drive,
      config: loadConfig({
        NODE_ENV: 'test', DATABASE_URL: applicationUrl, BETTER_AUTH_SECRET: randomBytes(32).toString('hex'),
        WEB_ORIGIN: origin, API_ORIGIN: 'http://127.0.0.1:3001', API_HOST: '127.0.0.1', API_PORT: '3001',
      }),
    });
    const admin = await user('administrator', 'admin');
    adminCookie = admin.cookie;
    const c = await user('collaborator', 'colab');
    colab = { id: c.id };
    colabCookie = c.cookie;
    otherCookie = (await user('collaborator', 'outro')).cookie;

    drive.add(`${LOTE}/foto-1.jpg`, PHOTO);
    drive.add(`${LOTE}/foto-2.jpg`, Buffer.from('foto-2-conteudo'));
    drive.add(`${LOTE}/pagina.html`, Buffer.from('<script>alert(1)</script>'), 'text/html');

    const client = await post('/api/v1/clients', adminCookie, { name: CLIENT, contactName: 'X', email: `c-${runId}@fixture.test`, phone: '1', notes: '' });
    expect(client.statusCode).toBe(201);
    const clientId = (client.json().client ?? client.json()).id as string;
    createdClientIds.push(clientId);
    const demand = await post('/api/v1/demands', adminCookie, { clientId, title: 'Postar vídeos', deliveryDate: agencyToday() });
    const task = await post('/api/v1/tasks', adminCookie, { demandId: demand.json().demand.id, assignedToUserId: colab.id, title: 'Postar 4 vídeos no Insta', deliveryDate: agencyToday() });
    expect(task.statusCode).toBe(201);
    taskId = task.json().task.id;
  }, 60000);

  afterAll(async () => {
    try {
      await app?.close();
    } finally {
      if (database) {
        const cleanup = connectDatabase(migrationUrl);
        const c = await cleanup.pool.connect();
        try {
          await c.query('BEGIN');
          const demands = (await c.query<{ id: string }>('SELECT id FROM demand WHERE client_id = ANY($1::uuid[])', [createdClientIds])).rows.map((r) => r.id);
          const fileIds = [...drive.files.values()].map((f) => f.id);
          await c.query('DELETE FROM drive_file_status WHERE drive_file_id = ANY($1::text[])', [fileIds]);
          await c.query('DELETE FROM material_event WHERE material_id IN (SELECT id FROM material WHERE client_id = ANY($1::uuid[]))', [createdClientIds]);
          await c.query('DELETE FROM material WHERE client_id = ANY($1::uuid[])', [createdClientIds]);
          await c.query('DELETE FROM notification WHERE demand_id = ANY($1::uuid[])', [demands]);
          await c.query('DELETE FROM demand_event WHERE demand_id = ANY($1::uuid[])', [demands]);
          await c.query('DELETE FROM task WHERE demand_id = ANY($1::uuid[])', [demands]);
          await c.query('DELETE FROM demand WHERE id = ANY($1::uuid[])', [demands]);
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
      }
    }
  });

  it('administrador navega pela árvore; colaborador não', async () => {
    const root = await get('/api/v1/drive/list?path=', adminCookie);
    expect(root.statusCode).toBe(200);
    expect(root.json().entries.map((e: { name: string }) => e.name)).toContain(CLIENT);
    const lote = await get(`/api/v1/drive/list?path=${encodeURIComponent(LOTE)}`, adminCookie);
    const names = lote.json().entries.map((e: { name: string }) => e.name);
    expect(names).toEqual(expect.arrayContaining(['foto-1.jpg', 'foto-2.jpg']));
    expect((await get('/api/v1/drive/list?path=', colabCookie)).statusCode).toBe(403);
    expect((await get('/api/v1/drive/list?path=..%2Fsegredo', adminCookie)).statusCode).toBe(400);
  });

  it('vincular arquivo à tarefa deixa "a publicar" e libera só para o responsável', async () => {
    const linked = await post('/api/v1/drive/link', adminCookie, { path: `${LOTE}/foto-1.jpg`, taskId });
    expect(linked.statusCode).toBe(201);
    expect(linked.json().material.driveFileId).toBeTruthy();
    expect((await post('/api/v1/drive/link', adminCookie, { path: `${LOTE}/foto-1.jpg`, taskId })).statusCode).toBe(409);

    const mine = await get('/api/v1/drive/my-files', colabCookie);
    expect(mine.statusCode).toBe(200);
    const group = mine.json().tasks.find((t: { taskId: string }) => t.taskId === taskId);
    expect(group.files).toHaveLength(1);
    expect(group.files[0].status).toBe('to_publish');
    expect((await get('/api/v1/drive/my-files', otherCookie)).json().tasks).toHaveLength(0);

    const ok = await get(`/api/v1/drive/file?path=${encodeURIComponent(`${LOTE}/foto-1.jpg`)}`, colabCookie);
    expect(ok.statusCode).toBe(200);
    expect(ok.rawPayload.equals(PHOTO)).toBe(true);
    expect(ok.headers['content-disposition']).toMatch(/^inline/);
    expect((await get(`/api/v1/drive/file?path=${encodeURIComponent(`${LOTE}/foto-2.jpg`)}`, colabCookie)).statusCode).toBe(404);
    expect((await get(`/api/v1/drive/file?path=${encodeURIComponent(`${LOTE}/foto-1.jpg`)}`, otherCookie)).statusCode).toBe(404);

    const ranged = await get(`/api/v1/drive/file?path=${encodeURIComponent(`${LOTE}/foto-1.jpg`)}`, colabCookie, { range: 'bytes=0-3' });
    expect(ranged.statusCode).toBe(206);
    expect(ranged.rawPayload.toString()).toBe('foto');
  });

  it('colaborador marca como publicado só o que é dele', async () => {
    const fileId = [...drive.files.entries()].find(([p]) => p.endsWith('foto-1.jpg'))![1].id;
    const otherId = [...drive.files.entries()].find(([p]) => p.endsWith('foto-2.jpg'))![1].id;
    expect((await post('/api/v1/drive/status', colabCookie, { fileId, status: 'published' })).statusCode).toBe(200);
    expect((await post('/api/v1/drive/status', colabCookie, { fileId: otherId, status: 'published' })).statusCode).toBe(403);
    expect((await post('/api/v1/drive/status', colabCookie, { fileId, status: null })).statusCode).toBe(403);
    const lote = await get(`/api/v1/drive/list?path=${encodeURIComponent(LOTE)}`, adminCookie);
    const entry = lote.json().entries.find((e: { id: string }) => e.id === fileId);
    expect(entry.status).toBe('published');
    expect(entry.links[0].taskTitle).toBe('Postar 4 vídeos no Insta');
  });

  it('HTML/SVG do Drive nunca abre no navegador (sempre download)', async () => {
    const res = await get(`/api/v1/drive/file?path=${encodeURIComponent(`${LOTE}/pagina.html`)}`, adminCookie);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/octet-stream');
    expect(res.headers['content-disposition']).toMatch(/^attachment/);
  });

  it('envio em partes: nome padronizado, numeração e bloqueio de repetidos', async () => {
    const data = Buffer.concat([randomBytes(5 * 1024 * 1024), Buffer.from(runId)]);
    const uploadId = randomUUID();
    expect((await chunk(adminCookie, uploadId, 0, data.subarray(0, 4 * 1024 * 1024))).statusCode).toBe(200);
    expect((await chunk(adminCookie, uploadId, 2, data.subarray(4 * 1024 * 1024))).statusCode).toBe(409);
    expect((await chunk(adminCookie, uploadId, 1, data.subarray(4 * 1024 * 1024))).statusCode).toBe(200);
    const done = await post('/api/v1/drive/upload/complete', adminCookie, { uploadId, folder: LOTE, fileName: 'IMG_9999.JPG', subject: 'Anúncios site', numbered: true });
    expect(done.statusCode).toBe(201);
    expect(done.json().uploaded[0].name).toBe(`${agencyToday()}_anuncios-site_01.jpg`);

    // Mesmo conteúdo de novo (em outro nome): não duplica.
    const again = randomUUID();
    await chunk(adminCookie, again, 0, data.subarray(0, 4 * 1024 * 1024));
    await chunk(adminCookie, again, 1, data.subarray(4 * 1024 * 1024));
    const dup = await post('/api/v1/drive/upload/complete', adminCookie, { uploadId: again, folder: LOTE, fileName: 'copia.jpg', subject: 'Anúncios site', numbered: true });
    expect(dup.statusCode).toBe(200);
    expect(dup.json().uploaded).toHaveLength(0);
    expect(dup.json().duplicates[0].existingPath).toContain('anuncios-site_01.jpg');

    // Pasta fora do padrão (raiz do cliente) e colaborador: recusados.
    const bad = randomUUID();
    await chunk(adminCookie, bad, 0, Buffer.from('x'));
    expect((await post('/api/v1/drive/upload/complete', adminCookie, { uploadId: bad, folder: CLIENT, fileName: 'x.jpg' })).statusCode).toBe(400);
    expect((await chunk(colabCookie, randomUUID(), 0, Buffer.from('x'))).statusCode).toBe(403);
    // Parte acima de 4 MB é recusada.
    expect((await chunk(adminCookie, randomUUID(), 0, randomBytes(4 * 1024 * 1024 + 1))).statusCode).toBe(413);
  });
});
