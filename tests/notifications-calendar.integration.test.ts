import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Demand, Task } from '@orium/contracts';
import { listNotifications, markNotificationAsRead } from '../apps/api/src/notifications.js';
import { notificationCalendarDate } from '../apps/api/src/notifications-calendar.js';
import { NotificationFixtures, type NotificationActor } from './notification-fixtures.js';

describe('personal calendar notifications, real PostgreSQL and Cuiaba dates', () => {
  const h = new NotificationFixtures('calendar');
  const now = new Date('2028-03-01T03:59:00Z'); // February 29, 23:59 in Cuiaba.
  let admin: NotificationActor, worker: NotificationActor, other: NotificationActor, demand: Demand;
  let today: Task, tomorrow: Task, plus3: Task, plus4: Task, overdue: Task, blocked: Task, paused: Task, completed: Task;
  let unstarted: Task, blockedToday: Task, pausedSoon: Task;
  beforeAll(async () => {
    await h.init(); admin = await h.user('administrator'); worker = await h.user('collaborator'); other = await h.user('collaborator'); demand = await h.demand(admin, '2028-03-30');
    today = await h.task(admin, demand, worker, { deliveryDate: '2028-02-29' }); tomorrow = await h.task(admin, demand, worker, { deliveryDate: '2028-03-01' });
    plus3 = await h.task(admin, demand, worker, { deliveryDate: '2028-03-03' }); plus4 = await h.task(admin, demand, worker, { deliveryDate: '2028-03-04' });
    overdue = await h.task(admin, demand, worker, { deliveryDate: '2028-02-28' }); blocked = await h.task(admin, demand, worker, { deliveryDate: '2028-02-28' });
    paused = await h.task(admin, demand, worker, { deliveryDate: '2028-02-28' }); completed = await h.task(admin, demand, worker, { deliveryDate: '2028-02-29' });
    unstarted = await h.task(admin, demand, worker, { deliveryDate: '2028-02-28' });
    blockedToday = await h.task(admin, demand, worker, { deliveryDate: '2028-02-29' });
    pausedSoon = await h.task(admin, demand, worker, { deliveryDate: '2028-03-01' });
    await h.migrator.pool.query(`UPDATE task SET status='in_production',started_at=clock_timestamp() WHERE id=$1`, [overdue.id]);
    await h.migrator.pool.query(`UPDATE task SET status='blocked',started_at=NULL WHERE id=$1`, [blocked.id]);
    await h.migrator.pool.query(`UPDATE task SET status='paused',started_at=clock_timestamp() WHERE id=$1`, [paused.id]);
    await h.migrator.pool.query(`UPDATE task SET status='completed',completed_at=clock_timestamp() WHERE id=$1`, [completed.id]);
    await h.migrator.pool.query(`UPDATE task SET status='in_production',started_at=NULL WHERE id=$1`, [unstarted.id]);
    await h.migrator.pool.query(`UPDATE task SET status='blocked',started_at=NULL WHERE id=$1`, [blockedToday.id]);
    await h.migrator.pool.query(`UPDATE task SET status='paused',started_at=clock_timestamp() WHERE id=$1`, [pausedSoon.id]);
  });
  afterAll(() => h.cleanup());
  const list = (actor: NotificationActor, clock = now, unreadOnly = false, pageSize = 50) => listNotifications(h.database, actor.session, { page: 1, pageSize, unreadOnly }, { now: clock });
  const temporal = async (actor: NotificationActor, clock = now) => (await list(actor, clock)).notifications.filter((row) => ['task_due_today', 'task_due_soon', 'task_overdue', 'demand_overdue'].includes(row.kind));

  it('uses leap-year Cuiaba midnight and exact today/+1/+3/+4 boundaries without treating pauses/blocks as overdue', async () => {
    expect(notificationCalendarDate(now)).toBe('2028-02-29');
    expect(notificationCalendarDate(new Date('2028-03-01T04:01:00Z'))).toBe('2028-03-01');
    const rows = await temporal(worker);
    expect(rows.map((row) => [row.taskId, row.kind]).sort()).toEqual([[today.id, 'task_due_today'], [tomorrow.id, 'task_due_soon'], [plus3.id, 'task_due_soon'], [overdue.id, 'task_overdue'], [blockedToday.id, 'task_due_today'], [pausedSoon.id, 'task_due_soon']].sort());
    expect(rows.some((row) => [plus4.id, blocked.id, paused.id, completed.id, unstarted.id].includes(row.taskId!))).toBe(false);
  });

  it('deduplicates concurrent polling, keeps readAt and counts independent of page/filter', async () => {
    const rows = await temporal(worker); const item = rows.find((row) => row.taskId === today.id)!;
    const read = await markNotificationAsRead(h.database, worker.session, item.id, { now });
    const results = await Promise.all([list(worker), list(worker), list(worker, now, true, 1)]);
    expect(results[0].unreadCount).toBe(results[2].unreadCount);
    expect(results[2].total).toBe(results[2].unreadCount);
    const refreshed = (await temporal(worker)).find((row) => row.id === item.id)!;
    expect(refreshed.readAt).toBe(read.notification.readAt);
    expect((await h.migrator.pool.query('SELECT count(*)::int AS count FROM notification WHERE recipient_user_id=$1 AND task_id=$2 AND kind=$3', [worker.id, today.id, 'task_due_today'])).rows[0].count).toBe(1);
  });

  it('hides stale alerts after date/window/status changes and applies same predicate to read and counts', async () => {
    const previous = (await temporal(worker)).find((row) => row.taskId === overdue.id)!;
    await h.migrator.pool.query(`UPDATE task SET status='paused' WHERE id=$1`, [overdue.id]);
    expect((await temporal(worker)).some((row) => row.id === previous.id)).toBe(false);
    await expect(markNotificationAsRead(h.database, worker.session, previous.id, { now })).rejects.toMatchObject({ status: 404 });
    const due = (await temporal(worker)).find((row) => row.taskId === tomorrow.id)!;
    await h.migrator.pool.query(`UPDATE task SET delivery_date='2028-03-02' WHERE id=$1`, [tomorrow.id]);
    const changed = (await temporal(worker)).find((row) => row.taskId === tomorrow.id)!;
    expect(changed.id).not.toBe(due.id);
    await expect(markNotificationAsRead(h.database, worker.session, due.id, { now })).rejects.toMatchObject({ status: 404 });
    const nextDay = new Date('2028-03-01T04:01:00Z');
    expect((await temporal(worker, nextDay)).some((row) => row.taskId === today.id && row.kind === 'task_due_today')).toBe(false);
    const all = await list(worker, nextDay), unread = await list(worker, nextDay, true);
    expect(all.unreadCount).toBe(unread.total);
    expect(all.notifications.length).toBe(all.total);
  });

  it('keeps boxes personal, applies current assignment, and excludes completed-only demand links', async () => {
    const expiredDemand = await h.demand(admin, '2028-02-28');
    const finished = await h.task(admin, expiredDemand, worker); await h.task(admin, expiredDemand, other);
    await h.migrator.pool.query(`UPDATE task SET status='completed',completed_at=clock_timestamp() WHERE id=$1`, [finished.id]);
    expect((await temporal(worker)).some((row) => row.demandId === expiredDemand.id && row.kind === 'demand_overdue')).toBe(false);
    expect((await temporal(other)).some((row) => row.demandId === expiredDemand.id && row.kind === 'demand_overdue')).toBe(true);
    expect((await temporal(admin)).some((row) => row.demandId === expiredDemand.id && row.kind === 'demand_overdue')).toBe(true);
    const alert = (await temporal(worker)).find((row) => row.taskId === plus3.id)!;
    await h.migrator.pool.query('UPDATE task SET assigned_to_user_id=$2 WHERE id=$1', [plus3.id, other.id]);
    expect((await temporal(worker)).some((row) => row.id === alert.id)).toBe(false);
    await expect(markNotificationAsRead(h.database, worker.session, alert.id, { now })).rejects.toMatchObject({ status: 404 });
    expect((await temporal(other)).some((row) => row.taskId === plus3.id)).toBe(true);
    const adminAlert = (await temporal(admin)).find((row) => row.taskId === plus3.id)!;
    expect((await temporal(other)).some((row) => row.id === adminAlert.id)).toBe(false);
    await h.migrator.pool.query(`UPDATE demand SET status='completed' WHERE id=$1`, [expiredDemand.id]);
    expect((await temporal(admin)).some((row) => row.demandId === expiredDemand.id)).toBe(false);
  });
});
