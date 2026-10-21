/**
 * Espelho do Google Drive (pasta Agent/) dentro do Orium System.
 *
 * O acesso ao Google fica num "gateway" rclone (rcd) na rede interna dos containers; a API
 * nunca guarda credenciais do Google. Regras de acesso:
 * - administradores navegam pela árvore inteira, enviam arquivos, vinculam a tarefas e mudam status;
 * - colaboradores só acessam arquivos vinculados (material) a tarefas atribuídas a eles.
 */
import { createHash } from 'node:crypto';
import { createReadStream, promises as fsp, openAsBlob } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  drivePathSchema,
  type DriveEntry,
  type DriveFileStatus,
  type DriveListResponse,
  type DriveMyFilesResponse,
  type DriveUploadResponse,
  type LinkDriveFileInput,
  type SessionResponse,
  type SetDriveFileStatusInput,
} from '@orium/contracts';
import type { Database } from './db.js';
import { AppError } from './errors.js';
import { createMaterial } from './materials.js';
import { agencyToday } from './agent.js';

export const DRIVE_CATEGORIES = [
  'Comprovantes',
  'Contratos',
  'Identidade Visual',
  'Criativos e Midias',
  'Relatorios',
  'Documentos Gerais',
] as const;

export const UPLOAD_CHUNK_BYTES = 4 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 1024 * 1024 * 1024;
const UPLOAD_DIR = path.join(os.tmpdir(), 'orium-drive-uploads');

type GatewayItem = {
  Path: string;
  Name: string;
  Size: number;
  MimeType?: string;
  ModTime?: string;
  IsDir: boolean;
  ID?: string;
  Hashes?: { md5?: string };
};

export interface DriveGateway {
  list(dir: string, options?: { recurse?: boolean; hashes?: boolean }): Promise<GatewayItem[]>;
  fetchFile(filePath: string, range?: string): Promise<Response>;
  upload(dir: string, fileName: string, localPath: string): Promise<void>;
}

/** Gateway HTTP (rclone rcd com --rc-serve). */
export function createHttpDriveGateway(env: NodeJS.ProcessEnv = process.env): DriveGateway | null {
  const base = env.DRIVE_GATEWAY_URL?.replace(/\/+$/, '');
  if (!base) return null;
  const fs = env.DRIVE_GATEWAY_FS ?? 'drive_mirror:';
  const authorization = env.DRIVE_GATEWAY_USER
    ? `Basic ${Buffer.from(`${env.DRIVE_GATEWAY_USER}:${env.DRIVE_GATEWAY_PASSWORD ?? ''}`).toString('base64')}`
    : undefined;
  const headers = (extra: Record<string, string> = {}) => (authorization ? { authorization, ...extra } : extra);
  const encodePath = (value: string) => value.split('/').map(encodeURIComponent).join('/');

  return {
    async list(dir, options = {}) {
      const res = await fetch(`${base}/operations/list`, {
        method: 'POST',
        headers: headers({ 'content-type': 'application/json' }),
        body: JSON.stringify({ fs, remote: dir, opt: { recurse: Boolean(options.recurse), showHash: Boolean(options.hashes) } }),
      });
      if (res.status === 404) return [];
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        if (/directory not found|not found/i.test(text)) return [];
        throw new AppError(502, 'DRIVE_UNAVAILABLE');
      }
      const body = (await res.json()) as { list?: GatewayItem[] };
      return body.list ?? [];
    },
    async fetchFile(filePath, range) {
      return fetch(`${base}/[${fs}]/${encodePath(filePath)}`, { headers: headers(range ? { range } : {}) });
    },
    async upload(dir, fileName, localPath) {
      const form = new FormData();
      form.append('file', await openAsBlob(localPath), fileName);
      const query = new URLSearchParams({ fs, remote: dir });
      const res = await fetch(`${base}/operations/uploadfile?${query.toString()}`, { method: 'POST', headers: headers(), body: form });
      if (!res.ok) throw new AppError(502, 'DRIVE_UPLOAD_FAILED');
    },
  };
}

function isAdmin(identity: SessionResponse): boolean {
  return identity.roles.includes('administrator');
}

function requireAdmin(identity: SessionResponse): void {
  if (!isAdmin(identity)) throw new AppError(403, 'FORBIDDEN');
}

function requireGateway(gateway: DriveGateway | null): DriveGateway {
  if (!gateway) throw new AppError(503, 'DRIVE_NOT_CONFIGURED');
  return gateway;
}

function parsePath(value: unknown): string {
  return drivePathSchema.parse(typeof value === 'string' ? value : '');
}

function splitPath(filePath: string): { dir: string; name: string } {
  const index = filePath.lastIndexOf('/');
  return index === -1 ? { dir: '', name: filePath } : { dir: filePath.slice(0, index), name: filePath.slice(index + 1) };
}

export function driveFileUrl(fileId: string): string {
  return `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view`;
}

const mimeByExtension: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', heic: 'image/heic',
  mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', pdf: 'application/pdf',
};

function guessMime(name: string): string | null {
  return mimeByExtension[name.split('.').pop()?.toLowerCase() ?? ''] ?? null;
}

async function statusesFor(database: Database, ids: string[]): Promise<Map<string, DriveFileStatus>> {
  if (ids.length === 0) return new Map();
  const res = await database.pool.query<{ drive_file_id: string; status: DriveFileStatus }>(
    'SELECT drive_file_id, status FROM drive_file_status WHERE drive_file_id = ANY($1::text[])',
    [ids],
  );
  return new Map(res.rows.map((row) => [row.drive_file_id, row.status]));
}

type LinkRow = {
  drive_file_id: string;
  material_id: string;
  task_id: string | null;
  task_title: string | null;
  demand_id: string | null;
  demand_title: string | null;
  assignee_name: string | null;
};

async function linksFor(database: Database, ids: string[]): Promise<Map<string, DriveEntry['links']>> {
  const map = new Map<string, DriveEntry['links']>();
  if (ids.length === 0) return map;
  const res = await database.pool.query<LinkRow>(
    `SELECT m.drive_file_id, m.id AS material_id, m.task_id, t.title AS task_title, m.demand_id, d.title AS demand_title, u.name AS assignee_name
       FROM material m
       LEFT JOIN task t ON t.id = m.task_id
       LEFT JOIN demand d ON d.id = m.demand_id
       LEFT JOIN auth_user u ON u.id = t.assigned_to_user_id
      WHERE m.archived_at IS NULL AND m.drive_file_id = ANY($1::text[])
      ORDER BY m.created_at`,
    [ids],
  );
  for (const row of res.rows) {
    const list = map.get(row.drive_file_id) ?? [];
    list.push({
      materialId: row.material_id,
      taskId: row.task_id,
      taskTitle: row.task_title,
      demandId: row.demand_id,
      demandTitle: row.demand_title,
      assigneeName: row.assignee_name,
    });
    map.set(row.drive_file_id, list);
  }
  return map;
}

function toEntry(item: GatewayItem, dir: string): Omit<DriveEntry, 'status' | 'links'> {
  return {
    id: item.ID ?? '',
    name: item.Name,
    path: dir ? `${dir}/${item.Name}` : item.Name,
    isDir: item.IsDir,
    size: item.IsDir ? null : item.Size,
    mimeType: item.IsDir ? null : (item.MimeType ?? guessMime(item.Name)),
    modifiedAt: item.ModTime ?? null,
  };
}

async function decorate(database: Database, base: Omit<DriveEntry, 'status' | 'links'>[]): Promise<DriveEntry[]> {
  const ids = base.filter((e) => !e.isDir && e.id).map((e) => e.id);
  const [statuses, links] = await Promise.all([statusesFor(database, ids), linksFor(database, ids)]);
  return base.map((entry) => ({
    ...entry,
    status: entry.isDir ? null : (statuses.get(entry.id) ?? null),
    links: entry.isDir ? [] : (links.get(entry.id) ?? []),
  }));
}

export async function listDrive(
  database: Database,
  gateway: DriveGateway | null,
  identity: SessionResponse,
  rawPath: unknown,
): Promise<DriveListResponse> {
  requireAdmin(identity);
  const dir = parsePath(rawPath);
  if (!gateway) return { configured: false, path: dir, entries: [] };
  const items = await gateway.list(dir);
  const entries = await decorate(database, items.map((item) => toEntry(item, dir)));
  entries.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name, 'pt-BR') : a.isDir ? -1 : 1));
  return { configured: true, path: dir, entries };
}

async function resolveFile(gateway: DriveGateway, filePath: string): Promise<GatewayItem> {
  const { dir, name } = splitPath(filePath);
  const item = (await gateway.list(dir)).find((entry) => !entry.IsDir && entry.Name === name);
  if (!item?.ID) throw new AppError(404, 'NOT_FOUND');
  return item;
}

async function collaboratorCanAccess(database: Database, identity: SessionResponse, fileId: string): Promise<boolean> {
  const res = await database.pool.query(
    `SELECT 1 FROM material m JOIN task t ON t.id = m.task_id
      WHERE m.drive_file_id = $1 AND m.archived_at IS NULL AND t.assigned_to_user_id = $2 LIMIT 1`,
    [fileId, identity.user.id],
  );
  return (res.rowCount ?? 0) > 0;
}

/** Tipos que podem abrir no navegador; o resto sempre baixa (evita HTML/SVG executando na origem do app). */
const INLINE_TYPES = /^(image\/(jpeg|png|gif|webp)|video\/(mp4|webm|quicktime)|audio\/(mpeg|mp4|ogg)|application\/pdf)$/;

export async function openDriveFile(
  database: Database,
  gateway: DriveGateway | null,
  identity: SessionResponse,
  rawPath: unknown,
  range: string | undefined,
  download: boolean,
): Promise<{ status: number; headers: Record<string, string>; body: ReadableStream<Uint8Array> | null }> {
  const drive = requireGateway(gateway);
  const filePath = parsePath(rawPath);
  if (!filePath) throw new AppError(400, 'PATH_REQUIRED');
  const item = await resolveFile(drive, filePath);
  if (!isAdmin(identity) && !(await collaboratorCanAccess(database, identity, item.ID!))) {
    throw new AppError(404, 'NOT_FOUND');
  }
  const upstream = await drive.fetchFile(filePath, range);
  if (!upstream.ok && upstream.status !== 206) throw new AppError(502, 'DRIVE_UNAVAILABLE');
  const mime = item.MimeType ?? guessMime(item.Name) ?? 'application/octet-stream';
  const inline = !download && INLINE_TYPES.test(mime);
  const headers: Record<string, string> = {
    'content-type': inline ? mime : 'application/octet-stream',
    'content-disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(item.Name)}`,
    'cache-control': 'private, max-age=300',
    'accept-ranges': 'bytes',
  };
  for (const key of ['content-length', 'content-range']) {
    const value = upstream.headers.get(key);
    if (value) headers[key] = value;
  }
  return { status: upstream.status === 206 ? 206 : 200, headers, body: upstream.body };
}

export async function setDriveFileStatus(
  database: Database,
  gateway: DriveGateway | null,
  identity: SessionResponse,
  input: SetDriveFileStatusInput,
): Promise<{ fileId: string; status: DriveFileStatus | null }> {
  requireGateway(gateway);
  if (!isAdmin(identity)) {
    // Colaborador marca/desmarca publicação só nos arquivos das próprias tarefas.
    if (input.status === null || !(await collaboratorCanAccess(database, identity, input.fileId))) {
      throw new AppError(403, 'FORBIDDEN');
    }
  }
  if (input.status === null) {
    await database.pool.query('DELETE FROM drive_file_status WHERE drive_file_id = $1', [input.fileId]);
  } else {
    await database.pool.query(
      `INSERT INTO drive_file_status (drive_file_id, status, updated_by_user_id, updated_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (drive_file_id) DO UPDATE SET status = EXCLUDED.status, updated_by_user_id = EXCLUDED.updated_by_user_id, updated_at = now()`,
      [input.fileId, input.status, identity.user.id],
    );
  }
  return { fileId: input.fileId, status: input.status };
}

export async function linkDriveFile(
  database: Database,
  gateway: DriveGateway | null,
  identity: SessionResponse,
  input: LinkDriveFileInput,
) {
  requireAdmin(identity);
  const drive = requireGateway(gateway);
  const item = await resolveFile(drive, input.path);
  const task = await database.pool.query<{ demand_id: string; client_id: string }>(
    'SELECT t.demand_id, d.client_id FROM task t JOIN demand d ON d.id = t.demand_id WHERE t.id = $1',
    [input.taskId],
  );
  const row = task.rows[0];
  if (!row) throw new AppError(404, 'NOT_FOUND');
  const existing = await database.pool.query(
    'SELECT 1 FROM material WHERE drive_file_id = $1 AND task_id = $2 AND archived_at IS NULL',
    [item.ID, input.taskId],
  );
  if ((existing.rowCount ?? 0) > 0) throw new AppError(409, 'ALREADY_LINKED');
  return createMaterial(database, identity, {
    clientId: row.client_id,
    demandId: row.demand_id,
    taskId: input.taskId,
    title: item.Name.slice(0, 200),
    description: `Google Drive: Agent/${input.path}`.slice(0, 4000),
    category: 'drive',
    url: driveFileUrl(item.ID!),
    driveFileId: item.ID!,
    drivePath: input.path,
  });
}

export async function myDriveFiles(database: Database, gateway: DriveGateway | null, identity: SessionResponse): Promise<DriveMyFilesResponse> {
  const res = await database.pool.query<{
    task_id: string; task_title: string; task_status: DriveMyFilesResponse['tasks'][number]['taskStatus'];
    delivery_date: string; demand_id: string; demand_title: string; client_name: string;
    drive_file_id: string; drive_path: string | null; material_id: string; assignee_name: string | null;
  }>(
    `SELECT t.id AS task_id, t.title AS task_title, t.status AS task_status, t.delivery_date::text AS delivery_date,
            d.id AS demand_id, d.title AS demand_title, c.name AS client_name,
            m.drive_file_id, m.drive_path, m.id AS material_id, u.name AS assignee_name
       FROM material m
       JOIN task t ON t.id = m.task_id
       JOIN demand d ON d.id = t.demand_id
       JOIN client c ON c.id = d.client_id
       LEFT JOIN auth_user u ON u.id = t.assigned_to_user_id
      WHERE m.archived_at IS NULL AND m.drive_file_id IS NOT NULL
        AND t.assigned_to_user_id = $1 AND t.status <> 'completed'
      ORDER BY t.delivery_date, t.title, m.drive_path`,
    [identity.user.id],
  );
  const statuses = await statusesFor(database, [...new Set(res.rows.map((r) => r.drive_file_id))]);
  const tasks = new Map<string, DriveMyFilesResponse['tasks'][number]>();
  for (const row of res.rows) {
    const group = tasks.get(row.task_id) ?? {
      taskId: row.task_id, taskTitle: row.task_title, taskStatus: row.task_status, deliveryDate: row.delivery_date,
      demandId: row.demand_id, demandTitle: row.demand_title, clientName: row.client_name, files: [],
    };
    const filePath = row.drive_path ?? '';
    const name = splitPath(filePath).name || row.drive_file_id;
    group.files.push({
      id: row.drive_file_id, name, path: filePath, isDir: false, size: null, mimeType: guessMime(name), modifiedAt: null,
      status: statuses.get(row.drive_file_id) ?? null,
      links: [{ materialId: row.material_id, taskId: row.task_id, taskTitle: row.task_title, demandId: row.demand_id, demandTitle: row.demand_title, assigneeName: row.assignee_name }],
    });
    tasks.set(row.task_id, group);
  }
  return { configured: Boolean(gateway), tasks: [...tasks.values()] };
}

// ---------------- Envio em partes ----------------

function uploadPaths(uploadId: string) {
  const dir = path.join(UPLOAD_DIR, uploadId);
  return { dir, data: path.join(dir, 'data'), meta: path.join(dir, 'meta.json') };
}

type UploadMeta = { userId: string; nextChunk: number; bytes: number; createdAt: number };

export async function receiveUploadChunk(
  identity: SessionResponse,
  uploadId: string,
  chunkIndex: number,
  chunk: Buffer,
): Promise<{ received: number; bytes: number }> {
  requireAdmin(identity);
  if (!/^[0-9a-f-]{36}$/.test(uploadId) || !Number.isInteger(chunkIndex) || chunkIndex < 0) throw new AppError(400, 'VALIDATION_FAILED');
  if (chunk.length === 0 || chunk.length > UPLOAD_CHUNK_BYTES) throw new AppError(400, 'CHUNK_SIZE_INVALID');
  const files = uploadPaths(uploadId);
  let meta: UploadMeta;
  if (chunkIndex === 0) {
    await fsp.rm(files.dir, { recursive: true, force: true });
    await fsp.mkdir(files.dir, { recursive: true, mode: 0o700 });
    meta = { userId: identity.user.id, nextChunk: 0, bytes: 0, createdAt: Date.now() };
  } else {
    meta = JSON.parse(await fsp.readFile(files.meta, 'utf8').catch(() => 'null')) as UploadMeta;
    if (!meta || meta.userId !== identity.user.id) throw new AppError(404, 'UPLOAD_NOT_FOUND');
  }
  if (meta.nextChunk !== chunkIndex) throw new AppError(409, 'CHUNK_OUT_OF_ORDER');
  if (meta.bytes + chunk.length > MAX_UPLOAD_BYTES) throw new AppError(413, 'FILE_TOO_LARGE');
  await fsp.appendFile(files.data, chunk, { mode: 0o600 });
  meta = { ...meta, nextChunk: chunkIndex + 1, bytes: meta.bytes + chunk.length };
  await fsp.writeFile(files.meta, JSON.stringify(meta), { mode: 0o600 });
  return { received: meta.nextChunk, bytes: meta.bytes };
}

function slugify(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

async function md5File(filePath: string): Promise<string> {
  const hash = createHash('md5');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

/** Pasta de destino precisa ser Cliente/Categoria[/Lote], com categoria padrão. */
function validateUploadFolder(folder: string): { client: string } {
  const parts = folder.split('/');
  if (parts.length < 2 || parts.length > 3 || !(DRIVE_CATEGORIES as readonly string[]).includes(parts[1]!)) {
    throw new AppError(400, 'UPLOAD_FOLDER_INVALID');
  }
  return { client: parts[0]! };
}

export async function completeUpload(
  database: Database,
  gateway: DriveGateway | null,
  identity: SessionResponse,
  input: { uploadId: string; folder: string; fileName: string; subject?: string; numbered?: boolean },
): Promise<DriveUploadResponse> {
  requireAdmin(identity);
  const drive = requireGateway(gateway);
  const folder = parsePath(input.folder);
  const { client } = validateUploadFolder(folder);
  const files = uploadPaths(input.uploadId);
  const meta = JSON.parse(await fsp.readFile(files.meta, 'utf8').catch(() => 'null')) as UploadMeta | null;
  if (!meta || meta.userId !== identity.user.id) throw new AppError(404, 'UPLOAD_NOT_FOUND');

  try {
    const digest = await md5File(files.data);
    // Repetido em qualquer lugar da pasta do cliente: não envia de novo.
    const known = await drive.list(client, { recurse: true, hashes: true });
    const duplicate = known.find((item) => !item.IsDir && item.Hashes?.md5 === digest);
    if (duplicate) {
      // Path do rclone é relativo à raiz do remote (Agent/), mesmo listando a pasta do cliente.
      return { uploaded: [], duplicates: [{ name: input.fileName, existingPath: duplicate.Path }] };
    }

    const original = path.basename(input.fileName).replace(/[\\/:*?"<>|\u0000]/g, '-');
    const ext = (path.extname(original).toLowerCase() || '.bin').slice(0, 10);
    const taken = new Set((await drive.list(folder)).filter((i) => !i.IsDir).map((i) => i.Name));
    const today = agencyToday();
    const slug = slugify(input.subject ?? '');
    let base: string;
    if (slug) {
      const pattern = new RegExp(`^${today}_${slug}_(\\d+)\\.`);
      const seq = Math.max(0, ...[...taken].map((name) => Number(pattern.exec(name)?.[1] ?? 0))) + 1;
      base = input.numbered || seq > 1 ? `${today}_${slug}_${String(seq).padStart(2, '0')}` : `${today}_${slug}`;
    } else {
      base = `${today}_${slugify(path.basename(original, path.extname(original))) || 'arquivo'}`;
    }
    let name = `${base}${ext}`;
    for (let n = 2; taken.has(name); n += 1) name = `${base}-${n}${ext}`;

    await drive.upload(folder, name, files.data);
    const created = (await drive.list(folder)).find((item) => !item.IsDir && item.Name === name);
    if (!created) throw new AppError(502, 'DRIVE_UPLOAD_FAILED');
    return { uploaded: await decorate(database, [toEntry(created, folder)]), duplicates: [] };
  } finally {
    await fsp.rm(files.dir, { recursive: true, force: true });
  }
}

/** Remove envios abandonados (sem "complete") há mais de 6 horas. */
export async function pruneStaleUploads(now: number = Date.now()): Promise<void> {
  const entries = await fsp.readdir(UPLOAD_DIR).catch(() => [] as string[]);
  for (const id of entries) {
    const files = uploadPaths(id);
    const meta = JSON.parse(await fsp.readFile(files.meta, 'utf8').catch(() => 'null')) as UploadMeta | null;
    if (!meta || now - meta.createdAt > 6 * 3600_000) await fsp.rm(files.dir, { recursive: true, force: true });
  }
}

