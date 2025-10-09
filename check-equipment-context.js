// Quick script to check equipment_context in chat_threads table
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const threadId = process.argv[2];

if (!threadId) {
  console.error('Usage: node check-equipment-context.js <thread_id>');
  process.exit(1);
}

const { data, error } = await supabase
  .from('chat_threads')
  .select('id, equipment_context')
  .eq('id', threadId)
  .single();

if (error) {
  console.error('Error:', error.message);
  process.exit(1);
}

console.log('\n📦 Equipment Context for thread:', threadId);
console.log('='.repeat(80));
console.log(JSON.stringify(data.equipment_context, null, 2));
console.log('='.repeat(80));
console.log('Total systems stored:', data.equipment_context?.length || 0);
console.log('');

process.exit(0);
