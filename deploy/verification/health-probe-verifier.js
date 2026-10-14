/**
 * Normaliza qualquer objeto de cabeçalhos (Record ou Fetch Headers) para mapa chave-valor minúsculo.
 */
function normalizeHeaders(rawHeaders) {
    const normalized = {};
    if (!rawHeaders)
        return normalized;
    if (typeof rawHeaders.forEach === 'function') {
        rawHeaders.forEach((value, key) => {
            normalized[key.toLowerCase()] = String(value).trim();
        });
        return normalized;
    }
    for (const [k, v] of Object.entries(rawHeaders)) {
        if (v === undefined || v === null)
            continue;
        const lowerKey = k.toLowerCase();
        const valStr = Array.isArray(v) ? v.join(', ') : String(v);
        normalized[lowerKey] = valStr.trim();
    }
    return normalized;
}
/**
 * Validação fail-closed dos cabeçalhos de segurança HTTP/TLS em superfícies web e api.
 * Exige:
 * - strict-transport-security (contendo max-age)
 * - x-content-type-options: nosniff
 * - x-frame-options: DENY
 * - referrer-policy: no-referrer
 * - cache-control: contendo no-store
 * - content-security-policy (mandatório na superfície api)
 */
export function verifyHttpSecurityHeaders(rawHeaders, surface) {
    const violations = [];
    const headers = normalizeHeaders(rawHeaders);
    const verifiedHeaders = {};
    // 1. Strict-Transport-Security (HSTS)
    const hsts = headers['strict-transport-security'];
    if (!hsts) {
        violations.push('Cabeçalho "Strict-Transport-Security" ausente.');
    }
    else if (!/max-age=\d+/i.test(hsts)) {
        violations.push(`Cabeçalho "Strict-Transport-Security" inválido: deve conter diretiva max-age (obtido: "${hsts}").`);
    }
    else {
        verifiedHeaders['strict-transport-security'] = hsts;
    }
    // 2. X-Content-Type-Options
    const xcto = headers['x-content-type-options'];
    if (!xcto) {
        violations.push('Cabeçalho "X-Content-Type-Options" ausente.');
    }
    else {
        const tokens = xcto.toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
        if (tokens.length === 0 || tokens.some((t) => t !== 'nosniff')) {
            violations.push(`Cabeçalho "X-Content-Type-Options" inválido: esperado "nosniff" (obtido: "${xcto}").`);
        }
        else {
            verifiedHeaders['x-content-type-options'] = xcto;
        }
    }
    // 3. X-Frame-Options
    const xfo = headers['x-frame-options'];
    if (!xfo) {
        violations.push('Cabeçalho "X-Frame-Options" ausente.');
    }
    else {
        const tokens = xfo.toUpperCase().split(',').map((s) => s.trim()).filter(Boolean);
        if (tokens.length === 0 || tokens.some((t) => t !== 'DENY')) {
            violations.push(`Cabeçalho "X-Frame-Options" inválido: esperado "DENY" (obtido: "${xfo}").`);
        }
        else {
            verifiedHeaders['x-frame-options'] = xfo;
        }
    }
    // 4. Referrer-Policy
    const rp = headers['referrer-policy'];
    if (!rp) {
        violations.push('Cabeçalho "Referrer-Policy" ausente.');
    }
    else {
        const tokens = rp.toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
        if (tokens.length === 0 || tokens.some((t) => t !== 'no-referrer')) {
            violations.push(`Cabeçalho "Referrer-Policy" inválido: esperado "no-referrer" (obtido: "${rp}").`);
        }
        else {
            verifiedHeaders['referrer-policy'] = rp;
        }
    }
    // 5. Cache-Control
    const cc = headers['cache-control'];
    if (!cc) {
        violations.push('Cabeçalho "Cache-Control" ausente.');
    }
    else if (!cc.toLowerCase().includes('no-store')) {
        violations.push(`Cabeçalho "Cache-Control" deve conter a diretiva "no-store" para superfícies seguras (obtido: "${cc}").`);
    }
    else {
        verifiedHeaders['cache-control'] = cc;
    }
    // 6. Content-Security-Policy (mandatório em api)
    const csp = headers['content-security-policy'];
    if (surface === 'api') {
        if (!csp || csp.trim().length === 0) {
            violations.push('Cabeçalho "Content-Security-Policy" obrigatório ausente na superfície "api".');
        }
        else {
            verifiedHeaders['content-security-policy'] = csp;
        }
    }
    else if (csp) {
        verifiedHeaders['content-security-policy'] = csp;
    }
    return {
        valid: violations.length === 0,
        violations,
        verifiedHeaders,
    };
}
const DUMP_FILENAME_REGEX = /^orium_.+\.dump$/i;
/**
 * Validação fail-closed do estado de monitoramento de frescor (freshness) do backup.
 * Atende ao Gate 6 do contrato ("Monitorar falha de backup e falta de freshness, não só saúde HTTP").
 *
 * Regras estritas:
 * - ok === true (booleano estrito; rejeita false, números 1/0 e strings)
 * - stamp deve ser string ISO válida
 * - age_sec <= rpo_sec
 * - age_sec <= maxRpoSeconds (default: 86400s / 24h)
 * - latest deve coincidir com regex ^orium_.+\.dump$
 */
export function verifyBackupFreshness(rawPayload, maxRpoSeconds = 86400, nowMs = Date.now()) {
    const violations = [];
    if (!rawPayload || typeof rawPayload !== 'object' || Array.isArray(rawPayload)) {
        return {
            valid: false,
            violations: ['Payload de freshness inválido: deve ser um objeto JSON não-nulo.'],
        };
    }
    const payload = rawPayload;
    // 1. Validação estrita do booleano ok (rejeita 1, 0, strings ou ausência)
    if (typeof payload.ok !== 'boolean') {
        violations.push(`Campo "ok" inválido ou ambíguo: esperado booleano estrito true (obtido: ${typeof payload.ok} ${JSON.stringify(payload.ok)}). Valores numéricos 1/0 são estritamente rejeitados.`);
    }
    else if (payload.ok !== true) {
        violations.push('Monitoramento indica falha no backup: "ok" é false.');
    }
    // 2. Validação do timestamp ISO (stamp)
    let parsedStampMs = 0;
    if (typeof payload.stamp !== 'string' || payload.stamp.trim().length === 0) {
        violations.push('Campo "stamp" ausente ou inválido: deve ser string ISO 8601.');
    }
    else {
        parsedStampMs = Date.parse(payload.stamp);
        if (isNaN(parsedStampMs)) {
            violations.push(`Campo "stamp" contém formato de data ISO inválido: "${payload.stamp}".`);
        }
    }
    // 3. Validação do nome do arquivo mais recente (latest)
    if (typeof payload.latest !== 'string' || payload.latest.trim().length === 0) {
        violations.push('Campo "latest" ausente ou vazio: nome do dump de backup obrigatório.');
    }
    else if (!DUMP_FILENAME_REGEX.test(payload.latest.trim())) {
        violations.push(`Campo "latest" inválido: "${payload.latest}" não segue o padrão canônico "^orium_.+\\.dump$".`);
    }
    // 4. Validação do age_sec
    if (typeof payload.age_sec !== 'number' || !Number.isFinite(payload.age_sec) || payload.age_sec < 0) {
        violations.push(`Campo "age_sec" inválido: deve ser número não-negativo (obtido: ${JSON.stringify(payload.age_sec)}).`);
    }
    // 5. Validação do rpo_sec
    if (typeof payload.rpo_sec !== 'number' || !Number.isFinite(payload.rpo_sec) || payload.rpo_sec <= 0) {
        violations.push(`Campo "rpo_sec" inválido: deve ser número estritamente positivo (obtido: ${JSON.stringify(payload.rpo_sec)}).`);
    }
    const ageSeconds = typeof payload.age_sec === 'number' ? payload.age_sec : undefined;
    const rpoSeconds = typeof payload.rpo_sec === 'number' ? payload.rpo_sec : undefined;
    // 6. Checagem de RPO (RPO contratual do payload)
    if (ageSeconds !== undefined && rpoSeconds !== undefined) {
        if (ageSeconds > rpoSeconds) {
            violations.push(`RPO excedido: idade do backup (${ageSeconds}s) é superior ao RPO configurado (${rpoSeconds}s). Backup STALE.`);
        }
    }
    // 7. Checagem de maxRpoSeconds (limite máximo de tolerância)
    if (ageSeconds !== undefined && ageSeconds > maxRpoSeconds) {
        violations.push(`Tolerância máxima excedida: idade do backup (${ageSeconds}s) supera maxRpoSeconds (${maxRpoSeconds}s).`);
    }
    // 8. Checagem de tempo real contra stamp e nowMs
    if (parsedStampMs > 0) {
        const elapsedFromStampSec = Math.floor((nowMs - parsedStampMs) / 1000);
        if (elapsedFromStampSec > maxRpoSeconds) {
            violations.push(`Timestamp do relatório desatualizado: stamp emitido há ${elapsedFromStampSec}s, superando o RPO máximo de ${maxRpoSeconds}s.`);
        }
    }
    return {
        valid: violations.length === 0,
        violations,
        ageSeconds,
        rpoSeconds,
        latest: typeof payload.latest === 'string' ? payload.latest : undefined,
        stamp: typeof payload.stamp === 'string' ? payload.stamp : undefined,
    };
}
