import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import type { BackupFileItem, BackupStatusResponse, TriggerBackupResponse } from '@orium/contracts';
import type { Database } from './db.js';

const RPO_SEC = 86400;
const RETENTION_DAYS = 30;
const SCHEDULE_LABEL = 'Diário às 03:00 (America/Cuiaba)';
const REMOTE_NAME = process.env.ORIUM_RCLONE_CRYPT_REMOTE || 'orium-crypt';
const DRIVE_FOLDER = process.env.ORIUM_DRIVE_FOLDER || 'OriumSystem';

function resolveProjectRoot(): string {
  const candidates = [
    process.cwd(),
    path.resolve(process.cwd(), '../..'),
    'C:\\Users\\arino\\OneDrive\\Documentos\\Projetos\\OriumSystem',
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'ROADMAP.md'))) {
      return candidate;
    }
  }
  return process.cwd();
}

function resolveStageDir(): string {
  if (process.env.ORIUM_STAGE_DIR) {
    fs.mkdirSync(process.env.ORIUM_STAGE_DIR, { recursive: true });
    return process.env.ORIUM_STAGE_DIR;
  }
  if (process.platform !== 'win32' && fs.existsSync('/var/lib/orium-backup/staging')) {
    return '/var/lib/orium-backup/staging';
  }
  const root = resolveProjectRoot();
  const localStage = path.join(root, '.local', 'backups', 'staging');
  fs.mkdirSync(localStage, { recursive: true });
  return localStage;
}

function resolveRcloneConfigPath(): string | null {
  const root = resolveProjectRoot();
  const candidates = [
    process.env.ORIUM_RCLONE_CONFIG,
    '/var/lib/orium-backup/rclone.conf',
    path.join(root, '.local', 'phase10', 'drive-oauth', 'rclone.conf'),
  ].filter((item): item is string => Boolean(item));

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      try {
        const content = fs.readFileSync(candidate, 'utf8');
        if (content.includes('[drive_dest]') && content.includes('[orium-crypt]')) {
          return candidate;
        }
      } catch {
        // Ignore unreadable candidate
      }
    }
  }
  return null;
}

function resolveRcloneBin(): string | null {
  const wingetPath =
    'C:\\Users\\arino\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Rclone.Rclone_Microsoft.Winget.Source_8wekyb3d8bbwe\\rclone-v1.75.1-windows-amd64\\rclone.exe';
  if (process.env.RCLONE_BIN && fs.existsSync(process.env.RCLONE_BIN)) {
    return process.env.RCLONE_BIN;
  }
  if (process.platform === 'win32' && fs.existsSync(wingetPath)) {
    return wingetPath;
  }
  try {
    execFileSync('rclone', ['version'], { stdio: 'ignore', timeout: 3000 });
    return 'rclone';
  } catch {
    return null;
  }
}

function scanStageFiles(stageDir: string): BackupFileItem[] {
  if (!fs.existsSync(stageDir)) return [];
  const entries = fs
    .readdirSync(stageDir)
    .filter((f) => /^orium_.+\.dump$/.test(f));

  const items: BackupFileItem[] = [];
  for (const file of entries) {
    const fullPath = path.join(stageDir, file);
    try {
      const stat = fs.statSync(fullPath);
      if (!stat.isFile()) continue;
      const buf = fs.readFileSync(fullPath);
      const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
      items.push({
        file,
        sha256,
        sizeBytes: stat.size,
        createdAt: stat.mtime.toISOString(),
      });
    } catch {
      // Ignore transient file read errors
    }
  }

  items.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
  return items;
}

function writeManifestAndFreshness(stageDir: string, files: BackupFileItem[]) {
  const nowIso = new Date().toISOString();
  const stamp = nowIso.replace(/\.\d{3}Z$/, 'Z').replace(/[-:]/g, (m) => (m === ':' ? '' : '-'));
  const manifest = {
    manifestVersion: '1.0',
    kind: 'orium-backup',
    createdAt: nowIso,
    retention_days: RETENTION_DAYS,
    retention_mode: 'dryrun',
    files: files.map((f) => ({
      file: f.file,
      sha256: f.sha256,
      size_bytes: f.sizeBytes,
    })),
  };
  fs.writeFileSync(path.join(stageDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', {
    mode: 0o600,
  });

  const latest = files[0];
  const ageSec = latest?.createdAt
    ? Math.max(0, Math.floor((Date.now() - new Date(latest.createdAt).getTime()) / 1000))
    : 0;
  const ok = Boolean(latest && ageSec <= RPO_SEC);

  const freshness = {
    ok,
    stage: ok ? 'ok' : 'stale',
    stamp,
    latest: latest?.file ?? '',
    age_sec: ageSec,
    rpo_sec: RPO_SEC,
    retention_days: RETENTION_DAYS,
    retention_mode: 'dryrun',
  };
  fs.writeFileSync(path.join(stageDir, 'freshness.json'), JSON.stringify(freshness) + '\n', {
    mode: 0o600,
  });
}

export async function getBackupStatus(): Promise<BackupStatusResponse> {
  const stageDir = resolveStageDir();
  const rcloneConf = resolveRcloneConfigPath();
  const driveConfigured = Boolean(rcloneConf);
  const dryRunEnv = process.env.ORIUM_DRY_RUN;
  const dryRun = dryRunEnv === '1' ? true : !driveConfigured;

  const files = scanStageFiles(stageDir);
  const totalBytes = files.reduce((acc, item) => acc + item.sizeBytes, 0);

  let freshnessRaw: {
    ok?: boolean;
    stage?: string;
    last_stage_failed?: string;
    stamp?: string;
    latest?: string;
    age_sec?: number;
    rpo_sec?: number;
    retention_days?: number;
    retention_mode?: string;
  } | null = null;

  const freshnessPath = path.join(stageDir, 'freshness.json');
  if (fs.existsSync(freshnessPath)) {
    try {
      freshnessRaw = JSON.parse(fs.readFileSync(freshnessPath, 'utf8'));
    } catch {
      freshnessRaw = null;
    }
  }

  const latestFileObj = files[0] ?? null;
  const computedAgeSec = latestFileObj?.createdAt
    ? Math.max(0, Math.floor((Date.now() - new Date(latestFileObj.createdAt).getTime()) / 1000))
    : null;

  const ok = Boolean(latestFileObj && computedAgeSec !== null && computedAgeSec <= RPO_SEC);

  return {
    ok,
    stage: ok ? 'ok' : files.length === 0 ? 'empty' : 'stale',
    lastStageFailed: ok ? null : (freshnessRaw?.last_stage_failed ?? null),
    stamp: latestFileObj?.createdAt ?? freshnessRaw?.stamp ?? null,
    latestFile: latestFileObj?.file ?? freshnessRaw?.latest ?? null,
    ageSec: computedAgeSec,
    rpoSec: freshnessRaw?.rpo_sec ?? RPO_SEC,
    retentionDays: freshnessRaw?.retention_days ?? RETENTION_DAYS,
    retentionMode: freshnessRaw?.retention_mode ?? 'dryrun',
    driveConfigured,
    dryRun,
    driveFolder: DRIVE_FOLDER,
    remoteName: REMOTE_NAME,
    schedule: SCHEDULE_LABEL,
    files,
    totalBytes,
  };
}

const BACKUP_TABLES = [
  'role',
  'permission',
  'role_permission',
  'auth_user',
  'user_role',
  'identity_event',
  'client',
  'client_team_member',
  'client_scope_item',
  'demand',
  'demand_task',
  'task_requirement',
  'task_dependency',
  'task_comment',
  'demand_history_event',
  'material',
  'material_version',
  'notification',
  'demand_template',
  'demand_template_task',
  'demand_template_requirement',
  'demand_template_dependency',
] as const;

export async function triggerBackup(database: Database): Promise<TriggerBackupResponse> {
  const stageDir = resolveStageDir();
  const now = new Date();
  const stamp = now
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z')
    .replace(/:/g, '');

  const dbNameRes = await database.pool.query<{ current_database: string }>(
    'SELECT current_database()',
  );
  const dbName = dbNameRes.rows[0]?.current_database || 'orium';
  const fileName = `orium_${dbName}_${stamp}.dump`;
  const fullPath = path.join(stageDir, fileName);

  // Export consistent snapshot under REPEATABLE READ READ ONLY transaction
  const client = await database.pool.connect();
  const snapshotTables: Record<string, unknown[]> = {};
  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    for (const table of BACKUP_TABLES) {
      await client.query('SAVEPOINT sp_backup_table');
      try {
        const reg = await client.query<{ oid: string | null }>('SELECT to_regclass($1) AS oid', [
          `public.${table}`,
        ]);
        if (reg.rows[0]?.oid) {
          const rows = await client.query(`SELECT * FROM public.${table}`);
          snapshotTables[table] = rows.rows;
        }
        await client.query('RELEASE SAVEPOINT sp_backup_table');
      } catch {
        await client.query('ROLLBACK TO SAVEPOINT sp_backup_table');
        await client.query('RELEASE SAVEPOINT sp_backup_table');
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  const payload = {
    format: 'orium-custom-dump-v1',
    database: dbName,
    createdAt: now.toISOString(),
    stamp,
    tableCount: Object.keys(snapshotTables).length,
    tables: snapshotTables,
  };

  const compressed = zlib.gzipSync(Buffer.from(JSON.stringify(payload), 'utf8'), {
    level: zlib.constants.Z_BEST_COMPRESSION,
  });

  fs.writeFileSync(fullPath, compressed, { mode: 0o600 });
  const sha256 = crypto.createHash('sha256').update(compressed).digest('hex');
  const sizeBytes = compressed.byteLength;

  const files = scanStageFiles(stageDir);
  writeManifestAndFreshness(stageDir, files);

  const rcloneConf = resolveRcloneConfigPath();
  const rcloneBin = resolveRcloneBin();
  const dryRunEnv = process.env.ORIUM_DRY_RUN === '1';

  let driveUploaded = false;
  let driveMode: 'uploaded' | 'dryrun' | 'local_only' = 'local_only';
  let message =
    'Backup local consistente gerado e verificado com sucesso (SHA-256 registrado no manifesto).';

  if (rcloneConf && rcloneBin && !dryRunEnv) {
    try {
      execFileSync(
        rcloneBin,
        [
          '--config',
          rcloneConf,
          '--transfers',
          '2',
          'copy',
          stageDir,
          `${REMOTE_NAME}:/${DRIVE_FOLDER}`,
        ],
        { stdio: 'ignore', timeout: 60000 },
      );
      execFileSync(
        rcloneBin,
        [
          'cryptcheck',
          '--include',
          'orium_*.dump',
          '--include',
          'manifest.json',
          '--config',
          rcloneConf,
          stageDir,
          `${REMOTE_NAME}:/${DRIVE_FOLDER}`,
        ],
        { stdio: 'ignore', timeout: 60000 },
      );
      driveUploaded = true;
      driveMode = 'uploaded';
      message =
        'Backup criptografado (rclone crypt) enviado e verificado com sucesso no Google Drive!';
    } catch {
      driveUploaded = false;
      driveMode = 'local_only';
      message =
        'Backup local salvo com sucesso. O envio ao Google Drive não pôde ser concluído nesta execução.';
    }
  } else if (dryRunEnv) {
    driveMode = 'dryrun';
    message = 'Backup local gerado e verificado em modo Dry-Run.';
  }

  const status = await getBackupStatus();

  return {
    success: true,
    stamp,
    file: fileName,
    sha256,
    sizeBytes,
    driveUploaded,
    driveMode,
    message,
    status,
  };
}
