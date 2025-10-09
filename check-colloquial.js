import { getSupabaseClient } from './src/repositories/supabaseClient.js';

const assetUid = 'e4739797-4204-fe58-4abf-1867b0fd57ff';

try {
  const supabase = await getSupabaseClient();

  const { data, error } = await supabase
    .from('systems')
    .select('asset_uid, manufacturer_norm, model_norm, system_norm, colloquial_keywords')
    .eq('asset_uid', assetUid)
    .single();

  if (error) {
    console.error('❌ Query failed:', error.message);
    process.exit(1);
  }

  console.log('='.repeat(80));
  console.log('COLLOQUIAL KEYWORDS CHECK');
  console.log('='.repeat(80));
  console.log('Asset UID:', data.asset_uid);
  console.log('Manufacturer:', data.manufacturer_norm);
  console.log('Model:', data.model_norm);
  console.log('System:', data.system_norm);
  console.log('='.repeat(80));
  console.log('Colloquial Keywords:');
  console.log(data.colloquial_keywords || '(null - not populated)');
  console.log('='.repeat(80));

  if (data.colloquial_keywords && data.colloquial_keywords.trim().length > 0) {
    console.log('✅ Colloquial keywords are populated!');
    const keywords = data.colloquial_keywords.split(',').map(k => k.trim());
    console.log(`📊 Total keywords: ${keywords.length}`);
    console.log('Keywords:', keywords.join(', '));
  } else {
    console.log('❌ Colloquial keywords are NOT populated');
  }

  process.exit(0);
} catch (error) {
  console.error('❌ Script failed:', error.message);
  process.exit(1);
}
