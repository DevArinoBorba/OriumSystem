import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type {
  CreateDemandTemplateInput,
  DemandResponse,
  DemandTemplate,
  DemandTemplateListResponse,
  DemandTemplateResponse,
  DemandTemplateTask,
  DemandTemplateTaskRequirement,
  InstantiateDemandTemplateInput,
  SessionResponse,
  UpdateDemandTemplateInput,
} from '@orium/contracts';
import { demandResponseSchema, demandTemplateListResponseSchema, demandTemplateResponseSchema } from '@orium/contracts';
import type { Database } from './db.js';
import { AppError } from './errors.js';
import { IDENTITY_LOCK, adminPermissions } from './identity.js';
import { emitNotificationsForEvent } from './notifications-producer.js';

interface TemplateRow {
  id: string;
  title: string;
  description: string;
  category: 'web' | 'design' | 'video' | 'marketing' | 'social_media' | 'general';
  default_priority: 'low' | 'normal' | 'high' | 'urgent';
  estimated_days: number;
  active: boolean;
  version: number;
  created_at: Date | string;
  updated_at: Date | string;
}

interface TemplateTaskRow {
  id: string;
  template_id: string;
  title: string;
  description: string;
  suggested_role: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  day_offset_start: number;
  duration_days: number;
  order_index: number;
}

interface TemplateRequirementRow {
  id: string;
  template_task_id: string;
  title: string;
  mandatory: boolean;
  order_index: number;
}

interface TemplateDependencyRow {
  template_task_id: string;
  depends_on_template_task_id: string;
}

async function revalidateActor(
  client: PoolClient,
  actorId: string,
  requiredPermission: string,
  requireAdmin = false,
): Promise<{ id: string; name: string; isAdmin: boolean }> {
  const res = await client.query<{ id: string; name: string; active: boolean; role_id: string }>(`
    SELECT u.id, u.name, u.active, r.role_id
    FROM auth_user u
    JOIN user_role r ON r.user_id = u.id
    WHERE u.id = $1
  `, [actorId]);
  const user = res.rows[0];
  if (!user || !user.active) throw new AppError(401, 'UNAUTHENTICATED');

  const isAdmin = user.role_id === 'administrator';
  if (requireAdmin && !isAdmin) throw new AppError(403, 'FORBIDDEN');

  const permRes = await client.query<{ permission_id: string }>(`
    SELECT permission_id FROM role_permission WHERE role_id = $1 AND permission_id = $2
  `, [user.role_id, requiredPermission]);
  if (permRes.rows.length === 0) throw new AppError(403, 'FORBIDDEN');

  if (adminPermissions.includes(requiredPermission as never) && !isAdmin) {
    throw new AppError(403, 'FORBIDDEN');
  }

  return { id: user.id, name: user.name, isAdmin };
}

function formatTemplate(
  t: TemplateRow,
  tasks: TemplateTaskRow[],
  reqs: TemplateRequirementRow[],
  deps: TemplateDependencyRow[],
): DemandTemplate {
  const reqsByTask = new Map<string, DemandTemplateTaskRequirement[]>();
  for (const r of reqs) {
    if (!reqsByTask.has(r.template_task_id)) reqsByTask.set(r.template_task_id, []);
    reqsByTask.get(r.template_task_id)!.push({
      id: r.id,
      templateTaskId: r.template_task_id,
      title: r.title,
      mandatory: Boolean(r.mandatory),
      orderIndex: r.order_index,
    });
  }

  const depsByTask = new Map<string, string[]>();
  for (const d of deps) {
    if (!depsByTask.has(d.template_task_id)) depsByTask.set(d.template_task_id, []);
    depsByTask.get(d.template_task_id)!.push(d.depends_on_template_task_id);
  }

  const formattedTasks: DemandTemplateTask[] = tasks
    .sort((a, b) => a.order_index - b.order_index)
    .map((task) => ({
      id: task.id,
      templateId: task.template_id,
      title: task.title,
      description: task.description ?? '',
      suggestedRole: task.suggested_role,
      priority: task.priority,
      dayOffsetStart: task.day_offset_start,
      durationDays: task.duration_days,
      orderIndex: task.order_index,
      requirements: (reqsByTask.get(task.id) ?? []).sort((a, b) => a.orderIndex - b.orderIndex),
      dependsOnTaskIds: depsByTask.get(task.id) ?? [],
    }));

  return {
    id: t.id,
    title: t.title,
    description: t.description ?? '',
    category: t.category,
    defaultPriority: t.default_priority,
    estimatedDays: t.estimated_days,
    active: Boolean(t.active),
    version: t.version,
    createdAt: new Date(t.created_at).toISOString(),
    updatedAt: new Date(t.updated_at).toISOString(),
    tasks: formattedTasks,
  };
}

function addDaysToDateString(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d! + days));
  const ny = dt.getUTCFullYear();
  const nm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const nd = String(dt.getUTCDate()).padStart(2, '0');
  return `${ny}-${nm}-${nd}`;
}

export async function listDemandTemplates(
  database: Database,
  identity: SessionResponse,
): Promise<DemandTemplateListResponse> {
  const client = await database.pool.connect();
  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const actor = await revalidateActor(client, identity.user.id, 'demands.read');

    const filter = actor.isAdmin ? '' : 'WHERE active = true';
    const templatesRes = await client.query<TemplateRow>(`
      SELECT * FROM demand_template ${filter} ORDER BY active DESC, title ASC, id ASC
    `);

    const templates = templatesRes.rows;
    if (templates.length === 0) {
      await client.query('COMMIT');
      return demandTemplateListResponseSchema.parse({ templates: [], total: 0 });
    }

    const templateIds = templates.map((t) => t.id);
    const tasksRes = await client.query<TemplateTaskRow>(`
      SELECT * FROM demand_template_task WHERE template_id = ANY($1::uuid[]) ORDER BY order_index ASC
    `, [templateIds]);

    const taskIds = tasksRes.rows.map((t) => t.id);
    let reqs: TemplateRequirementRow[] = [];
    let deps: TemplateDependencyRow[] = [];

    if (taskIds.length > 0) {
      const [reqsRes, depsRes] = await Promise.all([
        client.query<TemplateRequirementRow>(`
          SELECT * FROM demand_template_task_requirement WHERE template_task_id = ANY($1::uuid[]) ORDER BY order_index ASC
        `, [taskIds]),
        client.query<TemplateDependencyRow>(`
          SELECT * FROM demand_template_task_dependency WHERE template_task_id = ANY($1::uuid[])
        `, [taskIds]),
      ]);
      reqs = reqsRes.rows;
      deps = depsRes.rows;
    }

    await client.query('COMMIT');

    const tasksByTemplate = new Map<string, TemplateTaskRow[]>();
    for (const task of tasksRes.rows) {
      if (!tasksByTemplate.has(task.template_id)) tasksByTemplate.set(task.template_id, []);
      tasksByTemplate.get(task.template_id)!.push(task);
    }

    const formatted = templates.map((t) => formatTemplate(
      t,
      tasksByTemplate.get(t.id) ?? [],
      reqs,
      deps,
    ));

    return demandTemplateListResponseSchema.parse({
      templates: formatted,
      total: formatted.length,
    });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

export async function getDemandTemplateById(
  database: Database,
  identity: SessionResponse,
  templateId: string,
): Promise<DemandTemplateResponse> {
  const client = await database.pool.connect();
  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const actor = await revalidateActor(client, identity.user.id, 'demands.read');

    const tRes = await client.query<TemplateRow>(`
      SELECT * FROM demand_template WHERE id = $1
    `, [templateId]);
    const t = tRes.rows[0];
    if (!t) throw new AppError(404, 'NOT_FOUND');
    if (!actor.isAdmin && !t.active) throw new AppError(404, 'NOT_FOUND');

    const tasksRes = await client.query<TemplateTaskRow>(`
      SELECT * FROM demand_template_task WHERE template_id = $1 ORDER BY order_index ASC
    `, [templateId]);

    const taskIds = tasksRes.rows.map((tk) => tk.id);
    let reqs: TemplateRequirementRow[] = [];
    let deps: TemplateDependencyRow[] = [];

    if (taskIds.length > 0) {
      const [reqsRes, depsRes] = await Promise.all([
        client.query<TemplateRequirementRow>(`
          SELECT * FROM demand_template_task_requirement WHERE template_task_id = ANY($1::uuid[]) ORDER BY order_index ASC
        `, [taskIds]),
        client.query<TemplateDependencyRow>(`
          SELECT * FROM demand_template_task_dependency WHERE template_task_id = ANY($1::uuid[])
        `, [taskIds]),
      ]);
      reqs = reqsRes.rows;
      deps = depsRes.rows;
    }

    await client.query('COMMIT');
    const formatted = formatTemplate(t, tasksRes.rows, reqs, deps);
    return demandTemplateResponseSchema.parse({ template: formatted });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

export async function createDemandTemplate(
  database: Database,
  identity: SessionResponse,
  input: CreateDemandTemplateInput,
): Promise<DemandTemplateResponse> {
  const client = await database.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [IDENTITY_LOCK]);
    await revalidateActor(client, identity.user.id, 'demands.write', true);

    const templateId = randomUUID();
    const insertTRes = await client.query<TemplateRow>(`
      INSERT INTO demand_template (id, title, description, category, default_priority, estimated_days, active, version)
      VALUES ($1, $2, $3, $4, $5, $6, true, 1)
      RETURNING *
    `, [templateId, input.title, input.description, input.category, input.defaultPriority, input.estimatedDays]);
    const templateRow = insertTRes.rows[0]!;

    const tempIdToRealId = new Map<string, string>();
    const taskRowsToInsert: TemplateTaskRow[] = [];

    input.tasks.forEach((t, idx) => {
      const realId = randomUUID();
      if (t.tempId) tempIdToRealId.set(t.tempId, realId);
      tempIdToRealId.set(String(idx), realId);
      taskRowsToInsert.push({
        id: realId,
        template_id: templateId,
        title: t.title,
        description: t.description,
        suggested_role: t.suggestedRole,
        priority: t.priority,
        day_offset_start: t.dayOffsetStart,
        duration_days: t.durationDays,
        order_index: t.orderIndex ?? idx,
      });
    });

    for (const tr of taskRowsToInsert) {
      await client.query(`
        INSERT INTO demand_template_task (id, template_id, title, description, suggested_role, priority, day_offset_start, duration_days, order_index)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `, [tr.id, tr.template_id, tr.title, tr.description, tr.suggested_role, tr.priority, tr.day_offset_start, tr.duration_days, tr.order_index]);
    }

    const insertedReqs: TemplateRequirementRow[] = [];
    const insertedDeps: TemplateDependencyRow[] = [];

    for (let i = 0; i < input.tasks.length; i++) {
      const tInput = input.tasks[i]!;
      const realTaskId = taskRowsToInsert[i]!.id;

      if (tInput.requirements && tInput.requirements.length > 0) {
        for (let rIdx = 0; rIdx < tInput.requirements.length; rIdx++) {
          const req = tInput.requirements[rIdx]!;
          const reqId = randomUUID();
          await client.query(`
            INSERT INTO demand_template_task_requirement (id, template_task_id, title, mandatory, order_index)
            VALUES ($1, $2, $3, $4, $5)
          `, [reqId, realTaskId, req.title, req.mandatory, req.orderIndex ?? rIdx]);
          insertedReqs.push({
            id: reqId,
            template_task_id: realTaskId,
            title: req.title,
            mandatory: req.mandatory,
            order_index: req.orderIndex ?? rIdx,
          });
        }
      }

      if (tInput.dependsOnTempIds && tInput.dependsOnTempIds.length > 0) {
        for (const depTempId of tInput.dependsOnTempIds) {
          const depRealId = tempIdToRealId.get(depTempId);
          if (depRealId && depRealId !== realTaskId) {
            await client.query(`
              INSERT INTO demand_template_task_dependency (template_task_id, depends_on_template_task_id)
              VALUES ($1, $2)
              ON CONFLICT DO NOTHING
            `, [realTaskId, depRealId]);
            insertedDeps.push({
              template_task_id: realTaskId,
              depends_on_template_task_id: depRealId,
            });
          }
        }
      }
    }

    await client.query('COMMIT');
    const formatted = formatTemplate(templateRow, taskRowsToInsert, insertedReqs, insertedDeps);
    return demandTemplateResponseSchema.parse({ template: formatted });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

export async function updateDemandTemplate(
  database: Database,
  identity: SessionResponse,
  templateId: string,
  input: UpdateDemandTemplateInput,
): Promise<DemandTemplateResponse> {
  const client = await database.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [IDENTITY_LOCK]);
    await revalidateActor(client, identity.user.id, 'demands.write', true);

    const curRes = await client.query<TemplateRow>(`
      SELECT * FROM demand_template WHERE id = $1 FOR UPDATE
    `, [templateId]);
    const current = curRes.rows[0];
    if (!current) throw new AppError(404, 'NOT_FOUND');
    if (current.version !== input.version) throw new AppError(409, 'VERSION_CONFLICT');

    const newTitle = input.title ?? current.title;
    const newDescription = input.description ?? current.description;
    const newCategory = input.category ?? current.category;
    const newDefaultPriority = input.defaultPriority ?? current.default_priority;
    const newEstimatedDays = input.estimatedDays ?? current.estimated_days;
    const newActive = input.active !== undefined ? input.active : current.active;
    const newVersion = current.version + 1;

    const updateRes = await client.query<TemplateRow>(`
      UPDATE demand_template
      SET title = $1, description = $2, category = $3, default_priority = $4, estimated_days = $5, active = $6, version = $7, updated_at = now()
      WHERE id = $8
      RETURNING *
    `, [newTitle, newDescription, newCategory, newDefaultPriority, newEstimatedDays, newActive, newVersion, templateId]);
    const updatedTemplate = updateRes.rows[0]!;

    let currentTasks: TemplateTaskRow[] = [];
    let currentReqs: TemplateRequirementRow[] = [];
    let currentDeps: TemplateDependencyRow[] = [];

    if (input.tasks && input.tasks.length > 0) {
      await client.query('DELETE FROM demand_template_task WHERE template_id = $1', [templateId]);

      const tempIdToRealId = new Map<string, string>();
      const taskRowsToInsert: TemplateTaskRow[] = [];

      input.tasks.forEach((t, idx) => {
        const realId = randomUUID();
        if (t.tempId) tempIdToRealId.set(t.tempId, realId);
        tempIdToRealId.set(String(idx), realId);
        taskRowsToInsert.push({
          id: realId,
          template_id: templateId,
          title: t.title,
          description: t.description,
          suggested_role: t.suggestedRole,
          priority: t.priority,
          day_offset_start: t.dayOffsetStart,
          duration_days: t.durationDays,
          order_index: t.orderIndex ?? idx,
        });
      });

      for (const tr of taskRowsToInsert) {
        await client.query(`
          INSERT INTO demand_template_task (id, template_id, title, description, suggested_role, priority, day_offset_start, duration_days, order_index)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `, [tr.id, tr.template_id, tr.title, tr.description, tr.suggested_role, tr.priority, tr.day_offset_start, tr.duration_days, tr.order_index]);
      }

      for (let i = 0; i < input.tasks.length; i++) {
        const tInput = input.tasks[i]!;
        const realTaskId = taskRowsToInsert[i]!.id;

        if (tInput.requirements) {
          for (let rIdx = 0; rIdx < tInput.requirements.length; rIdx++) {
            const req = tInput.requirements[rIdx]!;
            const reqId = randomUUID();
            await client.query(`
              INSERT INTO demand_template_task_requirement (id, template_task_id, title, mandatory, order_index)
              VALUES ($1, $2, $3, $4, $5)
            `, [reqId, realTaskId, req.title, req.mandatory, req.orderIndex ?? rIdx]);
            currentReqs.push({
              id: reqId,
              template_task_id: realTaskId,
              title: req.title,
              mandatory: req.mandatory,
              order_index: req.orderIndex ?? rIdx,
            });
          }
        }

        if (tInput.dependsOnTempIds) {
          for (const depTempId of tInput.dependsOnTempIds) {
            const depRealId = tempIdToRealId.get(depTempId);
            if (depRealId && depRealId !== realTaskId) {
              await client.query(`
                INSERT INTO demand_template_task_dependency (template_task_id, depends_on_template_task_id)
                VALUES ($1, $2)
                ON CONFLICT DO NOTHING
              `, [realTaskId, depRealId]);
              currentDeps.push({
                template_task_id: realTaskId,
                depends_on_template_task_id: depRealId,
              });
            }
          }
        }
      }
      currentTasks = taskRowsToInsert;
    } else {
      const tasksRes = await client.query<TemplateTaskRow>(`
        SELECT * FROM demand_template_task WHERE template_id = $1 ORDER BY order_index ASC
      `, [templateId]);
      currentTasks = tasksRes.rows;
      const taskIds = currentTasks.map((tk) => tk.id);
      if (taskIds.length > 0) {
        const [rRes, dRes] = await Promise.all([
          client.query<TemplateRequirementRow>(`SELECT * FROM demand_template_task_requirement WHERE template_task_id = ANY($1::uuid[])`, [taskIds]),
          client.query<TemplateDependencyRow>(`SELECT * FROM demand_template_task_dependency WHERE template_task_id = ANY($1::uuid[])`, [taskIds]),
        ]);
        currentReqs = rRes.rows;
        currentDeps = dRes.rows;
      }
    }

    await client.query('COMMIT');
    const formatted = formatTemplate(updatedTemplate, currentTasks, currentReqs, currentDeps);
    return demandTemplateResponseSchema.parse({ template: formatted });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

export async function instantiateDemandTemplate(
  database: Database,
  identity: SessionResponse,
  templateId: string,
  input: InstantiateDemandTemplateInput,
): Promise<DemandResponse> {
  const client = await database.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [IDENTITY_LOCK]);
    const actor = await revalidateActor(client, identity.user.id, 'demands.write');

    // 1. Validar cliente
    const clientCheck = await client.query<{ id: string; name: string }>(`
      SELECT id, name FROM client WHERE id = $1 AND archived_at IS NULL FOR SHARE
    `, [input.clientId]);
    const clientRow = clientCheck.rows[0];
    if (!clientRow) throw new AppError(400, 'CLIENT_NOT_FOUND_OR_INACTIVE');

    // 2. Validar template
    const tRes = await client.query<TemplateRow>(`
      SELECT * FROM demand_template WHERE id = $1 AND active = true FOR SHARE
    `, [templateId]);
    const template = tRes.rows[0];
    if (!template) throw new AppError(404, 'NOT_FOUND');

    const tasksRes = await client.query<TemplateTaskRow>(`
      SELECT * FROM demand_template_task WHERE template_id = $1 ORDER BY order_index ASC
    `, [templateId]);
    const tTasks = tasksRes.rows;
    if (tTasks.length === 0) throw new AppError(400, 'TEMPLATE_HAS_NO_TASKS');

    const tTaskIds = tTasks.map((t) => t.id);
    const [reqsRes, depsRes] = await Promise.all([
      client.query<TemplateRequirementRow>(`
        SELECT * FROM demand_template_task_requirement WHERE template_task_id = ANY($1::uuid[]) ORDER BY order_index ASC
      `, [tTaskIds]),
      client.query<TemplateDependencyRow>(`
        SELECT * FROM demand_template_task_dependency WHERE template_task_id = ANY($1::uuid[])
      `, [tTaskIds]),
    ]);

    // 3. Determinar datas base
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Cuiaba' }).format(new Date());
    const startDate = input.startDate ?? today;
    const demandDeliveryDate = input.deliveryDate ?? addDaysToDateString(startDate, template.estimated_days);

    const demandId = randomUUID();
    const demandTitle = input.title ?? template.title;
    const demandDesc = input.description ?? template.description;
    const demandPriority = input.priority ?? template.default_priority;

    await client.query(`
      INSERT INTO demand (id, client_id, created_by_user_id, title, description, priority, delivery_date, status, version)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'open', 1)
    `, [demandId, clientRow.id, actor.id, demandTitle, demandDesc, demandPriority, demandDeliveryDate]);

    // 4. Mapear template tasks para novas tasks
    const templateTaskIdToRealTaskId = new Map<string, string>();
    tTasks.forEach((tk) => {
      templateTaskIdToRealTaskId.set(tk.id, randomUUID());
    });

    const depsByTemplateTask = new Map<string, string[]>();
    for (const d of depsRes.rows) {
      if (!depsByTemplateTask.has(d.template_task_id)) depsByTemplateTask.set(d.template_task_id, []);
      depsByTemplateTask.get(d.template_task_id)!.push(d.depends_on_template_task_id);
    }

    const reqsByTemplateTask = new Map<string, TemplateRequirementRow[]>();
    for (const r of reqsRes.rows) {
      if (!reqsByTemplateTask.has(r.template_task_id)) reqsByTemplateTask.set(r.template_task_id, []);
      reqsByTemplateTask.get(r.template_task_id)!.push(r);
    }

    const defaultAssigneeId = actor.id;
    const instantiatedTasks: { taskId: string; assignedToUserId: string; priority: string; status: string }[] = [];

    for (let i = 0; i < tTasks.length; i++) {
      const tk = tTasks[i]!;
      const realTaskId = templateTaskIdToRealTaskId.get(tk.id)!;
      const assignedUser = input.assignments?.[tk.id] ?? input.assignments?.[String(i)] ?? defaultAssigneeId;
      const taskDeliveryDate = addDaysToDateString(startDate, tk.day_offset_start + tk.duration_days);

      const hasDeps = (depsByTemplateTask.get(tk.id) ?? []).length > 0;
      const hasMandatoryReqs = (reqsByTemplateTask.get(tk.id) ?? []).some((r) => r.mandatory);
      const initialStatus = hasDeps || hasMandatoryReqs ? 'blocked' : 'ready';

      await client.query(`
        INSERT INTO task (
          id, demand_id, assigned_to_user_id, title, description, priority, delivery_date, status,
          ready_at, version
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1)
      `, [
        realTaskId,
        demandId,
        assignedUser,
        tk.title,
        tk.description,
        tk.priority,
        taskDeliveryDate,
        initialStatus,
        initialStatus === 'ready' ? new Date() : null,
      ]);

      instantiatedTasks.push({
        taskId: realTaskId,
        assignedToUserId: assignedUser,
        priority: tk.priority,
        status: initialStatus,
      });

      const reqs = reqsByTemplateTask.get(tk.id) ?? [];
      for (const r of reqs) {
        await client.query(`
          INSERT INTO task_requirement (id, task_id, title, mandatory, satisfied)
          VALUES ($1, $2, $3, $4, false)
        `, [randomUUID(), realTaskId, r.title, r.mandatory]);
      }
    }

    // 5. Inserir dependências
    for (const dep of depsRes.rows) {
      const realTaskId = templateTaskIdToRealTaskId.get(dep.template_task_id);
      const realDependsOnId = templateTaskIdToRealTaskId.get(dep.depends_on_template_task_id);
      if (realTaskId && realDependsOnId) {
        await client.query(`
          INSERT INTO task_dependency (task_id, depends_on_task_id)
          VALUES ($1, $2)
          ON CONFLICT DO NOTHING
        `, [realTaskId, realDependsOnId]);
      }
    }

    // 6. Registrar evento da demanda e eventos de cada tarefa instanciada
    const eventId = randomUUID();
    await client.query(`
      INSERT INTO demand_event (id, demand_id, task_id, actor_id, actor_name, action, reason, metadata)
      VALUES ($1, $2, NULL, $3, $4, 'demand_created_from_template', NULL, $5)
    `, [eventId, demandId, actor.id, actor.name, JSON.stringify({
      templateId,
      templateTitle: template.title,
      tasksCount: tTasks.length,
    })]);

    await emitNotificationsForEvent(client, eventId, {});

    for (const instTask of instantiatedTasks) {
      const taskEventId = randomUUID();
      await client.query(`
        INSERT INTO demand_event (id, demand_id, task_id, actor_id, actor_name, action, reason, metadata)
        VALUES ($1, $2, $3, $4, $5, 'task_created', NULL, $6)
      `, [taskEventId, demandId, instTask.taskId, actor.id, actor.name, JSON.stringify({
        assignedToUserId: instTask.assignedToUserId,
        priority: instTask.priority,
        status: instTask.status,
      })]);

      await emitNotificationsForEvent(client, taskEventId, {});
    }

    const createdDemandRes = await client.query<{
      id: string;
      client_id: string;
      created_by_user_id: string;
      title: string;
      description: string;
      priority: 'low' | 'normal' | 'high' | 'urgent';
      delivery_date: Date | string;
      status: 'open' | 'completed';
      version: number;
      created_at: Date | string;
      updated_at: Date | string;
    }>(`SELECT * FROM demand WHERE id = $1`, [demandId]);

    const created = createdDemandRes.rows[0]!;
    await client.query('COMMIT');

    const formattedDemand = {
      id: created.id,
      clientId: created.client_id,
      client: {
        id: clientRow.id,
        name: clientRow.name,
      },
      createdByUserId: created.created_by_user_id,
      title: created.title,
      description: created.description ?? '',
      priority: created.priority,
      deliveryDate: typeof created.delivery_date === 'string'
        ? created.delivery_date.slice(0, 10)
        : (created.delivery_date as Date).toISOString().slice(0, 10),
      status: created.status,
      version: created.version,
      createdAt: new Date(created.created_at).toISOString(),
      updatedAt: new Date(created.updated_at).toISOString(),
    };

    return demandResponseSchema.parse({ demand: formattedDemand });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    throw err;
  } finally {
    client.release();
  }
}
