import Fastify, { type FastifyServerOptions } from 'fastify';
import { fromNodeHeaders } from 'better-auth/node';
import { z } from 'zod';
import {
  changeRoleSchema,
  createUserSchema,
  deactivateUserSchema,
  loginSchema,
  rolePermissionsSchema,
  createClientSchema,
  updateClientSchema,
  clientVersionSchema,
  listClientsQuerySchema,
  upsertClientTeamMemberSchema,
  createClientScopeItemSchema,
  updateClientScopeItemSchema,
  clientFunctionalRoleSchema,
  createDemandSchema,
  updateDemandSchema,
  completeDemandSchema,
  createTaskSchema,
  taskVersionSchema,
  reassignTaskSchema,
  updateRequirementSchema,
  addDependencySchema,
  removeDependencySchema,
  submitTaskReviewSchema,
  reviewTaskSchema,
  requestTaskPauseSchema,
  approveTaskPauseSchema,
  createTaskCommentSchema,
  listDemandsQuerySchema,
  dashboardQuerySchema,
  listMaterialsQuerySchema,
  createMaterialSchema,
  updateMaterialSchema,
  materialVersionInputSchema,
  materialHistoryQuerySchema,
  listMaterialTargetsQuerySchema,
  clientTimelineQuerySchema,
  listNotificationsQuerySchema,
  createDemandTemplateInputSchema,
  updateDemandTemplateInputSchema,
  instantiateDemandTemplateInputSchema,
  setDriveFileStatusSchema,
  linkDriveFileSchema,
  reportQuerySchema,
  updateProfileSchema,
  changePasswordSchema,
  createClientCredentialSchema,
  updateClientCredentialSchema,
} from '@orium/contracts';
import type { Config } from './config.js';
import { assertApplicationDatabase, type Database } from './db.js';
import { createAuth } from './auth.js';
import {
  authenticate,
  authenticateInternal,
  changeIdentity,
  changeOwnPassword,
  changeRolePermissions,
  listUsers,
  provisionUser,
  publicIdentity,
  requirePermission,
  updateOwnProfile,
  IDENTITY_LOCK,
  serializeIdentity,
} from './identity.js';
import {
  listClients,
  getClientById,
  createClient,
  updateClient,
  archiveClient,
  restoreClient,
  resolveClientReadScope,
  listClientTeamMembers,
  upsertClientTeamMember,
  removeClientTeamMember,
  listClientScopeItems,
  createClientScopeItem,
  updateClientScopeItem,
  deleteClientScopeItem,
} from './clients.js';
import { listIdentityEvents } from './identity-audit.js';
import { listNotifications, markNotificationAsRead } from './notifications.js';
import {
  listDemandTemplates,
  getDemandTemplateById,
  createDemandTemplate,
  updateDemandTemplate,
  instantiateDemandTemplate,
} from './templates.js';
import { getProductivityReport, getBottlenecksReport } from './reports.js';
import { getBackupStatus, triggerBackup } from './backups.js';
import {
  listClientCredentials,
  createClientCredential,
  updateClientCredential,
  revealClientCredentialSecret,
  deleteClientCredential,
  getHermesStatus,
} from './vault.js';
import {
  getVapidConfig,
  savePushSubscription,
  removePushSubscription,
  dispatchPushToUser,
  dispatchPendingNotificationsPush,
} from './push.js';
import {
  listDemands,
  createDemand,
  getDemandById,
  updateDemand,
  completeDemand,
  getDemandHistory,
  createTask,
  getTaskById,
  acceptTask,
  startTask,
  submitTaskReview,
  reviewTask,
  requestTaskPause,
  approveTaskPause,
  resumeTask,
  reassignTask,
  updateRequirement,
  addDependency,
  removeDependency,
  listTaskComments,
  createTaskComment,
} from './demands.js';
import { getDashboard } from './dashboard.js';
import {
  listMaterials,
  getMaterial,
  createMaterial,
  updateMaterial,
  archiveMaterial,
  restoreMaterial,
  getMaterialHistory,
  listMaterialTargets,
  getClientTimeline,
} from './materials.js';
import { AppError } from './errors.js';
import {
  completeUpload,
  createHttpDriveGateway,
  linkDriveFile,
  listDrive,
  myDriveFiles,
  openDriveFile,
  pruneStaleUploads,
  receiveUploadChunk,
  setDriveFileStatus,
  UPLOAD_CHUNK_BYTES,
  type DriveGateway,
} from './drive.js';
import { Readable } from 'node:stream';

// Phase 6 / Increment 1 (docs/PHASE6-IMPLEMENTATION-CONTRACT.md). The API never serves documents,
// so the CSP denies everything; it does not protect the web document itself.
const apiSecurityHeaders = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
} as const;

type Options = { config: Config; database: Database; logger?: FastifyServerOptions['logger']; driveGateway?: DriveGateway | null };

export async function buildApp({ config, database, logger, driveGateway }: Options) {
  await assertApplicationDatabase(database);
  const app = Fastify({
    bodyLimit: 16384,
    requestTimeout: 15000,
    // Production API is reachable only through the web container on the private
    // application network; that proxy overwrites X-Forwarded-For.
    trustProxy: config.NODE_ENV === 'production',
    logger: logger ?? {
      level: config.LOG_LEVEL,
      redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]', 'password', 'token', 'secret', 'DATABASE_URL'],
      serializers: { req: (request) => ({ method: request.method, path: String(request.url).split('?')[0], id: request.id }), res: (response) => ({ statusCode: response.statusCode }) },
    },
  });
  const auth = createAuth(config, database);

  app.addHook('onRequest', async (request, reply) => {
    // Set before the guards so 403/404/413/500 responses carry the same protection.
    // HSTS belongs to the HTTPS deployment (Phase 10) and is deliberately not sent over local HTTP.
    reply.headers(apiSecurityHeaders);
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      if (request.headers.origin !== config.WEB_ORIGIN || request.headers['sec-fetch-site'] === 'cross-site') throw new AppError(403, 'ORIGIN_REJECTED');
      const contentType = String(request.headers['content-type'] ?? '');
      const isUploadChunk = request.method === 'POST' && request.url.split('?')[0] === '/api/v1/drive/upload/chunk';
      if (isUploadChunk ? !contentType.startsWith('application/octet-stream') : !contentType.startsWith('application/json')) {
        throw new AppError(415, 'JSON_REQUIRED');
      }
    }
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) return reply.code(error.status).send({ error: { code: error.code, requestId: request.id } });
    if (error instanceof z.ZodError) return reply.code(400).send({ error: { code: 'INVALID_INPUT', requestId: request.id } });
    const statusCode = typeof error === 'object' && error !== null && 'statusCode' in error ? (error as { statusCode?: number }).statusCode : undefined;
    if (statusCode === 400) return reply.code(400).send({ error: { code: 'INVALID_INPUT', requestId: request.id } });
    if (statusCode === 413) return reply.code(413).send({ error: { code: 'PAYLOAD_TOO_LARGE', requestId: request.id } });
    // Do not log raw exception messages: pg/validation can include input or connection strings.
    request.log.error({ code: 'INTERNAL_ERROR', requestId: request.id }, 'Request failed');
    return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', requestId: request.id } });
  });
  app.setNotFoundHandler((request, reply) => reply.code(404).send({ error: { code: 'NOT_FOUND', requestId: request.id } }));

  // ================= Espelho do Google Drive (Agent/) =================
  const drive = driveGateway === undefined ? createHttpDriveGateway() : driveGateway;
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: UPLOAD_CHUNK_BYTES }, (_request, body, done) => done(null, body));
  const pruneTimer = setInterval(() => { void pruneStaleUploads().catch(() => undefined); }, 3600_000);
  pruneTimer.unref();

  app.get('/api/v1/drive/list', async (request) => {
    const identity = await authenticate(database, auth, request.headers);
    requirePermission(identity, 'materials.read');
    const query = z.object({ path: z.string().max(1000).optional() }).parse(request.query);
    return listDrive(database, drive, identity, query.path ?? '');
  });

  app.get('/api/v1/drive/my-files', async (request) => {
    const identity = await authenticate(database, auth, request.headers);
    requirePermission(identity, 'materials.read');
    return myDriveFiles(database, drive, identity);
  });

  app.get('/api/v1/drive/file', async (request, reply) => {
    const identity = await authenticate(database, auth, request.headers);
    requirePermission(identity, 'materials.read');
    const query = z.object({ path: z.string().max(1000), download: z.enum(['1']).optional() }).parse(request.query);
    const range = typeof request.headers.range === 'string' ? request.headers.range : undefined;
    const file = await openDriveFile(database, drive, identity, query.path, range, query.download === '1');
    reply.code(file.status).headers(file.headers);
    return reply.send(file.body ? Readable.fromWeb(file.body as import('node:stream/web').ReadableStream) : null);
  });

  app.post('/api/v1/drive/status', async (request) => {
    const identity = await authenticate(database, auth, request.headers);
    requirePermission(identity, 'materials.read');
    return setDriveFileStatus(database, drive, identity, setDriveFileStatusSchema.parse(request.body));
  });

  app.post('/api/v1/drive/link', async (request, reply) => {
    const identity = await authenticate(database, auth, request.headers);
    requirePermission(identity, 'materials.write');
    const result = await linkDriveFile(database, drive, identity, linkDriveFileSchema.parse(request.body));
    return reply.code(201).send(result);
  });

  app.post('/api/v1/drive/upload/chunk', async (request) => {
    const identity = await authenticate(database, auth, request.headers);
    requirePermission(identity, 'materials.write');
    const query = z.object({ uploadId: z.string().uuid(), index: z.coerce.number().int().min(0).max(10_000) }).parse(request.query);
    if (!Buffer.isBuffer(request.body)) throw new AppError(400, 'INVALID_INPUT');
    return receiveUploadChunk(identity, query.uploadId, query.index, request.body);
  });

  app.post('/api/v1/drive/upload/complete', async (request, reply) => {
    const identity = await authenticate(database, auth, request.headers);
    requirePermission(identity, 'materials.write');
    const input = z.object({
      uploadId: z.string().uuid(),
      folder: z.string().max(1000),
      fileName: z.string().trim().min(1).max(255),
      subject: z.string().trim().max(80).optional(),
      numbered: z.boolean().optional(),
    }).strict().parse(request.body);
    const result = await completeUpload(database, drive, identity, input);
    return reply.code(result.uploaded.length > 0 ? 201 : 200).send(result);
  });

  app.get('/health/live', async () => ({ status: 'ok' }));
  app.get('/health/ready', async (_request, reply) => {
    try {
      await assertApplicationDatabase(database);
      await database.pool.query('SELECT id FROM role LIMIT 1');
      return { status: 'ok' };
    } catch { return reply.code(503).send({ status: 'unavailable' }); }
  });
  app.get('/api/v1/ready', async (_request, reply) => {
    try {
      await assertApplicationDatabase(database);
      await database.pool.query('SELECT id FROM role LIMIT 1');
      return { status: 'ready' };
    } catch { return reply.code(503).send({ status: 'unavailable' }); }
  });

  // Expose only the foundation authentication operations; never mount a wildcard auth router.
  app.post('/api/v1/auth/sign-in/email', async (request, reply) => {
    const input = loginSchema.parse(request.body);
    const headers = fromNodeHeaders(request.headers);
    headers.set('x-forwarded-for', request.ip);
    return serializeIdentity(database, async () => {
      const lock = await database.pool.connect();
      try {
        await lock.query('BEGIN');
        // Serialize password verification AND session creation with password recovery.
        // Otherwise an in-flight login could create an old-password session after reset.
        await lock.query('SELECT pg_advisory_xact_lock($1)', [IDENTITY_LOCK]);
        const response = await auth.handler(new Request(`${config.API_ORIGIN}/api/v1/auth/sign-in/email`, { method: 'POST', headers, body: JSON.stringify(input) }));
        if (!response.ok) return reply.code(response.status === 429 ? 429 : 401).send({ error: { code: response.status === 429 ? 'RATE_LIMITED' : 'INVALID_CREDENTIALS' } });
        const raw: unknown = await response.json();
        const parsed = z.object({ user: z.object({ id: z.string() }) }).parse(raw);
        const identity = await publicIdentity(database, parsed.user.id);
        requirePermission(identity, 'protected.read');
        const cookies = response.headers.getSetCookie();
        if (!cookies.length) throw new AppError(500, 'AUTH_SESSION_FAILED');
        reply.header('set-cookie', cookies);
        // Better Auth token and private session fields are deliberately not returned.
        return identity;
      } finally {
        try { await lock.query('ROLLBACK'); }
        finally { lock.release(); }
      }
    });
  });
  app.post('/api/v1/auth/sign-out', async (request, reply) => {
    await authenticate(database, auth, request.headers);
    const response = await auth.handler(new Request(`${config.API_ORIGIN}/api/v1/auth/sign-out`, { method: 'POST', headers: fromNodeHeaders(request.headers), body: '{}' }));
    if (!response.ok) throw new AppError(500, 'LOGOUT_FAILED');
    reply.header('set-cookie', response.headers.getSetCookie());
    return { success: true };
  });
  app.get('/api/v1/me', async (request) => {
    const identity = await authenticate(database, auth, request.headers);
    requirePermission(identity, 'protected.read');
    return identity;
  });
  app.patch('/api/v1/me', { bodyLimit: 1048576 }, async (request) => {
    const identity = await authenticate(database, auth, request.headers);
    requirePermission(identity, 'protected.read');
    const input = updateProfileSchema.parse(request.body);
    return updateOwnProfile(database, identity.user.id, input);
  });
  app.post('/api/v1/me/password', async (request) => {
    const identity = await authenticate(database, auth, request.headers);
    requirePermission(identity, 'protected.read');
    const sessionAuth = await authenticateInternal(database, auth, request.headers);
    const input = changePasswordSchema.parse(request.body);
    return changeOwnPassword(database, identity.user.id, sessionAuth.sessionId, input);
  });
  app.get('/api/v1/identity-events', async (request) => {
    const identity = await authenticate(database, auth, request.headers);
    return listIdentityEvents(database, identity, request.query);
  });
  app.get('/api/v1/users', async (request) => {
    requirePermission(await authenticate(database, auth, request.headers), 'users.read');
    return { users: await listUsers(database) };
  });
  app.post('/api/v1/users', async (request, reply) => {
    const identity = await authenticate(database, auth, request.headers);
    requirePermission(identity, 'users.create');
    const input = createUserSchema.parse(request.body);
    try {
      const created = await provisionUser(database, input, identity.user.id);
      return reply.code(201).send((await publicIdentity(database, created.id)).user);
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') throw new AppError(409, 'USER_CONFLICT');
      throw error;
    }
  });
  app.patch('/api/v1/users/:id', async (request) => {
    const identity = await authenticate(database, auth, request.headers);
    requirePermission(identity, 'users.deactivate');
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const input = deactivateUserSchema.parse(request.body);
    await changeIdentity(database, identity.user.id, params.id, input);
    return { success: true };
  });
  app.put('/api/v1/users/:id/role', async (request) => {
    const identity = await authenticate(database, auth, request.headers);
    requirePermission(identity, 'roles.manage');
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    await changeIdentity(database, identity.user.id, params.id, changeRoleSchema.parse(request.body));
    return { success: true };
  });
  app.put('/api/v1/roles/:role/permissions', async (request) => {
    const identity = await authenticate(database, auth, request.headers);
    requirePermission(identity, 'roles.manage');
    const params = z.object({ role: z.string() }).parse(request.params);
    await changeRolePermissions(database, identity.user.id, params.role, rolePermissionsSchema.parse(request.body).permissions);
    return { success: true };
  });
  for (const prefix of ['/api/v1/clients', '/api/clients'] as const) {
    app.get(prefix, async (request) => {
      const identity = await authenticate(database, auth, request.headers);
      resolveClientReadScope(identity);
      const query = listClientsQuerySchema.parse(request.query);
      return listClients(database, query, identity);
    });
    app.get(`${prefix}/:id`, async (request) => {
      const identity = await authenticate(database, auth, request.headers);
      resolveClientReadScope(identity);
      const params = z.object({ id: z.string().uuid() }).parse(request.params);
      const client = await getClientById(database, params.id, identity);
      return { client };
    });
    app.post(prefix, async (request, reply) => {
      const identity = await authenticate(database, auth, request.headers);
      requirePermission(identity, 'clients.write');
      requirePermission(identity, 'clients.manage');
      const input = createClientSchema.parse(request.body);
      const client = await createClient(database, identity, input);
      return reply.code(201).send({ client });
    });
    app.patch(`${prefix}/:id`, async (request) => {
      const identity = await authenticate(database, auth, request.headers);
      requirePermission(identity, 'clients.write');
      requirePermission(identity, 'clients.manage');
      const params = z.object({ id: z.string().uuid() }).parse(request.params);
      const input = updateClientSchema.parse(request.body);
      const client = await updateClient(database, identity, params.id, input);
      return { client };
    });
    app.post(`${prefix}/:id/archive`, async (request) => {
      const identity = await authenticate(database, auth, request.headers);
      requirePermission(identity, 'clients.archive');
      const params = z.object({ id: z.string().uuid() }).parse(request.params);
      const input = clientVersionSchema.parse(request.body);
      const client = await archiveClient(database, identity, params.id, input.version);
      return { client };
    });
    app.post(`${prefix}/:id/restore`, async (request) => {
      const identity = await authenticate(database, auth, request.headers);
      requirePermission(identity, 'clients.archive');
      const params = z.object({ id: z.string().uuid() }).parse(request.params);
      const input = clientVersionSchema.parse(request.body);
      const client = await restoreClient(database, identity, params.id, input.version);
      return { client };
    });

    // Fase 2A — Alocação de Equipe (client_team_member)
    app.get(`${prefix}/:id/team`, async (request) => {
      const identity = await authenticate(database, auth, request.headers);
      const params = z.object({ id: z.string().uuid() }).parse(request.params);
      return listClientTeamMembers(database, identity, params.id);
    });
    app.post(`${prefix}/:id/team`, async (request, reply) => {
      const identity = await authenticate(database, auth, request.headers);
      requirePermission(identity, 'clients.team.manage');
      const params = z.object({ id: z.string().uuid() }).parse(request.params);
      const input = upsertClientTeamMemberSchema.parse(request.body);
      const member = await upsertClientTeamMember(database, identity, params.id, input);
      return reply.code(201).send({ member });
    });
    app.delete(`${prefix}/:id/team/:userId/:functionalRole`, async (request) => {
      const identity = await authenticate(database, auth, request.headers);
      requirePermission(identity, 'clients.team.manage');
      const params = z.object({
        id: z.string().uuid(),
        userId: z.string().trim().min(1),
        functionalRole: clientFunctionalRoleSchema,
      }).parse(request.params);
      await removeClientTeamMember(database, identity, params.id, params.userId, params.functionalRole);
      return { success: true };
    });
    app.delete(`${prefix}/:id/team/:userId`, async (request) => {
      const identity = await authenticate(database, auth, request.headers);
      requirePermission(identity, 'clients.team.manage');
      const params = z.object({
        id: z.string().uuid(),
        userId: z.string().trim().min(1),
      }).parse(request.params);
      const query = z.object({
        functionalRole: clientFunctionalRoleSchema.optional(),
      }).parse(request.query);
      await removeClientTeamMember(database, identity, params.id, params.userId, query.functionalRole);
      return { success: true };
    });

    // Fase 2A — Escopo Contratado (client_scope_item)
    app.get(`${prefix}/:id/scope`, async (request) => {
      const identity = await authenticate(database, auth, request.headers);
      const params = z.object({ id: z.string().uuid() }).parse(request.params);
      return listClientScopeItems(database, identity, params.id);
    });
    app.post(`${prefix}/:id/scope`, async (request, reply) => {
      const identity = await authenticate(database, auth, request.headers);
      requirePermission(identity, 'clients.manage');
      const params = z.object({ id: z.string().uuid() }).parse(request.params);
      const input = createClientScopeItemSchema.parse(request.body);
      const scopeItem = await createClientScopeItem(database, identity, params.id, input);
      return reply.code(201).send({ scopeItem });
    });
    app.patch(`${prefix}/:id/scope/:scopeId`, async (request) => {
      const identity = await authenticate(database, auth, request.headers);
      requirePermission(identity, 'clients.manage');
      const params = z.object({
        id: z.string().uuid(),
        scopeId: z.string().uuid(),
      }).parse(request.params);
      const input = updateClientScopeItemSchema.parse(request.body);
      const scopeItem = await updateClientScopeItem(database, identity, params.id, params.scopeId, input);
      return { scopeItem };
    });
    app.delete(`${prefix}/:id/scope/:scopeId`, async (request) => {
      const identity = await authenticate(database, auth, request.headers);
      requirePermission(identity, 'clients.manage');
      const params = z.object({
        id: z.string().uuid(),
        scopeId: z.string().uuid(),
      }).parse(request.params);
      await deleteClientScopeItem(database, identity, params.id, params.scopeId);
      return { success: true };
    });
  }

  // ==========================================
  // FASE 3: DEMANDAS E TAREFAS
  // ==========================================

  // Demands
  app.get('/api/v1/demands', async (request) => {
    const identity = await authenticate(database, auth, request.headers);
    requirePermission(identity, 'demands.read');
    const query = listDemandsQuerySchema.parse(request.query);
    return listDemands(database, identity, query);
  });

  app.post('/api/v1/demands', async (request, reply) => {
    const identity = await authenticate(database, auth, request.headers);
    requirePermission(identity, 'demands.write');
    const input = createDemandSchema.parse(request.body);
    const result = await createDemand(database, identity, input);
    return reply.code(201).send(result);
  });

  app.get('/api/v1/demands/:id', async (request) => {
    const identity = await authenticate(database, auth, request.headers);
    requirePermission(identity, 'demands.read');
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    return getDemandById(database, identity, params.id);
  });

  app.patch('/api/v1/demands/:id', async (request) => {
    const identity = await authenticate(database, auth, request.headers);
    requirePermission(identity, 'demands.write');
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const input = updateDemandSchema.parse(request.body);
    return updateDemand(database, identity, params.id, input);
  });

  app.post('/api/v1/demands/:id/complete', async (request) => {
    const identity = await authenticate(database, auth, request.headers);
    requirePermission(identity, 'demands.write');
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const input = completeDemandSchema.parse(request.body);
    return completeDemand(database, identity, params.id, input);
  });

  app.get('/api/v1/demands/:id/history', async (request) => {
    const identity = await authenticate(database, auth, request.headers);
    requirePermission(identity, 'demands.read');
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    return getDemandHistory(database, identity, params.id);
  });

  // Tasks
  app.post('/api/v1/tasks', async (request, reply) => {
    const identity = await authenticate(database, auth, request.headers);
    requirePermission(identity, 'tasks.manage');
    const input = createTaskSchema.parse(request.body);
    const result = await createTask(database, identity, input);
    return reply.code(201).send(result);
  });

  app.get('/api/v1/tasks/:id', async (request) => {
    const identity = await authenticate(database, auth, request.headers);
    requirePermission(identity, 'tasks.read');
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    return getTaskById(database, identity, params.id);
  });

  app.post('/api/v1/tasks/:id/accept', async (request) => {
    const identity = await authenticate(database, auth, request.headers);
    requirePermission(identity, 'tasks.execute');
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const input = taskVersionSchema.parse(request.body);
    return acceptTask(database, identity, params.id, input);
  });

  app.post('/api/v1/tasks/:id/start', async (request) => {
    const identity = await authenticate(database, auth, request.headers);
    requirePermission(identity, 'tasks.execute');
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const input = taskVersionSchema.parse(request.body);
    return startTask(database, identity, params.id, input);
  });

  app.post('/api/v1/tasks/:id/submit-review', { bodyLimit: 4 * 1024 * 1024 }, async (request) => {
    const identity = await authenticate(database, auth, request.headers);
    requirePermission(identity, 'tasks.execute');
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const input = submitTaskReviewSchema.parse(request.body);
    return submitTaskReview(database, identity, params.id, input);
  });

  app.post('/api/v1/tasks/:id/review', { bodyLimit: 4 * 1024 * 1024 }, async (request) => {
    const identity = await authenticate(database, auth, request.headers);
    requirePermission(identity, 'tasks.review');
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const input = reviewTaskSchema.parse(request.body);
    return reviewTask(database, identity, params.id, input);
  });

  app.post('/api/v1/tasks/:id/request-pause', async (request) => {
    const identity = await authenticate(database, auth, request.headers);
    requirePermission(identity, 'tasks.execute');
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const input = requestTaskPauseSchema.parse(request.body);
    return requestTaskPause(database, identity, params.id, input);
  });

  app.post('/api/v1/tasks/:id/approve-pause', async (request) => {
    const identity = await authenticate(database, auth, request.headers);
    requirePermission(identity, 'tasks.manage');
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const input = approveTaskPauseSchema.parse(request.body);
    return approveTaskPause(database, identity, params.id, input);
  });

  app.post('/api/v1/tasks/:id/resume', async (request) => {
    const identity = await authenticate(database, auth, request.headers);
    requirePermission(identity, 'tasks.manage');
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const input = taskVersionSchema.parse(request.body);
    return resumeTask(database, identity, params.id, input);
  });

  app.post('/api/v1/tasks/:id/reassign', async (request) => {
    const identity = await authenticate(database, auth, request.headers);
    requirePermission(identity, 'tasks.manage');
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const input = reassignTaskSchema.parse(request.body);
    return reassignTask(database, identity, params.id, input);
  });

  app.patch('/api/v1/tasks/:id/requirements/:requirementId', async (request) => {
    const identity = await authenticate(database, auth, request.headers);
    requirePermission(identity, 'tasks.manage');
    const params = z.object({ id: z.string().uuid(), requirementId: z.string().uuid() }).parse(request.params);
    const input = updateRequirementSchema.parse(request.body);
    return updateRequirement(database, identity, params.id, params.requirementId, input);
  });

  app.post('/api/v1/tasks/:id/dependencies', async (request) => {
    const identity = await authenticate(database, auth, request.headers);
    requirePermission(identity, 'tasks.manage');
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const input = addDependencySchema.parse(request.body);
    return addDependency(database, identity, params.id, input);
  });

  app.delete('/api/v1/tasks/:id/dependencies/:dependencyId', async (request) => {
    const identity = await authenticate(database, auth, request.headers);
    requirePermission(identity, 'tasks.manage');
    const params = z.object({ id: z.string().uuid(), dependencyId: z.string().uuid() }).parse(request.params);
    const input = removeDependencySchema.parse(request.body);
    return removeDependency(database, identity, params.id, params.dependencyId, input);
  });

  app.get('/api/v1/tasks/:id/comments', async (request) => {
    const identity = await authenticate(database, auth, request.headers);
    requirePermission(identity, 'tasks.read');
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    return listTaskComments(database, identity, params.id);
  });

  app.post('/api/v1/tasks/:id/comments', { bodyLimit: 4 * 1024 * 1024 }, async (request, reply) => {
    const identity = await authenticate(database, auth, request.headers);
    if (!identity.permissions.includes('tasks.execute') && !identity.permissions.includes('tasks.manage')) {
      throw new AppError(403, 'FORBIDDEN');
    }
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const input = createTaskCommentSchema.parse(request.body);
    const result = await createTaskComment(database, identity, params.id, input);
    return reply.code(201).send(result);
  });

  app.get('/api/v1/dashboard', async (request) => {
    const identity = await authenticate(database, auth, request.headers);
    requirePermission(identity, 'demands.read');
    requirePermission(identity, 'tasks.read');
    const query = dashboardQuerySchema.parse(request.query);
    return getDashboard(database, identity, query);
  });

  app.get('/api/v1/materials/targets', async (request) => {
    const identity = await authenticate(database, auth, request.headers);
    requirePermission(identity, 'materials.read');
    const query = listMaterialTargetsQuerySchema.parse(request.query);
    return listMaterialTargets(database, identity, query);
  });

  app.get('/api/v1/materials', async (request) => {
    const identity = await authenticate(database, auth, request.headers);
    requirePermission(identity, 'materials.read');
    const query = listMaterialsQuerySchema.parse(request.query);
    return listMaterials(database, identity, query);
  });

  app.post('/api/v1/materials', async (request, reply) => {
    const identity = await authenticate(database, auth, request.headers);
    requirePermission(identity, 'materials.write');
    const input = createMaterialSchema.parse(request.body);
    const result = await createMaterial(database, identity, input);
    return reply.code(201).send(result);
  });

  app.get('/api/v1/materials/client-timeline/:clientId', async (request) => {
    const identity = await authenticate(database, auth, request.headers);
    requirePermission(identity, 'materials.read');
    requirePermission(identity, 'demands.read');
    const params = z.object({ clientId: z.string().uuid() }).parse(request.params);
    const query = clientTimelineQuerySchema.parse(request.query);
    return getClientTimeline(database, identity, params.clientId, query);
  });

  app.get('/api/v1/materials/:id', async (request) => {
    const identity = await authenticate(database, auth, request.headers);
    requirePermission(identity, 'materials.read');
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    return getMaterial(database, identity, params.id);
  });

  app.patch('/api/v1/materials/:id', async (request) => {
    const identity = await authenticate(database, auth, request.headers);
    requirePermission(identity, 'materials.write');
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const input = updateMaterialSchema.parse(request.body);
    return updateMaterial(database, identity, params.id, input);
  });

  app.post('/api/v1/materials/:id/archive', async (request) => {
    const identity = await authenticate(database, auth, request.headers);
    requirePermission(identity, 'materials.archive');
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const input = materialVersionInputSchema.parse(request.body);
    return archiveMaterial(database, identity, params.id, input.version);
  });

  app.post('/api/v1/materials/:id/restore', async (request) => {
    const identity = await authenticate(database, auth, request.headers);
    requirePermission(identity, 'materials.archive');
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const input = materialVersionInputSchema.parse(request.body);
    return restoreMaterial(database, identity, params.id, input.version);
  });

  app.get('/api/v1/materials/:id/history', async (request) => {
    const identity = await authenticate(database, auth, request.headers);
    requirePermission(identity, 'materials.read');
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const query = materialHistoryQuerySchema.parse(request.query);
    return getMaterialHistory(database, identity, params.id, query);
  });

  app.get('/api/v1/notifications', async (request) => {
    const sessionAuth = await authenticateInternal(database, auth, request.headers);
    const query = listNotificationsQuerySchema.parse(request.query);
    return listNotifications(database, sessionAuth, query);
  });

  app.post('/api/v1/notifications/:id/read', async (request) => {
    const sessionAuth = await authenticateInternal(database, auth, request.headers);
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    z.object({}).strict().parse(request.body);
    return markNotificationAsRead(database, sessionAuth, params.id);
  });

  // Fase 11 — Templates de Demandas
  app.get('/api/v1/demand-templates', async (request) => {
    const identity = await authenticate(database, auth, request.headers);
    requirePermission(identity, 'demands.read');
    return listDemandTemplates(database, identity);
  });

  app.get('/api/v1/demand-templates/:id', async (request) => {
    const identity = await authenticate(database, auth, request.headers);
    requirePermission(identity, 'demands.read');
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    return getDemandTemplateById(database, identity, params.id);
  });

  app.post('/api/v1/demand-templates', async (request, reply) => {
    const identity = await authenticate(database, auth, request.headers);
    requirePermission(identity, 'demands.write');
    if (!identity.roles.includes('administrator')) throw new AppError(403, 'FORBIDDEN');
    const input = createDemandTemplateInputSchema.parse(request.body);
    const result = await createDemandTemplate(database, identity, input);
    return reply.code(201).send(result);
  });

  app.patch('/api/v1/demand-templates/:id', async (request) => {
    const identity = await authenticate(database, auth, request.headers);
    requirePermission(identity, 'demands.write');
    if (!identity.roles.includes('administrator')) throw new AppError(403, 'FORBIDDEN');
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const input = updateDemandTemplateInputSchema.parse(request.body);
    return updateDemandTemplate(database, identity, params.id, input);
  });

  app.post('/api/v1/demand-templates/:id/instantiate', async (request, reply) => {
    const identity = await authenticate(database, auth, request.headers);
    requirePermission(identity, 'demands.write');
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const input = instantiateDemandTemplateInputSchema.parse(request.body);
    const result = await instantiateDemandTemplate(database, identity, params.id, input);
    return reply.code(201).send(result);
  });

  // Fase 11 — Relatórios Operacionais
  app.get('/api/v1/reports/productivity', async (request) => {
    const identity = await authenticate(database, auth, request.headers);
    requirePermission(identity, 'demands.read');
    const query = reportQuerySchema.parse(request.query);
    return getProductivityReport(database, identity, query);
  });

  app.get('/api/v1/reports/bottlenecks', async (request) => {
    const identity = await authenticate(database, auth, request.headers);
    requirePermission(identity, 'demands.read');
    const query = z.object({ clientId: z.string().uuid().optional() }).parse(request.query);
    return getBottlenecksReport(database, identity, query);
  });

  // Fase 10 — Backups & Google Drive (rclone crypt)
  app.get('/api/v1/backups/status', async (request) => {
    const identity = await authenticate(database, auth, request.headers);
    requirePermission(identity, 'roles.manage');
    if (!identity.roles.includes('administrator')) throw new AppError(403, 'FORBIDDEN');
    return getBackupStatus();
  });

  app.post('/api/v1/backups/run', async (request) => {
    const identity = await authenticate(database, auth, request.headers);
    requirePermission(identity, 'roles.manage');
    if (!identity.roles.includes('administrator')) throw new AppError(403, 'FORBIDDEN');
    return triggerBackup(database);
  });

  // Cofre de Credenciais (AES-256-GCM) & Hermes Agent
  app.get('/api/v1/hermes/status', async (request) => {
    const identity = await authenticate(database, auth, request.headers);
    requirePermission(identity, 'roles.manage');
    if (!identity.roles.includes('administrator')) throw new AppError(403, 'FORBIDDEN');
    return getHermesStatus(database);
  });

  app.get('/api/v1/vault/credentials', async (request) => {
    const identity = await authenticate(database, auth, request.headers);
    requirePermission(identity, 'roles.manage');
    if (!identity.roles.includes('administrator')) throw new AppError(403, 'FORBIDDEN');
    const query = z
      .object({
        clientId: z.string().uuid().optional(),
        search: z.string().max(120).optional(),
      })
      .parse(request.query);
    return listClientCredentials(config, database, query);
  });

  app.post('/api/v1/vault/credentials', async (request, reply) => {
    const identity = await authenticate(database, auth, request.headers);
    requirePermission(identity, 'roles.manage');
    if (!identity.roles.includes('administrator')) throw new AppError(403, 'FORBIDDEN');
    const input = createClientCredentialSchema.parse(request.body);
    const created = await createClientCredential(config, database, identity.user.id, input);
    return reply.code(201).send(created);
  });

  app.patch('/api/v1/vault/credentials/:id', async (request) => {
    const identity = await authenticate(database, auth, request.headers);
    requirePermission(identity, 'roles.manage');
    if (!identity.roles.includes('administrator')) throw new AppError(403, 'FORBIDDEN');
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const input = updateClientCredentialSchema.parse(request.body);
    return updateClientCredential(config, database, identity.user.id, params.id, input);
  });

  app.get('/api/v1/vault/credentials/:id/reveal', async (request) => {
    const identity = await authenticate(database, auth, request.headers);
    requirePermission(identity, 'roles.manage');
    if (!identity.roles.includes('administrator')) throw new AppError(403, 'FORBIDDEN');
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    return revealClientCredentialSecret(config, database, params.id);
  });

  app.delete('/api/v1/vault/credentials/:id', async (request) => {
    const identity = await authenticate(database, auth, request.headers);
    requirePermission(identity, 'roles.manage');
    if (!identity.roles.includes('administrator')) throw new AppError(403, 'FORBIDDEN');
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    return deleteClientCredential(database, params.id);
  });

  // Fase 8 — Web Push em Segundo Plano (VAPID RFC 8292 + AES-128-GCM RFC 8291)
  app.get('/api/v1/push/vapid-public-key', async (request) => {
    const identity = await authenticate(database, auth, request.headers);
    requirePermission(identity, 'protected.read');
    return { publicKey: getVapidConfig().publicKey, enabled: true };
  });

  app.post('/api/v1/push/subscribe', async (request) => {
    const identity = await authenticate(database, auth, request.headers);
    requirePermission(identity, 'protected.read');
    const input = z
      .object({
        endpoint: z.string().url().max(2048),
        keys: z.object({
          p256dh: z.string().min(16).max(512),
          auth: z.string().min(8).max(256),
        }),
        userAgent: z.string().max(512).optional().nullable(),
      })
      .parse(request.body);
    return savePushSubscription(database, identity.user.id, input);
  });

  app.post('/api/v1/push/unsubscribe', async (request) => {
    const identity = await authenticate(database, auth, request.headers);
    requirePermission(identity, 'protected.read');
    const input = z.object({ endpoint: z.string().url().max(2048) }).parse(request.body);
    return removePushSubscription(database, identity.user.id, input.endpoint);
  });

  app.post('/api/v1/push/test', async (request) => {
    const identity = await authenticate(database, auth, request.headers);
    requirePermission(identity, 'protected.read');
    return dispatchPushToUser(database, identity.user.id, {
      title: '🔔 Orium — Push em Segundo Plano Ativo!',
      body: `Olá ${identity.user.name}, seu celular está pronto para receber alertas mesmo com a tela bloqueada ou app fechado.`,
      tag: `orium-push-test-${Date.now()}`,
      url: '/',
    });
  });

  const pushInterval = setInterval(() => {
    void dispatchPendingNotificationsPush(database);
  }, 8000);
  pushInterval.unref();
  app.addHook('onClose', async () => {
    clearInterval(pushInterval);
  });

  await app.ready();
  return app;
}
