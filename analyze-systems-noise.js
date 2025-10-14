import 'dotenv/config';
import { getSupabaseClient } from './src/repositories/supabaseClient.js';

async function analyzeSystemsNoise() {
  try {
    const supabase = await getSupabaseClient();

    console.log('\n=== SYSTEMS TABLE ANALYSIS ===\n');

    // Count total systems
    const { count: totalCount, error: totalError } = await supabase
      .from('systems')
      .select('*', { count: 'exact', head: true });

    if (totalError) throw totalError;
    console.log(`Total systems: ${totalCount}`);

    // Count systems with "Unknown" manufacturer
    const { count: unknownMfgCount, error: unknownMfgError } = await supabase
      .from('systems')
      .select('*', { count: 'exact', head: true })
      .ilike('manufacturer_norm', 'unknown');

    if (unknownMfgError) throw unknownMfgError;
    console.log(`Systems with "Unknown" manufacturer: ${unknownMfgCount}`);

    // Count systems with "Unknown" model
    const { count: unknownModelCount, error: unknownModelError } = await supabase
      .from('systems')
      .select('*', { count: 'exact', head: true })
      .ilike('model_norm', 'unknown');

    if (unknownModelError) throw unknownModelError;
    console.log(`Systems with "Unknown" model: ${unknownModelCount}`);

    // Count systems with null description
    const { count: nullDescCount, error: nullDescError } = await supabase
      .from('systems')
      .select('*', { count: 'exact', head: true })
      .is('description', null);

    if (nullDescError) throw nullDescError;
    console.log(`Systems with null description: ${nullDescCount}`);

    // Count systems with null manual_url
    const { count: nullManualCount, error: nullManualError } = await supabase
      .from('systems')
      .select('*', { count: 'exact', head: true })
      .is('manual_url', null);

    if (nullManualError) throw nullManualError;
    console.log(`Systems with null manual_url: ${nullManualCount}`);

    // Count systems with spaces in canonical_model_id
    const { data: spacesInCanonical, error: spacesError } = await supabase
      .from('systems')
      .select('asset_uid, manufacturer_norm, model_norm, canonical_model_id')
      .like('canonical_model_id', '% %');

    if (spacesError) throw spacesError;
    console.log(`Systems with spaces in canonical_model_id: ${spacesInCanonical?.length || 0}`);

    // Sample problematic records with "Unknown"
    console.log('\n=== SAMPLE "UNKNOWN" RECORDS ===\n');
    const { data: unknownRecords, error: unknownError } = await supabase
      .from('systems')
      .select('asset_uid, manufacturer_norm, model_norm, system_norm, subsystem_norm, canonical_model_id, description, manual_url')
      .or('manufacturer_norm.ilike.unknown,model_norm.ilike.unknown')
      .limit(10);

    if (unknownError) throw unknownError;

    if (unknownRecords && unknownRecords.length > 0) {
      unknownRecords.forEach((record, i) => {
        console.log(`${i + 1}. ${record.manufacturer_norm} ${record.model_norm}`);
        console.log(`   Asset UID: ${record.asset_uid}`);
        console.log(`   System: ${record.system_norm || 'NULL'}`);
        console.log(`   Subsystem: ${record.subsystem_norm || 'NULL'}`);
        console.log(`   Canonical ID: ${record.canonical_model_id || 'NULL'}`);
        console.log(`   Description: ${record.description?.substring(0, 60) || 'NULL'}...`);
        console.log(`   Manual URL: ${record.manual_url || 'NULL'}\n`);
      });
    } else {
      console.log('No "Unknown" records found.\n');
    }

    // Sample records with spaces in canonical_model_id
    console.log('\n=== SAMPLE RECORDS WITH SPACES IN CANONICAL_MODEL_ID ===\n');
    if (spacesInCanonical && spacesInCanonical.length > 0) {
      spacesInCanonical.slice(0, 10).forEach((record, i) => {
        console.log(`${i + 1}. ${record.manufacturer_norm} ${record.model_norm}`);
        console.log(`   Asset UID: ${record.asset_uid}`);
        console.log(`   Canonical ID: "${record.canonical_model_id}"`);
        console.log(`   Should be: "${record.canonical_model_id?.replace(/ /g, '_')}"\n`);
      });
    } else {
      console.log('No records with spaces in canonical_model_id.\n');
    }

    // Check for duplicate systems (same manufacturer + model)
    console.log('\n=== CHECKING FOR DUPLICATES ===\n');
    const { data: allSystems, error: allError } = await supabase
      .from('systems')
      .select('manufacturer_norm, model_norm, asset_uid, canonical_model_id');

    if (allError) throw allError;

    const duplicateMap = new Map();
    allSystems.forEach(sys => {
      const key = `${sys.manufacturer_norm}|${sys.model_norm}`;
      if (!duplicateMap.has(key)) {
        duplicateMap.set(key, []);
      }
      duplicateMap.get(key).push(sys);
    });

    const duplicates = Array.from(duplicateMap.entries()).filter(([key, systems]) => systems.length > 1);
    console.log(`Found ${duplicates.length} duplicate manufacturer+model combinations:`);

    if (duplicates.length > 0) {
      duplicates.slice(0, 5).forEach(([key, systems]) => {
        console.log(`\n  ${key.replace('|', ' ')} (${systems.length} records):`);
        systems.forEach(sys => {
          console.log(`    - ${sys.asset_uid} | ${sys.canonical_model_id}`);
        });
      });
      if (duplicates.length > 5) {
        console.log(`\n  ... and ${duplicates.length - 5} more duplicate sets`);
      }
    }

  } catch (error) {
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
  }

  process.exit(0);
}

analyzeSystemsNoise();
