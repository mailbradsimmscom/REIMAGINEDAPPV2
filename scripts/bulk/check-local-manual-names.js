// scripts/check-local-manual-names.js
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function checkLocalManualNames() {
  console.log('🔍 Checking local_manual_file_name values in systems table\n');

  // 1. Check for any records with "0AJHC" in the name
  const { data: ajhc, error: ajhcError } = await supabase
    .from('systems')
    .select('asset_uid, manufacturer_norm, model_norm, local_manual_file_name')
    .like('local_manual_file_name', '%0AJHC%');

  if (ajhc && ajhc.length > 0) {
    console.log(`Found ${ajhc.length} records with "0AJHC":`);
    ajhc.forEach(s => {
      console.log(`  - "${s.local_manual_file_name}"`);
      console.log(`    ${s.manufacturer_norm} ${s.model_norm} (${s.asset_uid})`);
    });
  } else {
    console.log('❌ No records found with "0AJHC" in local_manual_file_name');
  }

  console.log('\n' + '='.repeat(70) + '\n');

  // 2. Check for any non-null local_manual_file_name values (first 10)
  const { data: nonNull, error: nonNullError } = await supabase
    .from('systems')
    .select('asset_uid, manufacturer_norm, model_norm, local_manual_file_name')
    .not('local_manual_file_name', 'is', null)
    .limit(10);

  if (nonNull && nonNull.length > 0) {
    console.log(`Sample of non-null local_manual_file_name values (first 10):`);
    nonNull.forEach(s => {
      console.log(`  - "${s.local_manual_file_name}"`);
      console.log(`    ${s.manufacturer_norm} ${s.model_norm} (${s.asset_uid})`);
    });
  } else {
    console.log('⚠️  No records found with non-null local_manual_file_name');
  }

  console.log('\n' + '='.repeat(70) + '\n');

  // 3. Count total records and records with local_manual_file_name
  const { count: totalCount } = await supabase
    .from('systems')
    .select('*', { count: 'exact', head: true });

  const { count: withManual } = await supabase
    .from('systems')
    .select('*', { count: 'exact', head: true })
    .not('local_manual_file_name', 'is', null);

  console.log('📊 Statistics:');
  console.log(`  Total systems: ${totalCount}`);
  console.log(`  With local_manual_file_name: ${withManual}`);
  console.log(`  Missing local_manual_file_name: ${totalCount - withManual}`);

  // 4. Look for the exact test file name in different ways
  console.log('\n' + '='.repeat(70) + '\n');
  console.log('🔎 Searching for test file in different ways:');

  const searches = [
    '0AJHC-EN0015_2019.12.pdf',
    '0AJHC-EN0015_2019.12',
    '0AJHC-EN0015',
    'EN0015_2019'
  ];

  for (const search of searches) {
    const { data, error } = await supabase
      .from('systems')
      .select('asset_uid, local_manual_file_name')
      .like('local_manual_file_name', `%${search}%`);

    if (data && data.length > 0) {
      console.log(`  ✓ Found with "${search}": ${data.length} record(s)`);
      data.forEach(d => console.log(`    - "${d.local_manual_file_name}"`));
    } else {
      console.log(`  ✗ Not found with "${search}"`);
    }
  }
}

checkLocalManualNames()
  .then(() => {
    console.log('\n✅ Done!');
    process.exit(0);
  })
  .catch(error => {
    console.error('❌ Error:', error);
    process.exit(1);
  });