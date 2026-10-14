CREATE TABLE material (
  id uuid PRIMARY KEY,
  client_id uuid NOT NULL REFERENCES client(id) ON DELETE RESTRICT,
  demand_id uuid REFERENCES demand(id) ON DELETE RESTRICT,
  task_id uuid REFERENCES task(id) ON DELETE RESTRICT,
  created_by_user_id text NOT NULL REFERENCES auth_user(id) ON DELETE RESTRICT,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  category text NOT NULL,
  url text NOT NULL,
  archived_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT material_version_check CHECK (version > 0),
  CONSTRAINT material_category_check CHECK (category IN ('brand', 'preview', 'published', 'drive', 'asset', 'reference')),
  CONSTRAINT material_task_requires_demand_check CHECK (task_id IS NULL OR demand_id IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX material_client_id_idx ON material(client_id);
--> statement-breakpoint
CREATE INDEX material_demand_id_idx ON material(demand_id);
--> statement-breakpoint
CREATE INDEX material_task_id_idx ON material(task_id);
--> statement-breakpoint
CREATE INDEX material_created_by_user_id_idx ON material(created_by_user_id);
--> statement-breakpoint
CREATE INDEX material_category_idx ON material(category);
--> statement-breakpoint
CREATE INDEX material_archived_at_idx ON material(archived_at);
--> statement-breakpoint
CREATE INDEX material_updated_at_idx ON material(updated_at DESC, id ASC);
--> statement-breakpoint
CREATE INDEX material_created_at_idx ON material(created_at);
--> statement-breakpoint
CREATE TABLE material_event (
  id uuid PRIMARY KEY,
  material_id uuid NOT NULL REFERENCES material(id) ON DELETE CASCADE,
  actor_id text NOT NULL REFERENCES auth_user(id) ON DELETE RESTRICT,
  actor_name text NOT NULL,
  action text NOT NULL,
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX material_event_material_id_idx ON material_event(material_id);
--> statement-breakpoint
CREATE INDEX material_event_actor_id_idx ON material_event(actor_id);
--> statement-breakpoint
CREATE INDEX material_event_created_at_idx ON material_event(created_at DESC);
--> statement-breakpoint
INSERT INTO permission VALUES
  ('materials.read'),
  ('materials.write'),
  ('materials.archive');
--> statement-breakpoint
INSERT INTO role_permission VALUES
  ('administrator', 'materials.read'),
  ('administrator', 'materials.write'),
  ('administrator', 'materials.archive'),
  ('collaborator', 'materials.read'),
  ('collaborator', 'materials.write');
