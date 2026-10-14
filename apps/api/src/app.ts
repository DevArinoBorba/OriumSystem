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
  reportQuerySchema,
} from '@orium/contracts';
import type { Config } from './config.js';
import { assertApplicationDatabase, type Database } from './db.js';
import { createAuth } from './auth.js';
import { authenticate, authenticateInternal, changeIdentity, changeRolePermissions, listUsers, provisionUser, publicIdentity, requirePermission, IDENTITY_LOCK, serializeIdentity } from './identity.js';
import { listClients, getClientById, createClient, updateClient, archiveClient, restoreClient } from './clients.js';
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

type Options = { config: Config; database: Database; logger?: FastifyServerOptions['logger'] };

export async function buildApp({ config, database, logger }: Options) {
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
      if (!String(request.headers['content-type'] ?? '').startsWith('application/json')) throw new AppError(415, 'JSON_REQUIRED');
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
  app.get('/api/v1/clients', async (request) => {
    const identity = await authenticate(database, auth, request.headers);
    requirePermission(identity, 'clients.read');
    const query = listClientsQuerySchema.parse(request.query);
    return listClients(database, query);
  });
  app.get('/api/v1/clients/:id', async (request) => {
    const identity = await authenticate(database, auth, request.headers);
    requirePermission(identity, 'clients.read');
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const client = await getClientById(database, params.id);
    return { client };
  });
  app.post('/api/v1/clients', async (request, reply) => {
    const identity = await authenticate(database, auth, request.headers);
    requirePermission(identity, 'clients.write');
    const input = createClientSchema.parse(request.body);
    const client = await createClient(database, identity, input);
    return reply.code(201).send({ client });
  });
  app.patch('/api/v1/clients/:id', async (request) => {
    const identity = await authenticate(database, auth, request.headers);
    requirePermission(identity, 'clients.write');
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const input = updateClientSchema.parse(request.body);
    const client = await updateClient(database, identity, params.id, input);
    return { client };
  });
  app.post('/api/v1/clients/:id/archive', async (request) => {
    const identity = await authenticate(database, auth, request.headers);
    requirePermission(identity, 'clients.archive');
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const input = clientVersionSchema.parse(request.body);
    const client = await archiveClient(database, identity, params.id, input.version);
    return { client };
  });
  app.post('/api/v1/clients/:id/restore', async (request) => {
    const identity = await authenticate(database, auth, request.headers);
    requirePermission(identity, 'clients.archive');
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const input = clientVersionSchema.parse(request.body);
    const client = await restoreClient(database, identity, params.id, input.version);
    return { client };
  });

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

  app.post('/api/v1/tasks/:id/submit-review', async (request) => {
    const identity = await authenticate(database, auth, request.headers);
    requirePermission(identity, 'tasks.execute');
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const input = submitTaskReviewSchema.parse(request.body);
    return submitTaskReview(database, identity, params.id, input);
  });

  app.post('/api/v1/tasks/:id/review', async (request) => {
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

  app.post('/api/v1/tasks/:id/comments', async (request, reply) => {
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

  await app.ready();
  return app;
}
