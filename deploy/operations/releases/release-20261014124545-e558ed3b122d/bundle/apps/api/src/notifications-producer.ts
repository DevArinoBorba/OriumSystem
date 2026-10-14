import { randomUUID } from 'node:crypto';
import type { NotificationKind, TaskStatus } from '@orium/contracts';
import type { PoolClient } from 'pg';

type SourceEvent = {
  id: string;
  demand_id: string;
  task_id: string | null;
  actor_id: string;
  action: string;
  created_at: Date | string;
  task_status: TaskStatus | null;
  actor_role: string | null;
};

export type NotificationEventContext = {
  previousTaskStatus?: TaskStatus;
  demandChanged?: boolean;
};

type Audience = 'assignee' | 'administrators' | 'demand_assignees';
type Delivery = { kind: NotificationKind; audience: Audience; administrativePermission?: 'tasks.manage' | 'tasks.review' };

function deliveryFor(event: SourceEvent, context: NotificationEventContext): Delivery | null {
  switch (event.action) {
    case 'task_created':
    case 'task_reassigned':
      return { kind: 'task_assigned', audience: 'assignee' };
    case 'task_ready':
      return event.task_status === 'ready' ? { kind: 'task_unblocked', audience: 'assignee' } : null;
    case 'task_requirement_updated':
    case 'task_dependency_added':
    case 'task_dependency_removed':
      if (context.previousTaskStatus === 'blocked' && event.task_status === 'ready') {
        return { kind: 'task_unblocked', audience: 'assignee' };
      }
      return context.previousTaskStatus === 'ready' && event.task_status === 'blocked'
        ? { kind: 'task_important_change', audience: 'assignee' } : null;
    case 'task_comment_created':
      if (event.actor_role === 'administrator') return { kind: 'task_comment', audience: 'assignee' };
      return event.actor_role === 'collaborator'
        ? { kind: 'task_comment', audience: 'administrators', administrativePermission: 'tasks.manage' } : null;
    case 'task_review_submitted':
      return { kind: 'task_review_submitted', audience: 'administrators', administrativePermission: 'tasks.review' };
    case 'task_changes_requested':
      return { kind: 'task_changes_requested', audience: 'assignee' };
    case 'task_completed':
      return { kind: 'task_approved', audience: 'assignee' };
    case 'task_pause_requested':
      return { kind: 'task_important_change', audience: 'administrators', administrativePermission: 'tasks.manage' };
    case 'task_pause_approved':
    case 'task_resumed':
      return { kind: 'task_important_change', audience: 'assignee' };
    case 'demand_updated':
      return context.demandChanged ? { kind: 'demand_important_change', audience: 'demand_assignees' } : null;
    case 'demand_completed':
      return { kind: 'demand_important_change', audience: 'demand_assignees' };
    default:
      return null;
  }
}

/** Called only immediately after inserting the event, on the producer's existing client,
 * inside its IDENTITY_LOCK transaction. No catch/commit/pool operation here: failure rolls
 * back the caller's domain mutation and audit event. This is not a historical backfill API. */
export async function emitNotificationsForEvent(
  client: PoolClient,
  sourceEventId: string,
  context: NotificationEventContext = {},
): Promise<number> {
  const source = (await client.query<SourceEvent>(`
    SELECT e.id, e.demand_id, e.task_id, e.actor_id, e.action, e.created_at,
           t.status AS task_status, r.role_id AS actor_role
    FROM demand_event e
    JOIN auth_user actor ON actor.id=e.actor_id AND actor.active
    JOIN user_role r ON r.user_id=actor.id
    LEFT JOIN task t ON t.id=e.task_id AND t.demand_id=e.demand_id
    WHERE e.id=$1 AND (e.task_id IS NULL OR t.id IS NOT NULL)
  `, [sourceEventId])).rows[0];
  if (!source) throw new Error('Notification source event is unavailable.');
  const delivery = deliveryFor(source, context);
  if (!delivery) return 0;

  const recipients = await client.query<{ id: string }>(`
    SELECT u.id
    FROM auth_user u JOIN user_role r ON r.user_id=u.id
    WHERE u.active AND u.id<>$1
      AND EXISTS (SELECT 1 FROM role_permission p WHERE p.role_id=r.role_id AND p.permission_id='demands.read')
      AND EXISTS (SELECT 1 FROM role_permission p WHERE p.role_id=r.role_id AND p.permission_id='tasks.read')
      AND (
        ($2='assignee' AND EXISTS (SELECT 1 FROM task t WHERE t.id=$3 AND t.demand_id=$4 AND t.assigned_to_user_id=u.id))
        OR ($2='administrators' AND r.role_id='administrator' AND EXISTS (
          SELECT 1 FROM role_permission p WHERE p.role_id=r.role_id AND p.permission_id=$5
        ))
        OR ($2='demand_assignees' AND EXISTS (SELECT 1 FROM task t WHERE t.demand_id=$4 AND t.assigned_to_user_id=u.id))
      )
    ORDER BY u.id
  `, [source.actor_id, delivery.audience, source.task_id, source.demand_id, delivery.administrativePermission ?? null]);

  let inserted = 0;
  for (const recipient of recipients.rows) {
    const result = await client.query(`
      INSERT INTO notification (id, recipient_user_id, demand_id, task_id, kind, source_event_id, source_delivery_date, created_at, read_at)
      VALUES ($1,$2,$3,$4,$5,$6,NULL,$7,NULL)
      ON CONFLICT DO NOTHING
    `, [randomUUID(), recipient.id, source.demand_id, source.task_id, delivery.kind, source.id, source.created_at]);
    inserted += result.rowCount ?? 0;
  }
  return inserted;
}
