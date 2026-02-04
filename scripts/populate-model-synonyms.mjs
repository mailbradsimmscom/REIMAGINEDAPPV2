#!/usr/bin/env node
/**
 * Populate ref_model_synonyms from ref_canonical_models via LLM
 *
 * Iterates all canonical models (54 rows), generates alternative model name
 * variants via LLM, and inserts into ref_model_synonyms with synonym_norm
 * computed via normalizeModelKey().
 *
 * Only generates synonyms whose normalized form differs from the canonical's
 * canonical_norm — otherwise the lookup in canonicalize_model() would already
 * resolve via ref_canonical_models directly.
 *
 * Usage:
 *   node scripts/populate-model-synonyms.mjs                  # Process all canonical models
 *   node scripts/populate-model-synonyms.mjs --dry-run        # Preview without DB writes
 *   node scripts/populate-model-synonyms.mjs --canonical XYZ  # Process single canonical model
 *   node scripts/populate-model-synonyms.mjs --force          # Regenerate even if synonyms exist
 */

import OpenAI from 'openai';
import { getEnv } from '../src/config/env.js';
import { getSupabaseClient } from '../src/repositories/supabaseClient.js';
import { normalizeModelKey } from '../src/utils/normalize-model-key.js';

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
  canonical: args.includes('--canonical') ? args[args.indexOf('--canonical') + 1] : null,
  help: args.includes('--help')
};

if (flags.help) {
  console.log(`
Usage:
  node scripts/populate-model-synonyms.mjs                  # Process all
  node scripts/populate-model-synonyms.mjs --dry-run        # Preview only
  node scripts/populate-model-synonyms.mjs --canonical XYZ  # Single model
  node scripts/populate-model-synonyms.mjs --force          # Regenerate all
  `);
  process.exit(0);
}

const SYNONYMS_PROMPT = `You are a marine equipment model naming expert. Given a canonical model name and its manufacturer, generate alternative model name strings that a user might type when referring to this exact product.

Canonical Model: {canonical_model}
Manufacturer: {manufacturer}

Generate alternative names that should resolve to this canonical model. Include:
1. Common abbreviations or shortenings (e.g., "Zeus 3S" for "Zeus 3S 16", "RA770" for "MS-RA770")
2. Brand + model combinations (e.g., "Garmin 8616" for model "GPSMAP 8616")
3. Model family names without size/variant suffix (e.g., "Zeus" for "Zeus 3S 16")
4. Common misspellings or phonetic variants
5. Format variations: with/without spaces, hyphens (e.g., "ZEN 150" and "ZEN-150" for "ZEN15048VDC")
6. Informal references boat owners use

Do NOT include:
- The exact canonical model name itself
- Terms that are too generic (e.g., just "radar" or "display")
- Manufacturer name alone

Return ONLY a JSON array of strings, nothing else. Example:
["Zeus 3S", "Zeus3S", "B&G Zeus", "Zeus 3"]`;

/**
 * Generate model synonyms for a canonical model via LLM
 */
async function generateModelSynonyms(canonicalModel, manufacturer) {
  const env = getEnv();
  const model = env.OPENAI_SUMMARY_MODEL || 'gpt-4o-mini';

  const prompt = SYNONYMS_PROMPT
    .replace('{canonical_model}', canonicalModel)
    .replace('{manufacturer}', manufacturer || 'Unknown');

  const response = await getOpenAIClient().chat.completions.create({
    model,
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 400,
    temperature: 0.4
  });

  const raw = response.choices[0].message.content.trim();

  try {
    // Strip markdown code fences if present
    const cleaned = raw.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '');
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) {
      return parsed.filter(s => typeof s === 'string' && s.trim().length > 0);
    }
    return [];
  } catch {
    console.warn(`  ⚠ Failed to parse LLM output for ${canonicalModel}: ${raw.substring(0, 100)}`);
    return [];
  }
}

async function main() {
  const supabase = await getSupabaseClient();
  const stats = { processed: 0, synonymsAdded: 0, skippedExisting: 0, skippedSameNorm: 0, errors: 0 };

  console.log(`\n🔧 Populate ref_model_synonyms from ref_canonical_models`);
  console.log(`   Mode: ${flags.dryRun ? 'DRY RUN' : 'LIVE'}${flags.force ? ' (force)' : ''}`);
  console.log('');

  // Fetch canonical models with manufacturer info
  let query = supabase
    .from('ref_canonical_models')
    .select('canonical_model, canonical_norm, manufacturer_id');

  if (flags.canonical) {
    query = query.eq('canonical_model', flags.canonical);
  }

  const { data: canonicals, error: fetchError } = await query;

  if (fetchError) {
    console.error('❌ Failed to fetch canonical models:', fetchError.message);
    process.exit(1);
  }

  if (!canonicals || canonicals.length === 0) {
    console.log('No canonical models found.');
    process.exit(0);
  }

  console.log(`Found ${canonicals.length} canonical model(s) to process.\n`);

  // Fetch manufacturer names for context
  const mfrIds = [...new Set(canonicals.map(c => c.manufacturer_id).filter(Boolean))];
  let mfrMap = {};
  if (mfrIds.length > 0) {
    const { data: mfrs } = await supabase
      .from('ref_manufacturers')
      .select('id, name')
      .in('id', mfrIds);
    if (mfrs) {
      mfrMap = Object.fromEntries(mfrs.map(m => [m.id, m.name]));
    }
  }

  // Fetch existing synonyms to skip if not --force
  let existingSynonymNorms = new Set();
  if (!flags.force) {
    const { data: existing } = await supabase
      .from('ref_model_synonyms')
      .select('synonym_norm');
    if (existing) {
      existingSynonymNorms = new Set(existing.map(e => e.synonym_norm));
    }
    console.log(`Existing synonyms in DB: ${existingSynonymNorms.size}\n`);
  }

  // Also fetch existing canonical_norms to skip synonyms that match
  const canonicalNorms = new Set(canonicals.map(c => c.canonical_norm));

  for (let i = 0; i < canonicals.length; i++) {
    const canonical = canonicals[i];
    const manufacturer = mfrMap[canonical.manufacturer_id] || 'Unknown';

    console.log(`[${i + 1}/${canonicals.length}] ${canonical.canonical_model} (${manufacturer})`);

    // Check if this canonical already has synonyms (unless --force)
    if (!flags.force) {
      const { data: existingForModel } = await supabase
        .from('ref_model_synonyms')
        .select('synonym')
        .eq('canonical_model', canonical.canonical_model);

      if (existingForModel && existingForModel.length > 0) {
        console.log(`  ⏭ Already has ${existingForModel.length} synonym(s), skipping (use --force to regenerate)`);
        stats.processed++;
        continue;
      }
    }

    // Generate synonyms via LLM
    let synonyms;
    try {
      synonyms = await generateModelSynonyms(canonical.canonical_model, manufacturer);
    } catch (err) {
      console.error(`  ❌ LLM error: ${err.message}`);
      stats.errors++;
      continue;
    }

    if (synonyms.length === 0) {
      console.log('  ⚠ No synonyms generated');
      stats.processed++;
      continue;
    }

    console.log(`  Generated ${synonyms.length} synonym(s): ${synonyms.join(', ')}`);

    // Insert each synonym
    for (const synonym of synonyms) {
      const synonymNorm = normalizeModelKey(synonym);

      // Skip if normalized form matches a canonical_norm (redundant lookup)
      if (canonicalNorms.has(synonymNorm)) {
        stats.skippedSameNorm++;
        continue;
      }

      // Skip if synonym_norm already exists (unique constraint)
      if (existingSynonymNorms.has(synonymNorm)) {
        stats.skippedExisting++;
        continue;
      }

      if (flags.dryRun) {
        console.log(`  [DRY] Would insert: "${synonym}" (norm: ${synonymNorm}) → ${canonical.canonical_model}`);
        stats.synonymsAdded++;
        continue;
      }

      try {
        const { error: insertError } = await supabase
          .from('ref_model_synonyms')
          .insert({
            synonym: synonym,
            synonym_norm: synonymNorm,
            canonical_model: canonical.canonical_model
          });

        if (insertError) {
          if (insertError.message.includes('23505') || insertError.message.includes('duplicate')) {
            stats.skippedExisting++;
          } else {
            console.error(`  ❌ Insert error for "${synonym}": ${insertError.message}`);
            stats.errors++;
          }
        } else {
          existingSynonymNorms.add(synonymNorm);
          stats.synonymsAdded++;
          console.log(`  ✅ Added: "${synonym}" (${synonymNorm}) → ${canonical.canonical_model}`);
        }
      } catch (err) {
        console.error(`  ❌ Insert error for "${synonym}": ${err.message}`);
        stats.errors++;
      }
    }

    stats.processed++;

    // Rate limiting between LLM calls
    if (i < canonicals.length - 1) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Summary${flags.dryRun ? ' (DRY RUN)' : ''}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Canonical models processed: ${stats.processed}
  Synonyms added:            ${stats.synonymsAdded}
  Skipped (already exists):  ${stats.skippedExisting}
  Skipped (same as canonical): ${stats.skippedSameNorm}
  Errors:                    ${stats.errors}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
