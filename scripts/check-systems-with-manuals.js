#!/usr/bin/env node
/**
 * List all systems with manual=true
 */

import { getSupabaseClient } from '../src/repositories/supabaseClient.js';

async function main() {
  try {
    const supabase = await getSupabaseClient();

    console.log('📖 Fetching systems with manual=true...\n');

    const { data, error } = await supabase
      .from('systems')
      .select('asset_uid, manufacturer_norm, model_norm, system_norm, subsystem_norm, description, colloquial_keywords')
      .eq('manual', true)
      .order('manufacturer_norm', { ascending: true })
      .order('model_norm', { ascending: true });

    if (error) {
      throw error;
    }

    if (!data || data.length === 0) {
      console.log('No systems found with manual=true');
      return;
    }

    console.log(`Found ${data.length} systems with manuals:\n`);
    console.log('='.repeat(120));
    console.log('Manufacturer'.padEnd(20), 'Model'.padEnd(35), 'System'.padEnd(20), 'Has Keywords');
    console.log('='.repeat(120));

    for (const system of data) {
      const hasKeywords = system.colloquial_keywords && system.colloquial_keywords.trim().length > 0 ? '✅' : '❌';
      console.log(
        system.manufacturer_norm.padEnd(20),
        system.model_norm.padEnd(35),
        (system.system_norm || '').padEnd(20),
        hasKeywords
      );
    }

    console.log('='.repeat(120));
    console.log(`\nTotal: ${data.length} systems`);

    const withKeywords = data.filter(s => s.colloquial_keywords && s.colloquial_keywords.trim().length > 0).length;
    const withoutKeywords = data.length - withKeywords;

    console.log(`✅ With colloquial keywords: ${withKeywords}`);
    console.log(`❌ Without colloquial keywords: ${withoutKeywords}`);

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
