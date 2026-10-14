import { describe, expect, it } from 'vitest';
import {
  verifyHttpSecurityHeaders,
  verifyBackupFreshness,
} from '../../deploy/verification/health-probe-verifier.js';

describe('Phase 10: Health Probes & Backup Freshness Verification (deploy/verification)', () => {
  describe('verifyHttpSecurityHeaders (HTTP / TLS Security Gates)', () => {
    const validWebHeaders = {
      'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    };

    const validApiHeaders = {
      ...validWebHeaders,
      'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    };

    it('approves compliant HTTP security headers for web surface', () => {
      const result = verifyHttpSecurityHeaders(validWebHeaders, 'web');
      expect(result.valid).toBe(true);
      expect(result.violations).toHaveLength(0);
      expect(result.verifiedHeaders['strict-transport-security']).toBe(
        'max-age=31536000; includeSubDomains; preload'
      );
      expect(result.verifiedHeaders['x-frame-options']).toBe('DENY');
    });

    it('approves compliant HTTP security headers for api surface with mandatory CSP', () => {
      const result = verifyHttpSecurityHeaders(validApiHeaders, 'api');
      expect(result.valid).toBe(true);
      expect(result.violations).toHaveLength(0);
      expect(result.verifiedHeaders['content-security-policy']).toBe(
        "default-src 'none'; frame-ancestors 'none'"
      );
    });

    it('handles Fetch Headers instances seamlessly and case-insensitively', () => {
      const fetchHeaders = new Headers();
      fetchHeaders.set('STRICT-TRANSPORT-SECURITY', 'max-age=63072000');
      fetchHeaders.set('x-content-type-options', 'nosniff');
      fetchHeaders.set('X-FRAME-OPTIONS', 'DENY');
      fetchHeaders.set('referrer-policy', 'no-referrer');
      fetchHeaders.set('cache-control', 'no-store');
      fetchHeaders.set('content-security-policy', "default-src 'none'");

      const result = verifyHttpSecurityHeaders(fetchHeaders, 'api');
      expect(result.valid).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it('fails closed when Strict-Transport-Security is missing or lacks max-age', () => {
      const missingHsts = { ...validWebHeaders };
      delete (missingHsts as Record<string, string>)['Strict-Transport-Security'];
      const res1 = verifyHttpSecurityHeaders(missingHsts, 'web');
      expect(res1.valid).toBe(false);
      expect(res1.violations.some((v) => v.includes('Strict-Transport-Security'))).toBe(true);

      const invalidHsts = { ...validWebHeaders, 'Strict-Transport-Security': 'includeSubDomains' };
      const res2 = verifyHttpSecurityHeaders(invalidHsts, 'web');
      expect(res2.valid).toBe(false);
      expect(res2.violations.some((v) => v.includes('max-age'))).toBe(true);
    });

    it('fails closed when X-Content-Type-Options is not nosniff', () => {
      const invalid = { ...validWebHeaders, 'X-Content-Type-Options': 'sniff' };
      const res = verifyHttpSecurityHeaders(invalid, 'web');
      expect(res.valid).toBe(false);
      expect(res.violations.some((v) => v.includes('nosniff'))).toBe(true);
    });

    it('fails closed when X-Frame-Options is not DENY', () => {
      const invalid = { ...validWebHeaders, 'X-Frame-Options': 'SAMEORIGIN' };
      const res = verifyHttpSecurityHeaders(invalid, 'web');
      expect(res.valid).toBe(false);
      expect(res.violations.some((v) => v.includes('DENY'))).toBe(true);
    });

    it('fails closed when Referrer-Policy is not no-referrer', () => {
      const invalid = { ...validWebHeaders, 'Referrer-Policy': 'unsafe-url' };
      const res = verifyHttpSecurityHeaders(invalid, 'web');
      expect(res.valid).toBe(false);
      expect(res.violations.some((v) => v.includes('no-referrer'))).toBe(true);
    });

    it('fails closed when Cache-Control lacks no-store', () => {
      const invalid = { ...validWebHeaders, 'Cache-Control': 'public, max-age=3600' };
      const res = verifyHttpSecurityHeaders(invalid, 'web');
      expect(res.valid).toBe(false);
      expect(res.violations.some((v) => v.includes('no-store'))).toBe(true);
    });

    it('fails closed when Content-Security-Policy is missing on api surface', () => {
      const res = verifyHttpSecurityHeaders(validWebHeaders, 'api');
      expect(res.valid).toBe(false);
      expect(res.violations.some((v) => v.includes('Content-Security-Policy'))).toBe(true);
    });
  });

  describe('verifyBackupFreshness (Gate 6 - Freshness Monitoring)', () => {
    const fixedNowMs = Date.parse('2026-10-14T12:00:00.000Z');
    const validFreshPayload = {
      ok: true,
      stamp: '2026-10-14T11:00:00.000Z', // 1 hora atrás
      latest: 'orium_20261014_110000.dump',
      age_sec: 3600,
      rpo_sec: 86400,
      retention_days: 30,
      retention_mode: 'dryrun',
    };

    it('approves a genuine, fresh backup conforming to RPO and naming contract', () => {
      const res = verifyBackupFreshness(validFreshPayload, 86400, fixedNowMs);
      expect(res.valid).toBe(true);
      expect(res.violations).toHaveLength(0);
      expect(res.ageSeconds).toBe(3600);
      expect(res.rpoSeconds).toBe(86400);
      expect(res.latest).toBe('orium_20261014_110000.dump');
      expect(res.stamp).toBe('2026-10-14T11:00:00.000Z');
    });

    it('fails closed when ok is false (backup failure detected)', () => {
      const failedPayload = { ...validFreshPayload, ok: false };
      const res = verifyBackupFreshness(failedPayload, 86400, fixedNowMs);
      expect(res.valid).toBe(false);
      expect(res.violations.some((v) => v.includes('falha'))).toBe(true);
    });

    it('fails closed when ok is a number (1 or 0) rather than a strict boolean', () => {
      const numericOkPayload1 = { ...validFreshPayload, ok: 1 };
      const res1 = verifyBackupFreshness(numericOkPayload1, 86400, fixedNowMs);
      expect(res1.valid).toBe(false);
      expect(res1.violations.some((v) => v.includes('booleano estrito'))).toBe(true);

      const numericOkPayload0 = { ...validFreshPayload, ok: 0 };
      const res2 = verifyBackupFreshness(numericOkPayload0, 86400, fixedNowMs);
      expect(res2.valid).toBe(false);
      expect(res2.violations.some((v) => v.includes('booleano estrito'))).toBe(true);
    });

    it('fails closed when ok is a string ("true" or "false")', () => {
      const stringOkPayload = { ...validFreshPayload, ok: 'true' };
      const res = verifyBackupFreshness(stringOkPayload, 86400, fixedNowMs);
      expect(res.valid).toBe(false);
      expect(res.violations.some((v) => v.includes('booleano estrito'))).toBe(true);
    });

    it('fails closed when backup is stale (age_sec > rpo_sec)', () => {
      const stalePayload = {
        ...validFreshPayload,
        age_sec: 90000,
        rpo_sec: 86400,
      };
      const res = verifyBackupFreshness(stalePayload, 86400, fixedNowMs);
      expect(res.valid).toBe(false);
      expect(res.violations.some((v) => v.includes('RPO excedido'))).toBe(true);
    });

    it('fails closed when age_sec exceeds maxRpoSeconds limit', () => {
      const stalePayload = {
        ...validFreshPayload,
        age_sec: 4000,
      };
      // limite estrito de 3000s
      const res = verifyBackupFreshness(stalePayload, 3000, fixedNowMs);
      expect(res.valid).toBe(false);
      expect(res.violations.some((v) => v.includes('Tolerância máxima excedida'))).toBe(true);
    });

    it('fails closed when stamp timestamp is expired according to real clock nowMs', () => {
      const expiredStampPayload = {
        ...validFreshPayload,
        stamp: '2026-10-10T12:00:00.000Z', // 4 dias atrás
      };
      const res = verifyBackupFreshness(expiredStampPayload, 86400, fixedNowMs);
      expect(res.valid).toBe(false);
      expect(res.violations.some((v) => v.includes('desatualizado'))).toBe(true);
    });

    it('fails closed when stamp is invalid ISO date', () => {
      const invalidDatePayload = { ...validFreshPayload, stamp: 'data-invalida' };
      const res = verifyBackupFreshness(invalidDatePayload, 86400, fixedNowMs);
      expect(res.valid).toBe(false);
      expect(res.violations.some((v) => v.includes('ISO inválido'))).toBe(true);
    });

    it('fails closed when latest dump filename is corrupted or missing', () => {
      const missingLatest = { ...validFreshPayload, latest: '' };
      const res1 = verifyBackupFreshness(missingLatest, 86400, fixedNowMs);
      expect(res1.valid).toBe(false);
      expect(res1.violations.some((v) => v.includes('obrigatório'))).toBe(true);

      const invalidNaming = { ...validFreshPayload, latest: 'backup_20261014.tar.gz' };
      const res2 = verifyBackupFreshness(invalidNaming, 86400, fixedNowMs);
      expect(res2.valid).toBe(false);
      expect(res2.violations.some((v) => v.includes('canônico'))).toBe(true);
    });

    it('fails closed when payload is null or non-object', () => {
      const resNull = verifyBackupFreshness(null);
      expect(resNull.valid).toBe(false);

      const resArray = verifyBackupFreshness([]);
      expect(resArray.valid).toBe(false);
    });
  });
});
