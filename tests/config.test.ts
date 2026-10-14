import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../apps/api/src/config.js';

const validEnv = (): NodeJS.ProcessEnv => ({
  NODE_ENV: 'test', DATABASE_URL: 'postgresql://orium_app@127.0.0.1:5433/orium_test',
  BETTER_AUTH_SECRET: randomBytes(32).toString('hex'),
});

describe('local configuration', () => {
  it('loads local defaults and coerces the port', () => {
    const config = loadConfig({ ...validEnv(), API_PORT: '3002' });
    expect(config.API_PORT).toBe(3002);
    expect(config.API_HOST).toBe('127.0.0.1');
    expect(config.WEB_ORIGIN).toBe('http://127.0.0.1:5173');
  });

  it.each([
    { NODE_ENV: 'production' }, { API_HOST: '0.0.0.0' }, { API_PORT: '80' },
    { API_PORT: '65536' }, { DATABASE_URL: 'postgresql://app@example.com/orium' },
    { DATABASE_URL: 'https://localhost/db' }, { WEB_ORIGIN: 'https://example.com' },
    { API_ORIGIN: 'http://localhost:3001/path' }, { WEB_ORIGIN: 'http://localhost:5173/' },
    { BETTER_AUTH_SECRET: 'short' }, { BETTER_AUTH_SECRET: 'replace-this-secret-with-a-secure-value' },
  ])('rejects invalid environment %j without exposing its values', (override) => {
    expect(() => loadConfig({ ...validEnv(), ...override })).toThrow('Configuração inválida:');
  });

  it('does not include credentials or secret values in validation errors', () => {
    const secret = randomBytes(12).toString('hex');
    const databaseUrl = `postgresql://app:${secret}@example.com/orium`;
    let message = '';
    try { loadConfig({ ...validEnv(), DATABASE_URL: databaseUrl, BETTER_AUTH_SECRET: secret }); }
    catch (error) { message = (error as Error).message; }
    expect(message).toContain('DATABASE_URL');
    expect(message).toContain('BETTER_AUTH_SECRET');
    expect(message).not.toContain(secret);
    expect(message).not.toContain(databaseUrl);
  });
});
