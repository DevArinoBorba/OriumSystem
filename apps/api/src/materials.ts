import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { Database } from './db.js';
import { AppError } from './errors.js';
import { IDENTITY_LOCK } from './identity.js';
import type {
  ClientTimelineQuery,
  ClientTimelineResponse,
  CreateMaterialInput,
  ListMaterialsQuery,
  ListMaterialsResponse,
  ListMaterialTargetsQuery,
  ListMaterialTargetsResponse,
  Material,
  MaterialHistoryQuery,
  MaterialHistoryResponse,
  Permission,
  Role,
  SessionResponse,
  TimelineEventSource,
  UpdateMaterialInput,
} from '@orium/contracts';

interface MaterialRow {
  id: string;
  client_id: string;
  client_name: string;
  demand_id: string | null;
  demand_title: string | null;
  task_id: string | null;
  task_title: string | null;
  created_by_user_id: string;
  title: string;
  description: string;
  category: 'brand' | 'preview' | 'published' | 'drive' | 'asset' | 'reference';
  url: string;
  drive_file_id?: string | null;
  drive_path?: string | null;
  archived_at: Date | string | null;
  version: number;
  created_at: Date | string;
  updated_at: Date | string;
}

interface RevalidatedActor {
  id: string;
  name: string;
  roles: Role[];
  permissions: Permission[];
  isAdmin: boolean;
}

async function revalidateActor(
  client: PoolClient,
  userId: string,
  requiredPermission?: Permission,
): Promise<RevalidatedActor> {
  const query = `
    SELECT
      u.id, u.name, u.active,
      COALESCE(array_agg(DISTINCT ur.role_id) FILTER (WHERE ur.role_id IS NOT NULL), '{}') AS roles,
      COALESCE(array_agg(DISTINCT rp.permission_id) FILTER (WHERE rp.permission_id IS NOT NULL), '{}') AS permissions
    FROM auth_user u
    LEFT JOIN user_role ur ON ur.user_id = u.id
    LEFT JOIN role_permission rp ON rp.role_id = ur.role_id
    WHERE u.id = $1
    GROUP BY u.id
  `;

  const res = await client.query<{
    id: string;
    name: string;
    active: boolean;
    roles: Role[];
    permissions: Permission[];
  }>(query, [userId]);

  const row = res.rows[0];
  if (!row || !row.active) {
    throw new AppError(401, 'UNAUTHENTICATED');
  }

  if (requiredPermission && !row.permissions.includes(requiredPermission)) {
    throw new AppError(403, 'FORBIDDEN');
  }

  const isAdmin = row.roles.includes('administrator');

  return {
    id: row.id,
    name: row.name,
    roles: row.roles,
    permissions: row.permissions,
    isAdmin,
  };
}

function formatMaterial(row: MaterialRow): Material {
  return {
    id: row.id,
    clientId: row.client_id,
    client: {
      id: row.client_id,
      name: row.client_name,
    },
    demandId: row.demand_id ?? null,
    demand: row.demand_id && row.demand_title ? {
      id: row.demand_id,
      title: row.demand_title,
    } : null,
    taskId: row.task_id ?? null,
    task: row.task_id && row.task_title ? {
      id: row.task_id,
      title: row.task_title,
    } : null,
    title: row.title,
    description: row.description ?? '',
    category: row.category,
    url: row.url,
    driveFileId: row.drive_file_id ?? null,
    drivePath: row.drive_path ?? null,
    archivedAt: row.archived_at ? new Date(row.archived_at).toISOString() : null,
    version: row.version,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export async function listMaterials(
  database: Database,
  identity: SessionResponse,
  query: ListMaterialsQuery,
): Promise<ListMaterialsResponse> {
  const client = await database.pool.connect();

  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');

    const actor = await revalidateActor(client, identity.user.id, 'materials.read');

    const conditions: string[] = [];
    const params: unknown[] = [];

    // 1. Scoping por perfil (RBAC e atribuição baseados em banco real)
    if (!actor.isAdmin) {
      params.push(actor.id);
      const userIdParam = `$${params.length}`;
      conditions.push(`(
        (m.task_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM task t
          WHERE t.id = m.task_id AND t.assigned_to_user_id = ${userIdParam}
        ))
        OR
        (m.task_id IS NULL AND m.demand_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM task t
          WHERE t.demand_id = m.demand_id AND t.assigned_to_user_id = ${userIdParam}
        ))
      )`);
    }

    // 2. Filtro de status
    if (query.status === 'active') {
      conditions.push('m.archived_at IS NULL');
    } else if (query.status === 'archived') {
      conditions.push('m.archived_at IS NOT NULL');
    }

    // 3. Filtros relacionais
    if (query.clientId) {
      params.push(query.clientId);
      conditions.push(`m.client_id = $${params.length}`);
    }

    if (query.demandId) {
      params.push(query.demandId);
      conditions.push(`m.demand_id = $${params.length}`);
    }

    if (query.taskId) {
      params.push(query.taskId);
      conditions.push(`m.task_id = $${params.length}`);
    }

    if (query.category) {
      params.push(query.category);
      conditions.push(`m.category = $${params.length}`);
    }

    // 4. Busca textual (q)
    if (query.q && query.q.length > 0) {
      params.push(`%${query.q.replace(/[%_\\]/g, '\\$&')}%`);
      const qParam = `$${params.length}`;
      conditions.push(`(m.title ILIKE ${qParam} ESCAPE '\\' OR m.description ILIKE ${qParam} ESCAPE '\\')`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Contagem total no mesmo snapshot
    const countSql = `SELECT count(*)::int AS total FROM material m ${whereClause}`;
    const countRes = await client.query<{ total: number }>(countSql, params);
    const total = countRes.rows[0]?.total ?? 0;

    // Paginação
    const offset = (query.page - 1) * query.pageSize;
    params.push(query.pageSize);
    const limitParam = `$${params.length}`;
    params.push(offset);
    const offsetParam = `$${params.length}`;

    const selectSql = `
      SELECT
        m.id, m.client_id, c.name AS client_name,
        m.demand_id, d.title AS demand_title,
        m.task_id, t.title AS task_title,
        m.created_by_user_id, m.title, m.description,
        m.category, m.url, m.archived_at, m.version,
        m.created_at, m.updated_at
      FROM material m
      JOIN client c ON c.id = m.client_id
      LEFT JOIN demand d ON d.id = m.demand_id
      LEFT JOIN task t ON t.id = m.task_id
      ${whereClause}
      ORDER BY m.updated_at DESC, m.id ASC
      LIMIT ${limitParam} OFFSET ${offsetParam}
    `;

    const selectRes = await client.query<MaterialRow>(selectSql, params);
    await client.query('COMMIT');

    return {
      materials: selectRes.rows.map(formatMaterial),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function getMaterial(
  database: Database,
  identity: SessionResponse,
  materialId: string,
): Promise<{ material: Material }> {
  const client = await database.pool.connect();

  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');

    const actor = await revalidateActor(client, identity.user.id, 'materials.read');

    const selectSql = `
      SELECT
        m.id, m.client_id, c.name AS client_name,
        m.demand_id, d.title AS demand_title,
        m.task_id, t.title AS task_title,
        m.created_by_user_id, m.title, m.description,
        m.category, m.url, m.archived_at, m.version,
        m.created_at, m.updated_at,
        t.assigned_to_user_id AS task_assigned_to_user_id
      FROM material m
      JOIN client c ON c.id = m.client_id
      LEFT JOIN demand d ON d.id = m.demand_id
      LEFT JOIN task t ON t.id = m.task_id
      WHERE m.id = $1
    `;

    const res = await client.query<MaterialRow & { task_assigned_to_user_id: string | null }>(selectSql, [materialId]);
    const row = res.rows[0];
    if (!row) {
      throw new AppError(404, 'NOT_FOUND');
    }

    if (!actor.isAdmin) {
      // Revalidar autorização por atribuição
      if (row.task_id) {
        if (row.task_assigned_to_user_id !== actor.id) {
          throw new AppError(404, 'NOT_FOUND');
        }
      } else if (row.demand_id) {
        const hasTaskRes = await client.query(
          'SELECT 1 FROM task WHERE demand_id = $1 AND assigned_to_user_id = $2 LIMIT 1',
          [row.demand_id, actor.id],
        );
        if (!hasTaskRes.rowCount) {
          throw new AppError(404, 'NOT_FOUND');
        }
      } else {
        // Material apenas de cliente é restrito a administradores
        throw new AppError(404, 'NOT_FOUND');
      }
    }

    await client.query('COMMIT');

    return { material: formatMaterial(row) };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function createMaterial(
  database: Database,
  identity: SessionResponse,
  input: CreateMaterialInput,
): Promise<{ material: Material }> {
  const client = await database.pool.connect();

  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [IDENTITY_LOCK]);

    const actor = await revalidateActor(client, identity.user.id, 'materials.write');

    // 1. Validação de regras para Colaborador
    if (!actor.isAdmin) {
      // Colaborador não cria material apenas de cliente
      if (!input.demandId && !input.taskId) {
        throw new AppError(403, 'FORBIDDEN');
      }

      if (input.taskId) {
        // Se vinculou a tarefa, a tarefa DEVE pertencer ao colaborador (com FOR SHARE)
        const taskCheck = await client.query<{ demand_id: string; assigned_to_user_id: string }>(
          'SELECT demand_id, assigned_to_user_id FROM task WHERE id = $1 FOR SHARE',
          [input.taskId],
        );
        const taskRow = taskCheck.rows[0];
        if (!taskRow || taskRow.assigned_to_user_id !== actor.id) {
          throw new AppError(404, 'NOT_FOUND');
        }
        if (input.demandId && taskRow.demand_id !== input.demandId) {
          throw new AppError(400, 'TASK_DEMAND_MISMATCH');
        }
      } else if (input.demandId) {
        // Se vinculou apenas ao chamado, colaborador DEVE possuir ao menos uma tarefa sua naquele chamado
        const demandTaskCheck = await client.query(
          'SELECT 1 FROM task WHERE demand_id = $1 AND assigned_to_user_id = $2 FOR SHARE LIMIT 1',
          [input.demandId, actor.id],
        );
        if (!demandTaskCheck.rowCount) {
          throw new AppError(404, 'NOT_FOUND');
        }
      }
    }

    // 2. Validação hierárquica estrita (cliente/chamado/tarefa)
    const clientRes = await client.query<{ id: string; name: string }>(
      'SELECT id, name FROM client WHERE id = $1',
      [input.clientId],
    );
    const clientRow = clientRes.rows[0];
    if (!clientRow) {
      throw new AppError(400, 'CLIENT_NOT_FOUND');
    }

    let demandTitle: string | null = null;
    if (input.demandId) {
      const demandRes = await client.query<{ id: string; client_id: string; title: string }>(
        'SELECT id, client_id, title FROM demand WHERE id = $1',
        [input.demandId],
      );
      const demandRow = demandRes.rows[0];
      if (!demandRow || demandRow.client_id !== input.clientId) {
        throw new AppError(400, 'DEMAND_CLIENT_MISMATCH');
      }
      demandTitle = demandRow.title;
    }

    let taskTitle: string | null = null;
    if (input.taskId) {
      if (!input.demandId) {
        throw new AppError(400, 'TASK_REQUIRES_DEMAND');
      }
      const taskRes = await client.query<{ id: string; demand_id: string; title: string }>(
        'SELECT id, demand_id, title FROM task WHERE id = $1',
        [input.taskId],
      );
      const taskRow = taskRes.rows[0];
      if (!taskRow || taskRow.demand_id !== input.demandId) {
        throw new AppError(400, 'TASK_DEMAND_MISMATCH');
      }
      taskTitle = taskRow.title;
    }

    // 3. Inserção do Material
    const materialId = randomUUID();
    const insertSql = `
      INSERT INTO material (
        id, client_id, demand_id, task_id, created_by_user_id,
        title, description, category, url, drive_file_id, drive_path, archived_at, version,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NULL, 1, now(), now())
      RETURNING *
    `;

    const insertRes = await client.query<MaterialRow>(insertSql, [
      materialId,
      input.clientId,
      input.demandId ?? null,
      input.taskId ?? null,
      actor.id,
      input.title,
      input.description ?? '',
      input.category,
      input.url,
      input.driveFileId ?? null,
      input.drivePath ?? null,
    ]);

    const createdRow = insertRes.rows[0]!;

    // Arquivo do Drive vinculado a uma tarefa entra como "a publicar" (sem sobrescrever status existente).
    if (input.driveFileId && input.taskId) {
      await client.query(`
        INSERT INTO drive_file_status (drive_file_id, status, updated_by_user_id, updated_at)
        VALUES ($1, 'to_publish', $2, now())
        ON CONFLICT (drive_file_id) DO NOTHING
      `, [input.driveFileId, actor.id]);
    }

    // 4. Gravação de Evento no Histórico
    const changes = {
      title: { before: null, after: input.title },
      category: { before: null, after: input.category },
      url: { before: null, after: input.url },
      clientId: { before: null, after: input.clientId },
      demandId: { before: null, after: input.demandId ?? null },
      taskId: { before: null, after: input.taskId ?? null },
    };

    await client.query(`
      INSERT INTO material_event (id, material_id, actor_id, actor_name, action, reason, metadata, created_at)
      VALUES ($1, $2, $3, $4, 'material_created', NULL, $5, now())
    `, [randomUUID(), materialId, actor.id, actor.name, JSON.stringify(changes)]);

    await client.query('COMMIT');

    return {
      material: formatMaterial({
        ...createdRow,
        client_name: clientRow.name,
        demand_title: demandTitle,
        task_title: taskTitle,
      }),
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function updateMaterial(
  database: Database,
  identity: SessionResponse,
  materialId: string,
  input: UpdateMaterialInput,
): Promise<{ material: Material }> {
  const client = await database.pool.connect();

  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [IDENTITY_LOCK]);

    const actor = await revalidateActor(client, identity.user.id, 'materials.write');

    // 1. Lock do registro de material
    const lockSql = `
      SELECT
        m.*,
        c.name AS client_name,
        d.title AS demand_title,
        t.title AS task_title
      FROM material m
      JOIN client c ON c.id = m.client_id
      LEFT JOIN demand d ON d.id = m.demand_id
      LEFT JOIN task t ON t.id = m.task_id
      WHERE m.id = $1
      FOR UPDATE OF m
    `;
    const lockRes = await client.query<MaterialRow & {
      client_name: string;
      demand_title: string | null;
      task_title: string | null;
    }>(lockSql, [materialId]);
    const existing = lockRes.rows[0];
    if (!existing) {
      throw new AppError(404, 'NOT_FOUND');
    }

    // 2. Autorização DEVE anteceder 409 para não vazar a existência do registro
    // Bloquear a task FOR SHARE para sincronizar com reatribuição concorrente
    if (!actor.isAdmin) {
      if (existing.task_id) {
        const taskCheck = await client.query<{ assigned_to_user_id: string }>(
          'SELECT assigned_to_user_id FROM task WHERE id = $1 FOR SHARE',
          [existing.task_id],
        );
        const taskRow = taskCheck.rows[0];
        if (!taskRow || taskRow.assigned_to_user_id !== actor.id) {
          throw new AppError(404, 'NOT_FOUND');
        }
      } else if (existing.demand_id) {
        // Demanda própria usa task bloqueada com FOR SHARE
        const taskCheck = await client.query(
          'SELECT id FROM task WHERE demand_id = $1 AND assigned_to_user_id = $2 FOR SHARE LIMIT 1',
          [existing.demand_id, actor.id],
        );
        if (!taskCheck.rowCount) {
          throw new AppError(404, 'NOT_FOUND');
        }
      } else {
        throw new AppError(404, 'NOT_FOUND');
      }
    }

    // 3. Concorrência otimista (version check)
    if (existing.version !== input.version) {
      throw new AppError(409, 'VERSION_CONFLICT');
    }

    // 4. Imutabilidade de vínculos para AMBOS OS PAPÉIS (revisão de segurança Codex)
    if (
      (input.clientId !== undefined && input.clientId !== existing.client_id) ||
      (input.demandId !== undefined && (input.demandId ?? null) !== existing.demand_id) ||
      (input.taskId !== undefined && (input.taskId ?? null) !== existing.task_id)
    ) {
      throw new AppError(400, 'MATERIAL_LINKS_IMMUTABLE');
    }

    // 5. Detecção de mudanças para histórico (apenas campos editáveis)
    const changes: Record<string, { before: unknown; after: unknown }> = {};
    if (existing.title !== input.title) {
      changes.title = { before: existing.title, after: input.title };
    }
    if ((existing.description ?? '') !== (input.description ?? '')) {
      changes.description = { before: existing.description ?? '', after: input.description ?? '' };
    }
    if (existing.category !== input.category) {
      changes.category = { before: existing.category, after: input.category };
    }
    if (existing.url !== input.url) {
      changes.url = { before: existing.url, after: input.url };
    }

    // 6. Atualização atômica (vínculos client_id, demand_id, task_id são estritamente imutáveis)
    const updateSql = `
      UPDATE material
      SET
        title = $1,
        description = $2,
        category = $3,
        url = $4,
        version = version + 1,
        updated_at = now()
      WHERE id = $5 AND version = $6
      RETURNING *
    `;

    const updateRes = await client.query<MaterialRow>(updateSql, [
      input.title,
      input.description ?? '',
      input.category,
      input.url,
      materialId,
      input.version,
    ]);

    if (!updateRes.rowCount) {
      throw new AppError(409, 'VERSION_CONFLICT');
    }

    const updatedRow = updateRes.rows[0]!;

    // 7. Gravação de Evento no Histórico
    if (Object.keys(changes).length > 0) {
      await client.query(`
        INSERT INTO material_event (id, material_id, actor_id, actor_name, action, reason, metadata, created_at)
        VALUES ($1, $2, $3, $4, 'material_updated', NULL, $5, now())
      `, [randomUUID(), materialId, actor.id, actor.name, JSON.stringify(changes)]);
    }

    await client.query('COMMIT');

    return {
      material: formatMaterial({
        ...updatedRow,
        client_name: existing.client_name,
        demand_title: existing.demand_title,
        task_title: existing.task_title,
      }),
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function archiveMaterial(
  database: Database,
  identity: SessionResponse,
  materialId: string,
  version: number,
): Promise<{ material: Material }> {
  const client = await database.pool.connect();

  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [IDENTITY_LOCK]);

    const actor = await revalidateActor(client, identity.user.id, 'materials.archive');
    if (!actor.isAdmin) {
      throw new AppError(403, 'FORBIDDEN');
    }

    const lockRes = await client.query<MaterialRow>(
      'SELECT * FROM material WHERE id = $1 FOR UPDATE',
      [materialId],
    );
    const existing = lockRes.rows[0];
    if (!existing) {
      throw new AppError(404, 'NOT_FOUND');
    }

    if (existing.version !== version) {
      throw new AppError(409, 'VERSION_CONFLICT');
    }

    if (existing.archived_at) {
      // Já arquivado
      await client.query('COMMIT');
      return getMaterial(database, identity, materialId);
    }

    const updateRes = await client.query<MaterialRow>(`
      UPDATE material
      SET archived_at = now(), version = version + 1, updated_at = now()
      WHERE id = $1 AND version = $2
      RETURNING *
    `, [materialId, version]);

    if (!updateRes.rowCount) {
      throw new AppError(409, 'VERSION_CONFLICT');
    }

    const updatedRow = updateRes.rows[0]!;

    const changes = {
      archivedAt: { before: null, after: updatedRow.archived_at },
    };

    await client.query(`
      INSERT INTO material_event (id, material_id, actor_id, actor_name, action, reason, metadata, created_at)
      VALUES ($1, $2, $3, $4, 'material_archived', NULL, $5, now())
    `, [randomUUID(), materialId, actor.id, actor.name, JSON.stringify(changes)]);

    await client.query('COMMIT');

    return getMaterial(database, identity, materialId);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function restoreMaterial(
  database: Database,
  identity: SessionResponse,
  materialId: string,
  version: number,
): Promise<{ material: Material }> {
  const client = await database.pool.connect();

  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [IDENTITY_LOCK]);

    const actor = await revalidateActor(client, identity.user.id, 'materials.archive');
    if (!actor.isAdmin) {
      throw new AppError(403, 'FORBIDDEN');
    }

    const lockRes = await client.query<MaterialRow>(
      'SELECT * FROM material WHERE id = $1 FOR UPDATE',
      [materialId],
    );
    const existing = lockRes.rows[0];
    if (!existing) {
      throw new AppError(404, 'NOT_FOUND');
    }

    if (existing.version !== version) {
      throw new AppError(409, 'VERSION_CONFLICT');
    }

    if (!existing.archived_at) {
      // Já ativo
      await client.query('COMMIT');
      return getMaterial(database, identity, materialId);
    }

    const updateRes = await client.query<MaterialRow>(`
      UPDATE material
      SET archived_at = NULL, version = version + 1, updated_at = now()
      WHERE id = $1 AND version = $2
      RETURNING *
    `, [materialId, version]);

    if (!updateRes.rowCount) {
      throw new AppError(409, 'VERSION_CONFLICT');
    }

    const changes = {
      archivedAt: { before: existing.archived_at, after: null },
    };

    await client.query(`
      INSERT INTO material_event (id, material_id, actor_id, actor_name, action, reason, metadata, created_at)
      VALUES ($1, $2, $3, $4, 'material_restored', NULL, $5, now())
    `, [randomUUID(), materialId, actor.id, actor.name, JSON.stringify(changes)]);

    await client.query('COMMIT');

    return getMaterial(database, identity, materialId);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function getMaterialHistory(
  database: Database,
  identity: SessionResponse,
  materialId: string,
  query: MaterialHistoryQuery,
): Promise<MaterialHistoryResponse> {
  const client = await database.pool.connect();

  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');

    const actor = await revalidateActor(client, identity.user.id, 'materials.read');

    // 1. Autorização de acesso ao material no mesmo snapshot
    const matRes = await client.query<{
      id: string;
      demand_id: string | null;
      task_id: string | null;
      task_assigned_to_user_id: string | null;
    }>(`
      SELECT m.id, m.demand_id, m.task_id, t.assigned_to_user_id AS task_assigned_to_user_id
      FROM material m
      LEFT JOIN task t ON t.id = m.task_id
      WHERE m.id = $1
    `, [materialId]);

    const mat = matRes.rows[0];
    if (!mat) {
      throw new AppError(404, 'NOT_FOUND');
    }

    if (!actor.isAdmin) {
      if (mat.task_id) {
        if (mat.task_assigned_to_user_id !== actor.id) {
          throw new AppError(404, 'NOT_FOUND');
        }
      } else if (mat.demand_id) {
        const hasTaskRes = await client.query(
          'SELECT 1 FROM task WHERE demand_id = $1 AND assigned_to_user_id = $2 LIMIT 1',
          [mat.demand_id, actor.id],
        );
        if (!hasTaskRes.rowCount) {
          throw new AppError(404, 'NOT_FOUND');
        }
      } else {
        throw new AppError(404, 'NOT_FOUND');
      }
    }

    // 2. Contagem e listagem no mesmo snapshot consistente
    const countRes = await client.query<{ total: number }>(
      'SELECT count(*)::int AS total FROM material_event WHERE material_id = $1',
      [materialId],
    );
    const total = countRes.rows[0]?.total ?? 0;

    const offset = (query.page - 1) * query.pageSize;
    const selectSql = `
      SELECT id, action, actor_name, created_at, metadata
      FROM material_event
      WHERE material_id = $1
      ORDER BY created_at DESC, id ASC
      LIMIT $2 OFFSET $3
    `;

    const selectRes = await client.query<{
      id: string;
      action: string;
      actor_name: string;
      created_at: Date | string;
      metadata: Record<string, { before: unknown; after: unknown }>;
    }>(selectSql, [materialId, query.pageSize, offset]);

    await client.query('COMMIT');

    return {
      events: selectRes.rows.map((row) => ({
        id: row.id,
        action: row.action,
        actorName: row.actor_name,
        createdAt: new Date(row.created_at).toISOString(),
        changes: row.metadata ?? {},
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function listMaterialTargets(
  database: Database,
  identity: SessionResponse,
  query: ListMaterialTargetsQuery,
): Promise<ListMaterialTargetsResponse> {
  const client = await database.pool.connect();

  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');

    const actor = await revalidateActor(client, identity.user.id, 'materials.read');

    const offset = (query.page - 1) * query.pageSize;
    const params: unknown[] = [];
    const whereConditions: string[] = [];

    if (query.kind === 'client') {
      if (!actor.isAdmin) {
        // Colaborador só visualiza clientes com chamados onde ele tem tarefas atribuídas
        params.push(actor.id);
        whereConditions.push(`EXISTS (
          SELECT 1 FROM demand d
          JOIN task t ON t.demand_id = d.id
          WHERE d.client_id = c.id AND t.assigned_to_user_id = $${params.length}
        )`);
      }

      whereConditions.push('c.archived_at IS NULL');

      if (query.q && query.q.length > 0) {
        params.push(`%${query.q.replace(/[%_\\]/g, '\\$&')}%`);
        whereConditions.push(`c.name ILIKE $${params.length} ESCAPE '\\'`);
      }

      const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';
      const countRes = await client.query<{ total: number }>(`SELECT count(*)::int AS total FROM client c ${whereClause}`, params);
      const total = countRes.rows[0]?.total ?? 0;

      params.push(query.pageSize);
      const limitParam = `$${params.length}`;
      params.push(offset);
      const offsetParam = `$${params.length}`;

      const listRes = await client.query<{ id: string; title: string }>(`
        SELECT c.id, c.name AS title
        FROM client c
        ${whereClause}
        ORDER BY c.name ASC
        LIMIT ${limitParam} OFFSET ${offsetParam}
      `, params);

      await client.query('COMMIT');

      return {
        targets: listRes.rows.map((r) => ({ id: r.id, title: r.title })),
        total,
        page: query.page,
        pageSize: query.pageSize,
      };
    }

    if (query.kind === 'demand') {
      if (!actor.isAdmin) {
        // Colaborador só vê chamados onde tem tarefas atribuídas
        params.push(actor.id);
        whereConditions.push(`EXISTS (
          SELECT 1 FROM task t
          WHERE t.demand_id = d.id AND t.assigned_to_user_id = $${params.length}
        )`);
      }

      if (query.clientId) {
        params.push(query.clientId);
        whereConditions.push(`d.client_id = $${params.length}`);
      }

      if (query.q && query.q.length > 0) {
        params.push(`%${query.q.replace(/[%_\\]/g, '\\$&')}%`);
        whereConditions.push(`d.title ILIKE $${params.length} ESCAPE '\\'`);
      }

      const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';
      const countRes = await client.query<{ total: number }>(`SELECT count(*)::int AS total FROM demand d ${whereClause}`, params);
      const total = countRes.rows[0]?.total ?? 0;

      params.push(query.pageSize);
      const limitParam = `$${params.length}`;
      params.push(offset);
      const offsetParam = `$${params.length}`;

      const listRes = await client.query<{ id: string; title: string; client_id: string }>(`
        SELECT d.id, d.title, d.client_id
        FROM demand d
        ${whereClause}
        ORDER BY d.title ASC
        LIMIT ${limitParam} OFFSET ${offsetParam}
      `, params);

      await client.query('COMMIT');

      return {
        targets: listRes.rows.map((r) => ({ id: r.id, title: r.title, clientId: r.client_id })),
        total,
        page: query.page,
        pageSize: query.pageSize,
      };
    }

    // kind === 'task'
    if (!actor.isAdmin) {
      // Colaborador NUNCA vê tarefas de terceiros
      params.push(actor.id);
      whereConditions.push(`t.assigned_to_user_id = $${params.length}`);
    }

    if (query.demandId) {
      params.push(query.demandId);
      whereConditions.push(`t.demand_id = $${params.length}`);
    }

    if (query.clientId) {
      params.push(query.clientId);
      whereConditions.push(`d.client_id = $${params.length}`);
    }

    if (query.q && query.q.length > 0) {
      params.push(`%${query.q.replace(/[%_\\]/g, '\\$&')}%`);
      whereConditions.push(`t.title ILIKE $${params.length} ESCAPE '\\'`);
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';
    const countRes = await client.query<{ total: number }>(`
      SELECT count(*)::int AS total
      FROM task t
      JOIN demand d ON d.id = t.demand_id
      ${whereClause}
    `, params);
    const total = countRes.rows[0]?.total ?? 0;

    params.push(query.pageSize);
    const limitParam = `$${params.length}`;
    params.push(offset);
    const offsetParam = `$${params.length}`;

    const listRes = await client.query<{ id: string; title: string; client_id: string; demand_id: string }>(`
      SELECT t.id, t.title, d.client_id, t.demand_id
      FROM task t
      JOIN demand d ON d.id = t.demand_id
      ${whereClause}
      ORDER BY t.title ASC
      LIMIT ${limitParam} OFFSET ${offsetParam}
    `, params);

    await client.query('COMMIT');

    return {
      targets: listRes.rows.map((r) => ({
        id: r.id,
        title: r.title,
        clientId: r.client_id,
        demandId: r.demand_id,
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function getClientTimeline(
  database: Database,
  identity: SessionResponse,
  clientId: string,
  query: ClientTimelineQuery,
): Promise<ClientTimelineResponse> {
  const client = await database.pool.connect();

  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');

    const actor = await revalidateActor(client, identity.user.id, 'materials.read');
    if (!actor.permissions.includes('demands.read')) {
      throw new AppError(403, 'FORBIDDEN');
    }

    // 1. Validar existência do cliente (e se não está arquivado)
    const clientRes = await client.query<{ id: string; name: string; archived_at: Date | string | null }>(
      'SELECT id, name, archived_at FROM client WHERE id = $1',
      [clientId],
    );
    const clientRow = clientRes.rows[0];
    if (!clientRow || clientRow.archived_at !== null) {
      throw new AppError(404, 'NOT_FOUND');
    }

    // 2. Colaborador: cliente precisa ter trabalho atualmente atribuído (anti-IDOR 404 se não tiver)
    if (!actor.isAdmin) {
      const hasWorkCheck = await client.query(
        `SELECT 1
         FROM demand d
         JOIN task t ON t.demand_id = d.id
         WHERE d.client_id = $1 AND t.assigned_to_user_id = $2
         LIMIT 1`,
        [clientId, actor.id],
      );
      if (!hasWorkCheck.rowCount) {
        throw new AppError(404, 'NOT_FOUND');
      }
    }

    // 3. Montar consulta unificada segura de demand_event e material_event
    const params: unknown[] = [clientId];
    let demandFilter = '';
    let taskFilter = '';
    let materialFilter = '';

    if (!actor.isAdmin) {
      params.push(actor.id);
      const userParam = `$${params.length}`;

      // Colaborador: demanda somente com tarefa própria
      demandFilter = `AND EXISTS (
        SELECT 1 FROM task t_sub
        WHERE t_sub.demand_id = d.id AND t_sub.assigned_to_user_id = ${userParam}
      )`;

      // Colaborador: evento de tarefa somente se a tarefa pertence atualmente ao colaborador
      taskFilter = `AND t.assigned_to_user_id = ${userParam}`;

      // Colaborador: material usa exatamente o filtro autorizado de Materiais (exclui client-only e tarefa de terceiro)
      materialFilter = `AND (
        (m.task_id IS NOT NULL AND t.assigned_to_user_id = ${userParam})
        OR
        (m.task_id IS NULL AND m.demand_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM task t_sub
          WHERE t_sub.demand_id = m.demand_id AND t_sub.assigned_to_user_id = ${userParam}
        ))
      )`;
    }

    const cteSql = `
      WITH timeline_events AS (
        -- Eventos de demanda (ações no nível do chamado)
        SELECT
          de.id,
          'demand'::text AS source,
          d.id AS source_id,
          d.id AS demand_id,
          NULL::uuid AS task_id,
          NULL::uuid AS material_id,
          d.title AS title,
          de.action,
          de.actor_name,
          de.created_at
        FROM demand_event de
        JOIN demand d ON d.id = de.demand_id
        WHERE d.client_id = $1 AND de.task_id IS NULL
        ${demandFilter}

        UNION ALL

        -- Eventos de tarefa (ações na tarefa)
        SELECT
          de.id,
          'task'::text AS source,
          t.id AS source_id,
          d.id AS demand_id,
          t.id AS task_id,
          NULL::uuid AS material_id,
          t.title AS title,
          de.action,
          de.actor_name,
          de.created_at
        FROM demand_event de
        JOIN demand d ON d.id = de.demand_id
        JOIN task t ON t.id = de.task_id
        WHERE d.client_id = $1
        ${taskFilter}

        UNION ALL

        -- Eventos de material
        SELECT
          me.id,
          'material'::text AS source,
          m.id AS source_id,
          m.demand_id AS demand_id,
          m.task_id AS task_id,
          m.id AS material_id,
          m.title AS title,
          me.action,
          me.actor_name,
          me.created_at
        FROM material_event me
        JOIN material m ON m.id = me.material_id
        LEFT JOIN task t ON t.id = m.task_id
        WHERE m.client_id = $1
        ${materialFilter}
      )
    `;

    // 4. Contagem total exata no mesmo snapshot
    const countSql = `${cteSql} SELECT count(*)::int AS total FROM timeline_events`;
    const countRes = await client.query<{ total: number }>(countSql, params);
    const total = countRes.rows[0]?.total ?? 0;

    // 5. Paginação e ordenação (createdAt DESC, source ASC, id ASC)
    const offset = (query.page - 1) * query.pageSize;
    const paginationParams = [...params, query.pageSize, offset];
    const limitParam = `$${paginationParams.length - 1}`;
    const offsetParam = `$${paginationParams.length}`;

    const selectSql = `
      ${cteSql}
      SELECT *
      FROM timeline_events
      ORDER BY created_at DESC, source ASC, id ASC
      LIMIT ${limitParam} OFFSET ${offsetParam}
    `;

    const selectRes = await client.query<{
      id: string;
      source: string;
      source_id: string;
      demand_id: string | null;
      task_id: string | null;
      material_id: string | null;
      title: string;
      action: string;
      actor_name: string;
      created_at: Date | string;
    }>(selectSql, paginationParams);

    await client.query('COMMIT');

    return {
      client: {
        id: clientRow.id,
        name: clientRow.name,
      },
      events: selectRes.rows.map((row) => ({
        id: row.id,
        source: row.source as TimelineEventSource,
        sourceId: row.source_id,
        demandId: row.demand_id,
        taskId: row.task_id,
        materialId: row.material_id,
        title: row.title,
        action: row.action,
        actorName: row.actor_name,
        createdAt: new Date(row.created_at).toISOString(),
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
