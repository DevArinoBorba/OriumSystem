import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { connectDatabase } from './db.js';

export async function migrateDatabase(url: string, appRole = 'orium_app'): Promise<void> {
  const parsed = new URL(url);
  const validHost = process.env.NODE_ENV === 'production' ? parsed.hostname === 'postgres' : ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname);
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !validHost || parsed.username !== 'orium_migrator') throw new Error('Usar migrator separado no ambiente correto.');
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(appRole)) throw new Error('Papel SQL inválido.');
  const database = connectDatabase(url);
  try {
    const client = await database.pool.connect();
    try {
      await client.query('SELECT pg_advisory_lock($1)', [712040]);
      await migrate(database.db, {
        migrationsFolder: process.env.MIGRATIONS_FOLDER ?? fileURLToPath(new URL('../../../db/migrations', import.meta.url)),
      });
      await client.query(`GRANT USAGE ON SCHEMA public TO "${appRole}"`);
      await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON auth_user, auth_account, auth_session, auth_verification, user_role, role_permission, client, demand, task, task_requirement, task_dependency, task_comment, demand_event, material, material_event, demand_template, demand_template_task, demand_template_task_requirement, demand_template_task_dependency TO "${appRole}"`);
      await client.query(`GRANT SELECT ON role, permission TO "${appRole}"`);
      // Identity audit is append-only for the application: SELECT/INSERT plus the fixed retention routine.
      await client.query(`REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON identity_event, identity_event_subject FROM "${appRole}"`);
      await client.query(`GRANT SELECT, INSERT ON identity_event, identity_event_subject TO "${appRole}"`);
      await client.query(`GRANT EXECUTE ON FUNCTION public.prune_identity_events() TO "${appRole}"`);
      // Notification: SELECT, INSERT and UPDATE(read_at) only. DELETE, TRUNCATE and UPDATE of other columns are denied.
      await client.query(`REVOKE ALL ON notification FROM "${appRole}"`);
      await client.query(`GRANT SELECT, INSERT ON notification TO "${appRole}"`);
      await client.query(`GRANT UPDATE (read_at) ON notification TO "${appRole}"`);
    } finally {
      try {
        await client.query('SELECT pg_advisory_unlock($1)', [712040]);
      } finally {
        client.release();
      }
    }
  } finally {
    await database.pool.end();
  }
}
