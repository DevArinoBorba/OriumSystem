import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type {
  Client,
  ClientContractStatus,
  ClientFunctionalRole,
  ClientListResponse,
  ClientScopeItem,
  ClientScopeListResponse,
  ClientTeamListResponse,
  ClientTeamMember,
  CreateClientInput,
  CreateClientScopeItemInput,
  ListClientsQuery,
  Permission,
  Role,
  ScopeCadence,
  ScopeCategory,
  SessionResponse,
  UpdateClientInput,
  UpdateClientScopeItemInput,
  UpsertClientTeamMemberInput,
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
  contract_status: ClientContractStatus;
  segment: string | null;
  account_manager_user_id: string | null;
  briefing_summary: string | null;
  brand_kit_url: string | null;
  drive_folder_url: string | null;
  active_channels: string[] | null;
  onboarding_completed_at: Date | string | null;
  archived_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
  version: number;
};

type ClientTeamMemberRow = {
  client_id: string;
  user_id: string;
  user_name: string;
  user_email: string;
  functional_role: ClientFunctionalRole;
  is_primary: boolean;
  can_create_demands: boolean;
  assigned_by_user_id: string;
  assigned_at: Date | string;
};

type ClientScopeItemRow = {
  id: string;
  client_id: string;
  title: string;
  description: string;
  category: ScopeCategory;
  cadence: ScopeCadence;
  contracted_quantity: number;
  sla_business_days: number | null;
  sla_hours: number | null;
  active: boolean;
  version: number;
  created_at: Date | string;
  updated_at: Date | string;
};

const CLIENT_COLUMNS = `
  id, name, contact_name, email, phone, notes,
  contract_status, segment, account_manager_user_id, briefing_summary,
  brand_kit_url, drive_folder_url, active_channels, onboarding_completed_at,
  archived_at, created_at, updated_at, version
`;

// Trusted payload built only from data read/changed inside the client transaction.
// External calls are forbidden inside the transaction, so business rules here run on SQL
// fetch + mutate; the sole reason d'être of the transaction is authorization serialization.
async function revalidateActor(
  client: PoolClient,
  userId: string,
  requiredPermissions: Permission | Permission[],
): Promise<{ id: string; roles: Role[]; permissions: Permission[] }> {
  const requiredList = Array.isArray(requiredPermissions) ? requiredPermissions : [requiredPermissions];
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
  for (const perm of requiredList) {
    if (!row.permissions.includes(perm)) throw new AppError(403, 'FORBIDDEN');
    if (adminPermissions.includes(perm) && !row.roles.includes('administrator')) {
      throw new AppError(403, 'FORBIDDEN');
    }
  }
  return { id: row.id, roles: row.roles, permissions: row.permissions };
}

export function resolveClientReadScope(identity: SessionResponse): 'global' | 'assigned' {
  if (identity.permissions.includes('clients.read')) {
    return 'global';
  }
  if (identity.permissions.includes('clients.read.assigned')) {
    return 'assigned';
  }
  throw new AppError(403, 'FORBIDDEN');
}

function formatClient(row: ClientRow): Client {
  return {
    id: row.id,
    name: row.name,
    contactName: row.contact_name ?? null,
    email: row.email ?? null,
    phone: row.phone ?? null,
    notes: row.notes ?? null,
    contractStatus: row.contract_status ?? 'active',
    segment: row.segment ?? null,
    accountManagerUserId: row.account_manager_user_id ?? null,
    briefingSummary: row.briefing_summary ?? '',
    brandKitUrl: row.brand_kit_url ?? null,
    driveFolderUrl: row.drive_folder_url ?? null,
    activeChannels: Array.isArray(row.active_channels) ? row.active_channels : [],
    onboardingCompletedAt: row.onboarding_completed_at ? new Date(row.onboarding_completed_at).toISOString() : null,
    archivedAt: row.archived_at ? new Date(row.archived_at).toISOString() : null,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    version: row.version,
  };
}

function formatTeamMember(row: ClientTeamMemberRow): ClientTeamMember {
  return {
    clientId: row.client_id,
    userId: row.user_id,
    userName: row.user_name,
    userEmail: row.user_email,
    functionalRole: row.functional_role,
    isPrimary: row.is_primary,
    canCreateDemands: row.can_create_demands,
    assignedByUserId: row.assigned_by_user_id,
    assignedAt: new Date(row.assigned_at).toISOString(),
  };
}

function formatScopeItem(row: ClientScopeItemRow): ClientScopeItem {
  return {
    id: row.id,
    clientId: row.client_id,
    title: row.title,
    description: row.description ?? '',
    category: row.category,
    cadence: row.cadence,
    contractedQuantity: row.contracted_quantity,
    slaBusinessDays: row.sla_business_days ?? null,
    slaHours: row.sla_hours ?? null,
    active: row.active,
    isActive: row.active,
    version: row.version,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

async function assertUserAllocatedToClient(
  database: Database,
  userId: string,
  clientId: string,
): Promise<void> {
  const accessRes = await database.pool.query<{ allowed: boolean }>(`
    SELECT EXISTS (
      SELECT 1 FROM client c
      WHERE c.id = $1
        AND (
          c.account_manager_user_id = $2
          OR EXISTS (
            SELECT 1 FROM client_team_member ctm
            WHERE ctm.client_id = c.id AND ctm.user_id = $2
          )
          OR EXISTS (
            SELECT 1 FROM demand d
            JOIN task t ON t.demand_id = d.id
            WHERE d.client_id = c.id AND t.assigned_to_user_id = $2
          )
        )
    ) AS allowed
  `, [clientId, userId]);

  if (!accessRes.rows[0]?.allowed) {
    throw new AppError(403, 'FORBIDDEN');
  }
}

export async function listClients(
  database: Database,
  query: ListClientsQuery,
  identity?: SessionResponse,
): Promise<ClientListResponse> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (identity) {
    const scope = resolveClientReadScope(identity);
    if (scope === 'assigned') {
      const hasAnyRes = await database.pool.query<{ has_assigned: boolean }>(`
        SELECT EXISTS (
          SELECT 1 FROM client c
          WHERE c.account_manager_user_id = $1
             OR EXISTS (
               SELECT 1 FROM client_team_member ctm
               WHERE ctm.client_id = c.id AND ctm.user_id = $1
             )
             OR EXISTS (
               SELECT 1 FROM demand d
               JOIN task t ON t.demand_id = d.id
               WHERE d.client_id = c.id AND t.assigned_to_user_id = $1
             )
        ) AS has_assigned
      `, [identity.user.id]);

      if (!hasAnyRes.rows[0]?.has_assigned) {
        throw new AppError(403, 'FORBIDDEN');
      }

      params.push(identity.user.id);
      const actorParam = params.length;
      conditions.push(`(
        client.account_manager_user_id = $${actorParam}
        OR EXISTS (
          SELECT 1 FROM client_team_member ctm
          WHERE ctm.client_id = client.id AND ctm.user_id = $${actorParam}
        )
        OR EXISTS (
          SELECT 1 FROM demand d
          JOIN task t ON t.demand_id = d.id
          WHERE d.client_id = client.id AND t.assigned_to_user_id = $${actorParam}
        )
      )`);
    }
  }

  if (query.status === 'active') {
    conditions.push('archived_at IS NULL');
  } else if (query.status === 'archived') {
    conditions.push('archived_at IS NOT NULL');
  }

  if (query.contractStatus) {
    params.push(query.contractStatus);
    conditions.push(`contract_status = $${params.length}`);
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
    SELECT ${CLIENT_COLUMNS}
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

export async function getClientById(
  database: Database,
  id: string,
  identity?: SessionResponse,
): Promise<Client> {
  if (identity) {
    const scope = resolveClientReadScope(identity);
    if (scope === 'assigned') {
      await assertUserAllocatedToClient(database, identity.user.id, id);
    }
  }

  const result = await database.pool.query<ClientRow>(`
    SELECT ${CLIENT_COLUMNS}
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
    await revalidateActor(client, identity.user.id, ['clients.write', 'clients.manage']);

    if (input.accountManagerUserId) {
      const userCheck = await client.query<{ id: string }>(
        'SELECT id FROM auth_user WHERE id = $1 AND active = true',
        [input.accountManagerUserId],
      );
      if (!userCheck.rows[0]) {
        throw new AppError(404, 'USER_NOT_FOUND');
      }
    }

    const id = randomUUID();
    const insertRes = await client.query<ClientRow>(`
      INSERT INTO client (
        id, name, contact_name, email, phone, notes,
        contract_status, segment, account_manager_user_id, briefing_summary,
        brand_kit_url, drive_folder_url, active_channels, onboarding_completed_at,
        archived_at, created_at, updated_at, version
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NULL, now(), now(), 1)
      RETURNING ${CLIENT_COLUMNS}
    `, [
      id,
      input.name,
      input.contactName ?? null,
      input.email ?? null,
      input.phone ?? null,
      input.notes ?? null,
      input.contractStatus ?? 'active',
      input.segment ?? null,
      input.accountManagerUserId ?? null,
      input.briefingSummary ?? '',
      input.brandKitUrl ?? null,
      input.driveFolderUrl ?? null,
      input.activeChannels ?? [],
      input.onboardingCompletedAt ?? null,
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
    await revalidateActor(client, identity.user.id, ['clients.write', 'clients.manage']);

    if (input.accountManagerUserId !== undefined && input.accountManagerUserId !== null) {
      const userCheck = await client.query<{ id: string }>(
        'SELECT id FROM auth_user WHERE id = $1 AND active = true',
        [input.accountManagerUserId],
      );
      if (!userCheck.rows[0]) {
        throw new AppError(404, 'USER_NOT_FOUND');
      }
    }

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
    if (input.contractStatus !== undefined) {
      params.push(input.contractStatus);
      setClauses.push(`contract_status = $${params.length}`);
    }
    if (input.segment !== undefined) {
      params.push(input.segment ?? null);
      setClauses.push(`segment = $${params.length}`);
    }
    if (input.accountManagerUserId !== undefined) {
      params.push(input.accountManagerUserId ?? null);
      setClauses.push(`account_manager_user_id = $${params.length}`);
    }
    if (input.briefingSummary !== undefined) {
      params.push(input.briefingSummary);
      setClauses.push(`briefing_summary = $${params.length}`);
    }
    if (input.brandKitUrl !== undefined) {
      params.push(input.brandKitUrl ?? null);
      setClauses.push(`brand_kit_url = $${params.length}`);
    }
    if (input.driveFolderUrl !== undefined) {
      params.push(input.driveFolderUrl ?? null);
      setClauses.push(`drive_folder_url = $${params.length}`);
    }
    if (input.activeChannels !== undefined) {
      params.push(input.activeChannels);
      setClauses.push(`active_channels = $${params.length}`);
    }
    if (input.onboardingCompletedAt !== undefined) {
      params.push(input.onboardingCompletedAt ?? null);
      setClauses.push(`onboarding_completed_at = $${params.length}`);
    }

    setClauses.push('version = version + 1');
    setClauses.push('updated_at = now()');

    const query = `
      UPDATE client
      SET ${setClauses.join(', ')}
      WHERE id = $1 AND version = $2
      RETURNING ${CLIENT_COLUMNS}
    `;

    const updateRes = await client.query<ClientRow>(query, params);
    if (updateRes.rows[0]) {
      await client.query('COMMIT');
      return formatClient(updateRes.rows[0]);
    }

    const exists = await client.query<{ id: string; version: number }>(
      'SELECT id, version FROM client WHERE id = $1',
      [id],
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
      RETURNING ${CLIENT_COLUMNS}
    `, [id, version]);

    if (updateRes.rows[0]) {
      await client.query('COMMIT');
      return formatClient(updateRes.rows[0]);
    }

    const exists = await client.query<{ id: string; version: number }>(
      'SELECT id, version FROM client WHERE id = $1',
      [id],
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
      RETURNING ${CLIENT_COLUMNS}
    `, [id, version]);

    if (updateRes.rows[0]) {
      await client.query('COMMIT');
      return formatClient(updateRes.rows[0]);
    }

    const exists = await client.query<{ id: string; version: number }>(
      'SELECT id, version FROM client WHERE id = $1',
      [id],
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

// ==========================================
// FASE 2A: ALOCAÇÃO DE EQUIPE (client_team_member)
// ==========================================

export async function listClientTeamMembers(
  database: Database,
  identity: SessionResponse,
  clientId: string,
): Promise<ClientTeamListResponse> {
  const hasGlobal =
    identity.permissions.includes('clients.read') ||
    identity.permissions.includes('clients.team.manage') ||
    identity.permissions.includes('clients.manage');

  if (!hasGlobal) {
    if (!identity.permissions.includes('clients.read.assigned')) {
      throw new AppError(403, 'FORBIDDEN');
    }
    await assertUserAllocatedToClient(database, identity.user.id, clientId);
  }

  const clientCheck = await database.pool.query<{ id: string }>(
    'SELECT id FROM client WHERE id = $1',
    [clientId],
  );
  if (!clientCheck.rows[0]) {
    throw new AppError(404, 'CLIENT_NOT_FOUND');
  }

  const res = await database.pool.query<ClientTeamMemberRow>(`
    SELECT
      ctm.client_id,
      ctm.user_id,
      u.name AS user_name,
      u.email AS user_email,
      ctm.functional_role,
      ctm.is_primary,
      ctm.can_create_demands,
      ctm.assigned_by_user_id,
      ctm.assigned_at
    FROM client_team_member ctm
    JOIN auth_user u ON u.id = ctm.user_id
    WHERE ctm.client_id = $1
    ORDER BY ctm.is_primary DESC, ctm.assigned_at ASC, u.name ASC, ctm.functional_role ASC
  `, [clientId]);

  return {
    members: res.rows.map(formatTeamMember),
  };
}

export async function upsertClientTeamMember(
  database: Database,
  identity: SessionResponse,
  clientId: string,
  input: UpsertClientTeamMemberInput,
): Promise<ClientTeamMember> {
  const client = await database.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [IDENTITY_LOCK]);
    await revalidateActor(client, identity.user.id, 'clients.team.manage');

    const clientCheck = await client.query<{ id: string }>(
      'SELECT id FROM client WHERE id = $1',
      [clientId],
    );
    if (!clientCheck.rows[0]) {
      throw new AppError(404, 'CLIENT_NOT_FOUND');
    }

    const userCheck = await client.query<{ id: string; name: string; email: string }>(
      'SELECT id, name, email FROM auth_user WHERE id = $1 AND active = true',
      [input.userId],
    );
    const targetUser = userCheck.rows[0];
    if (!targetUser) {
      throw new AppError(404, 'USER_NOT_FOUND');
    }

    const upsertRes = await client.query<{
      client_id: string;
      user_id: string;
      functional_role: ClientFunctionalRole;
      is_primary: boolean;
      can_create_demands: boolean;
      assigned_by_user_id: string;
      assigned_at: Date | string;
    }>(`
      INSERT INTO client_team_member (
        client_id, user_id, functional_role, is_primary, can_create_demands, assigned_by_user_id, assigned_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, now())
      ON CONFLICT (client_id, user_id, functional_role)
      DO UPDATE SET
        is_primary = EXCLUDED.is_primary,
        can_create_demands = EXCLUDED.can_create_demands,
        assigned_by_user_id = EXCLUDED.assigned_by_user_id,
        assigned_at = now()
      RETURNING client_id, user_id, functional_role, is_primary, can_create_demands, assigned_by_user_id, assigned_at
    `, [
      clientId,
      input.userId,
      input.functionalRole,
      input.isPrimary ?? false,
      input.canCreateDemands ?? false,
      identity.user.id,
    ]);

    const row = upsertRes.rows[0];
    if (!row) throw new AppError(500, 'TEAM_MEMBER_ASSIGNMENT_FAILED');

    await client.query('COMMIT');
    return formatTeamMember({
      ...row,
      user_name: targetUser.name,
      user_email: targetUser.email,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function removeClientTeamMember(
  database: Database,
  identity: SessionResponse,
  clientId: string,
  userId: string,
  functionalRole?: ClientFunctionalRole,
): Promise<void> {
  const client = await database.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [IDENTITY_LOCK]);
    await revalidateActor(client, identity.user.id, 'clients.team.manage');

    const clientCheck = await client.query<{ id: string }>(
      'SELECT id FROM client WHERE id = $1',
      [clientId],
    );
    if (!clientCheck.rows[0]) {
      throw new AppError(404, 'CLIENT_NOT_FOUND');
    }

    const delRes = functionalRole
      ? await client.query(
          'DELETE FROM client_team_member WHERE client_id = $1 AND user_id = $2 AND functional_role = $3',
          [clientId, userId, functionalRole],
        )
      : await client.query(
          'DELETE FROM client_team_member WHERE client_id = $1 AND user_id = $2',
          [clientId, userId],
        );

    if (!delRes.rowCount) {
      throw new AppError(404, 'TEAM_MEMBER_NOT_FOUND');
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ==========================================
// FASE 2A: ESCOPO CONTRATADO (client_scope_item)
// ==========================================

export async function listClientScopeItems(
  database: Database,
  identity: SessionResponse,
  clientId: string,
): Promise<ClientScopeListResponse> {
  const hasGlobal =
    identity.permissions.includes('clients.read') ||
    identity.permissions.includes('clients.manage');

  if (!hasGlobal) {
    if (!identity.permissions.includes('clients.read.assigned')) {
      throw new AppError(403, 'FORBIDDEN');
    }
    await assertUserAllocatedToClient(database, identity.user.id, clientId);
  }

  const clientCheck = await database.pool.query<{ id: string }>(
    'SELECT id FROM client WHERE id = $1',
    [clientId],
  );
  if (!clientCheck.rows[0]) {
    throw new AppError(404, 'CLIENT_NOT_FOUND');
  }

  const res = await database.pool.query<ClientScopeItemRow>(`
    SELECT
      id, client_id, title, description, category, cadence,
      contracted_quantity, sla_business_days, sla_hours, active,
      version, created_at, updated_at
    FROM client_scope_item
    WHERE client_id = $1
    ORDER BY created_at ASC, id ASC
  `, [clientId]);

  return {
    scopeItems: res.rows.map(formatScopeItem),
  };
}

export async function createClientScopeItem(
  database: Database,
  identity: SessionResponse,
  clientId: string,
  input: CreateClientScopeItemInput,
): Promise<ClientScopeItem> {
  const client = await database.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [IDENTITY_LOCK]);
    await revalidateActor(client, identity.user.id, 'clients.manage');

    const clientCheck = await client.query<{ id: string }>(
      'SELECT id FROM client WHERE id = $1',
      [clientId],
    );
    if (!clientCheck.rows[0]) {
      throw new AppError(404, 'CLIENT_NOT_FOUND');
    }

    const id = randomUUID();
    const activeFlag = input.active ?? input.isActive ?? true;
    const insertRes = await client.query<ClientScopeItemRow>(`
      INSERT INTO client_scope_item (
        id, client_id, title, description, category, cadence,
        contracted_quantity, sla_business_days, sla_hours, active,
        version, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 1, now(), now())
      RETURNING
        id, client_id, title, description, category, cadence,
        contracted_quantity, sla_business_days, sla_hours, active,
        version, created_at, updated_at
    `, [
      id,
      clientId,
      input.title,
      input.description ?? '',
      input.category ?? 'general',
      input.cadence ?? 'monthly',
      input.contractedQuantity ?? 1,
      input.slaBusinessDays ?? null,
      input.slaHours ?? null,
      activeFlag,
    ]);

    const row = insertRes.rows[0];
    if (!row) throw new AppError(500, 'SCOPE_ITEM_CREATION_FAILED');

    await client.query('COMMIT');
    return formatScopeItem(row);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function updateClientScopeItem(
  database: Database,
  identity: SessionResponse,
  clientId: string,
  scopeId: string,
  input: UpdateClientScopeItemInput,
): Promise<ClientScopeItem> {
  const client = await database.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [IDENTITY_LOCK]);
    await revalidateActor(client, identity.user.id, 'clients.manage');

    const setClauses: string[] = [];
    const params: unknown[] = [scopeId, clientId, input.version];

    if (input.title !== undefined) {
      params.push(input.title);
      setClauses.push(`title = $${params.length}`);
    }
    if (input.description !== undefined) {
      params.push(input.description);
      setClauses.push(`description = $${params.length}`);
    }
    if (input.category !== undefined) {
      params.push(input.category);
      setClauses.push(`category = $${params.length}`);
    }
    if (input.cadence !== undefined) {
      params.push(input.cadence);
      setClauses.push(`cadence = $${params.length}`);
    }
    if (input.contractedQuantity !== undefined) {
      params.push(input.contractedQuantity);
      setClauses.push(`contracted_quantity = $${params.length}`);
    }
    if (input.slaBusinessDays !== undefined) {
      params.push(input.slaBusinessDays ?? null);
      setClauses.push(`sla_business_days = $${params.length}`);
    }
    if (input.slaHours !== undefined) {
      params.push(input.slaHours ?? null);
      setClauses.push(`sla_hours = $${params.length}`);
    }
    const nextActive = input.active !== undefined ? input.active : input.isActive;
    if (nextActive !== undefined) {
      params.push(nextActive);
      setClauses.push(`active = $${params.length}`);
    }

    setClauses.push('version = version + 1');
    setClauses.push('updated_at = now()');

    const updateRes = await client.query<ClientScopeItemRow>(`
      UPDATE client_scope_item
      SET ${setClauses.join(', ')}
      WHERE id = $1 AND client_id = $2 AND version = $3
      RETURNING
        id, client_id, title, description, category, cadence,
        contracted_quantity, sla_business_days, sla_hours, active,
        version, created_at, updated_at
    `, params);

    if (updateRes.rows[0]) {
      await client.query('COMMIT');
      return formatScopeItem(updateRes.rows[0]);
    }

    const exists = await client.query<{ id: string }>(
      'SELECT id FROM client_scope_item WHERE id = $1 AND client_id = $2',
      [scopeId, clientId],
    );
    if (!exists.rows[0]) {
      throw new AppError(404, 'SCOPE_ITEM_NOT_FOUND');
    }
    throw new AppError(409, 'SCOPE_ITEM_VERSION_CONFLICT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function deleteClientScopeItem(
  database: Database,
  identity: SessionResponse,
  clientId: string,
  scopeId: string,
): Promise<void> {
  const client = await database.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [IDENTITY_LOCK]);
    await revalidateActor(client, identity.user.id, 'clients.manage');

    const delRes = await client.query(
      'DELETE FROM client_scope_item WHERE id = $1 AND client_id = $2',
      [scopeId, clientId],
    );
    if (!delRes.rowCount) {
      throw new AppError(404, 'SCOPE_ITEM_NOT_FOUND');
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
