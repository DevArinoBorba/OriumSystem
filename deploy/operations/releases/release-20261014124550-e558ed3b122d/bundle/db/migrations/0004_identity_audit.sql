CREATE TABLE identity_event (
  id uuid PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  actor_id text,
  action text NOT NULL,
  target_user_id text,
  target_role_id text,
  previous_role text,
  new_role text,
  previous_active boolean,
  new_active boolean,
  previous_permissions text[],
  new_permissions text[],
  revoked_count integer NOT NULL DEFAULT 0,
  CONSTRAINT identity_event_action_check CHECK (action IN ('user_created', 'user_role_changed', 'user_deactivated', 'role_permissions_changed', 'password_recovered')),
  CONSTRAINT identity_event_revoked_count_check CHECK (revoked_count >= 0),
  CONSTRAINT identity_event_actor_id_check CHECK (actor_id IS NULL OR length(actor_id) BETWEEN 1 AND 255),
  CONSTRAINT identity_event_target_user_id_check CHECK (target_user_id IS NULL OR length(target_user_id) BETWEEN 1 AND 255),
  CONSTRAINT identity_event_roles_exist_check CHECK (
    (target_role_id IS NULL OR target_role_id IN ('collaborator', 'administrator'))
    AND (previous_role IS NULL OR previous_role IN ('collaborator', 'administrator'))
    AND (new_role IS NULL OR new_role IN ('collaborator', 'administrator'))
  ),
  CONSTRAINT identity_event_permissions_check CHECK (
    (previous_permissions IS NULL OR (array_ndims(previous_permissions) = 1 AND array_position(previous_permissions, NULL) IS NULL))
    AND (new_permissions IS NULL OR (array_ndims(new_permissions) = 1 AND array_position(new_permissions, NULL) IS NULL))
  ),
  CONSTRAINT identity_event_shape_check CHECK (
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
    OR (action = 'password_recovered'
      AND actor_id IS NOT NULL AND target_user_id IS NOT NULL AND target_role_id IS NULL
      AND previous_role IS NULL AND new_role IS NULL
      AND previous_active IS NULL AND new_active IS NULL
      AND previous_permissions IS NULL AND new_permissions IS NULL)
  )
);
--> statement-breakpoint
CREATE INDEX identity_event_created_at_id_idx ON identity_event(created_at DESC, id DESC);
--> statement-breakpoint
CREATE INDEX identity_event_target_user_created_at_idx ON identity_event(target_user_id, created_at DESC, id DESC);
--> statement-breakpoint
CREATE TABLE identity_event_subject (
  event_id uuid NOT NULL REFERENCES identity_event(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  CONSTRAINT identity_event_subject_pkey PRIMARY KEY (event_id, user_id),
  CONSTRAINT identity_event_subject_user_id_check CHECK (length(user_id) BETWEEN 1 AND 255)
);
--> statement-breakpoint
CREATE INDEX identity_event_subject_user_event_idx ON identity_event_subject(user_id, event_id);
--> statement-breakpoint
CREATE FUNCTION public.prune_identity_events() RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  removed integer;
BEGIN
  DELETE FROM public.identity_event
  WHERE created_at < pg_catalog.statement_timestamp() - interval '12 months';
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.prune_identity_events() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON identity_event, identity_event_subject FROM PUBLIC;
