// scripts/bulk/check-duplicates.js
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

/**
 * Check for Duplicate Systems
 *
 * Finds all duplicate entries in the systems table
 * based on manufacturer_norm and model_norm combinations
 */

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function checkDuplicates() {
  console.log('🔍 Checking for duplicate systems in database...\n');
  console.log('=' + '='.repeat(70));

  try {
    // Get all systems
    const { data: systems, error } = await supabase
      .from('systems')
      .select('asset_uid, manufacturer_norm, model_norm, local_manual_file_name, updated_at')
      .order('manufacturer_norm', { ascending: true })
      .order('model_norm', { ascending: true });

    if (error) {
      console.error('❌ Error fetching systems:', error);
      return;
    }

    console.log(`📊 Total systems in database: ${systems.length}\n`);

    // Group by manufacturer_norm and model_norm
    const grouped = {};

    systems.forEach(system => {
      const key = `${system.manufacturer_norm}|||${system.model_norm}`;
      if (!grouped[key]) {
        grouped[key] = [];
      }
      grouped[key].push(system);
    });

    // Find duplicates
    const duplicates = Object.entries(grouped)
      .filter(([key, items]) => items.length > 1)
      .sort((a, b) => b[1].length - a[1].length); // Sort by number of duplicates

    console.log(`🔴 Found ${duplicates.length} duplicate combinations:\n`);
    console.log('=' + '='.repeat(70));

    if (duplicates.length === 0) {
      console.log('✅ No duplicates found!\n');
      return;
    }

    // Display duplicates
    duplicates.forEach(([key, items], index) => {
      const [manufacturer, model] = key.split('|||');

      console.log(`\n${index + 1}. "${manufacturer}" / "${model}" (${items.length} duplicates)`);
      console.log('   ' + '-'.repeat(65));

      items.forEach((item, i) => {
        console.log(`   ${i + 1}. Asset UID: ${item.asset_uid}`);
        if (item.local_manual_file_name) {
          console.log(`      Manual: ${item.local_manual_file_name}`);
        }
        console.log(`      Updated: ${new Date(item.updated_at).toLocaleDateString()}`);
      });
    });

    console.log('\n' + '='.repeat(70));
    console.log('📊 SUMMARY');
    console.log('=' + '='.repeat(70));
    console.log(`Total duplicate combinations: ${duplicates.length}`);
    console.log(`Total duplicate records: ${duplicates.reduce((sum, [key, items]) => sum + items.length, 0)}`);
    console.log(`Unique records that have duplicates: ${duplicates.reduce((sum, [key, items]) => sum + items.length - 1, 0)}`);

    // Check specifically for problematic ones from our PDFs
    console.log('\n' + '='.repeat(70));
    console.log('🎯 CHECKING SPECIFIC PROBLEMATIC CASES');
    console.log('=' + '='.repeat(70));

    const problematicCases = [
      { manufacturer: 'Victron', model: 'cerbo_gx' },
      { manufacturer: 'Victron', model: 'cerbo gx' },
      { manufacturer: 'B&G', model: 'halo24_plus' },
      { manufacturer: 'B&G', model: 'halo24 plus' },
      { manufacturer: 'Cyclops Marine', model: 'smartfittings_gateway' }
    ];

    for (const testCase of problematicCases) {
      const { data, error } = await supabase
        .from('systems')
        .select('asset_uid, manufacturer_norm, model_norm')
        .ilike('manufacturer_norm', testCase.manufacturer)
        .ilike('model_norm', testCase.model);

      if (data && data.length > 0) {
        console.log(`\n✓ "${testCase.manufacturer}" + "${testCase.model}": ${data.length} match(es)`);
        data.forEach(d => {
          console.log(`  - ${d.asset_uid} (${d.manufacturer_norm} / ${d.model_norm})`);
        });
      } else {
        console.log(`\n✗ "${testCase.manufacturer}" + "${testCase.model}": No matches`);
      }
    }

    console.log('\n' + '='.repeat(70));
    console.log('\n💡 RECOMMENDATIONS:');
    console.log('1. Clean up duplicate records in the systems table');
    console.log('2. OR modify batch-upload-pdfs.js to use .limit(1) instead of .single()');
    console.log('3. OR add a unique constraint on (manufacturer_norm, model_norm) after cleanup');
    console.log('');

  } catch (error) {
    console.error('❌ Fatal error:', error);
  }
}

// Run the check
console.log('🚀 Duplicate Systems Checker\n');
checkDuplicates()
  .then(() => {
    console.log('✅ Check complete!');
    process.exit(0);
  })
  .catch(error => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });