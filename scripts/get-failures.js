import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function analyzeRun6() {
  const { data: runs } = await supabase
    .from('test_results')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1);

  const run = runs[0];
  console.log('=== Run #6 Analysis (', run.git_commit?.substring(0, 7), ') ===\n');

  const results = run.results;

  for (const category of Object.keys(results)) {
    const cat = results[category];
    console.log(`${category}: ${cat.passed} passed, ${cat.failed} failed`);

    // Show failed tests with errors if available
    if (cat.tests) {
      const failures = cat.tests.filter(t => t.status === 'failed');
      if (failures.length > 0 && failures.length <= 10) {
        for (const f of failures) {
          console.log(`  - ${f.name}`);
          if (f.error) console.log(`    Error: ${f.error.substring(0, 150)}`);
        }
      } else if (failures.length > 10) {
        console.log(`  (${failures.length} failures - showing first 5)`);
        for (const f of failures.slice(0, 5)) {
          console.log(`  - ${f.name}`);
          if (f.error) console.log(`    Error: ${f.error.substring(0, 150)}`);
        }
      }
    }
    console.log('');
  }
}

analyzeRun6().catch(console.error);
