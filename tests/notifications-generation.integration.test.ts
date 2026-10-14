import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Task } from '@orium/contracts';
import { emitNotificationsForEvent } from '../apps/api/src/notifications-producer.js';
import { IDENTITY_LOCK } from '../apps/api/src/identity.js';
import { NotificationFixtures, type NotificationActor } from './notification-fixtures.js';

describe('notification event generation, real PostgreSQL', () => {
  const h = new NotificationFixtures('generation');
  let admin: NotificationActor, reviewer: NotificationActor, worker: NotificationActor, other: NotificationActor;
  beforeAll(async () => { await h.init(); admin = await h.user('administrator'); reviewer = await h.user('administrator'); worker = await h.user('collaborator'); other = await h.user('collaborator'); });
  afterAll(() => h.cleanup());
  const records = async (task: Task, kind?: string) => (await h.migrator.pool.query('SELECT recipient_user_id,kind,source_event_id,read_at FROM notification WHERE task_id=$1 AND ($2::text IS NULL OR kind=$2) ORDER BY recipient_user_id', [task.id, kind ?? null])).rows;

  it('assigns exactly once, excludes author, sends reassignment to current recipient and revokes old visibility', async () => {
    const demand = await h.demand(admin);
    let task = await h.task(admin, demand, worker);
    expect(await records(task)).toHaveLength(1);
    expect((await records(task))[0]).toMatchObject({ recipient_user_id: worker.id, kind: 'task_assigned' });
    const own = await h.task(admin, demand, admin);
    expect(await records(own)).toHaveLength(0);
    task = await h.action(admin, task, 'reassign', { assignedToUserId: other.id, reason: 'Test current recipient' });
    const all = await records(task, 'task_assigned');
    expect(all).toHaveLength(2);
    expect(all.map((row) => row.recipient_user_id).sort()).toEqual([worker.id, other.id].sort());
    const response = await h.request(worker, 'GET', '/api/v1/notifications?pageSize=50');
    expect(response.statusCode).toBe(200);
    expect(response.json().notifications.some((row: { taskId: string }) => row.taskId === task.id)).toBe(false);
  });

  it('routes distinct comments and review/adjustment/approval to current authorized recipients', async () => {
    const demand = await h.demand(admin);
    let task = await h.task(admin, demand, worker);
    for (const actor of [admin, worker, worker]) {
      expect((await h.request(actor, 'POST', `/api/v1/tasks/${task.id}/comments`, { content: 'A distinct operational comment' })).statusCode).toBe(201);
    }
    const comments = await records(task, 'task_comment');
    expect(comments.filter((row) => row.recipient_user_id === worker.id)).toHaveLength(1);
    expect(comments.filter((row) => row.recipient_user_id === admin.id)).toHaveLength(2);
    expect(comments.filter((row) => row.recipient_user_id === reviewer.id)).toHaveLength(2);
    task = await h.action(worker, task, 'accept');
    task = await h.action(worker, task, 'start');
    task = await h.action(worker, task, 'submit-review', { deliveryNotes: 'Ready for review' });
    expect((await records(task, 'task_review_submitted')).map((row) => row.recipient_user_id).sort()).toEqual([admin.id, reviewer.id].sort());
    task = await h.action(reviewer, task, 'review', { decision: 'changes_requested', feedback: 'Please adjust the layout' });
    expect((await records(task, 'task_changes_requested'))[0].recipient_user_id).toBe(worker.id);
    task = await h.action(worker, task, 'start');
    task = await h.action(worker, task, 'submit-review', { deliveryNotes: 'Changes ready' });
    task = await h.action(reviewer, task, 'review', { decision: 'complete', feedback: 'Approved' });
    expect((await records(task, 'task_approved'))[0].recipient_user_id).toBe(worker.id);
  });

  it('notifies readiness only on real transition and cascade recipient, not a repeated requirement value', async () => {
    const demand = await h.demand(admin);
    let predecessor = await h.task(admin, demand, worker, { requirements: [{ title: 'Briefing', mandatory: true }] });
    const dependent = await h.task(admin, demand, other, { dependsOnTaskIds: [predecessor.id] });
    const detail = (await h.request(admin, 'GET', `/api/v1/tasks/${predecessor.id}`)).json();
    const requirementId = detail.requirements[0].id as string;
    for (let i = 0; i < 2; i++) {
      const response = await h.request(admin, 'PATCH', `/api/v1/tasks/${predecessor.id}/requirements/${requirementId}`, { version: predecessor.version, satisfied: true });
      expect(response.statusCode).toBe(200); predecessor = response.json().task as Task;
    }
    expect(await records(predecessor, 'task_unblocked')).toHaveLength(1);
    predecessor = await h.action(worker, predecessor, 'accept');
    predecessor = await h.action(worker, predecessor, 'start');
    predecessor = await h.action(worker, predecessor, 'submit-review', { deliveryNotes: 'Predecessor complete' });
    await h.action(admin, predecessor, 'review', { decision: 'complete', feedback: 'Approved' });
    expect((await records(dependent, 'task_unblocked')).map((row) => row.recipient_user_id)).toEqual([other.id]);
  });

  it('routes pause request/approval/resume, meaningful demand changes and suppresses no-op updates', async () => {
    let demand = await h.demand(admin);
    let task = await h.task(admin, demand, worker);
    task = await h.action(worker, task, 'accept'); task = await h.action(worker, task, 'start');
    task = await h.action(worker, task, 'request-pause', { reason: 'Waiting on briefing' });
    expect((await records(task, 'task_important_change')).map((row) => row.recipient_user_id).sort()).toEqual([admin.id, reviewer.id].sort());
    task = await h.action(admin, task, 'approve-pause', { reason: 'Pause approved', deliveryDate: '2031-01-01' });
    await h.action(admin, task, 'resume');
    expect((await records(task, 'task_important_change')).filter((row) => row.recipient_user_id === worker.id)).toHaveLength(2);
    for (const title of [demand.title, 'Meaningfully changed title']) {
      const response = await h.request(admin, 'PATCH', `/api/v1/demands/${demand.id}`, { version: demand.version, title });
      expect(response.statusCode).toBe(200); demand = response.json().demand;
    }
    const changes = (await h.migrator.pool.query('SELECT recipient_user_id FROM notification WHERE demand_id=$1 AND kind=$2', [demand.id, 'demand_important_change'])).rows;
    expect(changes).toEqual([{ recipient_user_id: worker.id }]);
  });

  it('deduplicates the real source event and preserves readAt', async () => {
    const demand = await h.demand(admin); const task = await h.task(admin, demand, worker);
    const notification = (await h.migrator.pool.query('SELECT * FROM notification WHERE task_id=$1', [task.id])).rows[0];
    const read = await h.request(worker, 'POST', `/api/v1/notifications/${notification.id}/read`, {});
    expect(read.statusCode).toBe(200);
    const client = await h.database.pool.connect();
    try { await client.query('BEGIN'); await client.query('SELECT pg_advisory_xact_lock($1)', [IDENTITY_LOCK]); expect(await emitNotificationsForEvent(client, notification.source_event_id)).toBe(0); await client.query('COMMIT'); }
    finally { await client.query('ROLLBACK'); client.release(); }
    expect(await records(task)).toHaveLength(1);
    expect((await records(task))[0].read_at.toISOString()).toBe(read.json().notification.readAt);
  });

  it('routes reblocking and dependency removal, and deduplicates demand recipients on completion', async () => {
    const demand = await h.demand(admin);
    const predecessor = await h.task(admin, demand, other);
    let task = await h.task(admin, demand, worker);
    const added = await h.request(admin, 'POST', `/api/v1/tasks/${task.id}/dependencies`, { version: task.version, dependsOnTaskId: predecessor.id });
    expect(added.statusCode).toBe(200); task = added.json().task;
    expect(task.status).toBe('blocked');
    expect((await records(task, 'task_important_change')).map(row => row.recipient_user_id)).toEqual([worker.id]);
    const removed = await h.request(admin, 'DELETE', `/api/v1/tasks/${task.id}/dependencies/${predecessor.id}`, { version: task.version });
    expect(removed.statusCode).toBe(200); task = removed.json().task;
    expect(task.status).toBe('ready');
    expect(await records(task, 'task_unblocked')).toHaveLength(1);
    await h.task(admin, demand, worker);
    await h.migrator.pool.query(`UPDATE task SET status='completed',completed_at=clock_timestamp() WHERE demand_id=$1`, [demand.id]);
    const response = await h.request(admin, 'POST', `/api/v1/demands/${demand.id}/complete`, { version: demand.version });
    expect(response.statusCode).toBe(200);
    const rows = (await h.migrator.pool.query('SELECT recipient_user_id FROM notification WHERE demand_id=$1 AND kind=$2 ORDER BY recipient_user_id', [demand.id, 'demand_important_change'])).rows;
    expect(rows.map(row => row.recipient_user_id)).toEqual([worker.id, other.id].sort());
  });

  it('rolls back task and event when notification persistence fails, and filters inactive/ungranted recipients', async () => {
    const demand = await h.demand(admin);
    const before = (await h.migrator.pool.query('SELECT (SELECT count(*) FROM task WHERE demand_id=$1)::int AS tasks,(SELECT count(*) FROM demand_event WHERE demand_id=$1)::int AS events', [demand.id])).rows[0];
    await h.migrator.pool.query('REVOKE INSERT ON notification FROM orium_app');
    try { expect((await h.request(admin, 'POST', '/api/v1/tasks', { demandId: demand.id, assignedToUserId: worker.id, title: 'Must roll back', priority: 'normal' })).statusCode).toBe(500); }
    finally { await h.migrator.pool.query('GRANT INSERT ON notification TO orium_app'); }
    const after = (await h.migrator.pool.query('SELECT (SELECT count(*) FROM task WHERE demand_id=$1)::int AS tasks,(SELECT count(*) FROM demand_event WHERE demand_id=$1)::int AS events', [demand.id])).rows[0];
    expect(after).toEqual(before);
    const task = await h.task(admin, demand, worker);
    await h.migrator.pool.query('UPDATE auth_user SET active=false WHERE id=$1', [reviewer.id]);
    try { expect((await h.request(worker, 'POST', `/api/v1/tasks/${task.id}/comments`, { content: 'Only active administrators' })).statusCode).toBe(201); }
    finally { await h.migrator.pool.query('UPDATE auth_user SET active=true WHERE id=$1', [reviewer.id]); }
    expect((await records(task, 'task_comment')).map((row) => row.recipient_user_id)).toEqual([admin.id]);
    await h.revoke('administrator', 'tasks.manage');
    try { expect((await h.request(worker, 'POST', `/api/v1/tasks/${task.id}/comments`, { content: 'No authorized administrators' })).statusCode).toBe(201); }
    finally { await h.restore(); }
    expect(await records(task, 'task_comment')).toHaveLength(1);
  });
});
