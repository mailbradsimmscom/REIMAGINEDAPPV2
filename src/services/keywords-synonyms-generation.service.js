/**
 * Keywords and Synonyms Generation Service
 *
 * Generates spec_keywords and synonyms (fts + human) for systems using LLM
 * based on manufacturer, model, system, subsystem, and description.
 */

import OpenAI from 'openai';
import { getEnv } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { getSupabaseClient } from '../repositories/supabaseClient.js';

const requestLogger = logger.createModuleLogger('keywords-synonyms-generation');

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
{refContext}

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

/**
 * Generate keywords for a system
 * @param {Object} system - System data
 * @returns {Promise<string>} - Generated keywords
 */
async function generateKeywords(system) {
  const env = getEnv();
  const model = env.OPENAI_SUMMARY_MODEL || 'gpt-4o-mini';

  const prompt = KEYWORDS_PROMPT
    .replace('{manufacturer}', system.manufacturer_norm || 'Unknown')
    .replace('{model}', system.model_norm || 'Unknown')
    .replace('{system}', system.system_norm || 'Unknown')
    .replace('{subsystem}', system.subsystem_norm || 'Unknown')
    .replace('{description}', system.description || 'No description available');

  requestLogger.debug('Generating keywords', {
    manufacturer: system.manufacturer_norm,
    model: system.model_norm
  });

  const response = await getOpenAIClient().chat.completions.create({
    model: model,
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 100,
    temperature: 0.3
  });

  return response.choices[0].message.content.trim();
}

/**
 * Generate synonyms for a system
 * @param {Object} system - System data
 * @returns {Promise<string>} - Generated synonyms
 */
async function generateSynonyms(system, refContext = '') {
  const env = getEnv();
  const model = env.OPENAI_SUMMARY_MODEL || 'gpt-4o-mini';

  const prompt = SYNONYMS_PROMPT
    .replace('{manufacturer}', system.manufacturer_norm || 'Unknown')
    .replace('{model}', system.model_norm || 'Unknown')
    .replace('{description}', system.description || 'No description available')
    .replace('{refContext}', refContext);

  requestLogger.debug('Generating synonyms', {
    manufacturer: system.manufacturer_norm,
    model: system.model_norm
  });

  const response = await getOpenAIClient().chat.completions.create({
    model: model,
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 600,
    temperature: 0.5
  });

  return response.choices[0].message.content.trim();
}

/**
 * Generate and save keywords and synonyms for a system
 * Called automatically when a new system is created
 *
 * @param {string} assetUid - System asset UID
 * @returns {Promise<Object>} - { success, keywords?, synonyms?, error? }
 */
/**
 * Generate synonyms and description for a ref table entry via LLM.
 * Called when a user creates a new entry via "+ Add New" in the ingest UI.
 *
 * @param {string} tableName - One of: manufacturer, product_type, system_category, subsystem_category
 * @param {string} entryName - The name the user entered (e.g., "Grill/Cooktop")
 * @returns {Promise<{synonyms: string[], description: string}>}
 */
export async function generateRefTableSynonyms(tableName, entryName) {
  const env = getEnv();
  const model = env.OPENAI_SUMMARY_MODEL || 'gpt-4o-mini';

  const typeLabels = {
    manufacturer: 'manufacturer',
    product_type: 'product type',
    system_category: 'system category',
    subsystem_category: 'subsystem category'
  };
  const typeLabel = typeLabels[tableName] || tableName;

  const prompt = `You are a marine equipment expert. Generate synonyms and a brief description for this marine ${typeLabel}: "${entryName}".

Synonyms should include:
- Colloquial terms boat owners would use
- Abbreviations and acronyms
- Common misspellings
- Related industry terms and alternate names

Return ONLY valid JSON (no markdown, no code fences):
{"synonyms": ["term1", "term2", ...], "description": "Brief one-sentence description"}`;

  requestLogger.debug('Generating ref table synonyms', { tableName, entryName });

  const response = await getOpenAIClient().chat.completions.create({
    model,
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 300,
    temperature: 0.4
  });

  const raw = response.choices[0].message.content.trim();

  try {
    const parsed = JSON.parse(raw);
    return {
      synonyms: Array.isArray(parsed.synonyms) ? parsed.synonyms.filter(Boolean) : [],
      description: typeof parsed.description === 'string' ? parsed.description : ''
    };
  } catch {
    requestLogger.warn('Failed to parse ref table synonyms JSON', { raw, tableName, entryName });
    return { synonyms: [], description: '' };
  }
}

/**
 * Fetch synonyms from ref tables via a system's FK columns.
 * Returns { manufacturer: string[], productType: string[] }
 */
async function fetchRefTableSynonyms(supabase, system) {
  const result = { manufacturer: [], productType: [] };

  const fetches = [];

  if (system.manufacturer_id) {
    fetches.push(
      supabase.from('ref_manufacturers').select('synonyms').eq('id', system.manufacturer_id).single()
        .then(({ data }) => { if (data?.synonyms) result.manufacturer = data.synonyms; })
        .catch(() => {})
    );
  }

  if (system.product_type_id) {
    fetches.push(
      supabase.from('ref_product_types').select('synonyms').eq('id', system.product_type_id).single()
        .then(({ data }) => { if (data?.synonyms) result.productType = data.synonyms; })
        .catch(() => {})
    );
  }

  await Promise.all(fetches);
  return result;
}

/**
 * Post-process synonyms: merge LLM output with ref table terms,
 * deduplicate, and append normalized (no-space) variants for tsvector matching.
 *
 * @param {string} llmSynonyms - Space-separated LLM output
 * @param {string[]} refTerms - Ref table synonyms to append
 * @returns {string} - Processed space-separated synonym string
 */
function postProcessSynonyms(llmSynonyms, refTerms) {
  // Split LLM output into tokens
  const llmTokens = llmSynonyms.split(/\s+/).filter(Boolean);

  // Combine LLM tokens with ref table terms
  const allTerms = [...llmTokens, ...refTerms];

  // For multi-word ref terms, also add the joined (no-space) variant
  // so tsvector can match "SchenkerZEN15048VDC" as a single token
  const joinedVariants = [];
  for (const term of allTerms) {
    if (term.includes(' ') || term.includes('-')) {
      const joined = term.replace(/[\s\-]/g, '');
      if (joined !== term) joinedVariants.push(joined);
    }
  }

  const combined = [...allTerms, ...joinedVariants];

  // Deduplicate (case-insensitive)
  const seen = new Set();
  const deduped = [];
  for (const term of combined) {
    const key = term.toLowerCase().trim();
    if (key && !seen.has(key)) {
      seen.add(key);
      deduped.push(term.trim());
    }
  }

  return deduped.join(' ');
}

export async function generateAndSaveKeywordsSynonyms(assetUid) {
  const startTime = Date.now();

  try {
    requestLogger.info('Generating keywords and synonyms for new system', { assetUid });

    // Fetch system data
    const supabase = await getSupabaseClient();
    const { data: system, error: fetchError } = await supabase
      .from('systems')
      .select('*')
      .eq('asset_uid', assetUid)
      .single();

    if (fetchError || !system) {
      throw new Error(`System not found: ${assetUid}`);
    }

    // Phase 1b: Fetch ref table synonyms via FK columns
    const refSynonyms = await fetchRefTableSynonyms(supabase, system);

    // Build ref context for the LLM prompt
    const refContextParts = [];
    if (refSynonyms.manufacturer.length > 0) {
      refContextParts.push(`This manufacturer is also known as: ${refSynonyms.manufacturer.join(', ')}`);
    }
    if (refSynonyms.productType.length > 0) {
      refContextParts.push(`This product type is also known as: ${refSynonyms.productType.join(', ')}`);
    }
    const refContext = refContextParts.length > 0
      ? '\n' + refContextParts.join('\n')
      : '';

    // Generate keywords and synonyms in parallel
    const [keywords, llmSynonyms] = await Promise.all([
      generateKeywords(system),
      generateSynonyms(system, refContext)
    ]);

    // Phase 1b+1c: Deterministic append of ref table synonyms + post-processing
    const allRefTerms = [...refSynonyms.manufacturer, ...refSynonyms.productType];
    const synonyms = postProcessSynonyms(llmSynonyms, allRefTerms);

    requestLogger.info('Generated keywords and synonyms', {
      assetUid,
      keywordsLength: keywords.length,
      synonymsLength: synonyms.length,
      refTermsInjected: allRefTerms.length,
      duration: Date.now() - startTime
    });

    // Update system with generated data
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
      throw new Error(`Failed to update system: ${updateError.message}`);
    }

    const totalDuration = Date.now() - startTime;
    requestLogger.info('Successfully saved keywords and synonyms', {
      assetUid,
      duration: totalDuration
    });

    return {
      success: true,
      keywords,
      synonyms,
      duration: totalDuration
    };

  } catch (error) {
    const totalDuration = Date.now() - startTime;
    requestLogger.error('Failed to generate keywords and synonyms', {
      assetUid,
      error: error.message,
      duration: totalDuration
    });

    return {
      success: false,
      error: error.message,
      duration: totalDuration
    };
  }
}
