CREATE TABLE demand (
  id uuid PRIMARY KEY,
  client_id uuid NOT NULL REFERENCES client(id),
  created_by_user_id text NOT NULL REFERENCES auth_user(id),
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  priority text NOT NULL DEFAULT 'normal',
  delivery_date date NOT NULL,
  status text NOT NULL DEFAULT 'open',
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT demand_version_check CHECK (version > 0),
  CONSTRAINT demand_priority_check CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  CONSTRAINT demand_status_check CHECK (status IN ('open', 'completed'))
);
--> statement-breakpoint
CREATE INDEX demand_client_id_idx ON demand(client_id);
--> statement-breakpoint
CREATE INDEX demand_created_by_user_id_idx ON demand(created_by_user_id);
--> statement-breakpoint
CREATE INDEX demand_status_idx ON demand(status);
--> statement-breakpoint
CREATE INDEX demand_delivery_date_idx ON demand(delivery_date);
--> statement-breakpoint
CREATE INDEX demand_created_at_idx ON demand(created_at);
--> statement-breakpoint
CREATE TABLE task (
  id uuid PRIMARY KEY,
  demand_id uuid NOT NULL REFERENCES demand(id) ON DELETE CASCADE,
  assigned_to_user_id text NOT NULL REFERENCES auth_user(id),
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  priority text NOT NULL DEFAULT 'normal',
  delivery_date date NOT NULL,
  status text NOT NULL DEFAULT 'blocked',
  accepted_at timestamptz,
  ready_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  pause_requested_at timestamptz,
  pause_reason text,
  paused_at timestamptz,
  delivery_notes text,
  preview_url text,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT task_version_check CHECK (version > 0),
  CONSTRAINT task_priority_check CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  CONSTRAINT task_status_check CHECK (status IN ('blocked', 'ready', 'in_production', 'in_review', 'changes_requested', 'paused', 'completed'))
);
--> statement-breakpoint
CREATE INDEX task_demand_id_idx ON task(demand_id);
--> statement-breakpoint
CREATE INDEX task_assigned_to_user_id_idx ON task(assigned_to_user_id);
--> statement-breakpoint
CREATE INDEX task_status_idx ON task(status);
--> statement-breakpoint
CREATE INDEX task_delivery_date_idx ON task(delivery_date);
--> statement-breakpoint
CREATE TABLE task_requirement (
  id uuid PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES task(id) ON DELETE CASCADE,
  title text NOT NULL,
  mandatory boolean NOT NULL DEFAULT true,
  satisfied boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX task_requirement_task_id_idx ON task_requirement(task_id);
--> statement-breakpoint
CREATE TABLE task_dependency (
  task_id uuid NOT NULL REFERENCES task(id) ON DELETE CASCADE,
  depends_on_task_id uuid NOT NULL REFERENCES task(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT task_dependency_pkey PRIMARY KEY (task_id, depends_on_task_id),
  CONSTRAINT task_dependency_not_self CHECK (task_id <> depends_on_task_id)
);
--> statement-breakpoint
CREATE INDEX task_dependency_depends_on_task_id_idx ON task_dependency(depends_on_task_id);
--> statement-breakpoint
CREATE TABLE task_comment (
  id uuid PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES task(id) ON DELETE CASCADE,
  author_id text NOT NULL REFERENCES auth_user(id),
  author_name text NOT NULL,
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX task_comment_task_id_idx ON task_comment(task_id);
--> statement-breakpoint
CREATE INDEX task_comment_author_id_idx ON task_comment(author_id);
--> statement-breakpoint
CREATE TABLE demand_event (
  id uuid PRIMARY KEY,
  demand_id uuid NOT NULL REFERENCES demand(id) ON DELETE CASCADE,
  task_id uuid REFERENCES task(id) ON DELETE SET NULL,
  actor_id text NOT NULL REFERENCES auth_user(id),
  actor_name text NOT NULL,
  action text NOT NULL,
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX demand_event_demand_id_idx ON demand_event(demand_id);
--> statement-breakpoint
CREATE INDEX demand_event_task_id_idx ON demand_event(task_id);
--> statement-breakpoint
CREATE INDEX demand_event_actor_id_idx ON demand_event(actor_id);
--> statement-breakpoint
CREATE INDEX demand_event_created_at_idx ON demand_event(created_at);
--> statement-breakpoint
INSERT INTO permission VALUES
  ('demands.read'),
  ('demands.write'),
  ('tasks.read'),
  ('tasks.manage'),
  ('tasks.execute'),
  ('tasks.review');
--> statement-breakpoint
INSERT INTO role_permission VALUES
  ('administrator', 'demands.read'),
  ('administrator', 'demands.write'),
  ('administrator', 'tasks.read'),
  ('administrator', 'tasks.manage'),
  ('administrator', 'tasks.execute'),
  ('administrator', 'tasks.review'),
  ('collaborator', 'demands.read'),
  ('collaborator', 'tasks.read'),
  ('collaborator', 'tasks.execute');
