const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

(async () => {
  console.log('Running migration 024_agent_training_tables...\n');

  // Create agent_training_decisions table
  const { error: e1 } = await supabase.rpc('exec_sql', {
    sql: `
      CREATE TABLE IF NOT EXISTS agent_training_decisions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        agent_type text NOT NULL,
        source_table text NOT NULL,
        source_id uuid NOT NULL,
        item_snapshot jsonb NOT NULL,
        decision text NOT NULL,
        reasoning text,
        decision_source text DEFAULT 'human',
        confidence numeric,
        created_at timestamptz DEFAULT now()
      );
    `
  });

  if (e1) {
    // Try direct table creation via insert test
    console.log('RPC not available, testing table directly...');
  }

  // Test if table exists by querying it
  const { data: test1, error: testErr1 } = await supabase
    .from('agent_training_decisions')
    .select('id')
    .limit(1);

  if (testErr1 && testErr1.code === '42P01') {
    console.log('agent_training_decisions: Table does not exist');
    console.log('Please run the SQL manually in Supabase SQL Editor:');
    console.log('  scripts/migrations/024_agent_training_tables.sql');
    process.exit(1);
  } else if (testErr1) {
    console.log('agent_training_decisions: Error -', testErr1.message);
  } else {
    console.log('agent_training_decisions: EXISTS');
  }

  // Test agent_config
  const { data: test2, error: testErr2 } = await supabase
    .from('agent_config')
    .select('*')
    .limit(1);

  if (testErr2 && testErr2.code === '42P01') {
    console.log('agent_config: Table does not exist');
    console.log('Please run the SQL manually in Supabase SQL Editor');
    process.exit(1);
  } else if (testErr2) {
    console.log('agent_config: Error -', testErr2.message);
  } else {
    console.log('agent_config: EXISTS');
    if (test2 && test2.length > 0) {
      console.log('  Config entries:', test2.map(c => c.agent_type).join(', '));
    }
  }

  console.log('\nMigration check complete.');
  process.exit(0);
})();
