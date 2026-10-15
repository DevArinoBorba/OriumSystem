import crypto from 'node:crypto';
import type {
  ClientCredential,
  ClientCredentialCategory,
  ClientCredentialListResponse,
  ClientCredentialSecretResponse,
  CreateClientCredentialInput,
  HermesStatusResponse,
  UpdateClientCredentialInput,
} from '@orium/contracts';
import type { Config } from './config.js';
import type { Database } from './db.js';
import { AppError } from './errors.js';

function deriveVaultKey(config: Config): Buffer {
  const rawSecret = process.env.ORIUM_VAULT_KEY || config.BETTER_AUTH_SECRET;
  const keyBytes = crypto.hkdfSync(
    'sha256',
    Buffer.from(rawSecret, 'utf8'),
    Buffer.from('orium-vault-salt-v1', 'utf8'),
    Buffer.from('client-credential-aes-256-gcm', 'utf8'),
    32,
  );
  return Buffer.from(keyBytes);
}

export function encryptCredentialSecret(config: Config, plaintext: string): string {
  const key = deriveVaultKey(config);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptCredentialSecret(config: Config, payload: string): string {
  const parts = payload.split(':');
  const ivHex = parts[1];
  const tagHex = parts[2];
  const cipherHex = parts[3];
  if (parts.length !== 4 || parts[0] !== 'v1' || !ivHex || !tagHex || !cipherHex) {
    throw new AppError(500, 'VAULT_DECRYPT_FAILED');
  }
  const key = deriveVaultKey(config);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(cipherHex, 'hex')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

function maskSecret(plaintext: string): string {
  if (!plaintext) return '••••••••';
  if (plaintext.length <= 4) return '••••••••';
  return `${'•'.repeat(Math.min(8, plaintext.length - 2))}${plaintext.slice(-2)}`;
}

type CredentialRow = {
  id: string;
  client_id: string;
  client_name: string;
  category: string;
  label: string;
  service_url: string | null;
  username: string;
  encrypted_secret: string;
  notes: string | null;
  updated_by_name: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

function mapCredentialRow(config: Config, row: CredentialRow): ClientCredential {
  let masked = '••••••••';
  try {
    const plain = decryptCredentialSecret(config, row.encrypted_secret);
    masked = maskSecret(plain);
  } catch {
    masked = '••••••••';
  }
  return {
    id: row.id,
    clientId: row.client_id,
    clientName: row.client_name,
    category: row.category as ClientCredentialCategory,
    label: row.label,
    serviceUrl: row.service_url,
    username: row.username,
    secretPreview: masked,
    notes: row.notes,
    updatedByName: row.updated_by_name,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export async function listClientCredentials(
  config: Config,
  database: Database,
  filters?: { clientId?: string; search?: string },
): Promise<ClientCredentialListResponse> {
  const params: unknown[] = [];
  const where: string[] = [];

  if (filters?.clientId) {
    params.push(filters.clientId);
    where.push(`cc.client_id = $${params.length}`);
  }
  if (filters?.search && filters.search.trim().length > 0) {
    params.push(`%${filters.search.trim()}%`);
    where.push(
      `(c.name ILIKE $${params.length} OR cc.label ILIKE $${params.length} OR cc.username ILIKE $${params.length} OR COALESCE(cc.service_url, '') ILIKE $${params.length})`,
    );
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const result = await database.pool.query<CredentialRow>(
    `
    SELECT
      cc.id,
      cc.client_id,
      c.name AS client_name,
      cc.category,
      cc.label,
      cc.service_url,
      cc.username,
      cc.encrypted_secret,
      cc.notes,
      u.name AS updated_by_name,
      cc.created_at,
      cc.updated_at
    FROM public.client_credential cc
    INNER JOIN public.client c ON c.id = cc.client_id
    LEFT JOIN public.auth_user u ON u.id = cc.updated_by
    ${whereSql}
    ORDER BY c.name ASC, cc.label ASC, cc.created_at DESC
    `,
    params,
  );

  return {
    credentials: result.rows.map((row) => mapCredentialRow(config, row)),
  };
}

export async function createClientCredential(
  config: Config,
  database: Database,
  actorUserId: string,
  input: CreateClientCredentialInput,
): Promise<ClientCredential> {
  const clientRes = await database.pool.query<{ id: string; name: string }>(
    'SELECT id, name FROM public.client WHERE id = $1 LIMIT 1',
    [input.clientId],
  );
  if (clientRes.rowCount === 0) {
    throw new AppError(404, 'CLIENT_NOT_FOUND');
  }

  const id = crypto.randomUUID();
  const encryptedSecret = encryptCredentialSecret(config, input.secret);
  const serviceUrl = input.serviceUrl && input.serviceUrl.trim().length > 0 ? input.serviceUrl.trim() : null;
  const notes = input.notes && input.notes.trim().length > 0 ? input.notes.trim() : null;

  await database.pool.query(
    `
    INSERT INTO public.client_credential (
      id, client_id, category, label, service_url, username, encrypted_secret, notes, updated_by, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
    `,
    [
      id,
      input.clientId,
      input.category,
      input.label.trim(),
      serviceUrl,
      input.username.trim(),
      encryptedSecret,
      notes,
      actorUserId,
    ],
  );

  const created = await listClientCredentials(config, database, { clientId: input.clientId });
  const match = created.credentials.find((item) => item.id === id);
  if (!match) throw new AppError(500, 'CREDENTIAL_CREATE_FAILED');
  return match;
}

export async function updateClientCredential(
  config: Config,
  database: Database,
  actorUserId: string,
  credentialId: string,
  input: UpdateClientCredentialInput,
): Promise<ClientCredential> {
  const existing = await database.pool.query<CredentialRow>(
    `
    SELECT cc.*, c.name AS client_name, u.name AS updated_by_name
    FROM public.client_credential cc
    INNER JOIN public.client c ON c.id = cc.client_id
    LEFT JOIN public.auth_user u ON u.id = cc.updated_by
    WHERE cc.id = $1
    LIMIT 1
    `,
    [credentialId],
  );
  if (existing.rowCount === 0 || !existing.rows[0]) {
    throw new AppError(404, 'CREDENTIAL_NOT_FOUND');
  }
  const row = existing.rows[0];
  const category = input.category ?? row.category;
  const label = input.label !== undefined ? input.label.trim() : row.label;
  const serviceUrl =
    input.serviceUrl !== undefined
      ? input.serviceUrl && input.serviceUrl.trim().length > 0
        ? input.serviceUrl.trim()
        : null
      : row.service_url;
  const username = input.username !== undefined ? input.username.trim() : row.username;
  const encryptedSecret =
    input.secret !== undefined ? encryptCredentialSecret(config, input.secret) : row.encrypted_secret;
  const notes =
    input.notes !== undefined
      ? input.notes && input.notes.trim().length > 0
        ? input.notes.trim()
        : null
      : row.notes;

  await database.pool.query(
    `
    UPDATE public.client_credential
    SET
      category = $2,
      label = $3,
      service_url = $4,
      username = $5,
      encrypted_secret = $6,
      notes = $7,
      updated_by = $8,
      updated_at = NOW()
    WHERE id = $1
    `,
    [credentialId, category, label, serviceUrl, username, encryptedSecret, notes, actorUserId],
  );

  const updated = await database.pool.query<CredentialRow>(
    `
    SELECT cc.*, c.name AS client_name, u.name AS updated_by_name
    FROM public.client_credential cc
    INNER JOIN public.client c ON c.id = cc.client_id
    LEFT JOIN public.auth_user u ON u.id = cc.updated_by
    WHERE cc.id = $1
    LIMIT 1
    `,
    [credentialId],
  );
  if (!updated.rows[0]) throw new AppError(404, 'CREDENTIAL_NOT_FOUND');
  return mapCredentialRow(config, updated.rows[0]);
}

export async function revealClientCredentialSecret(
  config: Config,
  database: Database,
  credentialId: string,
): Promise<ClientCredentialSecretResponse> {
  const res = await database.pool.query<{
    id: string;
    client_id: string;
    client_name: string;
    label: string;
    username: string;
    service_url: string | null;
    encrypted_secret: string;
    notes: string | null;
  }>(
    `
    SELECT
      cc.id,
      cc.client_id,
      c.name AS client_name,
      cc.label,
      cc.username,
      cc.service_url,
      cc.encrypted_secret,
      cc.notes
    FROM public.client_credential cc
    INNER JOIN public.client c ON c.id = cc.client_id
    WHERE cc.id = $1
    LIMIT 1
    `,
    [credentialId],
  );
  if (res.rowCount === 0 || !res.rows[0]) {
    throw new AppError(404, 'CREDENTIAL_NOT_FOUND');
  }
  const row = res.rows[0];
  const secret = decryptCredentialSecret(config, row.encrypted_secret);
  return {
    id: row.id,
    clientId: row.client_id,
    clientName: row.client_name,
    label: row.label,
    username: row.username,
    secret,
    serviceUrl: row.service_url,
    notes: row.notes,
  };
}

export async function deleteClientCredential(
  database: Database,
  credentialId: string,
): Promise<{ deleted: true }> {
  const res = await database.pool.query('DELETE FROM public.client_credential WHERE id = $1', [
    credentialId,
  ]);
  if (res.rowCount === 0) {
    throw new AppError(404, 'CREDENTIAL_NOT_FOUND');
  }
  return { deleted: true };
}

export async function getHermesStatus(database: Database): Promise<HermesStatusResponse> {
  const [credCountRes, clientCountRes] = await Promise.all([
    database.pool.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM public.client_credential'),
    database.pool.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM public.client WHERE archived_at IS NULL'),
  ]);
  const totalCredentials = Number(credCountRes.rows[0]?.count ?? 0);
  const totalClients = Number(clientCountRes.rows[0]?.count ?? 0);

  let omnirouteHealthy = false;
  const omnirouteCheckUrl =
    process.env.OMNIROUTE_INTERNAL_URL || 'https://omniroute.187.77.251.41.sslip.io/login';
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const resp = await fetch(omnirouteCheckUrl, { signal: controller.signal });
    clearTimeout(timer);
    omnirouteHealthy = resp.ok || resp.status < 500;
  } catch {
    omnirouteHealthy = false;
  }

  const omnirouteUrl =
    process.env.OMNIROUTE_PUBLIC_URL || 'https://omniroute.187.77.251.41.sslip.io/';

  return {
    installed: true,
    version: 'Orium Agent v2026.10 (Fase 9 Completa — WhatsApp + Obsidian + Google Drive)',
    omnirouteUrl,
    omnirouteHealthy,
    whatsappConfigured: true,
    skillInstalled: true,
    totalCredentials,
    totalClients,
    capabilities: [
      'Identidade executiva Orium Agent no WhatsApp (+55 67 9656-7255) com observação silenciosa em grupos de clientes (responde apenas quando mencionado)',
      'Consulta e escrita transacional: criar clientes, abrir demandas, instanciar templates operacionais, criar/atualizar tarefas e comentar com auditoria em demand_event',
      'Acesso e gravação segura no Cofre de Credenciais (AES-256-GCM / HKDF-SHA256) sob demanda exclusiva para Administradores',
      'Segundo Cérebro persistente em Vault Obsidian (/data/orium/obsidian-vault + plugin hwiki) sincronizado automaticamente a cada 15 minutos',
      'Arquivamento inteligente no Google Drive (Agent/<Cliente>/<Categoria>/) via rclone com auto-exclusão de cache local na VPS (0 bytes acumulados)',
      'Roteamento multi-modelo resiliente via OmniRoute (Gemini 3 Flash, Claude Sonnet 4.6, MiniMax M2.7, DeepSeek V4 Flash) com fallback automático',
    ],
  };
}
