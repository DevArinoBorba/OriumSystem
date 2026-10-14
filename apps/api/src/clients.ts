import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type {
  Client,
  CreateClientInput,
  UpdateClientInput,
  ListClientsQuery,
  ClientListResponse,
  SessionResponse,
  Permission,
  Role,
} from '@orium/contracts';
import type { Database } from './db.js';
import { AppError } from './errors.js';
import { IDENTITY_LOCK, adminPermissions } from './identity.js';

type ClientRow = {
  id: string;
  name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  archived_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
  version: number;
};

// Trusted payload built only from data read/changed inside the client transaction.
// External calls are forbidden inside the transaction, so business rules here run on SQL
// fetch + mutate; the sole reason d'être of the transaction is authorization serialization.
async function revalidateActor(
  client: PoolClient,
  userId: string,
  requiredPermission: Permission,
): Promise<{ id: string; roles: Role[]; permissions: Permission[] }> {
  const res = await client.query<{
    id: string;
    active: boolean;
    roles: Role[];
    permissions: Permission[];
  }>(`
    SELECT
      u.id, u.active,
      COALESCE(array_agg(DISTINCT ur.role_id) FILTER (WHERE ur.role_id IS NOT NULL), '{}') AS roles,
      COALESCE(array_agg(DISTINCT rp.permission_id) FILTER (WHERE rp.permission_id IS NOT NULL), '{}') AS permissions
    FROM auth_user u
    LEFT JOIN user_role ur ON ur.user_id = u.id
    LEFT JOIN role_permission rp ON rp.role_id = ur.role_id
    WHERE u.id = $1
    GROUP BY u.id
  `, [userId]);

  const row = res.rows[0];
  if (!row || !row.active) throw new AppError(401, 'UNAUTHENTICATED');
  if (!row.permissions.includes(requiredPermission)) throw new AppError(403, 'FORBIDDEN');
  if (adminPermissions.includes(requiredPermission) && !row.roles.includes('administrator')) {
    throw new AppError(403, 'FORBIDDEN');
  }
  return { id: row.id, roles: row.roles, permissions: row.permissions };
}

function formatClient(row: ClientRow): Client {
  return {
    id: row.id,
    name: row.name,
    contactName: row.contact_name ?? null,
    email: row.email ?? null,
    phone: row.phone ?? null,
    notes: row.notes ?? null,
    archivedAt: row.archived_at ? new Date(row.archived_at).toISOString() : null,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    version: row.version,
  };
}

export async function listClients(database: Database, query: ListClientsQuery): Promise<ClientListResponse> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (query.status === 'active') {
    conditions.push('archived_at IS NULL');
  } else if (query.status === 'archived') {
    conditions.push('archived_at IS NOT NULL');
  }

  if (query.q && query.q.length > 0) {
    params.push(`%${query.q.replace(/[%_\\]/g, '\\$&')}%`);
    const paramIndex = params.length;
    conditions.push(`(name ILIKE $${paramIndex} ESCAPE '\\' OR contact_name ILIKE $${paramIndex} ESCAPE '\\' OR email ILIKE $${paramIndex} ESCAPE '\\')`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const countQuery = `SELECT count(*)::int AS total FROM client ${whereClause}`;
  const countResult = await database.pool.query<{ total: number }>(countQuery, params);
  const total = countResult.rows[0]?.total ?? 0;

  const offset = (query.page - 1) * query.pageSize;
  params.push(query.pageSize);
  const limitParam = params.length;
  params.push(offset);
  const offsetParam = params.length;

  const dataQuery = `
    SELECT id, name, contact_name, email, phone, notes, archived_at, created_at, updated_at, version
    FROM client
    ${whereClause}
    ORDER BY name ASC, id ASC
    LIMIT $${limitParam} OFFSET $${offsetParam}
  `;
  const dataResult = await database.pool.query<ClientRow>(dataQuery, params);
  const clients = dataResult.rows.map(formatClient);

  return {
    clients,
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}

export async function getClientById(database: Database, id: string): Promise<Client> {
  const result = await database.pool.query<ClientRow>(`
    SELECT id, name, contact_name, email, phone, notes, archived_at, created_at, updated_at, version
    FROM client
    WHERE id = $1
  `, [id]);
  const row = result.rows[0];
  if (!row) throw new AppError(404, 'CLIENT_NOT_FOUND');
  return formatClient(row);
}

export async function createClient(database: Database, identity: SessionResponse, input: CreateClientInput): Promise<Client> {
  const client = await database.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [IDENTITY_LOCK]);
    await revalidateActor(client, identity.user.id, 'clients.write');

    const id = randomUUID();
    const insertRes = await client.query<ClientRow>(`
      INSERT INTO client (id, name, contact_name, email, phone, notes, archived_at, created_at, updated_at, version)
      VALUES ($1, $2, $3, $4, $5, $6, NULL, now(), now(), 1)
      RETURNING id, name, contact_name, email, phone, notes, archived_at, created_at, updated_at, version
    `, [
      id,
      input.name,
      input.contactName ?? null,
      input.email ?? null,
      input.phone ?? null,
      input.notes ?? null,
    ]);

    const row = insertRes.rows[0];
    if (!row) throw new AppError(500, 'CLIENT_CREATION_FAILED');

    await client.query('COMMIT');
    return formatClient(row);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function updateClient(database: Database, identity: SessionResponse, id: string, input: UpdateClientInput): Promise<Client> {
  const client = await database.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [IDENTITY_LOCK]);
    await revalidateActor(client, identity.user.id, 'clients.write');

    const setClauses: string[] = [];
    const params: unknown[] = [id, input.version];

    if (input.name !== undefined) {
      params.push(input.name);
      setClauses.push(`name = $${params.length}`);
    }
    if (input.contactName !== undefined) {
      params.push(input.contactName ?? null);
      setClauses.push(`contact_name = $${params.length}`);
    }
    if (input.email !== undefined) {
      params.push(input.email ?? null);
      setClauses.push(`email = $${params.length}`);
    }
    if (input.phone !== undefined) {
      params.push(input.phone ?? null);
      setClauses.push(`phone = $${params.length}`);
    }
    if (input.notes !== undefined) {
      params.push(input.notes ?? null);
      setClauses.push(`notes = $${params.length}`);
    }

    setClauses.push('version = version + 1');
    setClauses.push('updated_at = now()');

    const query = `
      UPDATE client
      SET ${setClauses.join(', ')}
      WHERE id = $1 AND version = $2
      RETURNING id, name, contact_name, email, phone, notes, archived_at, created_at, updated_at, version
    `;

    const updateRes = await client.query<ClientRow>(query, params);
    if (updateRes.rows[0]) {
      await client.query('COMMIT');
      return formatClient(updateRes.rows[0]);
    }

    const exists = await client.query<{ id: string; version: number }>(
      'SELECT id, version FROM client WHERE id = $1',
      [id]
    );
    if (!exists.rows[0]) {
      throw new AppError(404, 'CLIENT_NOT_FOUND');
    }
    throw new AppError(409, 'CLIENT_VERSION_CONFLICT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function archiveClient(database: Database, identity: SessionResponse, id: string, version: number): Promise<Client> {
  const client = await database.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [IDENTITY_LOCK]);
    await revalidateActor(client, identity.user.id, 'clients.archive');

    const updateRes = await client.query<ClientRow>(`
      UPDATE client
      SET archived_at = now(), version = version + 1, updated_at = now()
      WHERE id = $1 AND version = $2
      RETURNING id, name, contact_name, email, phone, notes, archived_at, created_at, updated_at, version
    `, [id, version]);

    if (updateRes.rows[0]) {
      await client.query('COMMIT');
      return formatClient(updateRes.rows[0]);
    }

    const exists = await client.query<{ id: string; version: number }>(
      'SELECT id, version FROM client WHERE id = $1',
      [id]
    );
    if (!exists.rows[0]) {
      throw new AppError(404, 'CLIENT_NOT_FOUND');
    }
    throw new AppError(409, 'CLIENT_VERSION_CONFLICT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function restoreClient(database: Database, identity: SessionResponse, id: string, version: number): Promise<Client> {
  const client = await database.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [IDENTITY_LOCK]);
    await revalidateActor(client, identity.user.id, 'clients.archive');

    const updateRes = await client.query<ClientRow>(`
      UPDATE client
      SET archived_at = NULL, version = version + 1, updated_at = now()
      WHERE id = $1 AND version = $2
      RETURNING id, name, contact_name, email, phone, notes, archived_at, created_at, updated_at, version
    `, [id, version]);

    if (updateRes.rows[0]) {
      await client.query('COMMIT');
      return formatClient(updateRes.rows[0]);
    }

    const exists = await client.query<{ id: string; version: number }>(
      'SELECT id, version FROM client WHERE id = $1',
      [id]
    );
    if (!exists.rows[0]) {
      throw new AppError(404, 'CLIENT_NOT_FOUND');
    }
    throw new AppError(409, 'CLIENT_VERSION_CONFLICT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
