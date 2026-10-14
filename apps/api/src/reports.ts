import type { PoolClient } from 'pg';
import type {
  BottlenecksReportResponse,
  ProductivityReportResponse,
  ReportQuery,
  SessionResponse,
  TaskStatus,
} from '@orium/contracts';
import { bottlenecksReportResponseSchema, productivityReportResponseSchema } from '@orium/contracts';
import type { Database } from './db.js';
import { AppError } from './errors.js';

async function revalidateActor(
  client: PoolClient,
  actorId: string,
): Promise<{ id: string; name: string; isAdmin: boolean }> {
  const res = await client.query<{ id: string; name: string; active: boolean; role_id: string }>(`
    SELECT u.id, u.name, u.active, r.role_id
    FROM auth_user u
    JOIN user_role r ON r.user_id = u.id
    WHERE u.id = $1
  `, [actorId]);
  const user = res.rows[0];
  if (!user || !user.active) throw new AppError(401, 'UNAUTHENTICATED');

  const permRes = await client.query<{ permission_id: string }>(`
    SELECT permission_id FROM role_permission WHERE role_id = $1 AND permission_id = 'demands.read'
  `, [user.role_id]);
  if (permRes.rows.length === 0) throw new AppError(403, 'FORBIDDEN');

  return { id: user.id, name: user.name, isAdmin: user.role_id === 'administrator' };
}

export async function getProductivityReport(
  database: Database,
  identity: SessionResponse,
  query: ReportQuery,
): Promise<ProductivityReportResponse> {
  const client = await database.pool.connect();
  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL READ COMMITTED READ ONLY');
    const actor = await revalidateActor(client, identity.user.id);

    const { startDate, endDate } = query;
    const params: unknown[] = [startDate, endDate];

    let demandScopeFilter = '';
    let taskScopeFilter = '';

    if (!actor.isAdmin) {
      params.push(actor.id);
      const userParam = `$${params.length}`;
      demandScopeFilter = `AND EXISTS (SELECT 1 FROM task st WHERE st.demand_id = d.id AND st.assigned_to_user_id = ${userParam})`;
      taskScopeFilter = `AND t.assigned_to_user_id = ${userParam}`;
    } else {
      if (query.userId) {
        params.push(query.userId);
        const userParam = `$${params.length}`;
        demandScopeFilter += ` AND EXISTS (SELECT 1 FROM task st WHERE st.demand_id = d.id AND st.assigned_to_user_id = ${userParam})`;
        taskScopeFilter += ` AND t.assigned_to_user_id = ${userParam}`;
      }
    }

    if (query.clientId) {
      params.push(query.clientId);
      const clientParam = `$${params.length}`;
      demandScopeFilter += ` AND d.client_id = ${clientParam}`;
      taskScopeFilter += ` AND d.client_id = ${clientParam}`;
    }

    // 1. Demandas criadas e concluídas no período
    const demandStatsRes = await client.query<{
      created: number;
      completed: number;
      on_time_count: number;
      avg_lead_hours: number | null;
    }>(`
      SELECT
        COUNT(d.id) FILTER (WHERE d.created_at::date >= $1::date AND d.created_at::date <= $2::date)::int AS created,
        COUNT(d.id) FILTER (WHERE d.status = 'completed' AND d.updated_at::date >= $1::date AND d.updated_at::date <= $2::date)::int AS completed,
        COUNT(d.id) FILTER (WHERE d.status = 'completed' AND d.updated_at::date >= $1::date AND d.updated_at::date <= $2::date AND d.updated_at::date <= d.delivery_date)::int AS on_time_count,
        COALESCE(AVG(EXTRACT(EPOCH FROM (d.updated_at - d.created_at)) / 3600) FILTER (WHERE d.status = 'completed' AND d.updated_at::date >= $1::date AND d.updated_at::date <= $2::date), 0)::float AS avg_lead_hours
      FROM demand d
      WHERE 1=1 ${demandScopeFilter}
    `, params);

    const demandStats = demandStatsRes.rows[0] ?? { created: 0, completed: 0, on_time_count: 0, avg_lead_hours: 0 };

    // 2. Tarefas concluídas no período e tempo de ciclo
    const taskStatsRes = await client.query<{
      completed: number;
      avg_cycle_hours: number | null;
    }>(`
      SELECT
        COUNT(t.id)::int AS completed,
        COALESCE(AVG(EXTRACT(EPOCH FROM (t.completed_at - t.started_at)) / 3600) FILTER (WHERE t.started_at IS NOT NULL), 0)::float AS avg_cycle_hours
      FROM task t
      JOIN demand d ON d.id = t.demand_id
      WHERE t.status = 'completed'
        AND t.completed_at IS NOT NULL
        AND t.completed_at::date >= $1::date
        AND t.completed_at::date <= $2::date
        ${taskScopeFilter}
    `, params);

    const taskStats = taskStatsRes.rows[0] ?? { completed: 0, avg_cycle_hours: 0 };

    const totalCompletedDemands = demandStats.completed;
    const onTimeDeliveryRate = totalCompletedDemands > 0
      ? Math.round((demandStats.on_time_count / totalCompletedDemands) * 1000) / 10
      : 100;

    // 3. Desempenho por responsável
    const byAssigneeRes = await client.query<{
      user_id: string;
      user_name: string;
      tasks_completed: number;
      avg_cycle_hours: number | null;
      on_time_tasks: number;
    }>(`
      SELECT
        u.id AS user_id,
        u.name AS user_name,
        COUNT(t.id)::int AS tasks_completed,
        COALESCE(AVG(EXTRACT(EPOCH FROM (t.completed_at - t.started_at)) / 3600) FILTER (WHERE t.started_at IS NOT NULL), 0)::float AS avg_cycle_hours,
        COUNT(t.id) FILTER (WHERE t.completed_at::date <= t.delivery_date)::int AS on_time_tasks
      FROM auth_user u
      JOIN task t ON t.assigned_to_user_id = u.id
      JOIN demand d ON d.id = t.demand_id
      WHERE t.status = 'completed'
        AND t.completed_at IS NOT NULL
        AND t.completed_at::date >= $1::date
        AND t.completed_at::date <= $2::date
        ${taskScopeFilter}
      GROUP BY u.id, u.name
      ORDER BY tasks_completed DESC, u.name ASC
    `, params);

    const byAssignee = byAssigneeRes.rows.map((row) => ({
      userId: row.user_id,
      userName: row.user_name,
      tasksCompleted: row.tasks_completed,
      averageCycleTimeHours: Math.round((row.avg_cycle_hours ?? 0) * 10) / 10,
      onTimeRate: row.tasks_completed > 0
        ? Math.round((row.on_time_tasks / row.tasks_completed) * 1000) / 10
        : 100,
    }));

    await client.query('COMMIT');

    const response: ProductivityReportResponse = {
      period: { startDate, endDate },
      summary: {
        demandsCreated: demandStats.created,
        demandsCompleted: demandStats.completed,
        tasksCompleted: taskStats.completed,
        onTimeDeliveryRate,
        averageLeadTimeHours: Math.round((demandStats.avg_lead_hours ?? 0) * 10) / 10,
        averageCycleTimeHours: Math.round((taskStats.avg_cycle_hours ?? 0) * 10) / 10,
      },
      byAssignee,
    };

    return productivityReportResponseSchema.parse(response);
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

export async function getBottlenecksReport(
  database: Database,
  identity: SessionResponse,
  query: { clientId?: string } = {},
): Promise<BottlenecksReportResponse> {
  const client = await database.pool.connect();
  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL READ COMMITTED READ ONLY');
    const actor = await revalidateActor(client, identity.user.id);

    const params: unknown[] = [];
    let filter = '';

    if (!actor.isAdmin) {
      params.push(actor.id);
      filter = `AND t.assigned_to_user_id = $${params.length}`;
    }

    if (query.clientId) {
      params.push(query.clientId);
      filter += ` AND d.client_id = $${params.length}`;
    }

    // 1. Contagens de status críticos
    const countsRes = await client.query<{
      blocked: number;
      paused: number;
      in_review: number;
      overdue: number;
      avg_ready_wait_hours: number | null;
      avg_prod_hours: number | null;
    }>(`
      SELECT
        COUNT(t.id) FILTER (WHERE t.status = 'blocked')::int AS blocked,
        COUNT(t.id) FILTER (WHERE t.status = 'paused' OR t.pause_requested_at IS NOT NULL)::int AS paused,
        COUNT(t.id) FILTER (WHERE t.status = 'in_review')::int AS in_review,
        COUNT(t.id) FILTER (WHERE t.status != 'completed' AND t.delivery_date < CURRENT_DATE)::int AS overdue,
        COALESCE(AVG(EXTRACT(EPOCH FROM (t.started_at - t.ready_at)) / 3600) FILTER (WHERE t.ready_at IS NOT NULL AND t.started_at IS NOT NULL), 0)::float AS avg_ready_wait_hours,
        COALESCE(AVG(EXTRACT(EPOCH FROM (COALESCE(t.completed_at, now()) - t.started_at)) / 3600) FILTER (WHERE t.started_at IS NOT NULL), 0)::float AS avg_prod_hours
      FROM task t
      JOIN demand d ON d.id = t.demand_id
      WHERE t.status != 'completed' AND d.status != 'completed'
        ${filter}
    `, params);

    const counts = countsRes.rows[0] ?? {
      blocked: 0,
      paused: 0,
      in_review: 0,
      overdue: 0,
      avg_ready_wait_hours: 0,
      avg_prod_hours: 0,
    };

    // 2. Média de pausas por tarefa
    const pauseCountRes = await client.query<{ avg_pauses: number | null }>(`
      SELECT COALESCE(AVG(pause_events), 0)::float AS avg_pauses
      FROM (
        SELECT t.id, COUNT(de.id) AS pause_events
        FROM task t
        JOIN demand d ON d.id = t.demand_id
        LEFT JOIN demand_event de ON de.task_id = t.id AND de.action IN ('pause_requested', 'task_paused')
        WHERE d.status != 'completed' ${filter}
        GROUP BY t.id
      ) sub
    `, params);

    const avgPauseCount = pauseCountRes.rows[0]?.avg_pauses ?? 0;

    // 3. Lista detalhada de tarefas pausadas ou bloqueadas
    const pausedTasksRes = await client.query<{
      task_id: string;
      task_title: string;
      demand_id: string;
      demand_title: string;
      client_name: string;
      assigned_to_name: string;
      status: string;
      pause_reason: string | null;
      days_in_status: number;
    }>(`
      SELECT
        t.id AS task_id,
        t.title AS task_title,
        d.id AS demand_id,
        d.title AS demand_title,
        c.name AS client_name,
        u.name AS assigned_to_name,
        t.status,
        t.pause_reason,
        GREATEST(0, EXTRACT(DAY FROM (now() - COALESCE(t.paused_at, t.pause_requested_at, t.updated_at))))::int AS days_in_status
      FROM task t
      JOIN demand d ON d.id = t.demand_id
      JOIN client c ON c.id = d.client_id
      JOIN auth_user u ON u.id = t.assigned_to_user_id
      WHERE d.status != 'completed'
        AND (t.status IN ('paused', 'blocked', 'changes_requested') OR t.pause_requested_at IS NOT NULL)
        ${filter}
      ORDER BY days_in_status DESC, t.updated_at ASC
      LIMIT 50
    `, params);

    await client.query('COMMIT');

    const pausedTasks = pausedTasksRes.rows.map((row) => ({
      taskId: row.task_id,
      taskTitle: row.task_title,
      demandId: row.demand_id,
      demandTitle: row.demand_title,
      clientName: row.client_name,
      assignedToName: row.assigned_to_name,
      status: row.status as TaskStatus,
      pauseReason: row.pause_reason,
      daysInCurrentStatus: row.days_in_status,
    }));

    const response: BottlenecksReportResponse = {
      summary: {
        currentlyBlockedTasks: counts.blocked,
        currentlyPausedTasks: counts.paused,
        currentlyInReviewTasks: counts.in_review,
        overdueOpenTasks: counts.overdue,
      },
      stageAverages: {
        averageReadyWaitHours: Math.round((counts.avg_ready_wait_hours ?? 0) * 10) / 10,
        averageProductionHours: Math.round((counts.avg_prod_hours ?? 0) * 10) / 10,
        averagePauseCount: Math.round(avgPauseCount * 10) / 10,
      },
      pausedTasks,
    };

    return bottlenecksReportResponseSchema.parse(response);
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    throw err;
  } finally {
    client.release();
  }
}
