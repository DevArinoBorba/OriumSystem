CREATE INDEX IF NOT EXISTS demand_status_created_at_idx ON demand(status, created_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS demand_client_status_delivery_idx ON demand(client_id, status, delivery_date);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS task_assigned_status_delivery_idx ON task(assigned_to_user_id, status, delivery_date);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS task_assigned_demand_idx ON task(assigned_to_user_id, demand_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS task_active_status_idx ON task(demand_id, status) WHERE status != 'completed';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS demand_event_demand_created_idx ON demand_event(demand_id, created_at DESC);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS demand_template (
  id uuid PRIMARY KEY,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT 'general',
  default_priority text NOT NULL DEFAULT 'normal',
  estimated_days integer NOT NULL DEFAULT 5,
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT demand_template_category_check CHECK (category IN ('web', 'design', 'video', 'marketing', 'social_media', 'general')),
  CONSTRAINT demand_template_default_priority_check CHECK (default_priority IN ('low', 'normal', 'high', 'urgent')),
  CONSTRAINT demand_template_estimated_days_check CHECK (estimated_days > 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS demand_template_task (
  id uuid PRIMARY KEY,
  template_id uuid NOT NULL REFERENCES demand_template(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  suggested_role text NOT NULL DEFAULT 'collaborator',
  priority text NOT NULL DEFAULT 'normal',
  day_offset_start integer NOT NULL DEFAULT 0,
  duration_days integer NOT NULL DEFAULT 1,
  order_index integer NOT NULL DEFAULT 0,
  CONSTRAINT demand_template_task_role_check CHECK (suggested_role IN ('administrator', 'collaborator')),
  CONSTRAINT demand_template_task_priority_check CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  CONSTRAINT demand_template_task_duration_check CHECK (duration_days > 0),
  CONSTRAINT demand_template_task_offset_check CHECK (day_offset_start >= 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS demand_template_task_requirement (
  id uuid PRIMARY KEY,
  template_task_id uuid NOT NULL REFERENCES demand_template_task(id) ON DELETE CASCADE,
  title text NOT NULL,
  mandatory boolean NOT NULL DEFAULT true,
  order_index integer NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS demand_template_task_dependency (
  template_task_id uuid NOT NULL REFERENCES demand_template_task(id) ON DELETE CASCADE,
  depends_on_template_task_id uuid NOT NULL REFERENCES demand_template_task(id) ON DELETE CASCADE,
  PRIMARY KEY (template_task_id, depends_on_template_task_id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS demand_template_active_idx ON demand_template(active);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS demand_template_category_idx ON demand_template(category);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS demand_template_task_template_id_idx ON demand_template_task(template_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS demand_template_task_req_task_id_idx ON demand_template_task_requirement(template_task_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS demand_template_task_dep_depends_idx ON demand_template_task_dependency(depends_on_template_task_id);
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'orium_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE demand_template TO orium_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE demand_template_task TO orium_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE demand_template_task_requirement TO orium_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE demand_template_task_dependency TO orium_app;
  END IF;
END $$;
