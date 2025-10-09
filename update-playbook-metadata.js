// Update staging_playbook_hints metadata for Zeus3S
import { getSupabaseClient } from './src/repositories/supabaseClient.js';

const docId = 'c0423de72bdbb87d3bb3b517bc4f4ba189c02e21d5da4f815d0cac303848770f';
const metadata = {
  manufacturer_norm: 'B&G',
  model_norm: 'zeus_s_16_mfd',
  asset_uid: 'e4739797-4204-fe58-4abf-1867b0fd57ff'
};

console.log('Updating staging_playbook_hints metadata...');
console.log('Doc ID:', docId);
console.log('Metadata:', metadata);

try {
  const supabase = await getSupabaseClient();

  const { data, error } = await supabase
    .from('staging_playbook_hints')
    .update(metadata)
    .eq('doc_id', docId);

  if (error) {
    console.error('❌ Update failed:', error.message);
    process.exit(1);
  }

  console.log('✅ SUCCESS: Updated staging_playbook_hints metadata');
  process.exit(0);
} catch (error) {
  console.error('❌ Script failed:', error.message);
  process.exit(1);
}
