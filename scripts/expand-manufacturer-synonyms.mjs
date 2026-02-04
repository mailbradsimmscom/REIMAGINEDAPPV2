#!/usr/bin/env node
/**
 * Expand ref_manufacturers.synonyms[] via LLM
 *
 * LLM-enriches ref_manufacturers.synonyms[]:
 * - Fills 33 empty rows with colloquial, abbreviation, misspelling variants
 * - Enriches 18 thin rows (corporate-only variants) with richer synonyms
 *
 * Usage:
 *   node scripts/expand-manufacturer-synonyms.mjs                  # Process all needing enrichment
 *   node scripts/expand-manufacturer-synonyms.mjs --dry-run        # Preview without DB writes
 *   node scripts/expand-manufacturer-synonyms.mjs --name "B&G"    # Process single manufacturer
 *   node scripts/expand-manufacturer-synonyms.mjs --force          # Regenerate all (even populated)
 *   node scripts/expand-manufacturer-synonyms.mjs --all            # Process all rows (even populated)
 */

import OpenAI from 'openai';
import { getEnv } from '../src/config/env.js';
import { getSupabaseClient } from '../src/repositories/supabaseClient.js';

// Lazy-load OpenAI client
let openai = null;
function getOpenAIClient() {
  if (!openai) {
    const env = getEnv();
    openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  }
  return openai;
}

// Parse CLI args
const args = process.argv.slice(2);
const flags = {
  dryRun: args.includes('--dry-run'),
  force: args.includes('--force'),
  all: args.includes('--all'),
  name: args.includes('--name') ? args[args.indexOf('--name') + 1] : null,
  help: args.includes('--help')
};

if (flags.help) {
  console.log(`
Usage:
  node scripts/expand-manufacturer-synonyms.mjs                  # Empty + thin rows
  node scripts/expand-manufacturer-synonyms.mjs --dry-run        # Preview only
  node scripts/expand-manufacturer-synonyms.mjs --name "B&G"     # Single manufacturer
  node scripts/expand-manufacturer-synonyms.mjs --force --all    # Regenerate all
  `);
  process.exit(0);
}

const SYNONYMS_PROMPT = `You are a marine equipment industry expert. Generate all terms a boat owner, marine technician, or dealer might use to refer to this manufacturer.

Manufacturer: {manufacturer}
{existingContext}

Include:
1. Full corporate/legal name (e.g., "Brookes and Gatehouse" for "B&G")
2. Common abbreviations and shortenings (e.g., "B&G" for "Brookes & Gatehouse")
3. Common misspellings and phonetic variants (e.g., "Keynon" for "Kenyon", "Shenker" for "Schenker")
4. Brand family names or parent company names if well-known
5. Alternate formatting (e.g., "B and G", "BandG", "B+G")
6. Colloquial references boat owners use

Do NOT include:
- Product model names (only manufacturer/brand names)
- Overly generic terms

Return ONLY a JSON array of strings. Example:
["Brookes and Gatehouse", "Brookes & Gatehouse", "B and G", "BandG", "B+G", "Navico B&G"]`;

/**
 * Generate manufacturer synonyms via LLM
 */
async function generateManufacturerSynonyms(manufacturer, existingSynonyms) {
  const env = getEnv();
  const model = env.OPENAI_SUMMARY_MODEL || 'gpt-4o-mini';

  let existingContext = '';
  if (existingSynonyms && existingSynonyms.length > 0) {
    existingContext = `\nExisting synonyms (enhance, don't repeat): ${existingSynonyms.join(', ')}`;
  }

  const prompt = SYNONYMS_PROMPT
    .replace('{manufacturer}', manufacturer)
    .replace('{existingContext}', existingContext);

  const response = await getOpenAIClient().chat.completions.create({
    model,
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 500,
    temperature: 0.4
  });

  const raw = response.choices[0].message.content.trim();

  try {
    // Strip markdown code fences (handles newlines between fence and content)
    let cleaned = raw.replace(/^```(?:json)?\s*/is, '').replace(/\s*```\s*$/is, '');
    // If JSON is truncated (missing closing bracket), attempt recovery
    if (!cleaned.endsWith(']')) {
      const lastComma = cleaned.lastIndexOf(',');
      const lastQuote = cleaned.lastIndexOf('"');
      if (lastComma > 0 && lastQuote > lastComma) {
        cleaned = cleaned.substring(0, lastQuote + 1) + ']';
      } else if (lastComma > 0) {
        cleaned = cleaned.substring(0, lastComma) + ']';
      }
    }
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) {
      return parsed.filter(s => typeof s === 'string' && s.trim().length > 0);
    }
    return [];
  } catch {
    console.warn(`  ⚠ Failed to parse LLM output for ${manufacturer}: ${raw.substring(0, 100)}`);
    return [];
  }
}

async function main() {
  const supabase = await getSupabaseClient();
  const stats = { processed: 0, enriched: 0, skipped: 0, errors: 0 };

  console.log(`\n🔧 Expand ref_manufacturers.synonyms[] via LLM`);
  console.log(`   Mode: ${flags.dryRun ? 'DRY RUN' : 'LIVE'}${flags.force ? ' (force)' : ''}`);
  console.log('');

  // Fetch manufacturers
  let query = supabase
    .from('ref_manufacturers')
    .select('id, name, synonyms')
    .order('name');

  if (flags.name) {
    query = query.eq('name', flags.name);
  }

  const { data: manufacturers, error: fetchError } = await query;

  if (fetchError) {
    console.error('❌ Failed to fetch manufacturers:', fetchError.message);
    process.exit(1);
  }

  if (!manufacturers || manufacturers.length === 0) {
    console.log('No manufacturers found.');
    process.exit(0);
  }

  // Filter based on mode
  let toProcess;
  if (flags.force || flags.all || flags.name) {
    toProcess = manufacturers;
  } else {
    // Default: only empty or thin (<=3 synonyms) rows
    toProcess = manufacturers.filter(m => {
      const syns = m.synonyms || [];
      return syns.length <= 3;
    });
  }

  console.log(`Total manufacturers: ${manufacturers.length}`);
  console.log(`To process: ${toProcess.length}\n`);

  for (let i = 0; i < toProcess.length; i++) {
    const mfr = toProcess[i];
    const existing = mfr.synonyms || [];

    console.log(`[${i + 1}/${toProcess.length}] ${mfr.name} (${existing.length} existing synonym(s))`);

    // Skip well-populated rows unless --force
    if (!flags.force && existing.length > 3) {
      console.log('  ⏭ Well-populated, skipping (use --force to regenerate)');
      stats.skipped++;
      continue;
    }

    // Generate synonyms via LLM
    let newSynonyms;
    try {
      newSynonyms = await generateManufacturerSynonyms(mfr.name, existing);
    } catch (err) {
      console.error(`  ❌ LLM error: ${err.message}`);
      stats.errors++;
      continue;
    }

    if (newSynonyms.length === 0) {
      console.log('  ⚠ No synonyms generated');
      stats.processed++;
      continue;
    }

    // Merge with existing (case-insensitive dedup)
    const seen = new Set(existing.map(s => s.toLowerCase()));
    // Don't include the manufacturer name itself
    seen.add(mfr.name.toLowerCase());
    const merged = [...existing];

    for (const syn of newSynonyms) {
      const key = syn.trim().toLowerCase();
      if (key && !seen.has(key)) {
        seen.add(key);
        merged.push(syn.trim());
      }
    }

    const added = merged.length - existing.length;
    console.log(`  Generated ${newSynonyms.length} → ${added} new after dedup (total: ${merged.length})`);

    if (added === 0) {
      console.log('  ⏭ No new synonyms after dedup');
      stats.processed++;
      continue;
    }

    if (flags.dryRun) {
      console.log(`  [DRY] Would update: [${merged.join(', ')}]`);
      stats.enriched++;
      stats.processed++;
      continue;
    }

    try {
      const { error: updateError } = await supabase
        .from('ref_manufacturers')
        .update({ synonyms: merged })
        .eq('id', mfr.id);

      if (updateError) {
        console.error(`  ❌ Update error: ${updateError.message}`);
        stats.errors++;
      } else {
        console.log(`  ✅ Updated: +${added} synonyms`);
        stats.enriched++;
      }
    } catch (err) {
      console.error(`  ❌ Update error: ${err.message}`);
      stats.errors++;
    }

    stats.processed++;

    // Rate limiting
    if (i < toProcess.length - 1) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Summary${flags.dryRun ? ' (DRY RUN)' : ''}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Manufacturers processed: ${stats.processed}
  Enriched:                ${stats.enriched}
  Skipped:                 ${stats.skipped}
  Errors:                  ${stats.errors}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
