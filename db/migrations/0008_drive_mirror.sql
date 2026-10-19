-- Espelho do Google Drive (Agent/): material passa a apontar para o arquivo do Drive
-- e cada arquivo pode ter status de publicação ("a publicar" / "publicado").
ALTER TABLE material ADD COLUMN IF NOT EXISTS drive_file_id text;
--> statement-breakpoint
ALTER TABLE material ADD COLUMN IF NOT EXISTS drive_path text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS material_drive_file_id_idx ON material(drive_file_id) WHERE drive_file_id IS NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS drive_file_status (
  drive_file_id text PRIMARY KEY,
  status text NOT NULL,
  updated_by_user_id text NOT NULL REFERENCES auth_user(id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT drive_file_status_status_check CHECK (status IN ('to_publish', 'published'))
);
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'orium_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE drive_file_status TO orium_app;
  END IF;
END $$;
