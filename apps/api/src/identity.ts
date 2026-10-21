import { randomUUID } from 'node:crypto';
import { hashPassword, verifyPassword } from 'better-auth/crypto';
import { eq } from 'drizzle-orm';
import {
  changePasswordSchema,
  createUserSchema,
  permissionSchema,
  roleSchema,
  updateProfileSchema,
  type Permission,
  type SessionResponse,
} from '@orium/contracts';
import type { Database } from './db.js';
import type { Auth } from './auth.js';
import { fromNodeHeaders } from 'better-auth/node';
import type { IncomingHttpHeaders } from 'node:http';
import { AppError } from './errors.js';
import * as schema from './schema.js';
import { recordIdentityEvent, normalizePermissions } from './identity-audit.js';

export const IDENTITY_LOCK = 712041;

const identityQueues = new WeakMap<Database['pool'], Promise<void>>();

// Queue before borrowing a connection: waiting identity operations must not
// exhaust the pool while sign-in needs a second connection for Better Auth.
export async function serializeIdentity<T>(database: Database, operation: () => Promise<T>): Promise<T> {
  const previous = identityQueues.get(database.pool) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  identityQueues.set(database.pool, current);
  await previous;
  try { return await operation(); }
  finally {
    release();
    if (identityQueues.get(database.pool) === current) identityQueues.delete(database.pool);
  }
}

// Trusted provisioning primitive, used by authorized admin routes and local bootstrap only.
// Without actorId (bootstrap/test primitive, never a public endpoint) the audit actor is NULL.
export async function provisionUser(database: Database, input: unknown, actorId?: string): Promise<{ id: string }> {
  return serializeIdentity(database, async () => {
    const data = createUserSchema.parse(input);
    const id = randomUUID();
    const passwordHash = await hashPassword(data.password);
    const client = await database.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock($1)', [IDENTITY_LOCK]);
      if (actorId) {
        const actor = await client.query(`SELECT 1 FROM auth_user u JOIN user_role r ON r.user_id=u.id WHERE u.id=$1 AND u.active AND r.role_id='administrator'`, [actorId]);
        if (!actor.rowCount) throw new AppError(403, 'FORBIDDEN');
      }
      await client.query('INSERT INTO auth_user (id, name, email) VALUES ($1, $2, $3)', [id, data.name, data.email]);
      await client.query(`INSERT INTO auth_account (id, user_id, account_id, provider_id, password) VALUES ($1, $2, $3, 'credential', $4)`, [randomUUID(), id, id, passwordHash]);
      await client.query('INSERT INTO user_role (user_id, role_id) VALUES ($1, $2)', [id, data.role]);
      await recordIdentityEvent(client, { action: 'user_created', actorId: actorId ?? null, targetUserId: id, newRole: data.role }, [id]);
      await client.query('COMMIT');
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* connection already broken */ }
      throw error;
    } finally { client.release(); }
    return { id };
  });
}

export async function publicIdentity(database: Database, id: string): Promise<SessionResponse> {
  const [identity] = await database.db.select({ id: schema.user.id, name: schema.user.name, email: schema.user.email, image: schema.user.image, active: schema.user.active })
    .from(schema.user).where(eq(schema.user.id, id));
  if (!identity?.active) throw new AppError(401, 'UNAUTHENTICATED');
  const memberships = await database.db.select({ role: schema.userRole.roleId })
    .from(schema.userRole).where(eq(schema.userRole.userId, id));
  const grants = await database.db.select({ permission: schema.rolePermission.permissionId })
    .from(schema.rolePermission).innerJoin(schema.userRole, eq(schema.userRole.roleId, schema.rolePermission.roleId))
    .where(eq(schema.userRole.userId, id));
  return {
    user: {
      id: identity.id,
      name: identity.name,
      email: identity.email,
      ...(identity.image ? { image: identity.image } : {}),
    },
    roles: memberships.flatMap((item) => { const parsed = roleSchema.safeParse(item.role); return parsed.success ? [parsed.data] : []; }),
    permissions: [...new Set(grants.flatMap((item) => { const parsed = permissionSchema.safeParse(item.permission); return parsed.success ? [parsed.data] : []; }))],
  };
}

export const adminPermissions: Permission[] = [
  'users.read', 'users.create', 'users.deactivate', 'roles.manage',
  'clients.write', 'clients.manage', 'clients.team.manage', 'clients.archive',
  'demands.write', 'tasks.manage', 'tasks.review',
  'materials.archive',
];

export function requirePermission(identity: SessionResponse, permission: Permission): void {
  if (!identity.permissions.includes(permission)) throw new AppError(403, 'FORBIDDEN');
  if (adminPermissions.includes(permission) && !identity.roles.includes('administrator')) throw new AppError(403, 'FORBIDDEN');
}

export type InternalSessionIdentity = {
  sessionId: string;
  identity: SessionResponse;
};

export async function authenticateInternal(database: Database, auth: Auth, headers: IncomingHttpHeaders): Promise<InternalSessionIdentity> {
  const current = await auth.api.getSession({ headers: fromNodeHeaders(headers) });
  if (!current) throw new AppError(401, 'UNAUTHENTICATED');
  // One conditional write: activity never extends absolute expiry. A stale/deleted session cannot be resurrected.
  const result = await database.pool.query<{ user_id: string }>(`
    UPDATE auth_session s SET last_seen_at = GREATEST(s.last_seen_at, now())
    FROM auth_user u
    WHERE s.id=$1 AND s.user_id=u.id AND u.active=true
      AND s.expires_at > now() AND s.created_at > now() - interval '7 days'
      AND s.last_seen_at > now() - interval '12 hours'
    RETURNING s.user_id
  `, [current.session.id]);
  if (!result.rows[0]) {
    await database.db.delete(schema.session).where(eq(schema.session.id, current.session.id));
    throw new AppError(401, 'UNAUTHENTICATED');
  }
  const identity = await publicIdentity(database, result.rows[0].user_id);
  return { sessionId: current.session.id, identity };
}

export async function authenticate(database: Database, auth: Auth, headers: IncomingHttpHeaders): Promise<SessionResponse> {
  const sessionAuth = await authenticateInternal(database, auth, headers);
  return sessionAuth.identity;
}

export async function changeIdentity(database: Database, actorId: string, targetId: string, change: { active: false } | { role: string }): Promise<void> {
  return serializeIdentity(database, async () => {
    const client = await database.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock($1)', [IDENTITY_LOCK]);
      // Recheck admin access inside the serialization boundary.
      const actor = await client.query(`SELECT 1 FROM auth_user u JOIN user_role r ON r.user_id=u.id WHERE u.id=$1 AND u.active AND r.role_id='administrator'`, [actorId]);
      if (!actor.rowCount) throw new AppError(403, 'FORBIDDEN');
      const target = await client.query<{ role_id: string; active: boolean }>(`SELECT u.active, r.role_id FROM auth_user u JOIN user_role r ON r.user_id=u.id WHERE u.id=$1 FOR UPDATE OF u`, [targetId]);
      const current = target.rows[0];
      if (!current) throw new AppError(404, 'NOT_FOUND');
      const demoting = 'active' in change || change.role !== 'administrator';
      if (current.active && current.role_id === 'administrator' && demoting) {
        const count = await client.query<{ count: number }>(`SELECT count(*)::int AS count FROM auth_user u JOIN user_role r ON r.user_id=u.id WHERE u.active AND r.role_id='administrator'`);
        if ((count.rows[0]?.count ?? 0) <= 1) throw new AppError(409, 'LAST_ADMINISTRATOR');
      }
      if ('active' in change) await client.query('UPDATE auth_user SET active=false, updated_at=now() WHERE id=$1', [targetId]);
      else await client.query('UPDATE user_role SET role_id=$1 WHERE user_id=$2', [roleSchema.parse(change.role), targetId]);
      const revoked = await client.query('DELETE FROM auth_session WHERE user_id=$1', [targetId]);
      const revokedCount = revoked.rowCount ?? 0;
      if ('active' in change) {
        await recordIdentityEvent(client, { action: 'user_deactivated', actorId, targetUserId: targetId, previousActive: current.active, revokedCount }, [targetId]);
      } else {
        await recordIdentityEvent(client, { action: 'user_role_changed', actorId, targetUserId: targetId, previousRole: roleSchema.parse(current.role_id), newRole: roleSchema.parse(change.role), revokedCount }, [targetId]);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  });
}

export async function listUsers(database: Database) {
  return database.db.select({ id: schema.user.id, name: schema.user.name, email: schema.user.email, active: schema.user.active, role: schema.userRole.roleId })
    .from(schema.user).innerJoin(schema.userRole, eq(schema.userRole.userId, schema.user.id)).orderBy(schema.user.name);
}

export async function changeRolePermissions(database: Database, actorId: string, roleId: string, permissions: Permission[]): Promise<void> {
  return serializeIdentity(database, async () => {
    // Foundation admin privileges remain available; editing future business grants is out of scope.
    const parsedRole = roleSchema.parse(roleId);
    const all = permissionSchema.options;
    if (parsedRole === 'administrator' && all.some((item) => !permissions.includes(item))) throw new AppError(409, 'ADMIN_PERMISSIONS_REQUIRED');
    const collaboratorAllowed: Permission[] = [
      'protected.read',
      'clients.read.assigned',
      'demands.read',
      'tasks.read',
      'tasks.execute',
      'materials.read',
      'materials.write',
    ];
    if (parsedRole === 'collaborator' && permissions.some((item) => !collaboratorAllowed.includes(item))) throw new AppError(400, 'ADMIN_PERMISSIONS_ONLY');
    const client = await database.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock($1)', [IDENTITY_LOCK]);
      const actor = await client.query(`SELECT 1 FROM auth_user u JOIN user_role r ON r.user_id=u.id WHERE u.id=$1 AND u.active AND r.role_id='administrator'`, [actorId]);
      if (!actor.rowCount) throw new AppError(403, 'FORBIDDEN');
      const previous = await client.query<{ permission_id: string }>('SELECT permission_id FROM role_permission WHERE role_id=$1', [parsedRole]);
      await client.query('DELETE FROM role_permission WHERE role_id=$1', [parsedRole]);
      const next = [...new Set(permissions)];
      if (next.length) await client.query('INSERT INTO role_permission (role_id, permission_id) SELECT $1, p FROM unnest($2::text[]) AS p', [parsedRole, next]);
      // Immediate revocation on policy changes, including existing browser sessions.
      // Members are captured inside IDENTITY_LOCK and become the event's historical subjects.
      const affected = await client.query<{ user_id: string }>('SELECT user_id FROM user_role WHERE role_id=$1', [parsedRole]);
      const members = affected.rows.map((row) => row.user_id);
      const revoked = members.length ? await client.query('DELETE FROM auth_session WHERE user_id = ANY($1::text[])', [members]) : null;
      await recordIdentityEvent(client, {
        action: 'role_permissions_changed',
        actorId,
        targetRoleId: parsedRole,
        previousPermissions: normalizePermissions(previous.rows.map((row) => row.permission_id)),
        newPermissions: normalizePermissions(next),
        revokedCount: revoked?.rowCount ?? 0,
      }, members);
      await client.query('COMMIT');
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* connection already broken */ }
      throw error;
    } finally { client.release(); }
  });
}

export async function updateOwnProfile(
  database: Database,
  userId: string,
  rawInput: unknown,
): Promise<SessionResponse & { id: string; name: string; email: string; image: string | null }> {
  const input = updateProfileSchema.parse(rawInput);
  return serializeIdentity(database, async () => {
    const client = await database.pool.connect();
    let inTransaction = false;
    try {
      await client.query('BEGIN');
      inTransaction = true;
      await client.query('SELECT pg_advisory_xact_lock($1)', [IDENTITY_LOCK]);

      const current = await client.query<{ id: string; active: boolean; image: string | null }>(
        'SELECT id, active, image FROM auth_user WHERE id = $1 FOR UPDATE',
        [userId],
      );
      const userRow = current.rows[0];
      if (!userRow?.active) throw new AppError(401, 'UNAUTHENTICATED');

      const nextImage = input.image !== undefined ? input.image : userRow.image;

      await client.query(
        `UPDATE auth_user
         SET name = $1, image = $2, updated_at = now()
         WHERE id = $3`,
        [input.name.trim(), nextImage, userId],
      );

      await recordIdentityEvent(
        client,
        { action: 'profile_updated', actorId: userId, targetUserId: userId, revokedCount: 0 },
        [userId],
      );

      await client.query('COMMIT');
      inTransaction = false;
    } catch (error) {
      if (inTransaction) {
        try { await client.query('ROLLBACK'); } catch { /* connection already broken */ }
      }
      throw error;
    } finally {
      client.release();
    }

    const identity = await publicIdentity(database, userId);
    const [imgRow] = await database.db
      .select({ image: schema.user.image })
      .from(schema.user)
      .where(eq(schema.user.id, userId));
    const image = imgRow?.image ?? null;
    return {
      ...identity,
      id: identity.user.id,
      name: identity.user.name,
      email: identity.user.email,
      image,
      user: {
        ...identity.user,
        ...(image ? { image } : {}),
      },
    };
  });
}

export async function changeOwnPassword(
  database: Database,
  userId: string,
  currentSessionId: string,
  rawInput: unknown,
): Promise<{ success: true; revokedCount: number }> {
  const input = changePasswordSchema.parse(rawInput);
  return serializeIdentity(database, async () => {
    const client = await database.pool.connect();
    let inTransaction = false;
    try {
      await client.query('BEGIN');
      inTransaction = true;
      await client.query('SELECT pg_advisory_xact_lock($1)', [IDENTITY_LOCK]);

      const userResult = await client.query<{ id: string; active: boolean }>(
        'SELECT id, active FROM auth_user WHERE id = $1 FOR UPDATE',
        [userId],
      );
      const userRow = userResult.rows[0];
      if (!userRow?.active) throw new AppError(401, 'UNAUTHENTICATED');

      const accountResult = await client.query<{ id: string; password: string | null }>(
        `SELECT id, password
         FROM auth_account
         WHERE user_id = $1 AND provider_id = 'credential'
         FOR UPDATE`,
        [userId],
      );
      if ((accountResult.rowCount ?? 0) !== 1 || !accountResult.rows[0]?.password) {
        throw new AppError(400, 'CREDENTIAL_NOT_FOUND');
      }

      const isCurrentValid = await verifyPassword({
        hash: accountResult.rows[0].password,
        password: input.currentPassword,
      });
      if (!isCurrentValid) {
        throw new AppError(401, 'INVALID_CREDENTIALS');
      }

      const newHash = await hashPassword(input.newPassword);
      await client.query(
        `UPDATE auth_account
         SET password = $1, updated_at = now()
         WHERE id = $2`,
        [newHash, accountResult.rows[0].id],
      );

      const revoked = await client.query(
        `DELETE FROM auth_session
         WHERE user_id = $1 AND id <> $2`,
        [userId, currentSessionId],
      );
      const revokedCount = revoked.rowCount ?? 0;

      await recordIdentityEvent(
        client,
        { action: 'password_changed', actorId: userId, targetUserId: userId, revokedCount },
        [userId],
      );

      await client.query('COMMIT');
      inTransaction = false;
      return { success: true, revokedCount };
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

export async function deleteUser(
  database: Database,
  actorId: string,
  targetId: string,
): Promise<void> {
  return serializeIdentity(database, async () => {
    const client = await database.pool.connect();
    let inTransaction = false;
    try {
      await client.query('BEGIN');
      inTransaction = true;
      await client.query('SELECT pg_advisory_xact_lock($1)', [IDENTITY_LOCK]);

      if (actorId === targetId) throw new AppError(400, 'CANNOT_DELETE_SELF');

      const actor = await client.query(
        `SELECT 1 FROM auth_user u JOIN user_role r ON r.user_id = u.id WHERE u.id = $1 AND u.active AND r.role_id = 'administrator'`,
        [actorId],
      );
      if (!actor.rowCount) throw new AppError(403, 'FORBIDDEN');

      const target = await client.query<{ id: string; active: boolean; role_id: string | null }>(
        `SELECT u.id, u.active, ur.role_id
         FROM auth_user u
         LEFT JOIN user_role ur ON ur.user_id = u.id
         WHERE u.id = $1
         FOR UPDATE OF u`,
        [targetId],
      );
      const current = target.rows[0];
      if (!current) throw new AppError(404, 'USER_NOT_FOUND');

      if (current.active && current.role_id === 'administrator') {
        const admins = await client.query<{ id: string }>(
          `SELECT u.id
           FROM auth_user u
           JOIN user_role ur ON ur.user_id = u.id
           WHERE u.active = TRUE AND ur.role_id = 'administrator'
           FOR UPDATE OF u`,
        );
        if ((admins.rowCount ?? 0) <= 1) throw new AppError(409, 'LAST_ADMINISTRATOR');
      }

      // Reassign historical/operational references that use RESTRICT or NO ACTION
      await client.query('UPDATE client_team_member SET assigned_by_user_id = $2 WHERE assigned_by_user_id = $1', [targetId, actorId]);
      await client.query('UPDATE demand SET created_by_user_id = $2 WHERE created_by_user_id = $1', [targetId, actorId]);
      await client.query('UPDATE task SET assigned_to_user_id = $2 WHERE assigned_to_user_id = $1', [targetId, actorId]);
      await client.query('UPDATE task_comment SET author_id = $2 WHERE author_id = $1', [targetId, actorId]);
      await client.query('UPDATE demand_event SET actor_id = $2 WHERE actor_id = $1', [targetId, actorId]);
      await client.query('UPDATE material SET created_by_user_id = $2 WHERE created_by_user_id = $1', [targetId, actorId]);
      await client.query('UPDATE material_event SET actor_id = $2 WHERE actor_id = $1', [targetId, actorId]);
      await client.query('UPDATE drive_file_status SET updated_by_user_id = $2 WHERE updated_by_user_id = $1', [targetId, actorId]);

      const revoked = await client.query('DELETE FROM auth_session WHERE user_id = $1', [targetId]);
      const revokedCount = revoked.rowCount ?? 0;

      await recordIdentityEvent(
        client,
        { action: 'user_deactivated', actorId, targetUserId: targetId, previousActive: current.active, revokedCount },
        [targetId],
      );
      await client.query('DELETE FROM auth_user WHERE id = $1', [targetId]);

      await client.query('COMMIT');
      inTransaction = false;
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
