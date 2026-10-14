import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { eq } from 'drizzle-orm';
import type { Config } from './config.js';
import type { Database } from './db.js';
import * as schema from './schema.js';

export function createAuth(config: Config, database: Database) {
  return betterAuth({
    appName: 'OriumSystem',
    baseURL: config.API_ORIGIN,
    basePath: '/api/v1/auth',
    secret: config.BETTER_AUTH_SECRET,
    trustedOrigins: [config.WEB_ORIGIN],
    database: drizzleAdapter(database.db, { provider: 'pg', schema }),
    emailAndPassword: {
      enabled: true, disableSignUp: true, minPasswordLength: 1, maxPasswordLength: 128,
    },
    session: {
      expiresIn: 7 * 24 * 60 * 60,
      disableSessionRefresh: true,
      cookieCache: { enabled: false },
    },
    advanced: {
      useSecureCookies: config.NODE_ENV === 'production',
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax', path: '/' },
    },
    logger: { disabled: true },
    rateLimit: { enabled: true, window: 60, max: 30, customRules: { '/sign-in/email': { window: 60, max: 5 } } },
    databaseHooks: {
      session: {
        create: {
          before: async (candidate) => {
            const [identity] = await database.db.select({ active: schema.user.active })
              .from(schema.user).where(eq(schema.user.id, candidate.userId));
            if (!identity?.active) return false;
            return { data: candidate };
          },
        },
      },
    },
  });
}
export type Auth = ReturnType<typeof createAuth>;
