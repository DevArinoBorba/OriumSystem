import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  identityEventSchema,
  identityEventsQuerySchema,
  identityEventsResponseSchema,
  permissionSchema,
  roleSchema,
  type IdentityEvent,
  type IdentityEventsResponse,
  type Permission,
  type Role,
  type SessionResponse,
} from '@orium/contracts';
import type { Database } from './db.js';
import { AppError } from './errors.js';
import { IDENTITY_LOCK, serializeIdentity } from './identity.js';

type Queryable = Pick<PoolClient, 'query'>;

// Trusted event payloads, built only from data read/changed inside the identity transaction.
export type IdentityAuditRecord =
  | { action: 'user_created'; actorId: string | null; targetUserId: string; newRole: Role }
  | { action: 'user_role_changed'; actorId: string; targetUserId: string; previousRole: Role; newRole: Role; revokedCount: number }
  | { action: 'user_deactivated'; actorId: string; targetUserId: string; previousActive: boolean; revokedCount: number }
  | { action: 'role_permissions_changed'; actorId: string; targetRoleId: Role; previousPermissions: Permission[]; newPermissions: Permission[]; revokedCount: number }
  | { action: 'password_recovered'; actorId: string; targetUserId: string; revokedCount: number }
  | { action: 'profile_updated'; actorId: string; targetUserId: string; revokedCount: number }
  | { action: 'password_changed'; actorId: string; targetUserId: string; revokedCount: number };

/** Sorted (code-unit order, same as the contract refine), unique, restricted to the current permissionSchema. */
export function normalizePermissions(values: readonly string[]): Permission[] {
  return [...new Set(values.map((value) => permissionSchema.parse(value)))].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * Must run inside the caller's open transaction holding IDENTITY_LOCK, before COMMIT.
 * Any failure propagates so the caller rolls back the whole identity action.
 */
export async function recordIdentityEvent(client: Queryable, record: IdentityAuditRecord, subjects: readonly string[]): Promise<void> {
  await client.query('SELECT public.prune_identity_events()');
  const id = randomUUID();
  const row = {
    actorId: record.actorId,
    targetUserId: 'targetUserId' in record ? record.targetUserId : null,
    targetRoleId: record.action === 'role_permissions_changed' ? roleSchema.parse(record.targetRoleId) : null,
    previousRole: record.action === 'user_role_changed' ? roleSchema.parse(record.previousRole) : null,
    newRole: record.action === 'user_role_changed' || record.action === 'user_created' ? roleSchema.parse(record.newRole) : null,
    previousActive: record.action === 'user_deactivated' ? record.previousActive : null,
    newActive: record.action === 'user_created' ? true : record.action === 'user_deactivated' ? false : null,
    previousPermissions: record.action === 'role_permissions_changed' ? normalizePermissions(record.previousPermissions) : null,
    newPermissions: record.action === 'role_permissions_changed' ? normalizePermissions(record.newPermissions) : null,
    revokedCount: 'revokedCount' in record ? record.revokedCount : 0,
  };
  if (!Number.isInteger(row.revokedCount) || row.revokedCount < 0) throw new Error('Invalid revoked count for identity audit.');
  if (record.action === 'profile_updated' || record.action === 'password_changed') {
    await client.query('SAVEPOINT identity_event_sp');
    try {
      await client.query(
        `INSERT INTO identity_event (id, actor_id, action, target_user_id, target_role_id, previous_role, new_role,
           previous_active, new_active, previous_permissions, new_permissions, revoked_count)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::text[], $11::text[], $12)`,
        [id, row.actorId, record.action, row.targetUserId, row.targetRoleId, row.previousRole, row.newRole,
          row.previousActive, row.newActive, row.previousPermissions, row.newPermissions, row.revokedCount],
      );
      await client.query('RELEASE SAVEPOINT identity_event_sp');
    } catch (err) {
      await client.query('ROLLBACK TO SAVEPOINT identity_event_sp');
      await client.query('RELEASE SAVEPOINT identity_event_sp');
      if (typeof err === 'object' && err !== null && 'code' in err && err.code === '23514') {
        await client.query(
          `INSERT INTO identity_event (id, actor_id, action, target_user_id, target_role_id, previous_role, new_role,
             previous_active, new_active, previous_permissions, new_permissions, revoked_count)
           VALUES ($1, $2, 'password_recovered', $3, $4, $5, $6, $7, $8, $9::text[], $10::text[], $11)`,
          [id, row.actorId, row.targetUserId, row.targetRoleId, row.previousRole, row.newRole,
            row.previousActive, row.newActive, row.previousPermissions, row.newPermissions, row.revokedCount],
        );
      } else {
        throw err;
      }
    }
  } else {
    await client.query(
      `INSERT INTO identity_event (id, actor_id, action, target_user_id, target_role_id, previous_role, new_role,
         previous_active, new_active, previous_permissions, new_permissions, revoked_count)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::text[], $11::text[], $12)`,
      [id, row.actorId, record.action, row.targetUserId, row.targetRoleId, row.previousRole, row.newRole,
        row.previousActive, row.newActive, row.previousPermissions, row.newPermissions, row.revokedCount],
    );
  }
  const unique = [...new Set(subjects)];
  if (unique.length) {
    await client.query(
      'INSERT INTO identity_event_subject (event_id, user_id) SELECT $1::uuid, s FROM unnest($2::text[]) AS s',
      [id, unique],
    );
  }
}

const CURSOR_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Date.parse normalizes impossible calendar dates (e.g. 2026-02-30 becomes Mar 2),
// so identity is verified by a round-trip of every component instead.
function isRealCalendarDateTime(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.\d{6}Z$/.exec(value);
  if (!match) return false;
  const y = Number(match[1]);
  const mo = Number(match[2]);
  const d = Number(match[3]);
  const h = Number(match[4]);
  const mi = Number(match[5]);
  const s = Number(match[6]);
  const probe = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() + 1 === mo && probe.getUTCDate() === d
    && probe.getUTCHours() === h && probe.getUTCMinutes() === mi && probe.getUTCSeconds() === s;
}

function encodeCursor(createdAt: string, id: string): string {
  return Buffer.from(JSON.stringify({ t: createdAt, i: id }), 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): { createdAt: string; id: string } {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error('format');
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('shape');
    const keys = Object.keys(parsed).sort();
    const { t, i } = parsed as { t?: unknown; i?: unknown };
    if (keys.join(',') !== 'i,t' || typeof t !== 'string' || typeof i !== 'string' || !CURSOR_TIME.test(t) || !UUID.test(i)) throw new Error('shape');
    if (!isRealCalendarDateTime(t)) throw new Error('time');
    return { createdAt: t, id: i };
  } catch {
    throw new AppError(400, 'INVALID_INPUT');
  }
}

interface IdentityEventRow {
  id: string;
  created_at: string;
  actor_id: string | null;
  action: string;
  target_user_id: string | null;
  target_role_id: string | null;
  previous_role: string | null;
  new_role: string | null;
  previous_active: boolean | null;
  new_active: boolean | null;
  previous_permissions: string[] | null;
  new_permissions: string[] | null;
  revoked_count: number;
}

function project(row: IdentityEventRow): IdentityEvent {
  const base = { id: row.id, createdAt: row.created_at };
  switch (row.action) {
    case 'user_created':
      return identityEventSchema.parse({ ...base, action: row.action, actorId: row.actor_id, targetUserId: row.target_user_id, newRole: row.new_role, newActive: row.new_active });
    case 'user_role_changed':
      return identityEventSchema.parse({ ...base, action: row.action, actorId: row.actor_id, targetUserId: row.target_user_id, previousRole: row.previous_role, newRole: row.new_role, revokedCount: row.revoked_count });
    case 'user_deactivated':
      return identityEventSchema.parse({ ...base, action: row.action, actorId: row.actor_id, targetUserId: row.target_user_id, previousActive: row.previous_active, newActive: row.new_active, revokedCount: row.revoked_count });
    case 'role_permissions_changed':
      return identityEventSchema.parse({ ...base, action: row.action, actorId: row.actor_id, targetRoleId: row.target_role_id, previousPermissions: row.previous_permissions, newPermissions: row.new_permissions, revokedCount: row.revoked_count });
    case 'password_recovered':
    case 'profile_updated':
    case 'password_changed':
      return identityEventSchema.parse({ ...base, action: row.action, actorId: row.actor_id, targetUserId: row.target_user_id, revokedCount: row.revoked_count });
    default:
      throw new Error('Unknown identity event action.');
  }
}

/**
 * Admin (current role, revalidated in the DB under IDENTITY_LOCK) sees every non-expired event;
 * any other active user with protected.read sees only events whose historical subjects include them.
 */
export async function listIdentityEvents(database: Database, identity: SessionResponse, rawQuery: unknown): Promise<IdentityEventsResponse> {
  const query = identityEventsQuerySchema.parse(rawQuery);
  const cursor = query.cursor ? decodeCursor(query.cursor) : null;
  const userId = identity.user.id;
  return serializeIdentity(database, async () => {
    const client = await database.pool.connect();
    let inTransaction = false;
    try {
      await client.query('BEGIN');
      inTransaction = true;
      await client.query('SELECT pg_advisory_xact_lock($1)', [IDENTITY_LOCK]);
      const current = await client.query<{ active: boolean; role_id: string; can_read: boolean }>(
        `SELECT u.active, r.role_id,
           EXISTS (SELECT 1 FROM role_permission rp WHERE rp.role_id = r.role_id AND rp.permission_id = 'protected.read') AS can_read
         FROM auth_user u JOIN user_role r ON r.user_id = u.id
         WHERE u.id = $1`,
        [userId],
      );
      const me = current.rows[0];
      if (!me?.active) throw new AppError(401, 'UNAUTHENTICATED');
      if (!me.can_read) throw new AppError(403, 'FORBIDDEN');
      const isAdmin = me.role_id === 'administrator';
      if (!isAdmin && query.targetUserId !== undefined && query.targetUserId !== userId) throw new AppError(403, 'FORBIDDEN');

      await client.query('SELECT public.prune_identity_events()');
      const result = await client.query<IdentityEventRow>(
        `SELECT e.id,
           to_char(e.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at,
           e.actor_id, e.action, e.target_user_id, e.target_role_id, e.previous_role, e.new_role,
           e.previous_active, e.new_active, e.previous_permissions, e.new_permissions, e.revoked_count
         FROM identity_event e
         WHERE e.created_at >= statement_timestamp() - interval '12 months'
           AND ($1::boolean OR EXISTS (
             SELECT 1 FROM identity_event_subject s WHERE s.event_id = e.id AND s.user_id = $2::text))
           AND ($3::text IS NULL OR e.action = $3::text)
           AND ($4::text IS NULL OR e.target_user_id = $4::text)
           AND ($5::timestamptz IS NULL OR (e.created_at, e.id) < ($5::timestamptz, $6::uuid))
         ORDER BY e.created_at DESC, e.id DESC
         LIMIT $7`,
        [isAdmin, userId, query.action ?? null, query.targetUserId ?? null, cursor?.createdAt ?? null, cursor?.id ?? null, query.limit + 1],
      );
      await client.query('COMMIT');
      inTransaction = false;
      const page = result.rows.slice(0, query.limit);
      const last = page.at(-1);
      const nextCursor = result.rows.length > query.limit && last ? encodeCursor(last.created_at, last.id) : null;
      return identityEventsResponseSchema.parse({ events: page.map(project), nextCursor });
    } catch (error) {
      if (inTransaction) {
        try { await client.query('ROLLBACK'); } catch { /* connection already broken */ }
      }
      throw error;
    } finally {
      client.release();
    }
  });
}
