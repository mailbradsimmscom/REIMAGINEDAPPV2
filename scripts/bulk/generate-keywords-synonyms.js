#!/usr/bin/env node
/**
 * Generate Keywords and Synonyms for Systems
 *
 * One-time script to generate spec_keywords and synonyms (fts + human) for systems
 * using LLM based on manufacturer, model, system, subsystem, and description.
 *
 * Usage:
 *   node scripts/bulk/generate-keywords-synonyms.js --asset-uid <uuid>
 *   node scripts/bulk/generate-keywords-synonyms.js --csv <path-to-csv>
 *   node scripts/bulk/generate-keywords-synonyms.js --all
 *   node scripts/bulk/generate-keywords-synonyms.js --dry-run --asset-uid <uuid>
 *
 * Options:
 *   --asset-uid <uuid>  Process single system by asset_uid
 *   --csv <path>        Process multiple systems from CSV file (one asset_uid per line)
 *   --all               Process ALL systems that are missing keywords/synonyms
 *   --dry-run           Show what would be generated without updating database
 *   --force             Regenerate even if keywords/synonyms already exist
 *   --help              Show this help message
 *
 * Examples:
 *   # Single system
 *   node scripts/bulk/generate-keywords-synonyms.js --asset-uid dced0407-7762-9022-097a-bd0d30ea2509
 *
 *   # From CSV file
 *   node scripts/bulk/generate-keywords-synonyms.js --csv systems-to-update.csv
 *
 *   # All missing systems
 *   node scripts/bulk/generate-keywords-synonyms.js --all
 *
 *   # Dry run
 *   node scripts/bulk/generate-keywords-synonyms.js --dry-run --asset-uid <uuid>
 */

import fs from 'fs';
import OpenAI from 'openai';
import { getEnv } from '../../src/config/env.js';
import { getSupabaseClient } from '../../src/repositories/supabaseClient.js';
import { logger } from '../../src/utils/logger.js';

const requestLogger = logger.createModuleLogger('generate-keywords-synonyms');

// Lazy-load OpenAI client
let openai = null;
function getOpenAIClient() {
  if (!openai) {
    const env = getEnv();
    openai = new OpenAI({
      apiKey: env.OPENAI_API_KEY
    });
  }
  return openai;
}

// Prompts
const KEYWORDS_PROMPT = `You are a marine equipment search expert. Generate searchable keywords that describe what this equipment IS and what it DOES.

Equipment Details:
Manufacturer: {manufacturer}
Model: {model}
System: {system}
Subsystem: {subsystem}
Description: {description}

Rules:
- Focus on FUNCTION and PURPOSE (what it does, not just what it's called)
- Include equipment type, technology, features, and use cases
- Use marine industry terminology
- Keep keywords concise (1-3 words each)
- Return 5-15 keywords as a single space-separated string
- NO manufacturer or model names
- NO marketing fluff, only searchable technical terms

Examples:
- For a radar: "radar dome solid-state pulse compression 24 nm close target separation"
- For an EPIRB: "emergency beacon epirb plb distress"
- For a depth sounder: "depth speed temperature triducer bluetooth nmea2000"

Return ONLY the keyword string, nothing else.`;

const SYNONYMS_PROMPT = `You are a marine equipment search expert. Generate search terms a boat owner or technician might use to find this product. Focus on MEANING, not formatting.

Equipment Details:
Manufacturer: {manufacturer}
Model: {model}
Description: {description}

Priority (most to least important):
1. Semantic/colloquial terms — what boat owners call it (e.g., "watermaker", "desal", "marine grill", "BBQ", "nav screen")
2. Brand + product combinations (e.g., "Kenyon grill", "B&G plotter", "Schenker watermaker")
3. Common misspellings and phonetic variants (e.g., "Keynon", "Shenker", "Furuno" vs "Faruno")
4. Abbreviations and acronyms (e.g., "MFD", "AP", "RO", "DST")
5. A small set of format variants — model with/without spaces/hyphens (e.g., "ZEN 150", "ZEN-150", "ZEN150")

Do NOT:
- Repeat the same word with only case changes (one form is enough)
- Generate dozens of spacing/hyphen permutations
- Pad output with near-duplicate entries

Return as a space-separated string. Generate as many DISTINCT, USEFUL terms as possible.

Return ONLY the synonym string, nothing else.`;

// Parse CLI arguments
const args = process.argv.slice(2);
const flags = {
  assetUid: null,
  csv: null,
  all: args.includes('--all'),
  dryRun: args.includes('--dry-run'),
  force: args.includes('--force'),
  help: args.includes('--help')
};

const assetUidIndex = args.indexOf('--asset-uid');
if (assetUidIndex !== -1 && args[assetUidIndex + 1]) {
  flags.assetUid = args[assetUidIndex + 1];
}

const csvIndex = args.indexOf('--csv');
if (csvIndex !== -1 && args[csvIndex + 1]) {
  flags.csv = args[csvIndex + 1];
}

// Show help
if (flags.help) {
  console.log(`
Generate Keywords and Synonyms for Systems

Usage:
  node scripts/bulk/generate-keywords-synonyms.js --asset-uid <uuid>
  node scripts/bulk/generate-keywords-synonyms.js --csv <path-to-csv>
  node scripts/bulk/generate-keywords-synonyms.js --all
  node scripts/bulk/generate-keywords-synonyms.js --dry-run --asset-uid <uuid>

Options:
  --asset-uid <uuid>  Process single system by asset_uid
  --csv <path>        Process multiple systems from CSV file (one asset_uid per line)
  --all               Process ALL systems that are missing keywords/synonyms
  --dry-run           Show what would be generated without updating database
  --force             Regenerate even if keywords/synonyms already exist
  --help              Show this help message

Examples:
  # Single system
  node scripts/bulk/generate-keywords-synonyms.js --asset-uid dced0407-7762-9022-097a-bd0d30ea2509

  # From CSV file
  node scripts/bulk/generate-keywords-synonyms.js --csv systems-to-update.csv

  # All missing systems
  node scripts/bulk/generate-keywords-synonyms.js --all
  `);
  process.exit(0);
}

// ============================================================================
// GENERATION FUNCTIONS
// ============================================================================

async function generateKeywords(system) {
  const env = getEnv();
  const model = env.OPENAI_SUMMARY_MODEL || 'gpt-4o-mini';

  const prompt = KEYWORDS_PROMPT
    .replace('{manufacturer}', system.manufacturer_norm || 'Unknown')
    .replace('{model}', system.model_norm || 'Unknown')
    .replace('{system}', system.system_norm || 'Unknown')
    .replace('{subsystem}', system.subsystem_norm || 'Unknown')
    .replace('{description}', system.description || 'No description available');

  const response = await getOpenAIClient().chat.completions.create({
    model: model,
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 100,
    temperature: 0.3
  });

  return response.choices[0].message.content.trim();
}

async function generateSynonyms(system) {
  const env = getEnv();
  const model = env.OPENAI_SUMMARY_MODEL || 'gpt-4o-mini';

  const prompt = SYNONYMS_PROMPT
    .replace('{manufacturer}', system.manufacturer_norm || 'Unknown')
    .replace('{model}', system.model_norm || 'Unknown')
    .replace('{description}', system.description || 'No description available');

  const response = await getOpenAIClient().chat.completions.create({
    model: model,
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 600,
    temperature: 0.5
  });

  return response.choices[0].message.content.trim();
}

// ============================================================================
// PROCESSING FUNCTIONS
// ============================================================================

async function processSystem(assetUid, stats) {
  const supabase = await getSupabaseClient();

  try {
    // Fetch system
    const { data: system, error: fetchError } = await supabase
      .from('systems')
      .select('*')
      .eq('asset_uid', assetUid)
      .single();

    if (fetchError || !system) {
      console.log(`❌ System not found: ${assetUid}`);
      stats.failed++;
      return;
    }

    console.log(`\n${'='.repeat(80)}`);
    console.log(`${system.manufacturer_norm} - ${system.model_norm}`);
    console.log(`Asset UID: ${assetUid}`);
    console.log(`${'='.repeat(80)}`);

    // Check if already populated
    if (!flags.force && system.spec_keywords && system.synonyms_fts && system.synonyms_human) {
      console.log('⏭️  Already has keywords and synonyms (use --force to regenerate)');
      stats.skipped++;
      return;
    }

    const startTime = Date.now();

    // Generate keywords
    console.log('📝 Generating keywords...');
    const keywords = await generateKeywords(system);
    console.log(`   ✓ Keywords: ${keywords.substring(0, 80)}${keywords.length > 80 ? '...' : ''}`);

    // Generate synonyms
    console.log('🔤 Generating synonyms...');
    const synonyms = await generateSynonyms(system);
    console.log(`   ✓ Synonyms: ${synonyms.substring(0, 80)}${synonyms.length > 80 ? '...' : ''}`);

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);

    // Estimate tokens and cost
    const estimatedTokens = 500; // Rough estimate for both calls
    const estimatedCost = (estimatedTokens / 1_000_000) * 0.15; // GPT-4o-mini pricing

    stats.totalTokens += estimatedTokens;
    stats.totalCost += estimatedCost;

    // Update database (if not dry run)
    if (!flags.dryRun) {
      console.log('💾 Updating database...');
      const { error: updateError } = await supabase
        .from('systems')
        .update({
          spec_keywords: keywords,
          synonyms_fts: synonyms,
          synonyms_human: synonyms, // Same for both
          updated_at: new Date().toISOString()
        })
        .eq('asset_uid', assetUid);

      if (updateError) {
        console.log(`   ❌ Update failed: ${updateError.message}`);
        stats.failed++;
        return;
      }

      console.log('   ✓ Database updated');
    } else {
      console.log('💾 [DRY RUN] Would update database');
    }

    console.log(`\n✅ Complete in ${duration}s (est. tokens: ${estimatedTokens}, cost: $${estimatedCost.toFixed(6)})`);
    stats.success++;

  } catch (error) {
    console.log(`\n❌ Error: ${error.message}`);
    stats.failed++;
  }
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log('🚀 Generate Keywords and Synonyms for Systems\n');

  if (flags.dryRun) {
    console.log('⚠️  DRY RUN MODE - No database updates will be made\n');
  }

  const stats = {
    total: 0,
    success: 0,
    failed: 0,
    skipped: 0,
    totalTokens: 0,
    totalCost: 0
  };

  let assetUids = [];

  // Determine which systems to process
  if (flags.assetUid) {
    // Single asset_uid
    assetUids = [flags.assetUid];
  } else if (flags.csv) {
    // Read from CSV file
    if (!fs.existsSync(flags.csv)) {
      console.error(`❌ CSV file not found: ${flags.csv}`);
      process.exit(1);
    }

    const content = fs.readFileSync(flags.csv, 'utf-8');
    assetUids = content
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0 && !line.startsWith('#'));

    console.log(`📄 Loaded ${assetUids.length} asset_uids from CSV\n`);
  } else if (flags.all) {
    // Process all systems missing keywords/synonyms
    const supabase = await getSupabaseClient();
    const { data: systems, error } = await supabase
      .from('systems')
      .select('asset_uid, manufacturer_norm, model_norm, spec_keywords, synonyms_fts, synonyms_human')
      .order('manufacturer_norm', { ascending: true });

    if (error) {
      console.error('❌ Error fetching systems:', error);
      process.exit(1);
    }

    // Filter systems missing keywords or synonyms
    const missingSystems = systems.filter(s =>
      !s.spec_keywords || !s.synonyms_fts || !s.synonyms_human
    );

    assetUids = missingSystems.map(s => s.asset_uid);
    console.log(`📋 Found ${assetUids.length} systems missing keywords/synonyms (out of ${systems.length} total)\n`);
  } else {
    console.error('❌ Must specify --asset-uid, --csv, or --all');
    console.log('Run with --help for usage information');
    process.exit(1);
  }

  stats.total = assetUids.length;

  if (stats.total === 0) {
    console.log('✅ No systems to process');
    process.exit(0);
  }

  // Process each system
  for (let i = 0; i < assetUids.length; i++) {
    console.log(`\nProcessing ${i + 1}/${stats.total}`);
    await processSystem(assetUids[i], stats);

    // Small delay between requests
    if (i < assetUids.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  // Summary
  console.log(`\n${'='.repeat(80)}`);
  console.log('📊 SUMMARY');
  console.log('='.repeat(80));
  console.log(`Total:     ${stats.total}`);
  console.log(`✅ Success: ${stats.success}`);
  console.log(`⏭️  Skipped: ${stats.skipped}`);
  console.log(`❌ Failed:  ${stats.failed}`);
  console.log(`\n💰 Estimated Cost:`);
  console.log(`Tokens:    ${stats.totalTokens.toLocaleString()}`);
  console.log(`Cost:      $${stats.totalCost.toFixed(4)}`);
  console.log('='.repeat(80));

  if (flags.dryRun) {
    console.log('\n⚠️  DRY RUN - No changes were made to the database');
  }

  process.exit(0);
}

// Run
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
