import { randomBytes } from 'node:crypto';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../apps/api/src/app.js';
import { loadConfig } from '../apps/api/src/config.js';
import type { Database } from '../apps/api/src/db.js';

// Phase 6 / Increment 1 — HTTP protection headers, verified with real Fastify app.inject.
// NOT a PostgreSQL integration test: the database is an explicit stub that ONLY answers the
// startup identity check (assertApplicationDatabase) with unsafe:false. Any other query fails
// loudly, so no case below can pass by silently reaching a fake database.
const queriesSeen: string[] = [];
const startupOnlyDatabaseStub = {
  pool: {
    query: async (sql: string) => {
      queriesSeen.push(sql.includes('AS unsafe') ? 'startup-identity-check' : 'unexpected');
      if (sql.includes('AS unsafe') && sql.includes('pg_roles')) return { rows: [{ unsafe: false }] };
      throw new Error('Stub limited to the startup identity check; unexpected query.');
    },
    connect: async () => { throw new Error('Stub does not provide connections.'); },
  },
  db: {},
} as unknown as Database;

const origin = 'http://127.0.0.1:5173';
const expectedHeaders: Record<string, string> = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
};

function expectSecurityHeaders(res: LightMyRequestResponse) {
  for (const [name, value] of Object.entries(expectedHeaders)) {
    expect(res.headers[name], `header ${name}`).toBe(value);
  }
  // HSTS is reserved for the HTTPS deployment; must not be emitted on local HTTP.
  expect(res.headers['strict-transport-security']).toBeUndefined();
  // None of these responses may establish or touch a session.
  expect(res.headers['set-cookie']).toBeUndefined();
}

function expectSanitizedError(res: LightMyRequestResponse, code: string, secretProbe?: string) {
  const body = res.json() as Record<string, unknown>;
  expect(Object.keys(body)).toEqual(['error']);
  const error = body.error as Record<string, unknown>;
  expect(Object.keys(error).sort()).toEqual(['code', 'requestId']);
  expect(error.code).toBe(code);
  expect(res.body).not.toMatch(/stack|postgres|password|secret|at \w+ \(/i);
  if (secretProbe) expect(res.body).not.toContain(secretProbe);
}

describe('Phase 6 / Increment 1 — API HTTP security headers (app.inject, startup-only DB stub)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({
      database: startupOnlyDatabaseStub,
      logger: false,
      config: loadConfig({
        NODE_ENV: 'test',
        DATABASE_URL: 'postgres://stub@127.0.0.1:1/stub_not_used',
        BETTER_AUTH_SECRET: randomBytes(32).toString('hex'),
        WEB_ORIGIN: origin,
        API_ORIGIN: 'http://127.0.0.1:3001',
        API_HOST: '127.0.0.1',
        API_PORT: '3001',
      }),
    });
  });

  afterAll(async () => {
    await app?.close();
  });

  it('GET /health/live → 200 with all security headers', async () => {
    const res = await app.inject({ method: 'GET', url: '/health/live' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
    expectSecurityHeaders(res);
  });

  it('unknown route → 404 with headers and sanitized error', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/does-not-exist?token=probe-value-123' });
    expect(res.statusCode).toBe(404);
    expectSecurityHeaders(res);
    expectSanitizedError(res, 'NOT_FOUND', 'probe-value-123');
  });

  it('mutation without Origin → 403 ORIGIN_REJECTED with headers, no input echo', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/sign-in/email',
      headers: { 'content-type': 'application/json' },
      payload: { email: 'probe@example.test', password: 'probe-password-not-real-1' },
    });
    expect(res.statusCode).toBe(403);
    expectSecurityHeaders(res);
    expectSanitizedError(res, 'ORIGIN_REJECTED', 'probe-password-not-real-1');
  });

  it('cross-site mutation with valid Origin → 403 (guard preserved)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/sign-in/email',
      headers: { origin, 'sec-fetch-site': 'cross-site', 'content-type': 'application/json' },
      payload: {},
    });
    expect(res.statusCode).toBe(403);
    expectSecurityHeaders(res);
    expectSanitizedError(res, 'ORIGIN_REJECTED');
  });

  it('mutation with Origin but non-JSON → 415 (guard preserved)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/sign-in/email',
      headers: { origin, 'content-type': 'text/plain' },
      payload: 'x',
    });
    expect(res.statusCode).toBe(415);
    expectSecurityHeaders(res);
    expectSanitizedError(res, 'JSON_REQUIRED');
  });

  it('oversized JSON body (>16 KB) → 413 PAYLOAD_TOO_LARGE with headers, body not echoed', async () => {
    const marker = 'oversize-marker-' + randomBytes(4).toString('hex');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/sign-in/email',
      headers: { origin, 'content-type': 'application/json' },
      payload: JSON.stringify({ email: 'probe@example.test', password: marker, pad: 'a'.repeat(20000) }),
    });
    expect(res.statusCode).toBe(413);
    expectSecurityHeaders(res);
    expectSanitizedError(res, 'PAYLOAD_TOO_LARGE', marker);
  });

  it('malformed JSON body → 400 INVALID_INPUT with headers, raw body not echoed', async () => {
    const marker = 'malformed-marker-' + randomBytes(4).toString('hex');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/sign-in/email',
      headers: { origin, 'content-type': 'application/json' },
      payload: `{"email":"probe@example.test","password":"${marker}",`,
    });
    expect(res.statusCode).toBe(400);
    expectSecurityHeaders(res);
    expectSanitizedError(res, 'INVALID_INPUT', marker);
  });

  it('stub was used only for the startup identity check', () => {
    expect(queriesSeen).toEqual(['startup-identity-check']);
  });
});
