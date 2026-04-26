-- Guardianage Notes, Supplies, and Receipts
-- Step 4: Monthly operations tables

-- Month Notes (current state)
CREATE TABLE IF NOT EXISTS guardianage_month_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  month_id uuid NOT NULL UNIQUE,
  current_text text,
  last_saved_by_user_id uuid,
  last_saved_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Month Note Revisions (append-only history)
CREATE TABLE IF NOT EXISTS guardianage_month_note_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  month_note_id uuid NOT NULL,
  month_id uuid NOT NULL,
  revision_number integer NOT NULL,
  full_text text,
  action_type text NOT NULL CHECK (action_type IN ('created', 'updated', 'cleared', 'deleted')),
  saved_by_user_id uuid,
  saved_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_guardianage_note_revisions_note ON guardianage_month_note_revisions(month_note_id);
CREATE INDEX IF NOT EXISTS idx_guardianage_note_revisions_month ON guardianage_month_note_revisions(month_id);

-- Month Supplies
CREATE TABLE IF NOT EXISTS guardianage_month_supplies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  month_id uuid NOT NULL,
  purchase_date date,
  item_name text NOT NULL,
  category text,
  vendor text,
  amount numeric(10,2),
  currency_code text NOT NULL DEFAULT 'USD' CHECK (currency_code IN ('USD', 'XCD')),
  note text,
  related_task_id uuid,
  entered_by_user_id uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_guardianage_supplies_month ON guardianage_month_supplies(month_id);

-- Month Supply Revisions (append-only edit history)
CREATE TABLE IF NOT EXISTS guardianage_month_supply_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  month_supply_id uuid NOT NULL,
  revision_number integer NOT NULL,
  item_name text,
  category text,
  vendor text,
  amount numeric(10,2),
  currency_code text,
  note text,
  action_type text NOT NULL CHECK (action_type IN ('created', 'updated')),
  saved_by_user_id uuid,
  saved_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_guardianage_supply_revisions ON guardianage_month_supply_revisions(month_supply_id);

-- Month Supply Receipts
CREATE TABLE IF NOT EXISTS guardianage_month_supply_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  month_supply_id uuid NOT NULL,
  storage_bucket text NOT NULL,
  storage_path text NOT NULL,
  original_filename text,
  mime_type text,
  file_size_bytes integer,
  uploaded_by_user_id uuid,
  uploaded_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_guardianage_receipts_supply ON guardianage_month_supply_receipts(month_supply_id);
