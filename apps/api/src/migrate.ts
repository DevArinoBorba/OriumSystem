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
      await client.query(`
        CREATE TABLE IF NOT EXISTS public.client_credential (
          id UUID PRIMARY KEY,
          client_id UUID NOT NULL REFERENCES public.client(id) ON DELETE CASCADE,
          category VARCHAR(40) NOT NULL DEFAULT 'other',
          label VARCHAR(120) NOT NULL,
          service_url VARCHAR(500),
          username VARCHAR(200) NOT NULL,
          encrypted_secret TEXT NOT NULL,
          notes VARCHAR(1000),
          updated_by TEXT REFERENCES public.auth_user(id) ON DELETE SET NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_client_credential_client_id ON public.client_credential(client_id);
      `);
      await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON auth_user, auth_account, auth_session, auth_verification, user_role, role_permission, client, client_team_member, client_scope_item, client_credential, demand, task, task_requirement, task_dependency, task_comment, demand_event, material, material_event, drive_file_status, demand_template, demand_template_task, demand_template_task_requirement, demand_template_task_dependency TO "${appRole}"`);
      await client.query(`GRANT SELECT ON role, permission TO "${appRole}"`);
      // Identity audit is append-only for the application: SELECT/INSERT plus the fixed retention routine.
      await client.query(`
        ALTER TABLE identity_event DROP CONSTRAINT IF EXISTS identity_event_action_check;
        ALTER TABLE identity_event ADD CONSTRAINT identity_event_action_check CHECK (
          action IN (
            'user_created',
            'user_role_changed',
            'user_deactivated',
            'role_permissions_changed',
            'password_recovered',
            'profile_updated',
            'password_changed'
          )
        );
        ALTER TABLE identity_event DROP CONSTRAINT IF EXISTS identity_event_shape_check;
        ALTER TABLE identity_event ADD CONSTRAINT identity_event_shape_check CHECK (
          (action = 'user_created'
            AND target_user_id IS NOT NULL AND target_role_id IS NULL
            AND previous_role IS NULL AND new_role IS NOT NULL
            AND previous_active IS NULL AND new_active IS TRUE
            AND previous_permissions IS NULL AND new_permissions IS NULL
            AND revoked_count = 0)
          OR (action = 'user_role_changed'
            AND actor_id IS NOT NULL AND target_user_id IS NOT NULL AND target_role_id IS NULL
            AND previous_role IS NOT NULL AND new_role IS NOT NULL
            AND previous_active IS NULL AND new_active IS NULL
            AND previous_permissions IS NULL AND new_permissions IS NULL)
          OR (action = 'user_deactivated'
            AND actor_id IS NOT NULL AND target_user_id IS NOT NULL AND target_role_id IS NULL
            AND previous_role IS NULL AND new_role IS NULL
            AND previous_active IS NOT NULL AND new_active IS FALSE
            AND previous_permissions IS NULL AND new_permissions IS NULL)
          OR (action = 'role_permissions_changed'
            AND actor_id IS NOT NULL AND target_user_id IS NULL AND target_role_id IS NOT NULL
            AND previous_role IS NULL AND new_role IS NULL
            AND previous_active IS NULL AND new_active IS NULL
            AND previous_permissions IS NOT NULL AND new_permissions IS NOT NULL)
          OR (action IN ('password_recovered', 'profile_updated', 'password_changed')
            AND actor_id IS NOT NULL AND target_user_id IS NOT NULL AND target_role_id IS NULL
            AND previous_role IS NULL AND new_role IS NULL
            AND previous_active IS NULL AND new_active IS NULL
            AND previous_permissions IS NULL AND new_permissions IS NULL)
        );
      `);
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
