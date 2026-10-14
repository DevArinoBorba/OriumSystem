import type { PoolClient } from 'pg';

/** Civil date only: session authentication always uses the real database clock separately. */
export function notificationCalendarDate(now: Date): string {
  if (!Number.isFinite(now.getTime())) throw new Error('Invalid notification calendar clock.');
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Cuiaba', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = (type: string) => parts.find((value) => value.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** Assumes recipient/session/grants have already been revalidated by the caller, on this
 * client under IDENTITY_LOCK. Only this recipient's currently applicable calendar is generated. */
export async function materializeCalendarNotifications(client: PoolClient, recipientId: string, isAdministrator: boolean, today: string): Promise<void> {
  await client.query(`
    INSERT INTO notification (id,recipient_user_id,demand_id,task_id,kind,source_event_id,source_delivery_date,created_at,read_at)
    SELECT gen_random_uuid(),$1,t.demand_id,t.id,
           CASE WHEN t.delivery_date=$3::date THEN 'task_due_today'
                WHEN t.delivery_date BETWEEN $3::date+1 AND $3::date+3 THEN 'task_due_soon'
                ELSE 'task_overdue' END,
           NULL,t.delivery_date,clock_timestamp(),NULL
    FROM task t JOIN demand d ON d.id=t.demand_id
    WHERE d.status='open' AND t.status<>'completed'
      AND ($2::boolean OR t.assigned_to_user_id=$1)
      AND (t.delivery_date=$3::date OR t.delivery_date BETWEEN $3::date+1 AND $3::date+3
           OR (t.delivery_date<$3::date AND t.started_at IS NOT NULL
               AND t.status IN ('in_production','in_review','changes_requested')))
    ON CONFLICT DO NOTHING
  `, [recipientId, isAdministrator, today]);
  await client.query(`
    INSERT INTO notification (id,recipient_user_id,demand_id,task_id,kind,source_event_id,source_delivery_date,created_at,read_at)
    SELECT gen_random_uuid(),$1,d.id,NULL,'demand_overdue',NULL,d.delivery_date,clock_timestamp(),NULL
    FROM demand d
    WHERE d.status='open' AND d.delivery_date<$3::date
      AND ($2::boolean OR EXISTS (
        SELECT 1 FROM task t WHERE t.demand_id=d.id AND t.assigned_to_user_id=$1 AND t.status<>'completed'
      ))
    ON CONFLICT DO NOTHING
  `, [recipientId, isAdministrator, today]);
}

/** Same predicate for list/total/unreadCount/read. Placeholders are internal constants;
 * resource aliases n/d/t correspond to the service's authorized projection. */
export function calendarApplicabilityPredicate(todayParameter: string, administratorParameter = '$2'): string {
  if (!/^\$[1-9]\d*$/.test(todayParameter) || !/^\$[1-9]\d*$/.test(administratorParameter)) {
    throw new Error('Invalid internal calendar placeholder.');
  }
  const today = `${todayParameter}::date`;
  return `(n.source_delivery_date IS NULL OR (
    n.source_delivery_date=CASE WHEN n.task_id IS NOT NULL THEN t.delivery_date ELSE d.delivery_date END
    AND (
      (n.kind='task_due_today' AND d.status='open' AND t.status<>'completed' AND t.delivery_date=${today})
      OR (n.kind='task_due_soon' AND d.status='open' AND t.status<>'completed' AND t.delivery_date BETWEEN ${today}+1 AND ${today}+3)
      OR (n.kind='task_overdue' AND d.status='open' AND t.delivery_date<${today} AND t.started_at IS NOT NULL
          AND t.status IN ('in_production','in_review','changes_requested'))
      OR (n.kind='demand_overdue' AND d.status='open' AND d.delivery_date<${today}
          AND (${administratorParameter}::boolean OR EXISTS (
            SELECT 1 FROM task calendar_scope WHERE calendar_scope.demand_id=d.id
              AND calendar_scope.assigned_to_user_id=n.recipient_user_id AND calendar_scope.status<>'completed'
          )))
    )
  ))`;
}
