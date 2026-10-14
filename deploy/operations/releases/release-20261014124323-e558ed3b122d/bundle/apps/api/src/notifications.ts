import type {
  ListNotificationsQuery,
  Notification,
  NotificationKind,
  NotificationListResponse,
  NotificationResponse,
} from '@orium/contracts';
import type { Database } from './db.js';
import { AppError } from './errors.js';
import { IDENTITY_LOCK, type InternalSessionIdentity } from './identity.js';
import { calendarApplicabilityPredicate, materializeCalendarNotifications, notificationCalendarDate } from './notifications-calendar.js';

// Fase 7 — Incremento 2: persistência e API pessoal de notificações
// (docs/PHASE7-INCREMENT2-CONTRACT.md e docs/PHASE7-NOTIFICATIONS-CONTRACT.md).
// Lock order: BEGIN READ COMMITTED -> pg_advisory_xact_lock(IDENTITY_LOCK) -> FOR SHARE on auth_session -> revalidate session/user -> recheck roles/grants -> execute domain query.

interface SessionValidationRow {
  user_id: string;
  active: boolean;
  expires_at: string | Date;
  created_at: string | Date;
  last_seen_at: string | Date;
  now_ts: string | Date;
}

interface NotificationRow {
  id: string;
  kind: string;
  demand_id: string;
  task_id: string | null;
  created_at: string | Date;
  read_at: string | Date | null;
  demand_title: string;
  demand_delivery_date: string;
  task_title: string | null;
  task_delivery_date: string | null;
}

function formatDate(d: unknown): string | null {
  if (!d) return null;
  if (typeof d === 'string') return d.slice(0, 10);
  if (d instanceof Date) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  return String(d).slice(0, 10);
}

function formatNotification(row: NotificationRow): Notification {
  return {
    id: row.id,
    kind: row.kind as NotificationKind,
    demandId: row.demand_id,
    taskId: row.task_id,
    demandTitle: row.demand_title,
    taskTitle: row.task_id ? row.task_title : null,
    createdAt: new Date(row.created_at).toISOString(),
    readAt: row.read_at ? new Date(row.read_at).toISOString() : null,
    deliveryDate: row.task_id ? formatDate(row.task_delivery_date) : formatDate(row.demand_delivery_date),
  };
}

export async function listNotifications(
  database: Database,
  sessionAuth: InternalSessionIdentity,
  query: ListNotificationsQuery,
  options: { now?: Date } = {},
): Promise<NotificationListResponse> {
  const client = await database.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [IDENTITY_LOCK]);

    // 1. Lock auth_session FOR SHARE first
    const lockRes = await client.query<{ id: string }>(
      `SELECT s.id
       FROM auth_session s
       WHERE s.id = $1
       FOR SHARE OF s`,
      [sessionAuth.sessionId],
    );

    if (lockRes.rows.length === 0) {
      throw new AppError(401, 'UNAUTHENTICATED');
    }

    // 2. Validate current session state, active user and temporal limits in a subsequent command on the same client after waiting for the lock
    const sessionRes = await client.query<SessionValidationRow>(
      `SELECT s.user_id, u.active, s.expires_at, s.created_at, s.last_seen_at, clock_timestamp() AS now_ts
       FROM auth_session s
       JOIN auth_user u ON s.user_id = u.id
       WHERE s.id = $1`,
      [sessionAuth.sessionId],
    );

    if (sessionRes.rows.length === 0) {
      throw new AppError(401, 'UNAUTHENTICATED');
    }

    const sessionRow = sessionRes.rows[0]!;
    if (sessionRow.user_id !== sessionAuth.identity.user.id || !sessionRow.active) {
      throw new AppError(401, 'UNAUTHENTICATED');
    }

    const now = new Date(sessionRow.now_ts).getTime();
    const expiresAt = new Date(sessionRow.expires_at).getTime();
    const createdAt = new Date(sessionRow.created_at).getTime();
    const lastSeenAt = new Date(sessionRow.last_seen_at).getTime();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const twelveHoursMs = 12 * 60 * 60 * 1000;

    // Negate equality on absolute expiry and 7-day / 12-hour limits in conformity with authenticate
    if (now >= expiresAt || now - createdAt >= sevenDaysMs || now - lastSeenAt >= twelveHoursMs) {
      throw new AppError(401, 'UNAUTHENTICATED');
    }

    // 3. Recheck real roles and permissions in-tx
    const permsRes = await client.query<{ role_id: string; permission_id: string }>(
      `SELECT r.role_id, rp.permission_id
       FROM user_role r
       JOIN role_permission rp ON r.role_id = rp.role_id
       WHERE r.user_id = $1`,
      [sessionRow.user_id],
    );

    const roles = new Set(permsRes.rows.map((r) => r.role_id));
    const permissions = new Set(permsRes.rows.map((r) => r.permission_id));

    if (!permissions.has('demands.read') || !permissions.has('tasks.read')) {
      throw new AppError(403, 'FORBIDDEN');
    }

    const isAdministrator = roles.has('administrator');
    const actorId = sessionRow.user_id;
    const today = notificationCalendarDate(options.now ?? new Date(sessionRow.now_ts));
    await materializeCalendarNotifications(client, actorId, isAdministrator, today);

    // 4. Count all currently visible and applicable unread notifications.
    const unreadRes = await client.query<{ count: number }>(
      `SELECT count(*)::int AS count
       FROM notification n
       JOIN demand d ON d.id = n.demand_id
       LEFT JOIN task t ON t.id = n.task_id
       WHERE n.recipient_user_id = $1
         AND n.read_at IS NULL
         AND (n.task_id IS NULL OR t.demand_id = n.demand_id)
         AND (
           $2::boolean = true
           OR (n.task_id IS NOT NULL AND t.assigned_to_user_id = $1)
           OR (n.task_id IS NULL AND EXISTS (
             SELECT 1 FROM task at_sub
             WHERE at_sub.demand_id = n.demand_id AND at_sub.assigned_to_user_id = $1
           ))
         )
         AND ${calendarApplicabilityPredicate('$3')}`,
      [actorId, isAdministrator, today],
    );
    const unreadCount = unreadRes.rows[0]?.count ?? 0;

    // 5. Count all applicable notifications respecting the unreadOnly filter.
    const totalRes = await client.query<{ count: number }>(
      `SELECT count(*)::int AS count
       FROM notification n
       JOIN demand d ON d.id = n.demand_id
       LEFT JOIN task t ON t.id = n.task_id
       WHERE n.recipient_user_id = $1
         AND ($3::boolean = false OR n.read_at IS NULL)
         AND (n.task_id IS NULL OR t.demand_id = n.demand_id)
         AND (
           $2::boolean = true
           OR (n.task_id IS NOT NULL AND t.assigned_to_user_id = $1)
           OR (n.task_id IS NULL AND EXISTS (
             SELECT 1 FROM task at_sub
             WHERE at_sub.demand_id = n.demand_id AND at_sub.assigned_to_user_id = $1
           ))
         )
         AND ${calendarApplicabilityPredicate('$4')}`,
      [actorId, isAdministrator, query.unreadOnly, today],
    );
    const total = totalRes.rows[0]?.count ?? 0;

    // 6. Query the paginated slice using the same authorization and calendar predicate.
    const offset = (query.page - 1) * query.pageSize;
    const itemsRes = await client.query<NotificationRow>(
      `SELECT n.id, n.kind, n.demand_id, n.task_id, n.created_at, n.read_at,
              d.title AS demand_title, d.delivery_date::text AS demand_delivery_date,
              t.title AS task_title, t.delivery_date::text AS task_delivery_date
       FROM notification n
       JOIN demand d ON d.id = n.demand_id
       LEFT JOIN task t ON t.id = n.task_id
       WHERE n.recipient_user_id = $1
         AND ($3::boolean = false OR n.read_at IS NULL)
         AND (n.task_id IS NULL OR t.demand_id = n.demand_id)
         AND (
           $2::boolean = true
           OR (n.task_id IS NOT NULL AND t.assigned_to_user_id = $1)
           OR (n.task_id IS NULL AND EXISTS (
             SELECT 1 FROM task at_sub
             WHERE at_sub.demand_id = n.demand_id AND at_sub.assigned_to_user_id = $1
           ))
         )
         AND ${calendarApplicabilityPredicate('$6')}
       ORDER BY n.created_at DESC, n.id DESC
       LIMIT $4 OFFSET $5`,
      [actorId, isAdministrator, query.unreadOnly, query.pageSize, offset, today],
    );

    await client.query('COMMIT');

    const notifications: Notification[] = itemsRes.rows.map(formatNotification);

    return {
      notifications,
      page: query.page,
      pageSize: query.pageSize,
      total,
      unreadCount,
      updatedAt: new Date(now).toISOString(),
    };
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function markNotificationAsRead(
  database: Database,
  sessionAuth: InternalSessionIdentity,
  notificationId: string,
  options: { now?: Date } = {},
): Promise<NotificationResponse> {
  const client = await database.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [IDENTITY_LOCK]);

    // 1. Lock auth_session FOR SHARE first
    const lockRes = await client.query<{ id: string }>(
      `SELECT s.id
       FROM auth_session s
       WHERE s.id = $1
       FOR SHARE OF s`,
      [sessionAuth.sessionId],
    );

    if (lockRes.rows.length === 0) {
      throw new AppError(401, 'UNAUTHENTICATED');
    }

    // 2. Validate current session state, active user and temporal limits in a subsequent command on the same client after waiting for the lock
    const sessionRes = await client.query<SessionValidationRow>(
      `SELECT s.user_id, u.active, s.expires_at, s.created_at, s.last_seen_at, clock_timestamp() AS now_ts
       FROM auth_session s
       JOIN auth_user u ON s.user_id = u.id
       WHERE s.id = $1`,
      [sessionAuth.sessionId],
    );

    if (sessionRes.rows.length === 0) {
      throw new AppError(401, 'UNAUTHENTICATED');
    }

    const sessionRow = sessionRes.rows[0]!;
    if (sessionRow.user_id !== sessionAuth.identity.user.id || !sessionRow.active) {
      throw new AppError(401, 'UNAUTHENTICATED');
    }

    const now = new Date(sessionRow.now_ts).getTime();
    const expiresAt = new Date(sessionRow.expires_at).getTime();
    const createdAt = new Date(sessionRow.created_at).getTime();
    const lastSeenAt = new Date(sessionRow.last_seen_at).getTime();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const twelveHoursMs = 12 * 60 * 60 * 1000;

    // Negate equality on absolute expiry and 7-day / 12-hour limits in conformity with authenticate
    if (now >= expiresAt || now - createdAt >= sevenDaysMs || now - lastSeenAt >= twelveHoursMs) {
      throw new AppError(401, 'UNAUTHENTICATED');
    }

    // 3. Recheck real roles and permissions in-tx
    const permsRes = await client.query<{ role_id: string; permission_id: string }>(
      `SELECT r.role_id, rp.permission_id
       FROM user_role r
       JOIN role_permission rp ON r.role_id = rp.role_id
       WHERE r.user_id = $1`,
      [sessionRow.user_id],
    );

    const roles = new Set(permsRes.rows.map((r) => r.role_id));
    const permissions = new Set(permsRes.rows.map((r) => r.permission_id));

    if (!permissions.has('demands.read') || !permissions.has('tasks.read')) {
      throw new AppError(403, 'FORBIDDEN');
    }

    const isAdministrator = roles.has('administrator');
    const actorId = sessionRow.user_id;

    const today = notificationCalendarDate(options.now ?? new Date(sessionRow.now_ts));

    // 4. Select the currently applicable authorized notification and lock FOR UPDATE OF n.
    const notifRes = await client.query<NotificationRow>(
      `SELECT n.id, n.kind, n.demand_id, n.task_id, n.created_at, n.read_at,
              d.title AS demand_title, d.delivery_date::text AS demand_delivery_date,
              t.title AS task_title, t.delivery_date::text AS task_delivery_date
       FROM notification n
       JOIN demand d ON d.id = n.demand_id
       LEFT JOIN task t ON t.id = n.task_id
       WHERE n.id = $3
         AND n.recipient_user_id = $1
         AND (n.task_id IS NULL OR t.demand_id = n.demand_id)
         AND (
           $2::boolean = true
           OR (n.task_id IS NOT NULL AND t.assigned_to_user_id = $1)
           OR (n.task_id IS NULL AND EXISTS (
             SELECT 1 FROM task at_sub
             WHERE at_sub.demand_id = n.demand_id AND at_sub.assigned_to_user_id = $1
           ))
         )
         AND ${calendarApplicabilityPredicate('$4')}
       FOR UPDATE OF n`,
      [actorId, isAdministrator, notificationId, today],
    );

    if (notifRes.rows.length === 0) {
      throw new AppError(404, 'NOT_FOUND');
    }

    const item = notifRes.rows[0]!;

    // 4. Update read_at = COALESCE(read_at, clock_timestamp())
    const updateRes = await client.query<{ read_at: string | Date }>(
      `UPDATE notification
       SET read_at = COALESCE(read_at, clock_timestamp())
       WHERE id = $1
       RETURNING read_at`,
      [notificationId],
    );

    await client.query('COMMIT');

    const finalReadAt = updateRes.rows[0]?.read_at ?? item.read_at;

    const notification: Notification = {
      id: item.id,
      kind: item.kind as NotificationKind,
      demandId: item.demand_id,
      taskId: item.task_id,
      demandTitle: item.demand_title,
      taskTitle: item.task_id ? item.task_title : null,
      createdAt: new Date(item.created_at).toISOString(),
      readAt: finalReadAt ? new Date(finalReadAt).toISOString() : null,
      deliveryDate: item.task_id ? formatDate(item.task_delivery_date) : formatDate(item.demand_delivery_date),
    };

    return { notification };
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore
    }
    throw error;
  } finally {
    client.release();
  }
}
