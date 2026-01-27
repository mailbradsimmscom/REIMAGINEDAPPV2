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

const SYNONYMS_PROMPT = `You are a marine equipment search expert. Generate ALL possible spelling, format variations, short forms, abbreviations, etc. of this product name that users might search for.

Equipment Details:
Manufacturer: {manufacturer}
Model: {model}
Description: {description}

Rules:
- Include uppercase, lowercase, mixed case variations
- Include with/without spaces, hyphens, underscores
- Include manufacturer prefix variations (e.g., "B&G HALO24", "BGHALO24", "B&GHALO24")
- Include short forms and abbreviations (e.g., "DST" for "Depth/Speed/Temp")
- Include number format variations (e.g., "24", "24+", "24 plus")
- Include acronyms and industry shorthand
- Include common typos and misspellings
- Return as space-separated string
- Generate 20-50 variations

Examples:
- "DST810 DST-810 dst810 DST 810 dst-810 DST810 Smart Multisensor dst depth speed temp"
- "HALO24+ HALO24 halo24+ HALO-24+ halo 24 plus B&G HALO24 BGHALO24 B&GHALO24"
- "NAIS500 NAIS-500 nais 500 AIS transponder class b ais"

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
async function generateSynonyms(system) {
  const env = getEnv();
  const model = env.OPENAI_SUMMARY_MODEL || 'gpt-4o-mini';

  const prompt = SYNONYMS_PROMPT
    .replace('{manufacturer}', system.manufacturer_norm || 'Unknown')
    .replace('{model}', system.model_norm || 'Unknown')
    .replace('{description}', system.description || 'No description available');

  requestLogger.debug('Generating synonyms', {
    manufacturer: system.manufacturer_norm,
    model: system.model_norm
  });

  const response = await getOpenAIClient().chat.completions.create({
    model: model,
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 200,
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

    // Generate keywords and synonyms in parallel
    const [keywords, synonyms] = await Promise.all([
      generateKeywords(system),
      generateSynonyms(system)
    ]);

    requestLogger.info('Generated keywords and synonyms', {
      assetUid,
      keywordsLength: keywords.length,
      synonymsLength: synonyms.length,
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
