-- Guardianage Season Context Notes
-- Season-level rich-text notes visible to all users, editable by admin only

-- Season Notes (current state)
CREATE TABLE IF NOT EXISTS guardianage_season_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id uuid NOT NULL UNIQUE,
  current_html text,
  last_saved_by_user_id uuid,
  last_saved_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Season Note Revisions (append-only history)
CREATE TABLE IF NOT EXISTS guardianage_season_note_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_note_id uuid NOT NULL,
  season_id uuid NOT NULL,
  revision_number integer NOT NULL,
  full_html text,
  action_type text NOT NULL CHECK (action_type IN ('created', 'updated', 'cleared')),
  saved_by_user_id uuid,
  saved_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_guardianage_season_note_revisions_note ON guardianage_season_note_revisions(season_note_id);
CREATE INDEX IF NOT EXISTS idx_guardianage_season_note_revisions_season ON guardianage_season_note_revisions(season_id);
