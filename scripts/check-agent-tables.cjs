const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

(async () => {
  // Check for any agent/training related tables
  const tablesToCheck = [
    'agent_training_decisions',
    'agent_config',
    'review_decisions',
    'training_data'
  ];

  console.log('Checking for agent-related tables...\n');

  for (const table of tablesToCheck) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .limit(1);

    if (error && error.code === '42P01') {
      console.log(table + ': does NOT exist');
    } else if (error) {
      console.log(table + ': error - ' + error.message);
    } else {
      console.log(table + ': EXISTS');
    }
  }

  // Check existing DIP staging tables for status field usage
  console.log('\n--- DIP Staging Tables Status Distribution ---\n');
  
  const dipTables = [
    'staging_spec_suggestions',
    'staging_playbook_hints', 
    'staging_intent_router',
    'staging_golden_tests'
  ];

  for (const table of dipTables) {
    const { data } = await supabase
      .from(table)
      .select('status');
    
    if (data) {
      const counts = {};
      data.forEach(r => {
        const s = r.status || 'null';
        counts[s] = (counts[s] || 0) + 1;
      });
      console.log(table + ':');
      Object.entries(counts).forEach(([k, v]) => console.log('  ' + k + ': ' + v));
    }
  }

  process.exit(0);
})();
