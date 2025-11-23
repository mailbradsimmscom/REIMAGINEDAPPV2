#!/usr/bin/env node

/**
 * Quick helper to run the Supabase search_systems RPC locally.
 *
 * Usage:
 *   node scripts/debug/search-systems.js bbq
 *
 * Falls back to "bbq" when no argument is provided.
 */

import process from 'node:process';
import { searchSystems } from '../../src/repositories/systems.repository.js';
import { isSupabaseConfigured } from '../../src/services/guards/index.js';

async function main() {
  if (!isSupabaseConfigured()) {
    console.error('❌ Supabase environment variables are missing. Please ensure SUPABASE_URL and a service key are set before running this script.');
    process.exit(1);
  }

  const term = process.argv[2] || 'bbq';
  console.log(`🔍 Running search_systems('${term}', 10)\n`);

  try {
    const results = await searchSystems(term, { limit: 10 });

    if (!results.length) {
      console.log('⚠️ No matches returned by search_systems.');
      return;
    }

    results.forEach((row, idx) => {
      console.log(
        `${idx + 1}. ${row.manufacturer_norm ?? 'Unknown'} ${row.model_norm ?? ''}`.trim()
      );
      console.log(`   asset_uid: ${row.asset_uid}`);
      console.log(`   rank: ${row.rank}`);
      if (row.system_norm || row.subsystem_norm) {
        console.log(`   system: ${row.system_norm ?? '-'} › ${row.subsystem_norm ?? '-'}`);
      }
      console.log('');
    });

    console.log(`✅ ${results.length} result(s) returned.`);
  } catch (error) {
    console.error('❌ search_systems RPC failed:', error.message);
    if (error.context) {
      console.error('Context:', error.context);
    }
    process.exitCode = 1;
  }
}

main();

