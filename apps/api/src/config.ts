import { z } from 'zod';

export const PRODUCTION_ORIGIN_ALLOWLIST = [
  'https://app.oriumdigital.tech',
  'https://staging.oriumdigital.tech',
] as const;

const originUrl = z.url().refine((value) => ['http:', 'https:'].includes(new URL(value).protocol));
const postgresUrl = z.url().refine((value) => ['postgres:', 'postgresql:'].includes(new URL(value).protocol));
const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_HOST: z.enum(['127.0.0.1', 'localhost', '::1', '0.0.0.0']).default('127.0.0.1'),
  API_PORT: z.coerce.number().int().min(1024).max(65535).default(3001),
  API_ORIGIN: originUrl.default('http://127.0.0.1:3001'),
  WEB_ORIGIN: originUrl.default('http://127.0.0.1:5173'),
  DATABASE_URL: postgresUrl,
  BETTER_AUTH_SECRET: z.string().min(32).refine((value) => !/placeholder|replace|change-me/i.test(value)),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'silent']).default('info'),
}).superRefine((value, ctx) => {
  for (const field of ['API_ORIGIN', 'WEB_ORIGIN'] as const) {
    if (new URL(value[field]).origin !== value[field]) {
      ctx.addIssue({ code: 'custom', path: [field], message: 'Usar somente a origem, sem caminho.' });
    }
  }
  if (value.NODE_ENV === 'production') {
    const isOriginAllowed = (PRODUCTION_ORIGIN_ALLOWLIST as readonly string[]).includes(value.API_ORIGIN);
    if (
      value.API_HOST !== '0.0.0.0'
      || !isOriginAllowed
      || value.API_ORIGIN !== value.WEB_ORIGIN
      || new URL(value.DATABASE_URL).hostname !== 'postgres'
    ) {
      ctx.addIssue({ code: 'custom', path: ['NODE_ENV'], message: 'Topologia de produção inválida.' });
    }
  } else {
    let hasLocalTopologyIssue = false;
    if (value.API_HOST === '0.0.0.0') {
      hasLocalTopologyIssue = true;
      ctx.addIssue({ code: 'custom', path: ['API_HOST'], message: 'Topologia local inválida.' });
    }
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(value.API_ORIGIN).hostname)) {
      hasLocalTopologyIssue = true;
      ctx.addIssue({ code: 'custom', path: ['API_ORIGIN'], message: 'Topologia local inválida.' });
    }
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(value.WEB_ORIGIN).hostname)) {
      hasLocalTopologyIssue = true;
      ctx.addIssue({ code: 'custom', path: ['WEB_ORIGIN'], message: 'Topologia local inválida.' });
    }
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(value.DATABASE_URL).hostname)) {
      hasLocalTopologyIssue = true;
      ctx.addIssue({ code: 'custom', path: ['DATABASE_URL'], message: 'Topologia local inválida.' });
    }
    if (hasLocalTopologyIssue) {
      ctx.addIssue({ code: 'custom', path: ['NODE_ENV'], message: 'Topologia local inválida.' });
    }
  }
});
export type Config = z.infer<typeof configSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = configSchema.safeParse(env);
  if (!result.success) {
    // Never echo input values or Zod's detailed errors containing input.
    throw new Error(`Configuração inválida: ${[...new Set(result.error.issues.map((item) => item.path.join('.')))].join(', ')}`);
  }
  return result.data;
}
