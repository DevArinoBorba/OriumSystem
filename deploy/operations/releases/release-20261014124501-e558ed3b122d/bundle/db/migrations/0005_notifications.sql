CREATE TABLE notification (
  id uuid PRIMARY KEY,
  recipient_user_id text NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
  demand_id uuid NOT NULL REFERENCES demand(id) ON DELETE CASCADE,
  task_id uuid REFERENCES task(id) ON DELETE CASCADE,
  kind text NOT NULL,
  source_event_id uuid REFERENCES demand_event(id) ON DELETE CASCADE,
  source_delivery_date date,
  created_at timestamptz NOT NULL,
  read_at timestamptz,
  CONSTRAINT notification_kind_check CHECK (kind IN (
    'task_assigned',
    'task_unblocked',
    'task_comment',
    'task_review_submitted',
    'task_changes_requested',
    'task_approved',
    'task_important_change',
    'demand_important_change',
    'task_due_today',
    'task_due_soon',
    'task_overdue',
    'demand_overdue'
  )),
  CONSTRAINT notification_single_source_check CHECK (
    (source_event_id IS NOT NULL AND source_delivery_date IS NULL) OR
    (source_event_id IS NULL AND source_delivery_date IS NOT NULL)
  ),
  CONSTRAINT notification_kind_source_check CHECK (
    (kind IN ('task_due_today', 'task_due_soon', 'task_overdue', 'demand_overdue') AND source_delivery_date IS NOT NULL) OR
    (kind NOT IN ('task_due_today', 'task_due_soon', 'task_overdue', 'demand_overdue') AND source_event_id IS NOT NULL)
  ),
  CONSTRAINT notification_kind_task_check CHECK (
    (kind LIKE 'task_%' AND task_id IS NOT NULL) OR
    (kind LIKE 'demand_%' AND task_id IS NULL)
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX notification_event_dedup_idx ON notification(recipient_user_id, kind, source_event_id) WHERE source_event_id IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX notification_calendar_task_dedup_idx ON notification(recipient_user_id, kind, demand_id, task_id, source_delivery_date) WHERE source_delivery_date IS NOT NULL AND task_id IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX notification_calendar_demand_dedup_idx ON notification(recipient_user_id, kind, demand_id, source_delivery_date) WHERE source_delivery_date IS NOT NULL AND task_id IS NULL;
--> statement-breakpoint
CREATE INDEX notification_recipient_created_at_idx ON notification(recipient_user_id, created_at DESC, id DESC);
--> statement-breakpoint
CREATE INDEX notification_recipient_unread_idx ON notification(recipient_user_id) WHERE read_at IS NULL;
--> statement-breakpoint
CREATE INDEX notification_demand_id_idx ON notification(demand_id);
--> statement-breakpoint
CREATE INDEX notification_task_id_idx ON notification(task_id);
--> statement-breakpoint
CREATE INDEX notification_source_event_id_idx ON notification(source_event_id);
