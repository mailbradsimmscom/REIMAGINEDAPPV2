#!/usr/bin/env node
/**
 * Analyze Systems Table - Keyword and Synonym Fields
 *
 * Examines ALL rows in the systems table to understand current state of:
 * - spec_keywords (text)
 * - synonyms_fts (text)
 * - synonyms_human (text)
 * - spec_keywords_jsonb (jsonb)
 * - synonyms_jsonb (jsonb)
 * - colloquial_keywords (text)
 */

import { getSupabaseClient } from '../../src/repositories/supabaseClient.js';

async function analyzeSystems() {
  console.log('🔍 Analyzing ALL systems in database...\n');

  const supabase = await getSupabaseClient();

  // Fetch ALL systems (table has < 150 rows)
  const { data: systems, error } = await supabase
    .from('systems')
    .select('asset_uid, manufacturer_norm, model_norm, spec_keywords, synonyms_fts, synonyms_human, spec_keywords_jsonb, synonyms_jsonb, colloquial_keywords')
    .order('manufacturer_norm', { ascending: true });

  if (error) {
    console.error('❌ Error fetching systems:', error);
    process.exit(1);
  }

  console.log(`📊 Total systems: ${systems.length}\n`);
  console.log('='.repeat(100));

  // Stats tracking
  const stats = {
    total: systems.length,
    spec_keywords: { populated: 0, empty: 0, null: 0 },
    synonyms_fts: { populated: 0, empty: 0, null: 0 },
    synonyms_human: { populated: 0, empty: 0, null: 0 },
    spec_keywords_jsonb: { populated: 0, empty: 0, null: 0 },
    synonyms_jsonb: { populated: 0, empty: 0, null: 0 },
    colloquial_keywords: { populated: 0, empty: 0, null: 0 }
  };

  // Analyze each system
  systems.forEach((sys, idx) => {
    // Track stats
    trackFieldStats(stats.spec_keywords, sys.spec_keywords);
    trackFieldStats(stats.synonyms_fts, sys.synonyms_fts);
    trackFieldStats(stats.synonyms_human, sys.synonyms_human);
    trackFieldStats(stats.spec_keywords_jsonb, sys.spec_keywords_jsonb);
    trackFieldStats(stats.synonyms_jsonb, sys.synonyms_jsonb);
    trackFieldStats(stats.colloquial_keywords, sys.colloquial_keywords);

    // Show first 10 and last 10 as examples
    if (idx < 10 || idx >= systems.length - 10) {
      console.log(`\n[${idx + 1}/${systems.length}] ${sys.manufacturer_norm} - ${sys.model_norm}`);
      console.log(`Asset UID: ${sys.asset_uid}`);
      console.log(`  spec_keywords:        ${describeField(sys.spec_keywords)}`);
      console.log(`  synonyms_fts:         ${describeField(sys.synonyms_fts)}`);
      console.log(`  synonyms_human:       ${describeField(sys.synonyms_human)}`);
      console.log(`  spec_keywords_jsonb:  ${describeField(sys.spec_keywords_jsonb)}`);
      console.log(`  synonyms_jsonb:       ${describeField(sys.synonyms_jsonb)}`);
      console.log(`  colloquial_keywords:  ${describeField(sys.colloquial_keywords)}`);
    } else if (idx === 10) {
      console.log(`\n... (showing first 10 and last 10) ...\n`);
    }
  });

  // Print summary stats
  console.log('\n' + '='.repeat(100));
  console.log('\n📈 SUMMARY STATISTICS\n');
  console.log(`Total systems: ${stats.total}\n`);

  printFieldStats('spec_keywords', stats.spec_keywords);
  printFieldStats('synonyms_fts', stats.synonyms_fts);
  printFieldStats('synonyms_human', stats.synonyms_human);
  printFieldStats('spec_keywords_jsonb', stats.spec_keywords_jsonb);
  printFieldStats('synonyms_jsonb', stats.synonyms_jsonb);
  printFieldStats('colloquial_keywords', stats.colloquial_keywords);

  console.log('\n' + '='.repeat(100));

  // Key findings
  console.log('\n🔑 KEY FINDINGS:\n');

  if (stats.spec_keywords_jsonb.empty === stats.total) {
    console.log('✓ spec_keywords_jsonb is EMPTY in ALL rows (all are {})');
  } else {
    console.log(`⚠ spec_keywords_jsonb has data in ${stats.spec_keywords_jsonb.populated} rows`);
  }

  if (stats.synonyms_jsonb.empty === stats.total) {
    console.log('✓ synonyms_jsonb is EMPTY in ALL rows (all are {})');
  } else {
    console.log(`⚠ synonyms_jsonb has data in ${stats.synonyms_jsonb.populated} rows`);
  }

  console.log(`\nspec_keywords:     ${stats.spec_keywords.populated} populated, ${stats.spec_keywords.empty + stats.spec_keywords.null} empty/null`);
  console.log(`synonyms_fts:      ${stats.synonyms_fts.populated} populated, ${stats.synonyms_fts.empty + stats.synonyms_fts.null} empty/null`);
  console.log(`synonyms_human:    ${stats.synonyms_human.populated} populated, ${stats.synonyms_human.empty + stats.synonyms_human.null} empty/null`);
  console.log(`colloquial_keywords: ${stats.colloquial_keywords.populated} populated, ${stats.colloquial_keywords.empty + stats.colloquial_keywords.null} empty/null`);

  console.log('\n');
  process.exit(0);
}

function trackFieldStats(stats, value) {
  if (value === null || value === undefined) {
    stats.null++;
  } else if (typeof value === 'string') {
    if (value.trim().length === 0) {
      stats.empty++;
    } else {
      stats.populated++;
    }
  } else if (typeof value === 'object') {
    if (Object.keys(value).length === 0) {
      stats.empty++;
    } else {
      stats.populated++;
    }
  }
}

function describeField(value) {
  if (value === null || value === undefined) {
    return 'NULL';
  } else if (typeof value === 'string') {
    if (value.trim().length === 0) {
      return 'EMPTY STRING';
    } else {
      const preview = value.substring(0, 50);
      return `"${preview}${value.length > 50 ? '...' : ''}" (${value.length} chars)`;
    }
  } else if (typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 0) {
      return 'EMPTY OBJECT {}';
    } else {
      return `OBJECT with ${keys.length} keys: ${JSON.stringify(value).substring(0, 50)}...`;
    }
  }
  return 'UNKNOWN TYPE';
}

function printFieldStats(name, stats) {
  console.log(`${name}:`);
  console.log(`  Populated: ${stats.populated}`);
  console.log(`  Empty:     ${stats.empty}`);
  console.log(`  Null:      ${stats.null}`);
  console.log('');
}

// Run analysis
analyzeSystems().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
