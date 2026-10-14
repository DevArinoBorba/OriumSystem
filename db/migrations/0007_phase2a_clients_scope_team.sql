ALTER TABLE client
  ADD COLUMN IF NOT EXISTS contract_status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS segment text,
  ADD COLUMN IF NOT EXISTS account_manager_user_id text REFERENCES auth_user(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS briefing_summary text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS brand_kit_url text,
  ADD COLUMN IF NOT EXISTS drive_folder_url text,
  ADD COLUMN IF NOT EXISTS active_channels text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS onboarding_completed_at timestamptz;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'client_contract_status_check'
  ) THEN
    ALTER TABLE client
      ADD CONSTRAINT client_contract_status_check
      CHECK (contract_status IN ('onboarding', 'active', 'paused', 'offboarding', 'archived'));
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS client_contract_status_idx ON client(contract_status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS client_account_manager_idx ON client(account_manager_user_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS client_team_member (
  client_id uuid NOT NULL REFERENCES client(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
  functional_role text NOT NULL,
  is_primary boolean NOT NULL DEFAULT false,
  can_create_demands boolean NOT NULL DEFAULT false,
  assigned_by_user_id text NOT NULL REFERENCES auth_user(id) ON DELETE RESTRICT,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id, user_id, functional_role),
  CONSTRAINT client_team_member_role_check CHECK (
    functional_role IN (
      'account_manager',
      'traffic_manager',
      'designer',
      'social_media',
      'copywriter',
      'developer',
      'video_maker'
    )
  )
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS client_team_member_user_idx ON client_team_member(user_id, client_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS client_team_member_client_idx ON client_team_member(client_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS client_scope_item (
  id uuid PRIMARY KEY,
  client_id uuid NOT NULL REFERENCES client(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT 'general',
  cadence text NOT NULL DEFAULT 'monthly',
  contracted_quantity integer NOT NULL DEFAULT 1,
  sla_business_days integer,
  sla_hours integer,
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_scope_item_category_check CHECK (
    category IN ('traffic', 'social_media', 'design', 'web', 'copy', 'video', 'crm', 'general')
  ),
  CONSTRAINT client_scope_item_cadence_check CHECK (
    cadence IN ('one_off', 'weekly', 'biweekly', 'monthly', 'quarterly')
  ),
  CONSTRAINT client_scope_item_quantity_check CHECK (contracted_quantity > 0),
  CONSTRAINT client_scope_item_sla_days_check CHECK (sla_business_days IS NULL OR sla_business_days > 0),
  CONSTRAINT client_scope_item_sla_hours_check CHECK (sla_hours IS NULL OR sla_hours > 0),
  CONSTRAINT client_scope_item_version_check CHECK (version > 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS client_scope_item_client_active_idx ON client_scope_item(client_id, active);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS client_scope_item_category_idx ON client_scope_item(category);
--> statement-breakpoint
INSERT INTO permission VALUES
  ('clients.read.assigned'),
  ('clients.manage'),
  ('clients.team.manage')
ON CONFLICT (id) DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permission VALUES
  ('administrator', 'clients.read.assigned'),
  ('administrator', 'clients.manage'),
  ('administrator', 'clients.team.manage'),
  ('collaborator', 'clients.read.assigned')
ON CONFLICT (role_id, permission_id) DO NOTHING;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'orium_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE client_team_member TO orium_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE client_scope_item TO orium_app;
  END IF;
END $$;
