import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const docId = 'c0423de72bdbb87d3bb3b517bc4f4ba189c02e21d5da4f815d0cac303848770f';

const tables = ['spec_suggestions', 'playbook_hints', 'troubleshooting', 'golden_tests', 'intent_router'];

for (const table of tables) {
  const { data } = await supabase.from(table).select('referenced_systems').eq('doc_id', docId);
  if (!data || data.length === 0) continue;

  const counts = {};
  data.forEach(row => {
    (row.referenced_systems || []).forEach(ref => {
      counts[ref] = (counts[ref] || 0) + 1;
    });
  });

  if (Object.keys(counts).length > 0) {
    console.log(`\n${table}:`);
    Object.entries(counts).sort((a,b) => b[1] - a[1]).forEach(([ref, count]) => {
      console.log(`  ${ref}: ${count}`);
    });
  } else {
    console.log(`\n${table}: no referenced_systems`);
  }
}

// Check documents table
const { data: doc } = await supabase.from('documents').select('selected_models, referenced_systems').eq('doc_id', docId).single();
console.log('\nDocument metadata:');
console.log('  selected_models:', JSON.stringify(doc?.selected_models));
console.log('  referenced_systems:', JSON.stringify(doc?.referenced_systems));
