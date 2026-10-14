CREATE TABLE client (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  contact_name text,
  email text,
  phone text,
  notes text,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1
);
--> statement-breakpoint
CREATE INDEX client_name_idx ON client(name);
--> statement-breakpoint
CREATE INDEX client_archived_at_idx ON client(archived_at);
--> statement-breakpoint
CREATE INDEX client_created_at_idx ON client(created_at);
--> statement-breakpoint
INSERT INTO permission VALUES ('clients.read'),('clients.write'),('clients.archive');
--> statement-breakpoint
INSERT INTO role_permission VALUES
  ('administrator','clients.read'),
  ('administrator','clients.write'),
  ('administrator','clients.archive');
