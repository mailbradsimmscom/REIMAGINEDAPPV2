#!/usr/bin/env node
/**
 * Sample Systems Data - Show actual column values
 *
 * Show 10 sample systems with ALL fields to understand what data is available
 */

import { getSupabaseClient } from '../../src/repositories/supabaseClient.js';

async function sampleSystemsData() {
  console.log('📋 Fetching sample systems data...\n');

  const supabase = await getSupabaseClient();

  // Get 10 diverse samples (some with populated fields, some without)
  const { data: systems, error } = await supabase
    .from('systems')
    .select('*')
    .order('manufacturer_norm', { ascending: true })
    .limit(10);

  if (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }

  systems.forEach((sys, idx) => {
    console.log(`\n${'='.repeat(100)}`);
    console.log(`[${idx + 1}/10] ${sys.manufacturer_norm} - ${sys.model_norm}`);
    console.log('='.repeat(100));
    console.log(`Asset UID:          ${sys.asset_uid}`);
    console.log(`System:             ${sys.system_norm || 'NULL'}`);
    console.log(`Subsystem:          ${sys.subsystem_norm || 'NULL'}`);
    console.log(`Canonical Model ID: ${sys.canonical_model_id || 'NULL'}`);
    console.log(`Description:        ${sys.description || 'NULL'}`);
    console.log(`Manual URL:         ${sys.manual_url || 'NULL'}`);
    console.log(`OEM Page:           ${sys.oem_page || 'NULL'}`);
    console.log(`\nCurrent Keywords/Synonyms:`);
    console.log(`spec_keywords:      ${sys.spec_keywords ? sys.spec_keywords.substring(0, 80) + '...' : 'NULL'}`);
    console.log(`synonyms_fts:       ${sys.synonyms_fts ? sys.synonyms_fts.substring(0, 80) + '...' : 'NULL'}`);
    console.log(`synonyms_human:     ${sys.synonyms_human ? sys.synonyms_human.substring(0, 80) + '...' : 'NULL'}`);
  });

  console.log('\n' + '='.repeat(100));
  process.exit(0);
}

sampleSystemsData().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
