# Database Migrations

## How to Run Migrations

### Option 1: Supabase Dashboard (Recommended)
1. Go to your Supabase project dashboard
2. Navigate to SQL Editor
3. Copy the contents of the migration file
4. Paste and run the SQL

### Option 2: Using Supabase CLI
```bash
# Install Supabase CLI if not already installed
brew install supabase/tap/supabase

# Login to Supabase
supabase login

# Run migration
supabase db push --db-url "postgresql://postgres:[YOUR-PASSWORD]@[YOUR-PROJECT-REF].supabase.co:5432/postgres"
```

### Option 3: Direct psql Connection
```bash
psql "postgresql://postgres:[YOUR-PASSWORD]@[YOUR-PROJECT-REF].supabase.co:5432/postgres" -f migrations/001_chat_sequence_constraint.sql
```

## Migration Files

- `001_chat_sequence_constraint.sql` - Adds unique constraint on (thread_id, sequence_number) to prevent race conditions in chat messages

## Verification

After running the migration, verify it worked:
```sql
-- Check if constraint exists
SELECT conname, contype
FROM pg_constraint
WHERE conname = 'unique_thread_sequence';

-- Check if index exists
SELECT indexname
FROM pg_indexes
WHERE indexname = 'idx_messages_thread_seq';
```