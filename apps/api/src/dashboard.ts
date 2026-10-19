import type {
  DashboardDemandItem,
  DashboardItem,
  DashboardQuery,
  DashboardResponse,
  DashboardTaskItem,
  DashboardWorkloadUser,
  DemandPriority,
  DemandStatus,
  SessionResponse,
  TaskPriority,
  TaskStatus,
} from '@orium/contracts';
import { dashboardResponseSchema } from '@orium/contracts';
import type { Database } from './db.js';
import { AppError } from './errors.js';

export interface DashboardOptions {
  now?: Date;
}

interface UserSnapshotRow {
  id: string;
  name: string;
  email: string;
  active: boolean;
  roles: string[];
  permissions: string[];
}

interface TaskSnapshotRow {
  task_id: string;
  task_title: string;
  task_priority: TaskPriority;
  task_delivery_date: string;
  task_status: TaskStatus;
  accepted_at: Date | string | null;
  started_at: Date | string | null;
  ready_at: Date | string | null;
  pause_requested_at: Date | string | null;
  pause_reason: string | null;
  paused_at: Date | string | null;
  assigned_to_user_id: string;
  assigned_to_name: string;
  demand_id: string;
  demand_title: string;
  demand_status: DemandStatus;
  demand_delivery_date: string;
  demand_priority: DemandPriority;
  client_id: string;
  client_name: string;
}

interface DemandSnapshotRow {
  demand_id: string;
  demand_title: string;
  demand_status: DemandStatus;
  demand_priority: DemandPriority;
  demand_delivery_date: string;
  client_id: string;
  client_name: string;
}

interface WorkloadSnapshotRow {
  user_id: string;
  name: string;
  active: boolean;
  total: number;
  production: number;
  awaiting_action: number;
}

const PRIORITY_ORDER: Record<string, number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
};

export function addCalendarDays(dateStr: string, days: number): string {
  const parts = dateStr.split('-').map(Number);
  const y = parts[0] ?? 1970;
  const m = parts[1] ?? 1;
  const d = parts[2] ?? 1;
  const date = new Date(Date.UTC(y, m - 1, d + days));
  const ny = date.getUTCFullYear();
  const nm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const nd = String(date.getUTCDate()).padStart(2, '0');
  return `${ny}-${nm}-${nd}`;
}

export function sortDashboardItems(items: DashboardItem[]): DashboardItem[] {
  return [...items].sort((a, b) => {
    const prioA = PRIORITY_ORDER[a.priority] ?? 99;
    const prioB = PRIORITY_ORDER[b.priority] ?? 99;
    if (prioA !== prioB) return prioA - prioB;
    if (a.deliveryDate !== b.deliveryDate) {
      return a.deliveryDate.localeCompare(b.deliveryDate);
    }
    return a.id.localeCompare(b.id);
  });
}

function getAwaitingActionReason(task: TaskSnapshotRow): string {
  if (task.pause_requested_at) {
    return task.pause_reason
      ? `Solicitação de pausa pendente: ${task.pause_reason}`
      : 'Solicitação de pausa pendente de aprovação';
  }
  switch (task.task_status) {
    case 'blocked':
      return 'Bloqueada por requisitos ou dependências pendentes';
    case 'ready':
      return task.accepted_at
        ? 'Pronta aguardando início da produção'
        : 'Pronta aguardando aceite do responsável';
    case 'in_review':
      return 'Submetida para revisão (aguardando avaliação do administrador)';
    case 'changes_requested':
      return 'Ajustes solicitados na revisão (aguardando correções do responsável)';
    case 'paused':
      return task.pause_reason
        ? `Pausada: ${task.pause_reason}`
        : 'Pausada operacionalmente';
    default:
      return 'Aguardando ação operacional';
  }
}

function mapTaskToDashboardItem(
  t: TaskSnapshotRow,
  scope: 'all' | 'assigned',
  reason?: string | null
): DashboardTaskItem {
  return {
    kind: 'task',
    id: t.task_id,
    title: t.task_title,
    demandId: t.demand_id,
    demandTitle: t.demand_title,
    client: {
      id: t.client_id,
      name: t.client_name,
    },
    status: t.task_status,
    priority: t.task_priority,
    deliveryDate: t.task_delivery_date,
    taskId: t.task_id,
    startedAt: t.started_at ? new Date(t.started_at).toISOString() : null,
    readyAt: t.ready_at ? new Date(t.ready_at).toISOString() : null,
    reason: reason ?? null,
    assignedTo: scope === 'all'
      ? { id: t.assigned_to_user_id, name: t.assigned_to_name }
      : null,
  };
}

function mapDemandToDashboardItem(d: DemandSnapshotRow): DashboardDemandItem {
  return {
    kind: 'demand',
    id: d.demand_id,
    title: d.demand_title,
    demandId: d.demand_id,
    demandTitle: d.demand_title,
    client: {
      id: d.client_id,
      name: d.client_name,
    },
    status: d.demand_status,
    priority: d.demand_priority,
    deliveryDate: d.demand_delivery_date,
    taskId: null,
    startedAt: null,
    reason: null,
    assignedTo: null,
  };
}

export async function getDashboard(
  database: Database,
  identity: SessionResponse,
  query: DashboardQuery,
  options?: DashboardOptions
): Promise<DashboardResponse> {
  const now = options?.now ?? new Date();
  const timeZone = 'America/Cuiaba';
  const today = new Intl.DateTimeFormat('en-CA', { timeZone }).format(now);
  const tomorrow = addCalendarDays(today, 1);
  const upcomingLimit = addCalendarDays(today, 3);
  const generatedAt = now.toISOString();

  const client = await database.pool.connect();
  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');

    // 1. Revalidar identidade, status ativo, papéis e permissões no mesmo snapshot
    const userResult = await client.query<UserSnapshotRow>(`
      SELECT
        u.id, u.name, u.email, u.active,
        COALESCE(array_agg(DISTINCT ur.role_id) FILTER (WHERE ur.role_id IS NOT NULL), '{}') AS roles,
        COALESCE(array_agg(DISTINCT rp.permission_id) FILTER (WHERE rp.permission_id IS NOT NULL), '{}') AS permissions
      FROM auth_user u
      LEFT JOIN user_role ur ON ur.user_id = u.id
      LEFT JOIN role_permission rp ON rp.role_id = ur.role_id
      WHERE u.id = $1
      GROUP BY u.id
    `, [identity.user.id]);

    const currentUser = userResult.rows[0];
    if (!currentUser || !currentUser.active) {
      throw new AppError(401, 'UNAUTHENTICATED');
    }

    const hasDemandsRead = currentUser.permissions.includes('demands.read');
    const hasTasksRead = currentUser.permissions.includes('tasks.read');
    if (!hasDemandsRead || !hasTasksRead) {
      throw new AppError(403, 'FORBIDDEN');
    }

    const isAdmin = currentUser.roles.includes('administrator');
    const scope: 'all' | 'assigned' = isAdmin ? 'all' : 'assigned';
    const canSeeWorkload = isAdmin && currentUser.permissions.includes('users.read');

    // 2. Buscar tarefas abertas de chamados abertos dentro do escopo autorizado
    const taskQueryParams: unknown[] = [];
    let taskFilter = '';
    if (!isAdmin) {
      taskQueryParams.push(currentUser.id);
      taskFilter = `AND t.assigned_to_user_id = $${taskQueryParams.length}`;
    }

    const tasksResult = await client.query<TaskSnapshotRow>(`
      SELECT
        t.id AS task_id,
        t.title AS task_title,
        t.priority AS task_priority,
        t.delivery_date::text AS task_delivery_date,
        t.status AS task_status,
        t.accepted_at,
        t.started_at,
        t.ready_at,
        t.pause_requested_at,
        t.pause_reason,
        t.paused_at,
        t.assigned_to_user_id,
        u.name AS assigned_to_name,
        d.id AS demand_id,
        d.title AS demand_title,
        d.status AS demand_status,
        d.delivery_date::text AS demand_delivery_date,
        d.priority AS demand_priority,
        c.id AS client_id,
        c.name AS client_name
      FROM task t
      JOIN demand d ON d.id = t.demand_id
      JOIN client c ON c.id = d.client_id
      JOIN auth_user u ON u.id = t.assigned_to_user_id
      WHERE t.status != 'completed'
        AND d.status != 'completed'
        ${taskFilter}
    `, taskQueryParams);

    const tasks = tasksResult.rows;

    // 3. Buscar chamados vencidos (overdueDemands) dentro do escopo autorizado
    const demandQueryParams: unknown[] = [today];
    let demandFilter = '';
    if (!isAdmin) {
      demandQueryParams.push(currentUser.id);
      demandFilter = `AND EXISTS (
        SELECT 1 FROM task st
        WHERE st.demand_id = d.id
          AND st.assigned_to_user_id = $${demandQueryParams.length}
          AND st.status != 'completed'
      )`;
    }

    const demandsResult = await client.query<DemandSnapshotRow>(`
      SELECT
        d.id AS demand_id,
        d.title AS demand_title,
        d.status AS demand_status,
        d.priority AS demand_priority,
        d.delivery_date::text AS demand_delivery_date,
        c.id AS client_id,
        c.name AS client_name
      FROM demand d
      JOIN client c ON c.id = d.client_id
      WHERE d.status = 'open'
        AND d.delivery_date < $1::date
        ${demandFilter}
    `, demandQueryParams);

    const overdueDemandRows = demandsResult.rows;

    // 4. Buscar carga de equipe (workload) se autorizado (admin + users.read)
    let workload: DashboardWorkloadUser[] = [];
    if (canSeeWorkload) {
      const workloadResult = await client.query<WorkloadSnapshotRow>(`
        SELECT
          u.id AS user_id,
          u.name,
          u.active,
          COUNT(t.id)::int AS total,
          COUNT(t.id) FILTER (WHERE t.status = 'in_production')::int AS production,
          COUNT(t.id) FILTER (
            WHERE t.status IN ('blocked', 'ready', 'in_review', 'changes_requested', 'paused')
               OR t.pause_requested_at IS NOT NULL
          )::int AS awaiting_action
        FROM auth_user u
        LEFT JOIN task t ON t.assigned_to_user_id = u.id
          AND t.status != 'completed'
          AND EXISTS (SELECT 1 FROM demand d WHERE d.id = t.demand_id AND d.status != 'completed')
        GROUP BY u.id, u.name, u.active
        HAVING u.active = true OR COUNT(t.id) > 0
        ORDER BY u.active DESC, COUNT(t.id) DESC, u.name ASC
      `);

      workload = workloadResult.rows.map((r) => ({
        userId: r.user_id,
        name: r.name,
        active: r.active,
        total: r.total,
        production: r.production,
        awaitingAction: r.awaiting_action,
      }));
    }

    await client.query('COMMIT');

    // 5. Categorização e projeção nas seções
    const productionItems: DashboardItem[] = [];
    const awaitingActionItems: DashboardItem[] = [];
    const overdueTaskItems: DashboardItem[] = [];
    const dueTodayItems: DashboardItem[] = [];
    const upcomingItems: DashboardItem[] = [];
    const urgentItems: DashboardItem[] = [];

    const awaitingActionSeen = new Set<string>();

    for (const t of tasks) {
      // 5.1 Em produção: status in_production
      if (t.task_status === 'in_production') {
        productionItems.push(mapTaskToDashboardItem(t, scope));
      }

      // 5.2 Dependendo de ação: blocked, ready, in_review, changes_requested, paused, ou pause_requested_at pendente
      const isAwaitingAction =
        ['blocked', 'ready', 'in_review', 'changes_requested', 'paused'].includes(t.task_status) ||
        Boolean(t.pause_requested_at);

      if (isAwaitingAction && !awaitingActionSeen.has(t.task_id)) {
        awaitingActionSeen.add(t.task_id);
        const reason = getAwaitingActionReason(t);
        awaitingActionItems.push(mapTaskToDashboardItem(t, scope, reason));
      }

      // 5.3 Atraso operacional de tarefa: started_at preenchido + status in_production/in_review/changes_requested + deliveryDate anterior a hoje
      const isOperationallyActive = ['in_production', 'in_review', 'changes_requested'].includes(t.task_status);
      const isStarted = Boolean(t.started_at);
      const isPastDate = t.task_delivery_date < today;

      if (isStarted && isOperationallyActive && isPastDate) {
        overdueTaskItems.push(mapTaskToDashboardItem(t, scope));
      }

      // 5.4 Hoje: entrega agendada para hoje
      if (t.task_delivery_date === today) {
        dueTodayItems.push(mapTaskToDashboardItem(t, scope));
      }

      // 5.5 Próximas entregas: amanhã até hoje+3 dias inclusive
      if (t.task_delivery_date >= tomorrow && t.task_delivery_date <= upcomingLimit) {
        upcomingItems.push(mapTaskToDashboardItem(t, scope));
      }

      // 5.6 Urgentes: prioridade urgent
      if (t.task_priority === 'urgent') {
        urgentItems.push(mapTaskToDashboardItem(t, scope));
      }
    }

    // 5.7 Chamados com prazo vencido
    const overdueDemandItems: DashboardItem[] = overdueDemandRows.map(mapDemandToDashboardItem);

    // 6. Ordenação determinística e paginação por limite
    const limit = query.limit;

    const buildSection = (rawItems: DashboardItem[]) => {
      const sorted = sortDashboardItems(rawItems);
      return {
        total: sorted.length,
        items: sorted.slice(0, limit),
      };
    };

    const response: DashboardResponse = {
      generatedAt,
      today,
      timeZone: 'America/Cuiaba',
      upcomingDays: 3,
      scope,
      sections: {
        production: buildSection(productionItems),
        awaitingAction: buildSection(awaitingActionItems),
        overdueTasks: buildSection(overdueTaskItems),
        overdueDemands: buildSection(overdueDemandItems),
        dueToday: buildSection(dueTodayItems),
        upcoming: buildSection(upcomingItems),
        urgent: buildSection(urgentItems),
      },
      workload,
      workloadAvailable: canSeeWorkload,
    };

    // Validar saída com o schema estrito oficial
    return dashboardResponseSchema.parse(response);
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Ignorar erro de rollback se transação já foi encerrada
    }
    throw err;
  } finally {
    client.release();
  }
}
