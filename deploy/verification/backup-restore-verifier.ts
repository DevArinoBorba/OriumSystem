import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';

export const CANONICAL_ROLE_PERMISSIONS_HASH = '9673b3ccf9d31ad30177ad4ba3ed1a7bbb62ef1cd2385d9827d3599c3c96195a';
export const EXPECTED_PERMISSIONS_COUNT = 23;

export const FORBIDDEN_RESTORE_PORTS = [55432, 5433, 5432];
export const FORBIDDEN_RESTORE_DB_NAMES = [
  'orium_dev',
  'orium_test',
  'orium_production',
  'orium_prod',
  'postgres',
  'template0',
  'template1',
];

export const MANDATORY_APPLICATION_TABLES = [
  'auth_user',
  'auth_account',
  'auth_session',
  'auth_verification',
  'role',
  'permission',
  'role_permission',
  'user_role',
  'client',
  'demand',
  'demand_event',
  'task',
  'task_requirement',
  'task_dependency',
  'task_comment',
  'material',
  'material_event',
  'notification',
  'identity_event',
  'identity_event_subject',
];

export interface IsolationCheckResult {
  isIsolated: boolean;
  port: number;
  dbName: string;
  host: string;
  violations: string[];
}

export interface ContainerRuntimeIsolationCheck {
  containerId: string;
  labels: Record<string, string>;
  volumeName?: string;
  hostPort?: number;
}

export interface RuntimeIsolationResult {
  isIsolated: boolean;
  violations: string[];
}

export interface BackupArtifactVerification {
  valid: boolean;
  filePath: string;
  sizeBytes: number;
  sha256: string;
  violations: string[];
}

export interface RestoreVerificationResult {
  restoredSuccessfully: boolean;
  tablesVerified: boolean;
  missingTables: string[];
  grantsCount: number;
  grantsFingerprint: string;
  grantsMatchCanonical: boolean;
  violations: string[];
}

/**
 * Sanitiza URLs de banco de dados para nunca expor senhas em erros ou logs.
 */
export function sanitizeDbUrl(url: URL | string): string {
  try {
    const clone = new URL(typeof url === 'string' ? url : url.toString());
    if (clone.password) {
      clone.password = '***';
    }
    return clone.toString();
  } catch {
    return '[url-invalida]';
  }
}

/**
 * Valida se uma URL de conexão aponta para um banco de dados rigorosamente isolado.
 * Regras estritas:
 * - Protocolo deve ser postgres: ou postgresql:
 * - Porta NÃO pode ser DEV (55432), TEST (5433) ou default compartilhado (5432)
 * - Nome do banco NÃO pode ser base ativa (orium_dev, orium_test, orium_production, orium_prod, postgres, etc.)
 * - Nome deve possuir prefixo de sandbox (sandbox_ ou orium_sandbox_)
 * - Erros NUNCA imprimem a URL crua contendo credenciais
 */
export function assertDatabaseIsolation(rawUrl: string): IsolationCheckResult {
  const violations: string[] = [];
  let parsed: URL;

  try {
    parsed = new URL(rawUrl);
  } catch (err: unknown) {
    const error = err as Error;
    return {
      isIsolated: false,
      port: 0,
      dbName: '',
      host: '',
      violations: [`URL de banco de dados inválida (formato incorreto): ${error.message}`],
    };
  }

  // 1. Rejeição estrita de protocolos não-postgres
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    violations.push(`Protocolo "${parsed.protocol}" inválido. Conexão deve usar "postgres:" ou "postgresql:".`);
  }

  const port = parseInt(parsed.port || '5432', 10);
  const dbName = parsed.pathname.replace(/^\//, '');
  const host = parsed.hostname;

  // 2. Proibição absoluta de portas DEV, TEST e default
  if (FORBIDDEN_RESTORE_PORTS.includes(port)) {
    violations.push(
      `VIOLAÇÃO GRAVE: A porta ${port} é reservada/ativa (${port === 55432 ? 'orium_dev' : port === 5433 ? 'orium_test' : 'default_postgres'}). Restore é estritamente proibido nesta porta.`
    );
  }

  // 3. Proibição absoluta de nomes de bancos reservados/ativos
  if (FORBIDDEN_RESTORE_DB_NAMES.includes(dbName.toLowerCase())) {
    violations.push(
      `VIOLAÇÃO GRAVE: O banco de dados "${dbName}" é uma base ativa reservada ou de sistema. Restore permitido apenas em bancos efêmeros de sandbox.`
    );
  }

  // 4. Validação de host local para sandbox
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(host)) {
    violations.push(`Host de teste "${host}" deve ser estritamente local (127.0.0.1 ou localhost).`);
  }

  // 5. Exigência de prefixo explícito de sandbox para evitar colisões
  if (!dbName.startsWith('sandbox_') && !dbName.startsWith('orium_sandbox')) {
    violations.push(`O banco de dados de restore deve possuir o prefixo "sandbox_" ou "orium_sandbox" para atestar isolamento comprovado.`);
  }

  const isIsolated = violations.length === 0;
  return {
    isIsolated,
    port,
    dbName,
    host,
    violations,
  };
}

/**
 * Valida o isolamento de runtime de um container PostgreSQL antes da execução de restore.
 * Exige verificação real de labels do container, IDs proibidos e volumes efêmeros.
 */
export function verifyRuntimeContainerIsolation(
  runtimeInfo: ContainerRuntimeIsolationCheck,
  forbiddenContainerIds: string[] = []
): RuntimeIsolationResult {
  const violations: string[] = [];

  // 1. Verificação de ID de container proibido (não pode ser DEV nem TEST)
  if (forbiddenContainerIds.includes(runtimeInfo.containerId)) {
    violations.push(`VIOLAÇÃO CRÍTICA: Container ID ${runtimeInfo.containerId} corresponde a um container ativo protegido (DEV/TEST). Operação abortada.`);
  }

  // 2. Verificação de labels obrigatórias do sandbox QA
  const labels = runtimeInfo.labels || {};
  if (labels.project !== 'orium') {
    violations.push(`Label "project" deve ser "orium" (obtido: "${labels.project || 'ausente'}").`);
  }
  if (labels.phase !== '10') {
    violations.push(`Label "phase" deve ser "10" (obtido: "${labels.phase || 'ausente'}").`);
  }
  if (labels.role !== 'qa-sandbox') {
    violations.push(`Label "role" deve ser "qa-sandbox" (obtido: "${labels.role || 'ausente'}").`);
  }

  // 3. Verificação de volume efêmero dedicado
  if (runtimeInfo.volumeName) {
    if (!runtimeInfo.volumeName.startsWith('orium-qa-sandbox-vol-')) {
      violations.push(`Volume "${runtimeInfo.volumeName}" deve ter prefixo "orium-qa-sandbox-vol-" para garantir ciclo de vida efêmero.`);
    }
    if (['orium-dev', 'orium-test'].includes(runtimeInfo.volumeName)) {
      violations.push(`VIOLAÇÃO CRÍTICA: Tentativa de montar volume protegido do projeto ("${runtimeInfo.volumeName}").`);
    }
  }

  // 4. Verificação de porta
  if (runtimeInfo.hostPort && FORBIDDEN_RESTORE_PORTS.includes(runtimeInfo.hostPort)) {
    violations.push(`Porta mapeada ${runtimeInfo.hostPort} está na lista de portas proibidas.`);
  }

  return {
    isIsolated: violations.length === 0,
    violations,
  };
}

/**
 * Verifies a backup file artifact's existence, integrity, and safety prior to execution.
 */
export async function verifyBackupArtifact(
  filePath: string,
  expectedChecksum?: string
): Promise<BackupArtifactVerification> {
  const violations: string[] = [];
  let sizeBytes = 0;
  let sha256 = '';

  try {
    const stat = await fs.stat(filePath);
    sizeBytes = stat.size;
    if (sizeBytes === 0) {
      violations.push('Arquivo de backup está vazio (0 bytes).');
    }

    const content = await fs.readFile(filePath);
    sha256 = createHash('sha256').update(content).digest('hex');

    if (expectedChecksum && sha256.toLowerCase() !== expectedChecksum.toLowerCase()) {
      violations.push(`Checksum do backup diverge do esperado: obtido ${sha256}, esperado ${expectedChecksum}.`);
    }

    // Inspeção básica de texto se não for binário
    const sample = content.slice(0, 16384).toString('utf8');
    const dangerousCommands = [
      { pattern: /DROP\s+DATABASE\s+(?:IF\s+EXISTS\s+)?(?:orium_dev|orium_test|orium_production)/i, desc: 'DROP DATABASE contra base ativa' },
      { pattern: /ALTER\s+SYSTEM/i, desc: 'ALTER SYSTEM proibido em dump' },
    ];

    for (const cmd of dangerousCommands) {
      if (cmd.pattern.test(sample)) {
        violations.push(`Comando perigoso detectado no cabeçalho do dump de backup: ${cmd.desc}`);
      }
    }
  } catch (err: unknown) {
    const error = err as Error;
    violations.push(`Falha ao ler arquivo de backup: ${error.message}`);
  }

  return {
    valid: violations.length === 0,
    filePath,
    sizeBytes,
    sha256,
    violations,
  };
}

/**
 * Validates the schema and grants of a restored database instance.
 */
export async function verifyRestoredDatabaseSchema(
  queryFn: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>
): Promise<RestoreVerificationResult> {
  const violations: string[] = [];

  // 1. Verificar se todas as tabelas essenciais existem
  const tablesRes = await queryFn(
    `SELECT table_name FROM information_schema.tables 
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`
  );
  const existingTables = new Set((tablesRes.rows as Array<{ table_name: string }>).map((r) => r.table_name));

  const missingTables = MANDATORY_APPLICATION_TABLES.filter((t) => !existingTables.has(t));
  if (missingTables.length > 0) {
    violations.push(`Tabelas essenciais ausentes após o restore: ${missingTables.join(', ')}`);
  }

  // 2. Verificar os grants de role_permission
  let grantsCount = 0;
  let grantsFingerprint = '';
  let grantsMatchCanonical = false;

  try {
    const grantsRes = await queryFn(
      `SELECT role_id, permission_id FROM role_permission 
       ORDER BY role_id, permission_id`
    );
    const rows = grantsRes.rows as Array<{ role_id: string; permission_id: string }>;
    grantsCount = rows.length;

    grantsFingerprint = createHash('sha256').update(JSON.stringify(rows)).digest('hex');
    grantsMatchCanonical =
      grantsCount === EXPECTED_PERMISSIONS_COUNT && grantsFingerprint === CANONICAL_ROLE_PERMISSIONS_HASH;

    if (!grantsMatchCanonical) {
      violations.push(
        `Grants divergentes após restore: contagem ${grantsCount} (esperado ${EXPECTED_PERMISSIONS_COUNT}), hash ${grantsFingerprint} (esperado ${CANONICAL_ROLE_PERMISSIONS_HASH})`
      );
    }
  } catch (err: unknown) {
    const error = err as Error;
    violations.push(`Erro ao consultar permissões em role_permission: ${error.message}`);
  }

  const restoredSuccessfully = violations.length === 0;

  return {
    restoredSuccessfully,
    tablesVerified: missingTables.length === 0,
    missingTables,
    grantsCount,
    grantsFingerprint,
    grantsMatchCanonical,
    violations,
  };
}
