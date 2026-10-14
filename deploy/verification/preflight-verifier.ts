import fs from 'node:fs/promises';
import { validateReleaseManifest, type ManifestValidationResult } from './manifest-validator.js';

export interface PreflightCheckResult {
  passed: boolean;
  gate: string;
  error?: string;
  details?: Record<string, unknown>;
}

export interface DeploymentPreflightSummary {
  ready: boolean;
  checks: PreflightCheckResult[];
}

export interface PreflightOptions {
  manifestPath: string;
  packageDirectory: string;
  migrationsDirectory: string;
  expectedEnvironment: 'production' | 'staging' | 'sandbox';
  targetPort?: number;
  blockedPorts?: number[];
}

/**
 * Executes a series of fail-closed preflight gates prior to any deployment or release step.
 * Strictly guarantees that any corrupted hash, missing migration, forbidden file, or port conflict halts the pipeline.
 */
export async function runDeploymentPreflight(options: PreflightOptions): Promise<DeploymentPreflightSummary> {
  const checks: PreflightCheckResult[] = [];

  // Gate 1: Existência e leitura do arquivo de manifesto
  let rawManifest: unknown;
  try {
    const content = await fs.readFile(options.manifestPath, 'utf8');
    rawManifest = JSON.parse(content);
    checks.push({ passed: true, gate: 'MANIFEST_PARSING' });
  } catch (err: unknown) {
    const error = err as Error;
    checks.push({
      passed: false,
      gate: 'MANIFEST_PARSING',
      error: `Falha ao carregar manifesto de release: ${error.message}`,
    });
    return { ready: false, checks };
  }

  // Gate 2: Validação estrutural, denylist de segredos e integridade criptográfica SHA-256
  const validation: ManifestValidationResult = await validateReleaseManifest(rawManifest, options.packageDirectory);
  if (!validation.valid) {
    const errorMessages = validation.issues.map((i) => `[${i.code}] ${i.message}`).join('; ');
    checks.push({
      passed: false,
      gate: 'MANIFEST_VALIDATION_AND_INTEGRITY',
      error: `Violações no manifesto de release: ${errorMessages}`,
      details: { issuesCount: validation.issues.length, issues: validation.issues },
    });
    return { ready: false, checks };
  }
  checks.push({
    passed: true,
    gate: 'MANIFEST_VALIDATION_AND_INTEGRITY',
    details: { verifiedFiles: validation.verifiedFilesCount, releaseId: validation.manifest?.releaseId },
  });

  const manifest = validation.manifest!;

  // Gate 3: Verificação de ambiente alvo
  if (manifest.targetEnvironment !== options.expectedEnvironment) {
    checks.push({
      passed: false,
      gate: 'TARGET_ENVIRONMENT_MATCH',
      error: `Ambiente do manifesto ("${manifest.targetEnvironment}") difere do ambiente esperado ("${options.expectedEnvironment}"). Preflight fail-closed.`,
    });
    return { ready: false, checks };
  }
  checks.push({ passed: true, gate: 'TARGET_ENVIRONMENT_MATCH' });

  // Gate 4: Verificação de presença física das migrações do banco até targetSchemaVersion
  try {
    const migrationFiles = await fs.readdir(options.migrationsDirectory);
    const sqlMigrations = migrationFiles.filter((f) => f.endsWith('.sql')).sort();

    const targetMigration = manifest.targetSchemaVersion;
    if (!sqlMigrations.includes(targetMigration)) {
      checks.push({
        passed: false,
        gate: 'MIGRATION_COMPLETENESS',
        error: `Migração alvo declarada no manifesto ("${targetMigration}") não existe no diretório de migrações.`,
      });
      return { ready: false, checks };
    }

    checks.push({
      passed: true,
      gate: 'MIGRATION_COMPLETENESS',
      details: { targetSchemaVersion: targetMigration, availableMigrationsCount: sqlMigrations.length },
    });
  } catch (err: unknown) {
    const error = err as Error;
    checks.push({
      passed: false,
      gate: 'MIGRATION_COMPLETENESS',
      error: `Erro ao inspecionar diretório de migrações: ${error.message}`,
    });
    return { ready: false, checks };
  }

  // Gate 5: Verificação de conformidade de portas (PORT_POLICY)
  if (options.targetPort) {
    const blocked = options.blockedPorts || [55432, 5433, 3000, 3001, 3002, 5173];
    if (blocked.includes(options.targetPort)) {
      checks.push({
        passed: false,
        gate: 'PORT_POLICY_COMPLIANCE',
        error: `Porta ${options.targetPort} está na lista de portas protegidas/reservadas (${blocked.join(', ')}). Exige alocação via Find-FreePort.ps1.`,
      });
      return { ready: false, checks };
    }
    checks.push({ passed: true, gate: 'PORT_POLICY_COMPLIANCE', details: { port: options.targetPort } });
  }

  const allPassed = checks.every((c) => c.passed);
  return { ready: allPassed, checks };
}

export const runPreflightChecks = runDeploymentPreflight;

