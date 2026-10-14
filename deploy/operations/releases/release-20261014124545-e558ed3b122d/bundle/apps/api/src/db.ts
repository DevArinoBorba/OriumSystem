import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema.js';

export function connectDatabase(url: string) {
  const pool = new pg.Pool({ connectionString: url, max: 10, connectionTimeoutMillis: 5000, idleTimeoutMillis: 10000, statement_timeout: 10000 });
  pool.on('error', () => { /* Request readiness reports availability without leaking database details. */ });
  return { pool, db: drizzle(pool, { schema }) };
}
export type Database = ReturnType<typeof connectDatabase>;

export async function assertApplicationDatabase(database: Database): Promise<void> {
  const result = await database.pool.query<{ unsafe: boolean }>(`
    SELECT (
      r.rolsuper OR r.rolbypassrls OR r.rolcreatedb OR r.rolcreaterole
      OR has_database_privilege(current_user, current_database(), 'CREATE')
      OR has_schema_privilege(current_user, 'public', 'CREATE')
      OR EXISTS (SELECT 1 FROM pg_namespace n WHERE n.nspname='public' AND pg_has_role(current_user,n.nspowner,'MEMBER'))
      OR EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname = 'public' AND pg_has_role(current_user, c.relowner, 'MEMBER'))
      OR EXISTS (SELECT 1 FROM pg_database d WHERE d.datname=current_database() AND pg_has_role(current_user,d.datdba,'MEMBER'))
    ) AS unsafe FROM pg_roles r WHERE r.rolname=current_user
  `);
  if (result.rows[0]?.unsafe !== false) throw new Error('Identidade do banco inadequada para aplicação.');
}
