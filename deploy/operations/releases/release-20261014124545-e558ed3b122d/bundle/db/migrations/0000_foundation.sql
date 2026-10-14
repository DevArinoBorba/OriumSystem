CREATE TABLE auth_user (
  id text PRIMARY KEY, name text NOT NULL, email text NOT NULL UNIQUE,
  email_verified boolean NOT NULL DEFAULT false, image text, active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE auth_account (
  id text PRIMARY KEY, account_id text NOT NULL, provider_id text NOT NULL,
  user_id text NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
  password text, access_token text, refresh_token text, id_token text,
  access_token_expires_at timestamptz, refresh_token_expires_at timestamptz, scope text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT account_provider_key UNIQUE(provider_id,account_id)
);
--> statement-breakpoint
CREATE INDEX account_user_idx ON auth_account(user_id);
--> statement-breakpoint
CREATE TABLE auth_session (
  id text PRIMARY KEY, token text NOT NULL UNIQUE,
  user_id text NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(), last_seen_at timestamptz NOT NULL DEFAULT now(),
  ip_address text, user_agent text
);
--> statement-breakpoint
CREATE INDEX session_user_idx ON auth_session(user_id);
--> statement-breakpoint
CREATE TABLE auth_verification (
  id text PRIMARY KEY, identifier text NOT NULL, value text NOT NULL, expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE role (id text PRIMARY KEY CHECK(id IN ('administrator','collaborator')), name text NOT NULL);
--> statement-breakpoint
CREATE TABLE permission (id text PRIMARY KEY);
--> statement-breakpoint
CREATE TABLE user_role (user_id text PRIMARY KEY REFERENCES auth_user(id) ON DELETE CASCADE, role_id text NOT NULL REFERENCES role(id));
--> statement-breakpoint
CREATE TABLE role_permission (
  role_id text NOT NULL REFERENCES role(id), permission_id text NOT NULL REFERENCES permission(id),
  PRIMARY KEY(role_id,permission_id)
);
--> statement-breakpoint
INSERT INTO role VALUES ('administrator','Administrador'),('collaborator','Colaborador');
--> statement-breakpoint
INSERT INTO permission VALUES ('protected.read'),('users.read'),('users.create'),('users.deactivate'),('roles.manage');
--> statement-breakpoint
INSERT INTO role_permission SELECT 'administrator',id FROM permission;
--> statement-breakpoint
INSERT INTO role_permission VALUES ('collaborator','protected.read');
