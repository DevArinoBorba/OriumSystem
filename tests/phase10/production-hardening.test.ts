import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig, PRODUCTION_ORIGIN_ALLOWLIST } from '../../apps/api/src/config.js';

describe('Phase 10: Production Hardening & Staging Support', () => {
  const baseValidProdEnv: NodeJS.ProcessEnv = {
    NODE_ENV: 'production',
    API_HOST: '0.0.0.0',
    API_PORT: '3001',
    API_ORIGIN: 'https://app.oriumdigital.tech',
    WEB_ORIGIN: 'https://app.oriumdigital.tech',
    DATABASE_URL: 'postgresql://orium_app:somepassword@postgres:5432/orium_prod',
    BETTER_AUTH_SECRET: 'super-secure-production-secret-min-32-chars-length',
    LOG_LEVEL: 'info',
  };

  describe('apps/api/src/config.ts - loadConfig in production and staging', () => {
    it('exports the canonical production origin allowlist with app and staging', () => {
      expect(PRODUCTION_ORIGIN_ALLOWLIST).toEqual([
        'https://app.oriumdigital.tech',
        'https://staging.oriumdigital.tech',
      ]);
    });

    it('approves production config with https://app.oriumdigital.tech', () => {
      const config = loadConfig(baseValidProdEnv);
      expect(config.NODE_ENV).toBe('production');
      expect(config.API_HOST).toBe('0.0.0.0');
      expect(config.API_ORIGIN).toBe('https://app.oriumdigital.tech');
      expect(config.WEB_ORIGIN).toBe('https://app.oriumdigital.tech');
      expect(new URL(config.DATABASE_URL).hostname).toBe('postgres');
    });

    it('approves staging config with https://staging.oriumdigital.tech', () => {
      const stagingEnv = {
        ...baseValidProdEnv,
        API_ORIGIN: 'https://staging.oriumdigital.tech',
        WEB_ORIGIN: 'https://staging.oriumdigital.tech',
      };
      const config = loadConfig(stagingEnv);
      expect(config.NODE_ENV).toBe('production');
      expect(config.API_HOST).toBe('0.0.0.0');
      expect(config.API_ORIGIN).toBe('https://staging.oriumdigital.tech');
      expect(config.WEB_ORIGIN).toBe('https://staging.oriumdigital.tech');
    });

    it('rejects unallowed arbitrary domains in production', () => {
      const env = {
        ...baseValidProdEnv,
        API_ORIGIN: 'https://unauthorized.oriumdigital.tech',
        WEB_ORIGIN: 'https://unauthorized.oriumdigital.tech',
      };
      expect(() => loadConfig(env)).toThrowError(/Configuração inválida:.*NODE_ENV/);
    });

    it('rejects http: protocol in production even for allowed host', () => {
      const env = {
        ...baseValidProdEnv,
        API_ORIGIN: 'http://app.oriumdigital.tech',
        WEB_ORIGIN: 'http://app.oriumdigital.tech',
      };
      expect(() => loadConfig(env)).toThrowError(/Configuração inválida:.*NODE_ENV/);
    });

    it('rejects divergence between API_ORIGIN and WEB_ORIGIN in production', () => {
      const env = {
        ...baseValidProdEnv,
        API_ORIGIN: 'https://app.oriumdigital.tech',
        WEB_ORIGIN: 'https://staging.oriumdigital.tech',
      };
      expect(() => loadConfig(env)).toThrowError(/Configuração inválida:.*NODE_ENV/);
    });

    it('rejects origins with a URL path in production', () => {
      const env = {
        ...baseValidProdEnv,
        API_ORIGIN: 'https://app.oriumdigital.tech/api',
        WEB_ORIGIN: 'https://app.oriumdigital.tech/api',
      };
      expect(() => loadConfig(env)).toThrowError(/Configuração inválida:.*API_ORIGIN/);
    });

    it('rejects production config when API_HOST is not 0.0.0.0', () => {
      const env = {
        ...baseValidProdEnv,
        API_HOST: '127.0.0.1',
      };
      expect(() => loadConfig(env)).toThrowError(/Configuração inválida:.*NODE_ENV/);
    });

    it('rejects production config when DATABASE_URL hostname is not postgres', () => {
      const env = {
        ...baseValidProdEnv,
        DATABASE_URL: 'postgresql://orium_app:somepassword@127.0.0.1:5432/orium_prod',
      };
      expect(() => loadConfig(env)).toThrowError(/Configuração inválida:.*NODE_ENV/);
    });

    it('preserves local development validation rules', () => {
      const localEnv: NodeJS.ProcessEnv = {
        NODE_ENV: 'development',
        API_HOST: '127.0.0.1',
        API_PORT: '3001',
        API_ORIGIN: 'http://127.0.0.1:3001',
        WEB_ORIGIN: 'http://127.0.0.1:5173',
        DATABASE_URL: 'postgresql://orium_app:somepassword@127.0.0.1:55432/orium_dev',
        BETTER_AUTH_SECRET: 'super-secure-production-secret-min-32-chars-length',
        LOG_LEVEL: 'info',
      };
      const config = loadConfig(localEnv);
      expect(config.NODE_ENV).toBe('development');
      expect(config.API_HOST).toBe('127.0.0.1');

      // Local cannot bind 0.0.0.0
      expect(() => loadConfig({ ...localEnv, API_HOST: '0.0.0.0' })).toThrowError(/Configuração inválida:.*NODE_ENV/);
    });
  });

  describe('deploy/production/nginx.conf - structural verification', () => {
    let nginxConf: string;

    it('reads deploy/production/nginx.conf', async () => {
      const filePath = path.resolve(process.cwd(), 'deploy', 'production', 'nginx.conf');
      nginxConf = await fs.readFile(filePath, 'utf8');
      expect(nginxConf).toBeTruthy();
    });

    it('configures real_ip directives in server block', () => {
      expect(nginxConf).toMatch(/set_real_ip_from\s+10\.0\.1\.0\/24;/);
      expect(nginxConf).toMatch(/set_real_ip_from\s+172\.16\.0\.0\/12;/);
      expect(nginxConf).toMatch(/real_ip_header\s+X-Forwarded-For;/);
      expect(nginxConf).toMatch(/real_ip_recursive\s+on;/);
    });

    it('contains all 5 mandatory security headers with always in location = /index.html', () => {
      const locationIndexMatch = nginxConf.match(/location\s*=\s*\/index\.html\s*\{([^}]+)\}/);
      expect(locationIndexMatch).not.toBeNull();
      const locationBody = locationIndexMatch![1];

      expect(locationBody).toMatch(/add_header\s+Cache-Control\s+"no-store"\s+always;/);
      expect(locationBody).toMatch(/add_header\s+X-Content-Type-Options\s+nosniff\s+always;/);
      expect(locationBody).toMatch(/add_header\s+Referrer-Policy\s+no-referrer\s+always;/);
      expect(locationBody).toMatch(/add_header\s+X-Frame-Options\s+DENY\s+always;/);
      expect(locationBody).toMatch(/add_header\s+Strict-Transport-Security\s+"max-age=31536000"\s+always;/);
    });

    it('contains server-level fallback security headers', () => {
      expect(nginxConf).toMatch(/add_header\s+X-Content-Type-Options\s+nosniff\s+always;/);
      expect(nginxConf).toMatch(/add_header\s+Referrer-Policy\s+no-referrer\s+always;/);
      expect(nginxConf).toMatch(/add_header\s+X-Frame-Options\s+DENY\s+always;/);
      expect(nginxConf).toMatch(/add_header\s+Strict-Transport-Security\s+"max-age=31536000"\s+always;/);
    });
  });
});
