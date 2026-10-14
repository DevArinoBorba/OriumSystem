import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
export const FORBIDDEN_FILE_PATTERNS = [
    /^\.env(?:\..+)?$/i,
    /(?:^|[\\/])\.env(?:\..+)?$/i,
    /\.(?:pem|key|pkcs8|pfx|p12)$/i,
    /\.(?:dump|dump\.gz|backup|bak)$/i,
    /(?:^|[\\/])(?:tests|test-fixtures|\.local|\.git|node_modules)(?:[\\/]|$)/i,
];
const HEX_64_REGEX = /^[a-f0-9]{64}$/i;
/**
 * Validates a release manifest structure, security allowlist, and hash integrity.
 * Strictly fail-closed: any anomaly, forbidden file, or checksum mismatch causes failure.
 */
export async function validateReleaseManifest(rawInput, baseDirectory) {
    const issues = [];
    if (!rawInput || typeof rawInput !== 'object' || Array.isArray(rawInput)) {
        issues.push({ code: 'SCHEMA_VIOLATION', message: 'Manifesto deve ser um objeto JSON' });
        return { valid: false, issues, verifiedFilesCount: 0 };
    }
    const raw = rawInput;
    // 1. Validação de campos obrigatórios do cabeçalho
    if (raw.manifestVersion !== '1.0') {
        issues.push({ code: 'SCHEMA_VIOLATION', field: 'manifestVersion', message: 'manifestVersion deve ser "1.0"' });
    }
    if (typeof raw.releaseId !== 'string' || raw.releaseId.trim().length === 0) {
        issues.push({ code: 'SCHEMA_VIOLATION', field: 'releaseId', message: 'releaseId é obrigatório' });
    }
    if (typeof raw.version !== 'string' || raw.version.trim().length === 0) {
        issues.push({ code: 'SCHEMA_VIOLATION', field: 'version', message: 'version é obrigatório' });
    }
    if (typeof raw.sourceTreeSHA256 !== 'string' || !HEX_64_REGEX.test(raw.sourceTreeSHA256)) {
        issues.push({
            code: 'SCHEMA_VIOLATION',
            field: 'sourceTreeSHA256',
            message: 'sourceTreeSHA256 é obrigatório e deve conter 64 caracteres hexadecimais (SHA-256)',
        });
    }
    if (raw.gitCommit !== null && raw.gitCommit !== undefined) {
        if (typeof raw.gitCommit !== 'string' || raw.gitCommit.trim().length < 7) {
            issues.push({
                code: 'SCHEMA_VIOLATION',
                field: 'gitCommit',
                message: 'gitCommit deve ser null ou conter hash SHA de ao menos 7 caracteres',
            });
        }
    }
    else if (raw.gitCommit === undefined) {
        issues.push({
            code: 'SCHEMA_VIOLATION',
            field: 'gitCommit',
            message: 'gitCommit é obrigatório (string ou null)',
        });
    }
    if (typeof raw.createdAt !== 'string' || isNaN(Date.parse(raw.createdAt))) {
        issues.push({ code: 'SCHEMA_VIOLATION', field: 'createdAt', message: 'createdAt deve ser uma data ISO válida' });
    }
    if (!['production', 'staging', 'sandbox'].includes(raw.targetEnvironment)) {
        issues.push({ code: 'SCHEMA_VIOLATION', field: 'targetEnvironment', message: 'targetEnvironment deve ser production, staging ou sandbox' });
    }
    if (typeof raw.appImage !== 'string' || raw.appImage.trim().length === 0) {
        issues.push({ code: 'SCHEMA_VIOLATION', field: 'appImage', message: 'appImage é obrigatório' });
    }
    if (typeof raw.targetSchemaVersion !== 'string' || raw.targetSchemaVersion.trim().length === 0) {
        issues.push({ code: 'SCHEMA_VIOLATION', field: 'targetSchemaVersion', message: 'targetSchemaVersion é obrigatório' });
    }
    // 2. Validação de política de rollback
    let rollbackPolicy;
    if (raw.rollbackPolicy !== undefined) {
        if (typeof raw.rollbackPolicy !== 'object' || raw.rollbackPolicy === null) {
            issues.push({ code: 'SCHEMA_VIOLATION', field: 'rollbackPolicy', message: 'rollbackPolicy deve ser um objeto' });
        }
        else {
            const rp = raw.rollbackPolicy;
            if (typeof rp.previousReleaseId !== 'string' || rp.previousReleaseId.trim().length === 0) {
                issues.push({ code: 'SCHEMA_VIOLATION', field: 'rollbackPolicy.previousReleaseId', message: 'previousReleaseId é obrigatório' });
            }
            if (typeof rp.previousVersion !== 'string' || rp.previousVersion.trim().length === 0) {
                issues.push({ code: 'SCHEMA_VIOLATION', field: 'rollbackPolicy.previousVersion', message: 'previousVersion é obrigatório' });
            }
            if (rp.schemaDowngradeAllowed !== false) {
                issues.push({
                    code: 'SCHEMA_VIOLATION',
                    field: 'rollbackPolicy.schemaDowngradeAllowed',
                    message: 'Rollback com downgrade de schema é estritamente proibido por contrato (fail-closed)',
                });
            }
            rollbackPolicy = {
                previousReleaseId: String(rp.previousReleaseId),
                previousVersion: String(rp.previousVersion),
                schemaDowngradeAllowed: false,
            };
        }
    }
    // 3. Validação da lista de arquivos
    if (!Array.isArray(raw.files) || raw.files.length === 0) {
        issues.push({ code: 'SCHEMA_VIOLATION', field: 'files', message: 'Manifesto deve conter ao menos um arquivo na lista files' });
        return { valid: false, issues, verifiedFilesCount: 0 };
    }
    const files = [];
    let verifiedFilesCount = 0;
    for (let idx = 0; idx < raw.files.length; idx++) {
        const f = raw.files[idx];
        const prefix = `files[${idx}]`;
        if (!f || typeof f !== 'object') {
            issues.push({ code: 'SCHEMA_VIOLATION', field: prefix, message: 'Entrada de arquivo inválida' });
            continue;
        }
        if (typeof f.path !== 'string' || f.path.trim().length === 0) {
            issues.push({ code: 'SCHEMA_VIOLATION', field: `${prefix}.path`, message: 'path do arquivo é obrigatório' });
            continue;
        }
        const filePath = f.path.trim();
        if (typeof f.sha256 !== 'string' || !HEX_64_REGEX.test(f.sha256)) {
            issues.push({
                code: 'SCHEMA_VIOLATION',
                field: `${prefix}.sha256`,
                message: `SHA-256 deve ter 64 caracteres hexadecimais para "${filePath}"`,
                file: filePath,
            });
        }
        if (typeof f.sizeBytes !== 'number' || !Number.isInteger(f.sizeBytes) || f.sizeBytes < 0) {
            issues.push({
                code: 'SCHEMA_VIOLATION',
                field: `${prefix}.sizeBytes`,
                message: `sizeBytes deve ser um inteiro não-negativo para "${filePath}"`,
                file: filePath,
            });
        }
        const entry = {
            path: filePath,
            sha256: String(f.sha256 || ''),
            sizeBytes: Number(f.sizeBytes || 0),
        };
        files.push(entry);
        // 4. Validação de Segurança: Bloqueio estrito de segredos, envs e artefatos de teste (Denylist)
        const normalizedPath = filePath.replace(/\\/g, '/');
        for (const pattern of FORBIDDEN_FILE_PATTERNS) {
            if (pattern.test(normalizedPath)) {
                issues.push({
                    code: 'FORBIDDEN_FILE_DETECTED',
                    message: `Arquivo proibido detectado no manifesto de release: "${filePath}". Segredos, .env e fixtures são estritamente vedados em pacotes de publicação.`,
                    file: filePath,
                });
            }
        }
        // 5. Validação de Hash e Integridade Física (se baseDirectory for fornecido)
        if (baseDirectory) {
            const fullPath = path.resolve(baseDirectory, normalizedPath);
            try {
                const stat = await fs.stat(fullPath);
                if (stat.size !== entry.sizeBytes) {
                    issues.push({
                        code: 'FILE_SIZE_MISMATCH',
                        message: `Tamanho divergente para "${filePath}": esperado ${entry.sizeBytes} bytes, encontrado ${stat.size} bytes.`,
                        file: filePath,
                    });
                }
                const fileContent = await fs.readFile(fullPath);
                const actualHash = createHash('sha256').update(fileContent).digest('hex');
                if (actualHash.toLowerCase() !== entry.sha256.toLowerCase()) {
                    issues.push({
                        code: 'CHECKSUM_MISMATCH',
                        message: `Checksum SHA-256 divergente para "${filePath}": esperado ${entry.sha256}, obtido ${actualHash}. Pacote corrompido ou adulterado.`,
                        file: filePath,
                    });
                }
                else {
                    verifiedFilesCount++;
                }
            }
            catch (err) {
                const error = err;
                issues.push({
                    code: 'FILE_NOT_FOUND',
                    message: `Arquivo declarado no manifesto não foi encontrado no pacote: "${filePath}" (${error.message}).`,
                    file: filePath,
                });
            }
        }
    }
    const valid = issues.length === 0;
    const manifest = valid
        ? {
            manifestVersion: '1.0',
            releaseId: String(raw.releaseId),
            version: String(raw.version),
            sourceTreeSHA256: String(raw.sourceTreeSHA256),
            gitCommit: raw.gitCommit === null ? null : String(raw.gitCommit),
            createdAt: String(raw.createdAt),
            targetEnvironment: raw.targetEnvironment,
            appImage: String(raw.appImage),
            targetSchemaVersion: String(raw.targetSchemaVersion),
            files,
            rollbackPolicy,
        }
        : undefined;
    return {
        valid,
        issues,
        manifest,
        verifiedFilesCount,
    };
}
/**
 * Validates rollback specification to guarantee zero schema drop/downgrades.
 */
export function validateRollbackSafety(manifest) {
    if (!manifest.rollbackPolicy) {
        return { safe: true };
    }
    if (manifest.rollbackPolicy.schemaDowngradeAllowed !== false) {
        return {
            safe: false,
            reason: 'Rollback contém política de downgrade de schema ativa, o que viola o princípio de preservação de dados.',
        };
    }
    return { safe: true };
}
/**
 * Carrega um arquivo de manifesto do disco e executa validação estrutural e de integridade dos arquivos empacotados.
 */
export async function validateManifestFile(manifestPath, baseDirectory) {
    try {
        const content = await fs.readFile(manifestPath, 'utf8');
        const raw = JSON.parse(content);
        return await validateReleaseManifest(raw, baseDirectory);
    }
    catch (err) {
        const error = err;
        return {
            valid: false,
            issues: [{ code: 'FILE_READ_ERROR', message: `Falha ao carregar manifesto em "${manifestPath}": ${error.message}` }],
            verifiedFilesCount: 0,
        };
    }
}
