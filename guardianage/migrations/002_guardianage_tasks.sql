-- Guardianage Task Tables
-- Step 2: Templates, task instances, task events

-- Task Templates
CREATE TABLE IF NOT EXISTS guardianage_task_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  task_type text NOT NULL CHECK (task_type IN ('weekly_recurring', 'monthly_recurring', 'monthly_major')),
  is_active boolean NOT NULL DEFAULT true,
  default_instructions text,
  has_photo_upload boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Task Instances
CREATE TABLE IF NOT EXISTS guardianage_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id uuid NOT NULL,
  month_id uuid NOT NULL,
  week_id uuid,
  task_template_id uuid,
  task_type text NOT NULL CHECK (task_type IN ('weekly_recurring', 'monthly_recurring', 'monthly_major')),
  title text NOT NULL,
  description text,
  instructions text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'complete', 'cancelled')),
  due_start_date date,
  due_end_date date,
  completed_at timestamptz,
  completed_by_user_id uuid,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_guardianage_tasks_month ON guardianage_tasks(month_id);
CREATE INDEX IF NOT EXISTS idx_guardianage_tasks_week ON guardianage_tasks(week_id);
CREATE INDEX IF NOT EXISTS idx_guardianage_tasks_status ON guardianage_tasks(status);
CREATE INDEX IF NOT EXISTS idx_guardianage_tasks_template ON guardianage_tasks(task_template_id);

-- Uniqueness constraints for template-backed tasks (prevents duplicate seeding)
CREATE UNIQUE INDEX IF NOT EXISTS idx_guardianage_tasks_template_week
  ON guardianage_tasks(task_template_id, week_id)
  WHERE task_template_id IS NOT NULL AND week_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_guardianage_tasks_template_month
  ON guardianage_tasks(task_template_id, month_id)
  WHERE task_template_id IS NOT NULL AND week_id IS NULL;

-- Task Events (append-only history)
CREATE TABLE IF NOT EXISTS guardianage_task_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL,
  actor_user_id uuid,
  event_type text NOT NULL CHECK (event_type IN ('completed', 'reopened', 'note_updated', 'photo_added', 'photo_removed', 'metadata_updated')),
  note_text text,
  event_metadata_json jsonb,
  occurred_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_guardianage_task_events_task ON guardianage_task_events(task_id);
CREATE INDEX IF NOT EXISTS idx_guardianage_task_events_type ON guardianage_task_events(event_type);
