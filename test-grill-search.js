#!/usr/bin/env node
/**
 * Test script to debug grill equipment search
 *
 * This script:
 * 1. Tests the search_systems RPC function with "grill"
 * 2. Manually searches all systems for grill-related terms
 * 3. Shows exactly what fields are populated for any potential matches
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Load environment
dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

console.log('🔍 Testing Grill Equipment Search\n');
console.log('=' .repeat(80));

// Test 1: Use the actual search_systems RPC
console.log('\n📋 TEST 1: search_systems RPC with "grill"');
console.log('-'.repeat(80));

try {
  const { data: rpcResults, error: rpcError } = await supabase.rpc('search_systems', {
    q: 'grill',
    top_n: 10
  });

  if (rpcError) {
    console.error('❌ RPC Error:', rpcError.message);
  } else {
    console.log(`✅ RPC returned ${rpcResults?.length || 0} results`);

    if (rpcResults && rpcResults.length > 0) {
      console.log('\nMatches found:');
      for (const result of rpcResults) {
        console.log(`  - asset_uid: ${result.asset_uid}, rank: ${result.rank}`);
      }
    } else {
      console.log('❌ No matches found via search_systems RPC');
    }
  }
} catch (err) {
  console.error('❌ Exception:', err.message);
}

// Test 2: Manual search for any grill-related terms
console.log('\n📋 TEST 2: Manual search for grill-related terms in ALL systems');
console.log('-'.repeat(80));

const searchTerms = ['grill', 'bbq', 'barbecue', 'magma', 'kenyon', 'force 10'];

try {
  const { data: allSystems, error: listError } = await supabase
    .from('systems')
    .select('asset_uid, manufacturer_norm, model_norm, system_norm, subsystem_norm, description, spec_keywords, synonyms_fts, colloquial_keywords')
    .order('manufacturer_norm');

  if (listError) {
    console.error('❌ List Error:', listError.message);
  } else {
    console.log(`✅ Retrieved ${allSystems?.length || 0} total systems`);

    // Search for grill-related terms
    const matches = [];

    for (const system of allSystems) {
      const searchableText = [
        system.manufacturer_norm,
        system.model_norm,
        system.system_norm,
        system.subsystem_norm,
        system.description,
        system.spec_keywords,
        system.synonyms_fts,
        system.colloquial_keywords
      ].filter(Boolean).join(' ').toLowerCase();

      const matchedTerms = searchTerms.filter(term =>
        searchableText.includes(term.toLowerCase())
      );

      if (matchedTerms.length > 0) {
        matches.push({
          system,
          matchedTerms
        });
      }
    }

    console.log(`\n🎯 Found ${matches.length} systems with grill-related terms:\n`);

    if (matches.length > 0) {
      for (const match of matches) {
        const s = match.system;
        console.log(`📦 ${s.asset_uid}`);
        console.log(`   Manufacturer: ${s.manufacturer_norm || '(empty)'}`);
        console.log(`   Model: ${s.model_norm || '(empty)'}`);
        console.log(`   System: ${s.system_norm || '(empty)'}`);
        console.log(`   Subsystem: ${s.subsystem_norm || '(empty)'}`);
        console.log(`   Description: ${s.description || '(empty)'}`);
        console.log(`   Spec Keywords: ${s.spec_keywords || '(empty)'}`);
        console.log(`   Synonyms FTS: ${s.synonyms_fts || '(empty)'}`);
        console.log(`   Colloquial: ${s.colloquial_keywords || '(empty)'}`);
        console.log(`   Matched terms: ${match.matchedTerms.join(', ')}`);
        console.log('');
      }
    } else {
      console.log('❌ NO GRILL-RELATED EQUIPMENT FOUND IN SYSTEMS TABLE\n');
      console.log('📝 Suggestions:');
      console.log('   1. Add your grill to the systems table via Admin → Systems');
      console.log('   2. Make sure to populate:');
      console.log('      - system_norm = "BBQ" or "Grill"');
      console.log('      - subsystem_norm = "Grill"');
      console.log('      - synonyms_fts should include "grill", "bbq", "barbecue"');
      console.log('      - description should mention "grill" or "BBQ"');
    }
  }
} catch (err) {
  console.error('❌ Exception:', err.message);
}

// Test 3: Show exact search query that would match
console.log('\n📋 TEST 3: Show PostgreSQL query that search_systems uses');
console.log('-'.repeat(80));
console.log(`
SELECT
  asset_uid,
  ts_rank(
    setweight(to_tsvector('english', COALESCE(model_norm, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(canonical_model_id, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(description, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(manufacturer_norm, '')), 'B') ||
    setweight(to_tsvector('english', COALESCE(system_norm, '')), 'C') ||
    setweight(to_tsvector('english', COALESCE(subsystem_norm, '')), 'C') ||
    setweight(to_tsvector('english', COALESCE(spec_keywords, '')), 'D') ||
    setweight(to_tsvector('english', COALESCE(synonyms_fts, '')), 'D'),
    plainto_tsquery('english', 'grill')
  ) as rank
FROM systems
WHERE
  to_tsvector('english',
    COALESCE(canonical_model_id, '') || ' ' ||
    COALESCE(manufacturer_norm, '') || ' ' ||
    COALESCE(model_norm, '') || ' ' ||
    COALESCE(system_norm, '') || ' ' ||
    COALESCE(subsystem_norm, '') || ' ' ||
    COALESCE(spec_keywords, '') || ' ' ||
    COALESCE(synonyms_fts, '') || ' ' ||
    COALESCE(description, '')
  ) @@ plainto_tsquery('english', 'grill')
ORDER BY rank DESC
LIMIT 10;
`);

console.log('\n' + '='.repeat(80));
console.log('✅ Test complete\n');
