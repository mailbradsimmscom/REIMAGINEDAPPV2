-- Guardianage Foundation Tables
-- Step 1: Season structure, users, sessions, audit log

-- Season
CREATE TABLE IF NOT EXISTS guardianage_seasons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  vessel_name text NOT NULL DEFAULT 'REIMAGINED',
  start_date date NOT NULL,
  end_date date NOT NULL,
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'active', 'closed')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Months
CREATE TABLE IF NOT EXISTS guardianage_months (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id uuid NOT NULL,
  month_key text NOT NULL,
  month_start_date date NOT NULL,
  month_end_date date NOT NULL,
  display_name text NOT NULL,
  sort_order integer NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_guardianage_months_season ON guardianage_months(season_id);

-- Weeks
CREATE TABLE IF NOT EXISTS guardianage_weeks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  month_id uuid NOT NULL,
  week_number_in_month integer NOT NULL,
  week_start_date date NOT NULL,
  week_end_date date NOT NULL,
  display_name text NOT NULL,
  sort_order integer NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_guardianage_weeks_month ON guardianage_weeks(month_id);

-- Users
CREATE TABLE IF NOT EXISTS guardianage_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  login_id text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  display_name text NOT NULL,
  role text NOT NULL DEFAULT 'team_user' CHECK (role IN ('team_user', 'admin')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  last_login_at timestamptz
);

-- Sessions
CREATE TABLE IF NOT EXISTS guardianage_user_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  session_token_hash text NOT NULL,
  created_at timestamptz DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  ip_address text,
  user_agent text
);

CREATE INDEX IF NOT EXISTS idx_guardianage_sessions_token ON guardianage_user_sessions(session_token_hash);
CREATE INDEX IF NOT EXISTS idx_guardianage_sessions_user ON guardianage_user_sessions(user_id);

-- Audit Log
CREATE TABLE IF NOT EXISTS guardianage_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid,
  entity_type text,
  entity_id uuid,
  action_type text NOT NULL,
  summary text,
  metadata_json jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_guardianage_audit_created ON guardianage_audit_log(created_at);
CREATE INDEX IF NOT EXISTS idx_guardianage_audit_type ON guardianage_audit_log(action_type);
