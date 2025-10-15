// Quick test to check database lookup
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function test() {
  console.log('Testing database lookups for Victron Cerbo GX...\n');

  // Test 1: Look for any Victron systems
  const { data: victronSystems } = await supabase
    .from('systems')
    .select('manufacturer_norm, model_norm, asset_uid')
    .ilike('manufacturer_norm', '%victron%')
    .limit(5);

  console.log('Victron systems in database:');
  victronSystems?.forEach(s => {
    console.log(`  "${s.manufacturer_norm}" / "${s.model_norm}"`);
  });

  console.log('\n---\n');

  // Test 2: Look for Cerbo specifically
  const { data: cerbo1, error: error1 } = await supabase
    .from('systems')
    .select('manufacturer_norm, model_norm, asset_uid')
    .ilike('manufacturer_norm', 'victron')
    .ilike('model_norm', 'cerbo_gx')
    .single();

  console.log('Query 1 - victron / cerbo_gx:', cerbo1 ? 'FOUND' : 'NOT FOUND');
  if (error1) {
    console.log(`  ERROR: ${error1.message}`);
  }
  if (cerbo1) {
    console.log(`  Found: "${cerbo1.manufacturer_norm}" / "${cerbo1.model_norm}"`);
    console.log(`  Asset UID: ${cerbo1.asset_uid}`);
  }

  // Test 3: With space instead of underscore
  const { data: cerbo2 } = await supabase
    .from('systems')
    .select('manufacturer_norm, model_norm, asset_uid')
    .ilike('manufacturer_norm', 'victron')
    .ilike('model_norm', 'cerbo gx')
    .single();

  console.log('Query 2 - victron / cerbo gx:', cerbo2 ? 'FOUND' : 'NOT FOUND');
  if (cerbo2) {
    console.log(`  Found: "${cerbo2.manufacturer_norm}" / "${cerbo2.model_norm}"`);
  }

  console.log('\n---\n');

  // Test 4: Look for all cerbo matches without .single()
  const { data: allCerbos } = await supabase
    .from('systems')
    .select('manufacturer_norm, model_norm, asset_uid')
    .ilike('manufacturer_norm', '%victron%')
    .ilike('model_norm', '%cerbo%');

  console.log('Query 3 - All systems with "cerbo" in model:', allCerbos?.length || 0);
  allCerbos?.forEach(s => {
    console.log(`  - "${s.manufacturer_norm}" / "${s.model_norm}" (${s.asset_uid})`);
  });

  console.log('\n---\n');

  // Test 5: Try with .limit(1) instead of .single()
  const { data: cerboLimit, error: errorLimit } = await supabase
    .from('systems')
    .select('manufacturer_norm, model_norm, asset_uid')
    .ilike('manufacturer_norm', 'victron')
    .ilike('model_norm', 'cerbo_gx')
    .limit(1);

  console.log('Query 4 - victron / cerbo_gx with .limit(1):', cerboLimit?.[0] ? 'FOUND' : 'NOT FOUND');
  if (errorLimit) {
    console.log(`  ERROR: ${errorLimit.message}`);
  }
  if (cerboLimit?.[0]) {
    console.log(`  Found: "${cerboLimit[0].manufacturer_norm}" / "${cerboLimit[0].model_norm}"`);
    console.log(`  Asset UID: ${cerboLimit[0].asset_uid}`);
  }
}

test().then(() => process.exit(0));