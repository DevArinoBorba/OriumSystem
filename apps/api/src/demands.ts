import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type {
  Demand,
  Task,
  Requirement,
  TaskComment,
  DemandEvent,
  CreateDemandInput,
  UpdateDemandInput,
  CompleteDemandInput,
  CreateTaskInput,
  TaskVersionInput,
  ReassignTaskInput,
  UpdateRequirementInput,
  AddDependencyInput,
  RemoveDependencyInput,
  SubmitTaskReviewInput,
  ReviewTaskInput,
  RequestTaskPauseInput,
  ApproveTaskPauseInput,
  CreateTaskCommentInput,
  ListDemandsQuery,
  DemandListResponse,
  DemandDetailResponse,
  DemandResponse,
  TaskResponse,
  TaskDetailResponse,
  TaskCommentsResponse,
  DemandHistoryResponse,
  SessionResponse,
  Permission,
  Role,
  DemandPriority,
  DemandStatus,
  TaskPriority,
  TaskStatus,
} from '@orium/contracts';
import { IDENTITY_LOCK, adminPermissions } from './identity.js';
import type { Database } from './db.js';
import { AppError } from './errors.js';
import { emitNotificationsForEvent, type NotificationEventContext } from './notifications-producer.js';

/** The exact audit event and its notifications share the caller's existing transaction. */
async function recordDemandEvent(client: PoolClient, sql: string, params: unknown[], context: NotificationEventContext): Promise<void> {
  const sourceEventId = params[0];
  if (typeof sourceEventId !== 'string') throw new Error('Invalid internal notification event ID.');
  await client.query(sql, params);
  await emitNotificationsForEvent(client, sourceEventId, context);
}

interface DemandRow {
  id: string;
  client_id: string;
  client_name?: string;
  created_by_user_id: string;
  title: string;
  description: string | null;
  priority: DemandPriority;
  delivery_date: Date | string;
  status: DemandStatus;
  version: number;
  created_at: Date | string;
  updated_at: Date | string;
}

interface TaskRow {
  id: string;
  demand_id: string;
  assigned_to_user_id: string;
  title: string;
  description: string | null;
  priority: TaskPriority;
  delivery_date: Date | string;
  status: TaskStatus;
  accepted_at: Date | string | null;
  ready_at: Date | string | null;
  started_at: Date | string | null;
  completed_at: Date | string | null;
  pause_requested_at: Date | string | null;
  pause_reason: string | null;
  paused_at: Date | string | null;
  delivery_notes: string | null;
  preview_url: string | null;
  version: number;
  created_at: Date | string;
  updated_at: Date | string;
}

interface RequirementRow {
  id: string;
  task_id: string;
  title: string;
  mandatory: boolean;
  satisfied: boolean;
  created_at: Date | string;
  updated_at: Date | string;
}

interface TaskCommentRow {
  id: string;
  task_id: string;
  author_id: string;
  author_name: string;
  content: string;
  created_at: Date | string;
}

interface DemandEventRow {
  id: string;
  demand_id: string;
  task_id: string | null;
  actor_id: string;
  actor_name: string;
  action: string;
  reason: string | null;
  metadata: Record<string, unknown> | null;
  created_at: Date | string;
}

interface RevalidatedActor {
  id: string;
  name: string;
  role: Role;
}

async function revalidateActorInsideTransaction(
  client: PoolClient,
  actorId: string,
  requiredPermission: Permission | ((role: Role) => Permission)
): Promise<RevalidatedActor> {
  const res = await client.query<{ id: string; name: string; active: boolean; role_id: string }>(`
    SELECT u.id, u.name, u.active, r.role_id
    FROM auth_user u
    JOIN user_role r ON r.user_id = u.id
    WHERE u.id = $1
  `, [actorId]);
  const user = res.rows[0];
  if (!user || !user.active) throw new AppError(401, 'UNAUTHENTICATED');

  const role = user.role_id as Role;
  const permission = typeof requiredPermission === 'function' ? requiredPermission(role) : requiredPermission;

  const permRes = await client.query<{ permission_id: string }>(`
    SELECT permission_id FROM role_permission WHERE role_id = $1 AND permission_id = $2
  `, [role, permission]);
  if (permRes.rows.length === 0) throw new AppError(403, 'FORBIDDEN');

  if (adminPermissions.includes(permission) && role !== 'administrator') {
    throw new AppError(403, 'FORBIDDEN');
  }

  return { id: user.id, name: user.name, role };
}

function formatDate(d: unknown): string {
  if (!d) return '';
  if (typeof d === 'string') return d.slice(0, 10);
  if (d instanceof Date) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  return String(d).slice(0, 10);
}

function formatIso(d: unknown): string {
  return new Date(d as string | number | Date).toISOString();
}

function formatNullableIso(d: unknown): string | null {
  return d ? new Date(d as string | number | Date).toISOString() : null;
}

function formatDemand(row: DemandRow, clientName?: string): Demand {
  return {
    id: row.id,
    clientId: row.client_id,
    client: { id: row.client_id, name: clientName ?? row.client_name ?? '' },
    createdByUserId: row.created_by_user_id,
    title: row.title,
    description: row.description ?? '',
    priority: row.priority,
    deliveryDate: formatDate(row.delivery_date),
    status: row.status,
    version: row.version,
    createdAt: formatIso(row.created_at),
    updatedAt: formatIso(row.updated_at),
  };
}

function formatTask(row: TaskRow): Task {
  return {
    id: row.id,
    demandId: row.demand_id,
    assignedToUserId: row.assigned_to_user_id,
    title: row.title,
    description: row.description ?? '',
    priority: row.priority,
    deliveryDate: formatDate(row.delivery_date),
    status: row.status,
    acceptedAt: formatNullableIso(row.accepted_at),
    readyAt: formatNullableIso(row.ready_at),
    startedAt: formatNullableIso(row.started_at),
    completedAt: formatNullableIso(row.completed_at),
    pauseRequestedAt: formatNullableIso(row.pause_requested_at),
    pauseReason: row.pause_reason ?? null,
    deliveryNotes: row.delivery_notes ?? null,
    previewUrl: row.preview_url ?? null,
    version: row.version,
    createdAt: formatIso(row.created_at),
    updatedAt: formatIso(row.updated_at),
  };
}

function formatRequirement(row: RequirementRow): Requirement {
  return {
    id: row.id,
    taskId: row.task_id,
    title: row.title,
    mandatory: Boolean(row.mandatory),
    satisfied: Boolean(row.satisfied),
    createdAt: formatIso(row.created_at),
    updatedAt: formatIso(row.updated_at),
  };
}

function formatTaskComment(row: TaskCommentRow): TaskComment {
  return {
    id: row.id,
    taskId: row.task_id,
    authorId: row.author_id,
    authorName: row.author_name,
    content: row.content,
    createdAt: formatIso(row.created_at),
  };
}

function formatDemandEvent(row: DemandEventRow): DemandEvent {
  return {
    id: row.id,
    demandId: row.demand_id,
    taskId: row.task_id ?? null,
    actorId: row.actor_id,
    actorName: row.actor_name,
    action: row.action,
    reason: row.reason ?? null,
    metadata: typeof row.metadata === 'object' && row.metadata !== null ? row.metadata : {},
    createdAt: formatIso(row.created_at),
  };
}

function safeFormatDemand(row: DemandRow | undefined, clientName?: string): Demand {
  if (!row) throw new AppError(500, 'DEMAND_OPERATION_FAILED');
  return formatDemand(row, clientName);
}

function safeFormatTask(row: TaskRow | undefined): Task {
  if (!row) throw new AppError(500, 'TASK_OPERATION_FAILED');
  return formatTask(row);
}

function safeFormatTaskComment(row: TaskCommentRow | undefined): TaskComment {
  if (!row) throw new AppError(500, 'COMMENT_OPERATION_FAILED');
  return formatTaskComment(row);
}

function wouldCreateCycle(existingEdges: { taskId: string; dependsOnTaskId: string }[], newTaskId: string, newDependsOnTaskId: string): boolean {
  if (newTaskId === newDependsOnTaskId) return true;
  const adj = new Map<string, string[]>();
  for (const edge of existingEdges) {
    if (!adj.has(edge.taskId)) adj.set(edge.taskId, []);
    adj.get(edge.taskId)!.push(edge.dependsOnTaskId);
  }
  const visited = new Set<string>();
  const stack = [newDependsOnTaskId];
  while (stack.length > 0) {
    const curr = stack.pop()!;
    if (curr === newTaskId) return true;
    if (!visited.has(curr)) {
      visited.add(curr);
      const neighbors = adj.get(curr) ?? [];
      for (const n of neighbors) {
        if (!visited.has(n)) stack.push(n);
      }
    }
  }
  return false;
}

async function evaluateTaskReadiness(
  client: PoolClient,
  taskId: string
): Promise<{ ready: boolean; allRequirementsSatisfied: boolean; allDependenciesCompleted: boolean }> {
  const reqRes = await client.query<{ count: number }>(`
    SELECT count(*)::int AS count
    FROM task_requirement
    WHERE task_id = $1 AND mandatory = true AND satisfied = false
  `, [taskId]);
  const unsatCount = reqRes.rows[0]?.count ?? 0;
  const allRequirementsSatisfied = unsatCount === 0;

  const depRes = await client.query<{ count: number }>(`
    SELECT count(*)::int AS count
    FROM task_dependency td
    JOIN task t ON t.id = td.depends_on_task_id
    WHERE td.task_id = $1 AND t.status != 'completed'
  `, [taskId]);
  const uncompletedDeps = depRes.rows[0]?.count ?? 0;
  const allDependenciesCompleted = uncompletedDeps === 0;

  const ready = allRequirementsSatisfied && allDependenciesCompleted;
  return { ready, allRequirementsSatisfied, allDependenciesCompleted };
}

// -------------------------------------------------------------
// DEMANDS
// -------------------------------------------------------------

export async function listDemands(
  database: Database,
  identity: SessionResponse,
  query: ListDemandsQuery
): Promise<DemandListResponse> {
  const isCollaborator = !identity.roles.includes('administrator');
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (isCollaborator) {
    params.push(identity.user.id);
    conditions.push(`EXISTS (SELECT 1 FROM task t WHERE t.demand_id = d.id AND t.assigned_to_user_id = $${params.length})`);
  }

  if (query.status !== 'all') {
    params.push(query.status);
    conditions.push(`d.status = $${params.length}`);
  }

  if (query.priority !== 'all') {
    params.push(query.priority);
    conditions.push(`d.priority = $${params.length}`);
  }

  if (query.clientId) {
    params.push(query.clientId);
    conditions.push(`d.client_id = $${params.length}`);
  }

  if (query.q && query.q.length > 0) {
    const escaped = `%${query.q.replace(/[%_\\]/g, '\\$&')}%`;
    params.push(escaped);
    const paramIndex = params.length;
    conditions.push(`(d.title ILIKE $${paramIndex} ESCAPE '\\' OR d.description ILIKE $${paramIndex} ESCAPE '\\')`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const countQuery = `SELECT count(*)::int AS total FROM demand d ${whereClause}`;
  const countResult = await database.pool.query<{ total: number }>(countQuery, params);
  const total = countResult.rows[0]?.total ?? 0;

  const page = query.page;
  const pageSize = query.pageSize;
  const offset = (page - 1) * pageSize;

  params.push(pageSize);
  const limitParamIndex = params.length;
  params.push(offset);
  const offsetParamIndex = params.length;

  const dataQuery = `
    SELECT d.*, c.name AS client_name
    FROM demand d
    JOIN client c ON c.id = d.client_id
    ${whereClause}
    ORDER BY d.created_at DESC, d.id DESC
    LIMIT $${limitParamIndex} OFFSET $${offsetParamIndex}
  `;

  const result = await database.pool.query<DemandRow>(dataQuery, params);
  const demands = result.rows.map((row) => formatDemand(row, row.client_name));

  return {
    demands,
    total,
    page,
    pageSize,
  };
}

export async function createDemand(
  database: Database,
  identity: SessionResponse,
  input: CreateDemandInput
): Promise<DemandResponse> {
  const dbClient = await database.pool.connect();
  try {
    await dbClient.query('BEGIN');
    await dbClient.query('SELECT pg_advisory_xact_lock($1)', [IDENTITY_LOCK]);

    const actor = await revalidateActorInsideTransaction(dbClient, identity.user.id, 'demands.write');

    const clientCheck = await dbClient.query<{ id: string; name: string }>(`
      SELECT id, name FROM client WHERE id = $1 AND archived_at IS NULL FOR SHARE
    `, [input.clientId]);
    const clientRow = clientCheck.rows[0];
    if (!clientRow) throw new AppError(400, 'CLIENT_NOT_FOUND_OR_INACTIVE');

    const id = randomUUID();
    const insertRes = await dbClient.query<DemandRow>(`
      INSERT INTO demand (id, client_id, created_by_user_id, title, description, priority, delivery_date, status, version)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'open', 1)
      RETURNING *
    `, [id, input.clientId, actor.id, input.title, input.description, input.priority, input.deliveryDate]);

    await recordDemandEvent(dbClient, `
      INSERT INTO demand_event (id, demand_id, task_id, actor_id, actor_name, action, reason, metadata)
      VALUES ($1, $2, NULL, $3, $4, 'demand_created', NULL, $5)
    `, [randomUUID(), id, actor.id, actor.name, JSON.stringify({ priority: input.priority, deliveryDate: input.deliveryDate })], {});

    if (input.assignedToUserId) {
      const assigneeCheck = await dbClient.query<{ id: string }>(`
        SELECT id FROM auth_user WHERE id = $1 AND active = true FOR SHARE
      `, [input.assignedToUserId]);
      const assigneeId = assigneeCheck.rows[0]?.id ?? actor.id;

      const reqList = input.requirements ?? [];
      const hasMandatoryRequirements = reqList.some((r) => r.mandatory);
      const initialTaskStatus: TaskStatus = hasMandatoryRequirements ? 'blocked' : 'ready';
      const taskId = randomUUID();

      await dbClient.query(`
        INSERT INTO task (
          id, demand_id, assigned_to_user_id, title, description, priority, delivery_date,
          status, ready_at, version
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CASE WHEN $8 = 'ready' THEN now() ELSE NULL END, 1)
      `, [
        taskId,
        id,
        assigneeId,
        input.title,
        input.description,
        input.priority,
        input.deliveryDate,
        initialTaskStatus,
      ]);

      for (const req of reqList) {
        await dbClient.query(`
          INSERT INTO task_requirement (id, task_id, title, mandatory, satisfied)
          VALUES ($1, $2, $3, $4, false)
        `, [randomUUID(), taskId, req.title, req.mandatory]);
      }
    }

    await dbClient.query('COMMIT');
    return { demand: safeFormatDemand(insertRes.rows[0], clientRow.name) };
  } catch (err) {
    await dbClient.query('ROLLBACK');
    throw err;
  } finally {
    dbClient.release();
  }
}

export async function getDemandById(
  database: Database,
  identity: SessionResponse,
  demandId: string
): Promise<DemandDetailResponse> {
  const isCollaborator = !identity.roles.includes('administrator');

  const demandRes = await database.pool.query<DemandRow>(`
    SELECT d.*, c.name AS client_name
    FROM demand d
    JOIN client c ON c.id = d.client_id
    WHERE d.id = $1
  `, [demandId]);
  const demandRow = demandRes.rows[0];
  if (!demandRow) throw new AppError(404, 'NOT_FOUND');

  let tasksQuery = `SELECT * FROM task WHERE demand_id = $1 ORDER BY created_at ASC, id ASC`;
  const tasksParams: unknown[] = [demandId];

  if (isCollaborator) {
    tasksParams.push(identity.user.id);
    tasksQuery = `SELECT * FROM task WHERE demand_id = $1 AND assigned_to_user_id = $2 ORDER BY created_at ASC, id ASC`;
  }

  const tasksRes = await database.pool.query<TaskRow>(tasksQuery, tasksParams);

  if (isCollaborator && tasksRes.rows.length === 0) {
    throw new AppError(404, 'NOT_FOUND');
  }

  return {
    demand: formatDemand(demandRow, demandRow.client_name),
    tasks: tasksRes.rows.map(formatTask),
  };
}

export async function updateDemand(
  database: Database,
  identity: SessionResponse,
  demandId: string,
  input: UpdateDemandInput
): Promise<DemandResponse> {
  const dbClient = await database.pool.connect();
  try {
    await dbClient.query('BEGIN');
    await dbClient.query('SELECT pg_advisory_xact_lock($1)', [IDENTITY_LOCK]);

    const actor = await revalidateActorInsideTransaction(dbClient, identity.user.id, 'demands.write');

    const checkRes = await dbClient.query<DemandRow>(`
      SELECT * FROM demand WHERE id = $1 FOR UPDATE
    `, [demandId]);
    const current = checkRes.rows[0];
    if (!current) throw new AppError(404, 'NOT_FOUND');
    if (current.version !== input.version) throw new AppError(409, 'VERSION_CONFLICT');

    const demandChanged = (input.title !== undefined && input.title !== current.title)
      || (input.description !== undefined && input.description !== (current.description ?? ''))
      || (input.priority !== undefined && input.priority !== current.priority)
      || (input.deliveryDate !== undefined && input.deliveryDate !== formatDate(current.delivery_date));

    const fields: string[] = [];
    const params: unknown[] = [demandId, input.version];

    if (input.title !== undefined) {
      params.push(input.title);
      fields.push(`title = $${params.length}`);
    }
    if (input.description !== undefined) {
      params.push(input.description);
      fields.push(`description = $${params.length}`);
    }
    if (input.priority !== undefined) {
      params.push(input.priority);
      fields.push(`priority = $${params.length}`);
    }
    if (input.deliveryDate !== undefined) {
      params.push(input.deliveryDate);
      fields.push(`delivery_date = $${params.length}`);
    }

    fields.push(`version = version + 1`, `updated_at = now()`);

    const updateQuery = `
      UPDATE demand SET ${fields.join(', ')}
      WHERE id = $1 AND version = $2
      RETURNING *
    `;
    const updateRes = await dbClient.query<DemandRow>(updateQuery, params);
    const updatedDemand = updateRes.rows[0];
    if (!updatedDemand) throw new AppError(500, 'DEMAND_UPDATE_FAILED');

    await dbClient.query(`
      UPDATE task
      SET title = $2,
          description = $3,
          priority = $4,
          delivery_date = $5,
          version = version + 1,
          updated_at = now()
      WHERE demand_id = $1
        AND (SELECT count(*) FROM task WHERE demand_id = $1) = 1
    `, [
      demandId,
      updatedDemand.title,
      updatedDemand.description,
      updatedDemand.priority,
      formatDate(updatedDemand.delivery_date),
    ]);

    const clientRes = await dbClient.query<{ name: string }>(`
      SELECT name FROM client WHERE id = $1
    `, [updatedDemand.client_id]);

    await recordDemandEvent(dbClient, `
      INSERT INTO demand_event (id, demand_id, task_id, actor_id, actor_name, action, reason, metadata)
      VALUES ($1, $2, NULL, $3, $4, 'demand_updated', NULL, $5)
    `, [randomUUID(), demandId, actor.id, actor.name, JSON.stringify(input)], { demandChanged });

    await dbClient.query('COMMIT');
    return { demand: formatDemand(updatedDemand, clientRes.rows[0]?.name) };
  } catch (err) {
    await dbClient.query('ROLLBACK');
    throw err;
  } finally {
    dbClient.release();
  }
}

export async function completeDemand(
  database: Database,
  identity: SessionResponse,
  demandId: string,
  input: CompleteDemandInput
): Promise<DemandResponse> {
  const dbClient = await database.pool.connect();
  try {
    await dbClient.query('BEGIN');
    await dbClient.query('SELECT pg_advisory_xact_lock($1)', [IDENTITY_LOCK]);

    const actor = await revalidateActorInsideTransaction(dbClient, identity.user.id, 'demands.write');

    const demandRes = await dbClient.query<{ id: string; version: number; status: string; client_id: string }>(`
      SELECT id, version, status, client_id FROM demand WHERE id = $1 FOR UPDATE
    `, [demandId]);
    const current = demandRes.rows[0];
    if (!current) throw new AppError(404, 'NOT_FOUND');
    if (current.version !== input.version) throw new AppError(409, 'VERSION_CONFLICT');
    if (current.status === 'completed') throw new AppError(400, 'DEMAND_ALREADY_COMPLETED');

    const tasksRes = await dbClient.query<{ id: string; status: string }>(`
      SELECT id, status FROM task WHERE demand_id = $1
    `, [demandId]);
    if (tasksRes.rows.length === 0) throw new AppError(400, 'DEMAND_HAS_NO_TASKS');
    const incomplete = tasksRes.rows.filter((t) => t.status !== 'completed');
    if (incomplete.length > 0) throw new AppError(400, 'TASKS_NOT_COMPLETED');

    const updateRes = await dbClient.query<DemandRow>(`
      UPDATE demand SET status = 'completed', version = version + 1, updated_at = now()
      WHERE id = $1 AND version = $2
      RETURNING *
    `, [demandId, input.version]);

    const clientRes = await dbClient.query<{ name: string }>(`
      SELECT name FROM client WHERE id = $1
    `, [current.client_id]);

    await recordDemandEvent(dbClient, `
      INSERT INTO demand_event (id, demand_id, task_id, actor_id, actor_name, action, reason, metadata)
      VALUES ($1, $2, NULL, $3, $4, 'demand_completed', NULL, '{}'::jsonb)
    `, [randomUUID(), demandId, actor.id, actor.name], {});

    await dbClient.query('COMMIT');
    return { demand: safeFormatDemand(updateRes.rows[0], clientRes.rows[0]?.name) };
  } catch (err) {
    await dbClient.query('ROLLBACK');
    throw err;
  } finally {
    dbClient.release();
  }
}

export async function deleteDemand(
  database: Database,
  identity: SessionResponse,
  demandId: string
): Promise<{ ok: true; id: string }> {
  const dbClient = await database.pool.connect();
  try {
    await dbClient.query('BEGIN');
    await dbClient.query('SELECT pg_advisory_xact_lock($1)', [IDENTITY_LOCK]);

    const actor = await revalidateActorInsideTransaction(dbClient, identity.user.id, 'demands.write');
    if (actor.role !== 'administrator') {
      throw new AppError(403, 'FORBIDDEN');
    }

    const demandRes = await dbClient.query<{ id: string; created_by_user_id: string }>(`
      SELECT id, created_by_user_id FROM demand WHERE id = $1 FOR UPDATE
    `, [demandId]);
    const current = demandRes.rows[0];
    if (!current) throw new AppError(404, 'NOT_FOUND');

    if (current.created_by_user_id !== actor.id) {
      throw new AppError(403, 'ONLY_DEMAND_CREATOR_CAN_DELETE');
    }

    // Desvincula materiais antes de excluir a demanda para não bloquear por FK restrict e preservar arquivos do cliente
    await dbClient.query(`
      UPDATE material
      SET task_id = NULL, demand_id = NULL, version = version + 1, updated_at = now()
      WHERE demand_id = $1
    `, [demandId]);

    await dbClient.query(`DELETE FROM demand WHERE id = $1`, [demandId]);

    await dbClient.query('COMMIT');
    return { ok: true, id: demandId };
  } catch (err) {
    await dbClient.query('ROLLBACK');
    throw err;
  } finally {
    dbClient.release();
  }
}

export async function getDemandHistory(
  database: Database,
  identity: SessionResponse,
  demandId: string
): Promise<DemandHistoryResponse> {
  const isCollaborator = !identity.roles.includes('administrator');

  const demandCheck = await database.pool.query<{ id: string }>(`
    SELECT id FROM demand WHERE id = $1
  `, [demandId]);
  if (!demandCheck.rows[0]) throw new AppError(404, 'NOT_FOUND');

  if (isCollaborator) {
    const accessCheck = await database.pool.query<{ id: string }>(`
      SELECT id FROM task WHERE demand_id = $1 AND assigned_to_user_id = $2
    `, [demandId, identity.user.id]);
    if (accessCheck.rows.length === 0) throw new AppError(404, 'NOT_FOUND');

    const eventsRes = await database.pool.query<DemandEventRow>(`
      SELECT e.*
      FROM demand_event e
      WHERE e.demand_id = $1 AND e.task_id IN (
        SELECT id FROM task WHERE demand_id = $1 AND assigned_to_user_id = $2
      )
      ORDER BY e.created_at ASC, e.id ASC
    `, [demandId, identity.user.id]);
    return { events: eventsRes.rows.map(formatDemandEvent) };
  }

  const eventsRes = await database.pool.query<DemandEventRow>(`
    SELECT * FROM demand_event WHERE demand_id = $1 ORDER BY created_at ASC, id ASC
  `, [demandId]);
  return { events: eventsRes.rows.map(formatDemandEvent) };
}

// -------------------------------------------------------------
// TASKS
// -------------------------------------------------------------

export async function createTask(
  database: Database,
  identity: SessionResponse,
  input: CreateTaskInput
): Promise<TaskResponse> {
  const dbClient = await database.pool.connect();
  try {
    await dbClient.query('BEGIN');
    await dbClient.query('SELECT pg_advisory_xact_lock($1)', [IDENTITY_LOCK]);

    const actor = await revalidateActorInsideTransaction(dbClient, identity.user.id, 'tasks.manage');

    const demandRes = await dbClient.query<{ id: string; status: string; delivery_date: Date | string }>(`
      SELECT id, status, delivery_date FROM demand WHERE id = $1 FOR UPDATE
    `, [input.demandId]);
    const demandRow = demandRes.rows[0];
    if (!demandRow) throw new AppError(404, 'DEMAND_NOT_FOUND');
    if (demandRow.status !== 'open') throw new AppError(400, 'DEMAND_NOT_OPEN');

    const userCheck = await dbClient.query<{ id: string; active: boolean }>(`
      SELECT id, active FROM auth_user WHERE id = $1 FOR SHARE
    `, [input.assignedToUserId]);
    const userRow = userCheck.rows[0];
    if (!userRow || !userRow.active) throw new AppError(400, 'USER_NOT_FOUND_OR_INACTIVE');

    const taskId = randomUUID();
    const finalDeliveryDate = input.deliveryDate ?? formatDate(demandRow.delivery_date);

    if (input.dependsOnTaskIds.length > 0) {
      const depCheck = await dbClient.query<{ id: string }>(`
        SELECT id FROM task WHERE demand_id = $1 AND id = ANY($2::uuid[])
      `, [input.demandId, input.dependsOnTaskIds]);
      if (depCheck.rows.length !== input.dependsOnTaskIds.length) {
        throw new AppError(400, 'INVALID_DEPENDENCY_TASK');
      }
    }

    const taskRes = await dbClient.query<TaskRow>(`
      INSERT INTO task (
        id, demand_id, assigned_to_user_id, title, description, priority,
        delivery_date, status, ready_at, version
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'blocked', NULL, 1)
      RETURNING *
    `, [
      taskId,
      input.demandId,
      input.assignedToUserId,
      input.title,
      input.description,
      input.priority,
      finalDeliveryDate,
    ]);

    for (const req of input.requirements) {
      await dbClient.query(`
        INSERT INTO task_requirement (id, task_id, title, mandatory, satisfied)
        VALUES ($1, $2, $3, $4, false)
      `, [randomUUID(), taskId, req.title, req.mandatory]);
    }

    for (const depId of input.dependsOnTaskIds) {
      await dbClient.query(`
        INSERT INTO task_dependency (task_id, depends_on_task_id)
        VALUES ($1, $2)
      `, [taskId, depId]);
    }

    const { ready } = await evaluateTaskReadiness(dbClient, taskId);
    let finalTaskRow = taskRes.rows[0];
    if (!finalTaskRow) throw new AppError(500, 'TASK_CREATION_FAILED');
    if (ready) {
      const updateReady = await dbClient.query<TaskRow>(`
        UPDATE task SET status = 'ready', ready_at = now()
        WHERE id = $1
        RETURNING *
      `, [taskId]);
      if (updateReady.rows[0]) {
        finalTaskRow = updateReady.rows[0];
      }
    }

    await recordDemandEvent(dbClient, `
      INSERT INTO demand_event (id, demand_id, task_id, actor_id, actor_name, action, reason, metadata)
      VALUES ($1, $2, $3, $4, $5, 'task_created', NULL, $6)
    `, [
      randomUUID(),
      input.demandId,
      taskId,
      actor.id,
      actor.name,
      JSON.stringify({ assignedToUserId: input.assignedToUserId, priority: input.priority, status: finalTaskRow.status }),
    ], {});

    await dbClient.query('COMMIT');
    return { task: formatTask(finalTaskRow) };
  } catch (err) {
    await dbClient.query('ROLLBACK');
    throw err;
  } finally {
    dbClient.release();
  }
}

export async function getTaskById(
  database: Database,
  identity: SessionResponse,
  taskId: string
): Promise<TaskDetailResponse> {
  const isCollaborator = !identity.roles.includes('administrator');

  const taskRes = await database.pool.query<TaskRow>(`
    SELECT * FROM task WHERE id = $1
  `, [taskId]);
  const taskRow = taskRes.rows[0];
  if (!taskRow) throw new AppError(404, 'NOT_FOUND');

  if (isCollaborator && taskRow.assigned_to_user_id !== identity.user.id) {
    throw new AppError(404, 'NOT_FOUND');
  }

  const reqRes = await database.pool.query<RequirementRow>(`
    SELECT * FROM task_requirement WHERE task_id = $1 ORDER BY created_at ASC, id ASC
  `, [taskId]);

  const depRes = await database.pool.query<{ depends_on_task_id: string; status: string }>(`
    SELECT td.depends_on_task_id, t.status
    FROM task_dependency td
    JOIN task t ON t.id = td.depends_on_task_id
    WHERE td.task_id = $1
    ORDER BY td.created_at ASC
  `, [taskId]);

  return {
    task: formatTask(taskRow),
    requirements: reqRes.rows.map(formatRequirement),
    dependencies: depRes.rows.map((d) => ({
      id: d.depends_on_task_id,
      satisfied: d.status === 'completed',
    })),
  };
}

export async function acceptTask(
  database: Database,
  identity: SessionResponse,
  taskId: string,
  input: TaskVersionInput
): Promise<TaskResponse> {
  const dbClient = await database.pool.connect();
  try {
    await dbClient.query('BEGIN');
    await dbClient.query('SELECT pg_advisory_xact_lock($1)', [IDENTITY_LOCK]);

    const actor = await revalidateActorInsideTransaction(dbClient, identity.user.id, 'tasks.execute');

    const taskRes = await dbClient.query<{ id: string; demand_id: string }>(`
      SELECT id, demand_id FROM task WHERE id = $1
    `, [taskId]);
    const taskRow = taskRes.rows[0];
    if (!taskRow) throw new AppError(404, 'NOT_FOUND');

    await dbClient.query(`SELECT id FROM demand WHERE id = $1 FOR UPDATE`, [taskRow.demand_id]);
    const lockedTaskRes = await dbClient.query<TaskRow>(`
      SELECT * FROM task WHERE id = $1 FOR UPDATE
    `, [taskId]);
    const lockedTask = lockedTaskRes.rows[0];
    if (!lockedTask) throw new AppError(404, 'NOT_FOUND');

    if (lockedTask.assigned_to_user_id !== actor.id) throw new AppError(403, 'FORBIDDEN');
    if (lockedTask.version !== input.version) throw new AppError(409, 'VERSION_CONFLICT');
    if (lockedTask.accepted_at !== null) throw new AppError(409, 'TASK_ALREADY_ACCEPTED');
    if (lockedTask.started_at !== null || lockedTask.status === 'completed') {
      throw new AppError(409, 'TASK_ALREADY_STARTED_OR_COMPLETED');
    }

    const updateRes = await dbClient.query<TaskRow>(`
      UPDATE task
      SET accepted_at = now(), version = version + 1, updated_at = now()
      WHERE id = $1 AND version = $2
      RETURNING *
    `, [taskId, input.version]);

    await recordDemandEvent(dbClient, `
      INSERT INTO demand_event (id, demand_id, task_id, actor_id, actor_name, action, reason, metadata)
      VALUES ($1, $2, $3, $4, $5, 'task_accepted', NULL, '{}'::jsonb)
    `, [randomUUID(), lockedTask.demand_id, taskId, actor.id, actor.name], {});

    await dbClient.query('COMMIT');
    return { task: safeFormatTask(updateRes.rows[0]) };
  } catch (err) {
    await dbClient.query('ROLLBACK');
    throw err;
  } finally {
    dbClient.release();
  }
}

export async function startTask(
  database: Database,
  identity: SessionResponse,
  taskId: string,
  input: TaskVersionInput
): Promise<TaskResponse> {
  const dbClient = await database.pool.connect();
  try {
    await dbClient.query('BEGIN');
    await dbClient.query('SELECT pg_advisory_xact_lock($1)', [IDENTITY_LOCK]);

    const actor = await revalidateActorInsideTransaction(dbClient, identity.user.id, 'tasks.execute');

    const initialCheck = await dbClient.query<{ demand_id: string }>(`SELECT demand_id FROM task WHERE id = $1`, [taskId]);
    if (!initialCheck.rows[0]) throw new AppError(404, 'NOT_FOUND');

    await dbClient.query(`SELECT id FROM demand WHERE id = $1 FOR UPDATE`, [initialCheck.rows[0].demand_id]);

    const taskRes = await dbClient.query<TaskRow>(`
      SELECT * FROM task WHERE id = $1 FOR UPDATE
    `, [taskId]);
    const taskRow = taskRes.rows[0];
    if (!taskRow) throw new AppError(404, 'NOT_FOUND');

    if (taskRow.assigned_to_user_id !== actor.id) throw new AppError(403, 'FORBIDDEN');
    if (taskRow.version !== input.version) throw new AppError(409, 'VERSION_CONFLICT');
    if (!taskRow.accepted_at) throw new AppError(400, 'TASK_NOT_ACCEPTED');
    if (taskRow.status !== 'ready' && taskRow.status !== 'changes_requested') {
      throw new AppError(400, 'TASK_NOT_READY_OR_CHANGES_REQUESTED');
    }

    const { ready, allRequirementsSatisfied, allDependenciesCompleted } = await evaluateTaskReadiness(dbClient, taskId);
    if (!allRequirementsSatisfied) throw new AppError(400, 'MANDATORY_REQUIREMENTS_UNSATISFIED');
    if (!allDependenciesCompleted) throw new AppError(400, 'DEPENDENCIES_UNCOMPLETED');
    if (!ready) throw new AppError(400, 'TASK_NOT_READY');

    const updateRes = await dbClient.query<TaskRow>(`
      UPDATE task
      SET status = 'in_production',
          started_at = COALESCE(started_at, now()),
          version = version + 1,
          updated_at = now()
      WHERE id = $1 AND version = $2
      RETURNING *
    `, [taskId, input.version]);

    await recordDemandEvent(dbClient, `
      INSERT INTO demand_event (id, demand_id, task_id, actor_id, actor_name, action, reason, metadata)
      VALUES ($1, $2, $3, $4, $5, 'task_started', NULL, '{}'::jsonb)
    `, [randomUUID(), taskRow.demand_id, taskId, actor.id, actor.name], {});

    await dbClient.query('COMMIT');
    return { task: safeFormatTask(updateRes.rows[0]) };
  } catch (err) {
    await dbClient.query('ROLLBACK');
    throw err;
  } finally {
    dbClient.release();
  }
}

export async function submitTaskReview(
  database: Database,
  identity: SessionResponse,
  taskId: string,
  input: SubmitTaskReviewInput
): Promise<TaskResponse> {
  const dbClient = await database.pool.connect();
  try {
    await dbClient.query('BEGIN');
    await dbClient.query('SELECT pg_advisory_xact_lock($1)', [IDENTITY_LOCK]);

    const actor = await revalidateActorInsideTransaction(dbClient, identity.user.id, 'tasks.execute');

    const initialCheck = await dbClient.query<{ demand_id: string }>(`SELECT demand_id FROM task WHERE id = $1`, [taskId]);
    if (!initialCheck.rows[0]) throw new AppError(404, 'NOT_FOUND');

    await dbClient.query(`SELECT id FROM demand WHERE id = $1 FOR UPDATE`, [initialCheck.rows[0].demand_id]);

    const taskRes = await dbClient.query<TaskRow>(`
      SELECT * FROM task WHERE id = $1 FOR UPDATE
    `, [taskId]);
    const taskRow = taskRes.rows[0];
    if (!taskRow) throw new AppError(404, 'NOT_FOUND');

    if (taskRow.assigned_to_user_id !== actor.id) throw new AppError(403, 'FORBIDDEN');
    if (taskRow.version !== input.version) throw new AppError(409, 'VERSION_CONFLICT');
    if (taskRow.status !== 'in_production') throw new AppError(400, 'TASK_NOT_IN_PRODUCTION');

    const updateRes = await dbClient.query<TaskRow>(`
      UPDATE task
      SET status = 'in_review',
          delivery_notes = $3,
          preview_url = $4,
          version = version + 1,
          updated_at = now()
      WHERE id = $1 AND version = $2
      RETURNING *
    `, [taskId, input.version, input.deliveryNotes, input.previewUrl ?? null]);

    await recordDemandEvent(dbClient, `
      INSERT INTO demand_event (id, demand_id, task_id, actor_id, actor_name, action, reason, metadata)
      VALUES ($1, $2, $3, $4, $5, 'task_review_submitted', NULL, $6)
    `, [
      randomUUID(),
      taskRow.demand_id,
      taskId,
      actor.id,
      actor.name,
      JSON.stringify({ deliveryNotes: input.deliveryNotes, previewUrl: input.previewUrl ?? null }),
    ], {});

    await dbClient.query('COMMIT');
    return { task: safeFormatTask(updateRes.rows[0]) };
  } catch (err) {
    await dbClient.query('ROLLBACK');
    throw err;
  } finally {
    dbClient.release();
  }
}

export async function reviewTask(
  database: Database,
  identity: SessionResponse,
  taskId: string,
  input: ReviewTaskInput
): Promise<TaskResponse> {
  const dbClient = await database.pool.connect();
  try {
    await dbClient.query('BEGIN');
    await dbClient.query('SELECT pg_advisory_xact_lock($1)', [IDENTITY_LOCK]);

    const actor = await revalidateActorInsideTransaction(dbClient, identity.user.id, 'tasks.review');

    const initialCheck = await dbClient.query<{ demand_id: string }>(`SELECT demand_id FROM task WHERE id = $1`, [taskId]);
    if (!initialCheck.rows[0]) throw new AppError(404, 'NOT_FOUND');

    await dbClient.query(`SELECT id FROM demand WHERE id = $1 FOR UPDATE`, [initialCheck.rows[0].demand_id]);

    const taskRes = await dbClient.query<TaskRow>(`
      SELECT * FROM task WHERE id = $1 FOR UPDATE
    `, [taskId]);
    const taskRow = taskRes.rows[0];
    if (!taskRow) throw new AppError(404, 'NOT_FOUND');

    if (taskRow.version !== input.version) throw new AppError(409, 'VERSION_CONFLICT');
    if (taskRow.status !== 'in_review') throw new AppError(400, 'TASK_NOT_IN_REVIEW');

    let updateRes: { rows: TaskRow[] };

    if (input.decision === 'changes_requested') {
      updateRes = await dbClient.query<TaskRow>(`
        UPDATE task
        SET status = 'changes_requested',
            version = version + 1,
            updated_at = now()
        WHERE id = $1 AND version = $2
        RETURNING *
      `, [taskId, input.version]);

      await recordDemandEvent(dbClient, `
        INSERT INTO demand_event (id, demand_id, task_id, actor_id, actor_name, action, reason, metadata)
        VALUES ($1, $2, $3, $4, $5, 'task_changes_requested', $6, '{}'::jsonb)
      `, [randomUUID(), taskRow.demand_id, taskId, actor.id, actor.name, input.feedback], {});
    } else {
      updateRes = await dbClient.query<TaskRow>(`
        UPDATE task
        SET status = 'completed',
            completed_at = now(),
            version = version + 1,
            updated_at = now()
        WHERE id = $1 AND version = $2
        RETURNING *
      `, [taskId, input.version]);

      await recordDemandEvent(dbClient, `
        INSERT INTO demand_event (id, demand_id, task_id, actor_id, actor_name, action, reason, metadata)
        VALUES ($1, $2, $3, $4, $5, 'task_completed', $6, '{}'::jsonb)
      `, [randomUUID(), taskRow.demand_id, taskId, actor.id, actor.name, input.feedback], {});

      const dependentsRes = await dbClient.query<{ task_id: string }>(`
        SELECT task_id FROM task_dependency WHERE depends_on_task_id = $1
      `, [taskId]);

      for (const dep of dependentsRes.rows) {
        const depTaskRes = await dbClient.query<{ id: string; status: string }>(`
          SELECT id, status FROM task WHERE id = $1 FOR UPDATE
        `, [dep.task_id]);
        const depTask = depTaskRes.rows[0];
        if (depTask && depTask.status === 'blocked') {
          const { ready } = await evaluateTaskReadiness(dbClient, dep.task_id);
          if (ready) {
            await dbClient.query(`
              UPDATE task
              SET status = 'ready', ready_at = now(), version = version + 1, updated_at = now()
              WHERE id = $1
            `, [dep.task_id]);

            await recordDemandEvent(dbClient, `
              INSERT INTO demand_event (id, demand_id, task_id, actor_id, actor_name, action, reason, metadata)
              VALUES ($1, $2, $3, $4, $5, 'task_ready', NULL, '{}'::jsonb)
            `, [randomUUID(), taskRow.demand_id, dep.task_id, actor.id, actor.name], {});
          }
        }
      }
    }

    await dbClient.query('COMMIT');
    return { task: safeFormatTask(updateRes.rows[0]) };
  } catch (err) {
    await dbClient.query('ROLLBACK');
    throw err;
  } finally {
    dbClient.release();
  }
}

export async function requestTaskPause(
  database: Database,
  identity: SessionResponse,
  taskId: string,
  input: RequestTaskPauseInput
): Promise<TaskResponse> {
  const dbClient = await database.pool.connect();
  try {
    await dbClient.query('BEGIN');
    await dbClient.query('SELECT pg_advisory_xact_lock($1)', [IDENTITY_LOCK]);

    const actor = await revalidateActorInsideTransaction(dbClient, identity.user.id, 'tasks.execute');

    const initialCheck = await dbClient.query<{ demand_id: string }>(`SELECT demand_id FROM task WHERE id = $1`, [taskId]);
    if (!initialCheck.rows[0]) throw new AppError(404, 'NOT_FOUND');

    await dbClient.query(`SELECT id FROM demand WHERE id = $1 FOR UPDATE`, [initialCheck.rows[0].demand_id]);

    const taskRes = await dbClient.query<TaskRow>(`
      SELECT * FROM task WHERE id = $1 FOR UPDATE
    `, [taskId]);
    const taskRow = taskRes.rows[0];
    if (!taskRow) throw new AppError(404, 'NOT_FOUND');

    if (taskRow.assigned_to_user_id !== actor.id) throw new AppError(403, 'FORBIDDEN');
    if (taskRow.version !== input.version) throw new AppError(409, 'VERSION_CONFLICT');
    if (taskRow.status !== 'in_production') throw new AppError(400, 'TASK_NOT_IN_PRODUCTION');

    const updateRes = await dbClient.query<TaskRow>(`
      UPDATE task
      SET pause_requested_at = now(),
          pause_reason = $3,
          version = version + 1,
          updated_at = now()
      WHERE id = $1 AND version = $2
      RETURNING *
    `, [taskId, input.version, input.reason]);

    await recordDemandEvent(dbClient, `
      INSERT INTO demand_event (id, demand_id, task_id, actor_id, actor_name, action, reason, metadata)
      VALUES ($1, $2, $3, $4, $5, 'task_pause_requested', $6, '{}'::jsonb)
    `, [randomUUID(), taskRow.demand_id, taskId, actor.id, actor.name, input.reason], {});

    await dbClient.query('COMMIT');
    return { task: safeFormatTask(updateRes.rows[0]) };
  } catch (err) {
    await dbClient.query('ROLLBACK');
    throw err;
  } finally {
    dbClient.release();
  }
}

export async function approveTaskPause(
  database: Database,
  identity: SessionResponse,
  taskId: string,
  input: ApproveTaskPauseInput
): Promise<TaskResponse> {
  const dbClient = await database.pool.connect();
  try {
    await dbClient.query('BEGIN');
    await dbClient.query('SELECT pg_advisory_xact_lock($1)', [IDENTITY_LOCK]);

    const actor = await revalidateActorInsideTransaction(dbClient, identity.user.id, 'tasks.manage');

    const initialCheck = await dbClient.query<{ demand_id: string }>(`SELECT demand_id FROM task WHERE id = $1`, [taskId]);
    if (!initialCheck.rows[0]) throw new AppError(404, 'NOT_FOUND');

    await dbClient.query(`SELECT id FROM demand WHERE id = $1 FOR UPDATE`, [initialCheck.rows[0].demand_id]);

    const taskRes = await dbClient.query<TaskRow>(`
      SELECT * FROM task WHERE id = $1 FOR UPDATE
    `, [taskId]);
    const taskRow = taskRes.rows[0];
    if (!taskRow) throw new AppError(404, 'NOT_FOUND');

    if (taskRow.version !== input.version) throw new AppError(409, 'VERSION_CONFLICT');
    if (!taskRow.pause_requested_at) throw new AppError(400, 'NO_PENDING_PAUSE_REQUEST');
    if (taskRow.status !== 'in_production') throw new AppError(400, 'TASK_NOT_IN_PRODUCTION');

    const oldDeliveryDate = formatDate(taskRow.delivery_date);

    const updateRes = await dbClient.query<TaskRow>(`
      UPDATE task
      SET status = 'paused',
          delivery_date = $3,
          paused_at = now(),
          version = version + 1,
          updated_at = now()
      WHERE id = $1 AND version = $2
      RETURNING *
    `, [taskId, input.version, input.deliveryDate]);

    await recordDemandEvent(dbClient, `
      INSERT INTO demand_event (id, demand_id, task_id, actor_id, actor_name, action, reason, metadata)
      VALUES ($1, $2, $3, $4, $5, 'task_pause_approved', $6, $7)
    `, [
      randomUUID(),
      taskRow.demand_id,
      taskId,
      actor.id,
      actor.name,
      input.reason,
      JSON.stringify({
        oldDeliveryDate,
        newDeliveryDate: input.deliveryDate,
        originalPauseReason: taskRow.pause_reason,
      }),
    ], {});

    await dbClient.query('COMMIT');
    return { task: safeFormatTask(updateRes.rows[0]) };
  } catch (err) {
    await dbClient.query('ROLLBACK');
    throw err;
  } finally {
    dbClient.release();
  }
}

export async function resumeTask(
  database: Database,
  identity: SessionResponse,
  taskId: string,
  input: TaskVersionInput
): Promise<TaskResponse> {
  const dbClient = await database.pool.connect();
  try {
    await dbClient.query('BEGIN');
    await dbClient.query('SELECT pg_advisory_xact_lock($1)', [IDENTITY_LOCK]);

    const actor = await revalidateActorInsideTransaction(dbClient, identity.user.id, 'tasks.manage');

    const initialCheck = await dbClient.query<{ demand_id: string }>(`SELECT demand_id FROM task WHERE id = $1`, [taskId]);
    if (!initialCheck.rows[0]) throw new AppError(404, 'NOT_FOUND');

    await dbClient.query(`SELECT id FROM demand WHERE id = $1 FOR UPDATE`, [initialCheck.rows[0].demand_id]);

    const taskRes = await dbClient.query<TaskRow>(`
      SELECT * FROM task WHERE id = $1 FOR UPDATE
    `, [taskId]);
    const taskRow = taskRes.rows[0];
    if (!taskRow) throw new AppError(404, 'NOT_FOUND');

    if (taskRow.version !== input.version) throw new AppError(409, 'VERSION_CONFLICT');
    if (taskRow.status !== 'paused') throw new AppError(400, 'TASK_NOT_PAUSED');

    const pausedAtDate = taskRow.paused_at ? new Date(taskRow.paused_at) : new Date(taskRow.updated_at);
    const now = new Date();
    const pausedDurationSeconds = Math.max(0, Math.round((now.getTime() - pausedAtDate.getTime()) / 1000));

    const updateRes = await dbClient.query<TaskRow>(`
      UPDATE task
      SET status = 'in_production',
          pause_requested_at = NULL,
          pause_reason = NULL,
          paused_at = NULL,
          version = version + 1,
          updated_at = now()
      WHERE id = $1 AND version = $2
      RETURNING *
    `, [taskId, input.version]);

    await recordDemandEvent(dbClient, `
      INSERT INTO demand_event (id, demand_id, task_id, actor_id, actor_name, action, reason, metadata)
      VALUES ($1, $2, $3, $4, $5, 'task_resumed', NULL, $6)
    `, [
      randomUUID(),
      taskRow.demand_id,
      taskId,
      actor.id,
      actor.name,
      JSON.stringify({
        pausedAt: pausedAtDate.toISOString(),
        resumedAt: now.toISOString(),
        pausedDurationSeconds,
      }),
    ], {});

    await dbClient.query('COMMIT');
    return { task: safeFormatTask(updateRes.rows[0]) };
  } catch (err) {
    await dbClient.query('ROLLBACK');
    throw err;
  } finally {
    dbClient.release();
  }
}

export async function reassignTask(
  database: Database,
  identity: SessionResponse,
  taskId: string,
  input: ReassignTaskInput
): Promise<TaskResponse> {
  const dbClient = await database.pool.connect();
  try {
    await dbClient.query('BEGIN');
    await dbClient.query('SELECT pg_advisory_xact_lock($1)', [IDENTITY_LOCK]);

    const actor = await revalidateActorInsideTransaction(dbClient, identity.user.id, 'tasks.manage');

    const initialCheck = await dbClient.query<{ demand_id: string }>(`SELECT demand_id FROM task WHERE id = $1`, [taskId]);
    if (!initialCheck.rows[0]) throw new AppError(404, 'NOT_FOUND');

    await dbClient.query(`SELECT id FROM demand WHERE id = $1 FOR UPDATE`, [initialCheck.rows[0].demand_id]);

    const taskRes = await dbClient.query<TaskRow>(`
      SELECT * FROM task WHERE id = $1 FOR UPDATE
    `, [taskId]);
    const taskRow = taskRes.rows[0];
    if (!taskRow) throw new AppError(404, 'NOT_FOUND');

    const targetUserCheck = await dbClient.query<{ id: string; active: boolean }>(`
      SELECT id, active FROM auth_user WHERE id = $1 FOR SHARE
    `, [input.assignedToUserId]);
    const targetUser = targetUserCheck.rows[0];
    if (!targetUser || !targetUser.active) throw new AppError(400, 'USER_NOT_FOUND_OR_INACTIVE');

    if (taskRow.version !== input.version) throw new AppError(409, 'VERSION_CONFLICT');
    if (taskRow.started_at !== null) throw new AppError(409, 'CANNOT_REASSIGN_STARTED_TASK');

    const updateRes = await dbClient.query<TaskRow>(`
      UPDATE task
      SET assigned_to_user_id = $3,
          accepted_at = NULL,
          version = version + 1,
          updated_at = now()
      WHERE id = $1 AND version = $2
      RETURNING *
    `, [taskId, input.version, input.assignedToUserId]);

    await recordDemandEvent(dbClient, `
      INSERT INTO demand_event (id, demand_id, task_id, actor_id, actor_name, action, reason, metadata)
      VALUES ($1, $2, $3, $4, $5, 'task_reassigned', $6, $7)
    `, [
      randomUUID(),
      taskRow.demand_id,
      taskId,
      actor.id,
      actor.name,
      input.reason,
      JSON.stringify({ previousAssignedToUserId: taskRow.assigned_to_user_id, newAssignedToUserId: input.assignedToUserId }),
    ], {});

    await dbClient.query('COMMIT');
    return { task: safeFormatTask(updateRes.rows[0]) };
  } catch (err) {
    await dbClient.query('ROLLBACK');
    throw err;
  } finally {
    dbClient.release();
  }
}

export async function updateRequirement(
  database: Database,
  identity: SessionResponse,
  taskId: string,
  requirementId: string,
  input: UpdateRequirementInput
): Promise<TaskResponse> {
  const dbClient = await database.pool.connect();
  try {
    await dbClient.query('BEGIN');
    await dbClient.query('SELECT pg_advisory_xact_lock($1)', [IDENTITY_LOCK]);

    const actor = await revalidateActorInsideTransaction(dbClient, identity.user.id, 'tasks.manage');

    const initialCheck = await dbClient.query<{ demand_id: string }>(`SELECT demand_id FROM task WHERE id = $1`, [taskId]);
    if (!initialCheck.rows[0]) throw new AppError(404, 'NOT_FOUND');

    await dbClient.query(`SELECT id FROM demand WHERE id = $1 FOR UPDATE`, [initialCheck.rows[0].demand_id]);

    const taskRes = await dbClient.query<TaskRow>(`
      SELECT * FROM task WHERE id = $1 FOR UPDATE
    `, [taskId]);
    const taskRow = taskRes.rows[0];
    if (!taskRow) throw new AppError(404, 'NOT_FOUND');

    const reqRes = await dbClient.query<{ id: string }>(`
      SELECT id FROM task_requirement WHERE id = $1 AND task_id = $2 FOR UPDATE
    `, [requirementId, taskId]);
    if (!reqRes.rows[0]) throw new AppError(404, 'NOT_FOUND');

    if (taskRow.version !== input.version) throw new AppError(409, 'VERSION_CONFLICT');
    if (taskRow.started_at !== null) throw new AppError(409, 'TASK_ALREADY_STARTED');

    await dbClient.query(`
      UPDATE task_requirement
      SET satisfied = $3, updated_at = now()
      WHERE id = $1 AND task_id = $2
    `, [requirementId, taskId, input.satisfied]);

    const { ready } = await evaluateTaskReadiness(dbClient, taskId);
    const newStatus = ready ? 'ready' : 'blocked';
    const readyAt = ready ? new Date().toISOString() : null;

    const updateRes = await dbClient.query<TaskRow>(`
      UPDATE task
      SET status = $3,
          ready_at = $4,
          version = version + 1,
          updated_at = now()
      WHERE id = $1 AND version = $2
      RETURNING *
    `, [taskId, input.version, newStatus, readyAt]);

    await recordDemandEvent(dbClient, `
      INSERT INTO demand_event (id, demand_id, task_id, actor_id, actor_name, action, reason, metadata)
      VALUES ($1, $2, $3, $4, $5, 'task_requirement_updated', NULL, $6)
    `, [
      randomUUID(),
      taskRow.demand_id,
      taskId,
      actor.id,
      actor.name,
      JSON.stringify({ requirementId, satisfied: input.satisfied, newStatus }),
    ], { previousTaskStatus: taskRow.status });

    await dbClient.query('COMMIT');
    return { task: safeFormatTask(updateRes.rows[0]) };
  } catch (err) {
    await dbClient.query('ROLLBACK');
    throw err;
  } finally {
    dbClient.release();
  }
}

export async function addDependency(
  database: Database,
  identity: SessionResponse,
  taskId: string,
  input: AddDependencyInput
): Promise<TaskResponse> {
  const dbClient = await database.pool.connect();
  try {
    await dbClient.query('BEGIN');
    await dbClient.query('SELECT pg_advisory_xact_lock($1)', [IDENTITY_LOCK]);

    const actor = await revalidateActorInsideTransaction(dbClient, identity.user.id, 'tasks.manage');

    if (taskId === input.dependsOnTaskId) throw new AppError(400, 'CANNOT_DEPEND_ON_SELF');

    const initialCheck = await dbClient.query<{ demand_id: string }>(`SELECT demand_id FROM task WHERE id = $1`, [taskId]);
    if (!initialCheck.rows[0]) throw new AppError(404, 'NOT_FOUND');

    await dbClient.query(`SELECT id FROM demand WHERE id = $1 FOR UPDATE`, [initialCheck.rows[0].demand_id]);

    const taskRes = await dbClient.query<TaskRow>(`
      SELECT * FROM task WHERE id = $1 FOR UPDATE
    `, [taskId]);
    const taskRow = taskRes.rows[0];
    if (!taskRow) throw new AppError(404, 'NOT_FOUND');

    if (taskRow.version !== input.version) throw new AppError(409, 'VERSION_CONFLICT');
    if (taskRow.started_at !== null) throw new AppError(409, 'TASK_ALREADY_STARTED');

    const prereqRes = await dbClient.query<{ id: string; demand_id: string; status: string }>(`
      SELECT id, demand_id, status FROM task WHERE id = $1
    `, [input.dependsOnTaskId]);
    const prereq = prereqRes.rows[0];
    if (!prereq || prereq.demand_id !== taskRow.demand_id) {
      throw new AppError(400, 'INVALID_DEPENDENCY_TASK');
    }

    const existingCheck = await dbClient.query<{ task_id: string }>(`
      SELECT task_id FROM task_dependency WHERE task_id = $1 AND depends_on_task_id = $2
    `, [taskId, input.dependsOnTaskId]);
    if (existingCheck.rows[0]) throw new AppError(409, 'DEPENDENCY_ALREADY_EXISTS');

    const allEdges = await dbClient.query<{ task_id: string; depends_on_task_id: string }>(`
      SELECT td.task_id, td.depends_on_task_id
      FROM task_dependency td
      JOIN task t ON t.id = td.task_id
      WHERE t.demand_id = $1
    `, [taskRow.demand_id]);

    const edges = allEdges.rows.map((r) => ({ taskId: r.task_id, dependsOnTaskId: r.depends_on_task_id }));
    if (wouldCreateCycle(edges, taskId, input.dependsOnTaskId)) {
      throw new AppError(400, 'CYCLIC_DEPENDENCY_DETECTED');
    }

    await dbClient.query(`
      INSERT INTO task_dependency (task_id, depends_on_task_id)
      VALUES ($1, $2)
    `, [taskId, input.dependsOnTaskId]);

    const { ready } = await evaluateTaskReadiness(dbClient, taskId);
    const newStatus = ready ? 'ready' : 'blocked';
    const readyAt = ready ? new Date().toISOString() : null;

    const updateRes = await dbClient.query<TaskRow>(`
      UPDATE task
      SET status = $3,
          ready_at = $4,
          version = version + 1,
          updated_at = now()
      WHERE id = $1 AND version = $2
      RETURNING *
    `, [taskId, input.version, newStatus, readyAt]);

    await recordDemandEvent(dbClient, `
      INSERT INTO demand_event (id, demand_id, task_id, actor_id, actor_name, action, reason, metadata)
      VALUES ($1, $2, $3, $4, $5, 'task_dependency_added', NULL, $6)
    `, [
      randomUUID(),
      taskRow.demand_id,
      taskId,
      actor.id,
      actor.name,
      JSON.stringify({ dependsOnTaskId: input.dependsOnTaskId, newStatus }),
    ], { previousTaskStatus: taskRow.status });

    await dbClient.query('COMMIT');
    return { task: safeFormatTask(updateRes.rows[0]) };
  } catch (err) {
    await dbClient.query('ROLLBACK');
    throw err;
  } finally {
    dbClient.release();
  }
}

export async function removeDependency(
  database: Database,
  identity: SessionResponse,
  taskId: string,
  dependencyId: string,
  input: RemoveDependencyInput
): Promise<TaskResponse> {
  const dbClient = await database.pool.connect();
  try {
    await dbClient.query('BEGIN');
    await dbClient.query('SELECT pg_advisory_xact_lock($1)', [IDENTITY_LOCK]);

    const actor = await revalidateActorInsideTransaction(dbClient, identity.user.id, 'tasks.manage');

    const initialCheck = await dbClient.query<{ demand_id: string }>(`SELECT demand_id FROM task WHERE id = $1`, [taskId]);
    if (!initialCheck.rows[0]) throw new AppError(404, 'NOT_FOUND');

    await dbClient.query(`SELECT id FROM demand WHERE id = $1 FOR UPDATE`, [initialCheck.rows[0].demand_id]);

    const taskRes = await dbClient.query<TaskRow>(`
      SELECT * FROM task WHERE id = $1 FOR UPDATE
    `, [taskId]);
    const taskRow = taskRes.rows[0];
    if (!taskRow) throw new AppError(404, 'NOT_FOUND');

    if (taskRow.version !== input.version) throw new AppError(409, 'VERSION_CONFLICT');
    if (taskRow.started_at !== null) throw new AppError(409, 'TASK_ALREADY_STARTED');

    const depRes = await dbClient.query<{ task_id: string }>(`
      DELETE FROM task_dependency
      WHERE task_id = $1 AND depends_on_task_id = $2
      RETURNING *
    `, [taskId, dependencyId]);
    if (!depRes.rows[0]) throw new AppError(404, 'NOT_FOUND');

    const { ready } = await evaluateTaskReadiness(dbClient, taskId);
    const newStatus = ready ? 'ready' : 'blocked';
    const readyAt = ready ? new Date().toISOString() : null;

    const updateRes = await dbClient.query<TaskRow>(`
      UPDATE task
      SET status = $3,
          ready_at = $4,
          version = version + 1,
          updated_at = now()
      WHERE id = $1 AND version = $2
      RETURNING *
    `, [taskId, input.version, newStatus, readyAt]);

    await recordDemandEvent(dbClient, `
      INSERT INTO demand_event (id, demand_id, task_id, actor_id, actor_name, action, reason, metadata)
      VALUES ($1, $2, $3, $4, $5, 'task_dependency_removed', NULL, $6)
    `, [
      randomUUID(),
      taskRow.demand_id,
      taskId,
      actor.id,
      actor.name,
      JSON.stringify({ removedDependencyId: dependencyId, newStatus }),
    ], { previousTaskStatus: taskRow.status });

    await dbClient.query('COMMIT');
    return { task: safeFormatTask(updateRes.rows[0]) };
  } catch (err) {
    await dbClient.query('ROLLBACK');
    throw err;
  } finally {
    dbClient.release();
  }
}

export async function listTaskComments(
  database: Database,
  identity: SessionResponse,
  taskId: string
): Promise<TaskCommentsResponse> {
  const isCollaborator = !identity.roles.includes('administrator');

  const taskRes = await database.pool.query<{ id: string; assigned_to_user_id: string }>(`
    SELECT id, assigned_to_user_id FROM task WHERE id = $1
  `, [taskId]);
  const taskRow = taskRes.rows[0];
  if (!taskRow) throw new AppError(404, 'NOT_FOUND');

  if (isCollaborator && taskRow.assigned_to_user_id !== identity.user.id) {
    throw new AppError(404, 'NOT_FOUND');
  }

  const commentsRes = await database.pool.query<TaskCommentRow>(`
    SELECT * FROM task_comment WHERE task_id = $1 ORDER BY created_at ASC, id ASC
  `, [taskId]);

  return { comments: commentsRes.rows.map(formatTaskComment) };
}

export async function createTaskComment(
  database: Database,
  identity: SessionResponse,
  taskId: string,
  input: CreateTaskCommentInput
): Promise<TaskCommentsResponse> {
  const dbClient = await database.pool.connect();
  try {
    await dbClient.query('BEGIN');
    await dbClient.query('SELECT pg_advisory_xact_lock($1)', [IDENTITY_LOCK]);

    const actor = await revalidateActorInsideTransaction(
      dbClient,
      identity.user.id,
      (role) => (role === 'administrator' ? 'tasks.manage' : 'tasks.execute'),
    );

    const initialCheck = await dbClient.query<{ demand_id: string }>(`SELECT demand_id FROM task WHERE id = $1`, [taskId]);
    if (!initialCheck.rows[0]) throw new AppError(404, 'NOT_FOUND');

    await dbClient.query(`SELECT id FROM demand WHERE id = $1 FOR UPDATE`, [initialCheck.rows[0].demand_id]);

    const taskRes = await dbClient.query<{ id: string; demand_id: string; assigned_to_user_id: string }>(`
      SELECT id, demand_id, assigned_to_user_id FROM task WHERE id = $1 FOR UPDATE
    `, [taskId]);
    const taskRow = taskRes.rows[0];
    if (!taskRow) throw new AppError(404, 'NOT_FOUND');

    if (actor.role !== 'administrator' && taskRow.assigned_to_user_id !== actor.id) {
      throw new AppError(404, 'NOT_FOUND');
    }

    const commentId = randomUUID();
    const insertRes = await dbClient.query<TaskCommentRow>(`
      INSERT INTO task_comment (id, task_id, author_id, author_name, content)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [commentId, taskId, actor.id, actor.name, input.content]);

    await recordDemandEvent(dbClient, `
      INSERT INTO demand_event (id, demand_id, task_id, actor_id, actor_name, action, reason, metadata)
      VALUES ($1, $2, $3, $4, $5, 'task_comment_created', NULL, $6)
    `, [randomUUID(), taskRow.demand_id, taskId, actor.id, actor.name, JSON.stringify({ commentId })], {});

    await dbClient.query('COMMIT');
    return { comments: [safeFormatTaskComment(insertRes.rows[0])] };
  } catch (err) {
    await dbClient.query('ROLLBACK');
    throw err;
  } finally {
    dbClient.release();
  }
}

export type KanbanMoveTargetColumn = 'tasks' | 'in_production' | 'in_review' | 'completed';

export async function moveTaskKanban(
  database: Database,
  identity: SessionResponse,
  taskId: string,
  input: { column: KanbanMoveTargetColumn },
): Promise<TaskResponse> {
  const dbClient = await database.pool.connect();
  try {
    await dbClient.query('BEGIN');
    await dbClient.query('SELECT pg_advisory_xact_lock($1)', [IDENTITY_LOCK]);

    const actor = await revalidateActorInsideTransaction(
      dbClient,
      identity.user.id,
      (role) => (role === 'administrator' ? 'tasks.manage' : 'tasks.execute'),
    );

    const initialCheck = await dbClient.query<{ demand_id: string }>(`SELECT demand_id FROM task WHERE id = $1`, [taskId]);
    if (!initialCheck.rows[0]) throw new AppError(404, 'NOT_FOUND');

    await dbClient.query(`SELECT id FROM demand WHERE id = $1 FOR UPDATE`, [initialCheck.rows[0].demand_id]);

    const taskRes = await dbClient.query<TaskRow>(`
      SELECT * FROM task WHERE id = $1 FOR UPDATE
    `, [taskId]);
    const taskRow = taskRes.rows[0];
    if (!taskRow) throw new AppError(404, 'NOT_FOUND');

    if (actor.role !== 'administrator' && taskRow.assigned_to_user_id !== actor.id) {
      throw new AppError(403, 'FORBIDDEN');
    }

    // Se colaborador arrastar para Concluído, exige permissão de administrador (ou envia para revisão)
    const targetColumn: KanbanMoveTargetColumn =
      input.column === 'completed' && actor.role !== 'administrator'
        ? 'in_review'
        : input.column;

    let updateRes: { rows: TaskRow[] };

    if (targetColumn === 'in_production') {
      const { ready, allRequirementsSatisfied, allDependenciesCompleted } = await evaluateTaskReadiness(dbClient, taskId);
      if (!allRequirementsSatisfied) throw new AppError(400, 'MANDATORY_REQUIREMENTS_UNSATISFIED');
      if (!allDependenciesCompleted) throw new AppError(400, 'DEPENDENCIES_UNCOMPLETED');
      if (!ready) throw new AppError(400, 'TASK_NOT_READY');

      updateRes = await dbClient.query<TaskRow>(`
        UPDATE task
        SET status = 'in_production',
            accepted_at = COALESCE(accepted_at, now()),
            ready_at = COALESCE(ready_at, now()),
            started_at = COALESCE(started_at, now()),
            completed_at = NULL,
            pause_requested_at = NULL,
            pause_reason = NULL,
            paused_at = NULL,
            version = version + 1,
            updated_at = now()
        WHERE id = $1
        RETURNING *
      `, [taskId]);

      await recordDemandEvent(dbClient, `
        INSERT INTO demand_event (id, demand_id, task_id, actor_id, actor_name, action, reason, metadata)
        VALUES ($1, $2, $3, $4, $5, $6, NULL, '{}'::jsonb)
      `, [
        randomUUID(),
        taskRow.demand_id,
        taskId,
        actor.id,
        actor.name,
        taskRow.status === 'paused' ? 'task_resumed' : 'task_started',
      ], {});
    } else if (targetColumn === 'in_review') {
      updateRes = await dbClient.query<TaskRow>(`
        UPDATE task
        SET status = 'in_review',
            accepted_at = COALESCE(accepted_at, now()),
            ready_at = COALESCE(ready_at, now()),
            started_at = COALESCE(started_at, now()),
            completed_at = NULL,
            pause_requested_at = NULL,
            pause_reason = NULL,
            paused_at = NULL,
            delivery_notes = COALESCE(delivery_notes, 'Enviada para análise via quadro Kanban'),
            version = version + 1,
            updated_at = now()
        WHERE id = $1
        RETURNING *
      `, [taskId]);

      await recordDemandEvent(dbClient, `
        INSERT INTO demand_event (id, demand_id, task_id, actor_id, actor_name, action, reason, metadata)
        VALUES ($1, $2, $3, $4, $5, 'task_review_submitted', NULL, $6)
      `, [
        randomUUID(),
        taskRow.demand_id,
        taskId,
        actor.id,
        actor.name,
        JSON.stringify({ deliveryNotes: 'Enviada para análise via quadro Kanban', previewUrl: taskRow.preview_url }),
      ], {});
    } else if (targetColumn === 'completed') {
      updateRes = await dbClient.query<TaskRow>(`
        UPDATE task
        SET status = 'completed',
            accepted_at = COALESCE(accepted_at, now()),
            ready_at = COALESCE(ready_at, now()),
            started_at = COALESCE(started_at, now()),
            completed_at = now(),
            pause_requested_at = NULL,
            pause_reason = NULL,
            paused_at = NULL,
            version = version + 1,
            updated_at = now()
        WHERE id = $1
        RETURNING *
      `, [taskId]);

      await recordDemandEvent(dbClient, `
        INSERT INTO demand_event (id, demand_id, task_id, actor_id, actor_name, action, reason, metadata)
        VALUES ($1, $2, $3, $4, $5, 'task_completed', 'Concluída via quadro Kanban', '{}'::jsonb)
      `, [randomUUID(), taskRow.demand_id, taskId, actor.id, actor.name], {});

      const dependentsRes = await dbClient.query<{ task_id: string }>(`
        SELECT task_id FROM task_dependency WHERE depends_on_task_id = $1
      `, [taskId]);

      for (const dep of dependentsRes.rows) {
        const depTaskRes = await dbClient.query<{ id: string; status: string }>(`
          SELECT id, status FROM task WHERE id = $1 FOR UPDATE
        `, [dep.task_id]);
        const depTask = depTaskRes.rows[0];
        if (depTask && depTask.status === 'blocked') {
          const { ready } = await evaluateTaskReadiness(dbClient, dep.task_id);
          if (ready) {
            await dbClient.query(`
              UPDATE task
              SET status = 'ready', ready_at = now(), version = version + 1, updated_at = now()
              WHERE id = $1
            `, [dep.task_id]);

            await recordDemandEvent(dbClient, `
              INSERT INTO demand_event (id, demand_id, task_id, actor_id, actor_name, action, reason, metadata)
              VALUES ($1, $2, $3, $4, $5, 'task_ready', NULL, '{}'::jsonb)
            `, [randomUUID(), taskRow.demand_id, dep.task_id, actor.id, actor.name], {});
          }
        }
      }
    } else {
      // targetColumn === 'tasks' (Em aberto)
      const { ready } = await evaluateTaskReadiness(dbClient, taskId);
      const nextStatus: TaskStatus = !ready
        ? 'blocked'
        : taskRow.status === 'in_review' || taskRow.status === 'completed'
          ? 'changes_requested'
          : 'ready';

      updateRes = await dbClient.query<TaskRow>(`
        UPDATE task
        SET status = $2,
            ready_at = CASE WHEN $2 = 'ready' THEN COALESCE(ready_at, now()) ELSE ready_at END,
            completed_at = NULL,
            pause_requested_at = NULL,
            pause_reason = NULL,
            paused_at = NULL,
            version = version + 1,
            updated_at = now()
        WHERE id = $1
        RETURNING *
      `, [taskId, nextStatus]);

      const eventAction = nextStatus === 'changes_requested' ? 'task_changes_requested' : 'task_ready';
      await recordDemandEvent(dbClient, `
        INSERT INTO demand_event (id, demand_id, task_id, actor_id, actor_name, action, reason, metadata)
        VALUES ($1, $2, $3, $4, $5, $6, 'Retornada para Em aberto via quadro Kanban', '{}'::jsonb)
      `, [randomUUID(), taskRow.demand_id, taskId, actor.id, actor.name, eventAction], {});
    }

    // Sincroniza status da demanda pai com o status de execução
    const openTasksCountRes = await dbClient.query<{ count: number }>(`
      SELECT count(*)::int AS count FROM task WHERE demand_id = $1 AND status != 'completed'
    `, [taskRow.demand_id]);
    const nextDemandStatus = (openTasksCountRes.rows[0]?.count ?? 0) === 0 ? 'completed' : 'open';
    await dbClient.query(`
      UPDATE demand
      SET status = $2, version = version + 1, updated_at = now()
      WHERE id = $1 AND status != $2
    `, [taskRow.demand_id, nextDemandStatus]);

    await dbClient.query('COMMIT');
    return { task: safeFormatTask(updateRes.rows[0]) };
  } catch (err) {
    await dbClient.query('ROLLBACK');
    throw err;
  } finally {
    dbClient.release();
  }
}
