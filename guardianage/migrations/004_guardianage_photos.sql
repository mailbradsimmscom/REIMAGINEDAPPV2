-- Guardianage Task Photos
-- Step 5: Photo upload metadata

CREATE TABLE IF NOT EXISTS guardianage_task_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL,
  task_event_id uuid,
  storage_bucket text NOT NULL,
  storage_path text NOT NULL,
  original_filename text,
  mime_type text,
  file_size_bytes integer,
  is_deleted boolean DEFAULT false,
  deleted_at timestamptz,
  deleted_by_user_id uuid,
  uploaded_by_user_id uuid,
  uploaded_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_guardianage_photos_task ON guardianage_task_photos(task_id);
CREATE INDEX IF NOT EXISTS idx_guardianage_photos_deleted ON guardianage_task_photos(is_deleted);
