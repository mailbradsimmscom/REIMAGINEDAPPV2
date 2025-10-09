import OpenAI from 'openai';
import { getEnv } from '../config/env.js';
import { logger } from '../utils/logger.js';

const EXTRACTION_PROMPT = `You are an equipment name extractor. Your job is to extract ONLY the equipment/product identifier from user queries, removing all symptoms, problems, actions, and context words.

Rules:
- Extract ANY equipment identifier mentioned - this could be:
  * Brand/manufacturer name alone (e.g., "Rocna", "Fortress")
  * Model number alone (e.g., "DST810", "FX-37")
  * Product type alone (e.g., "water pump", "anchor")
  * Any combination (e.g., "Rocna anchor", "Fortress FX-37")
- Remove symptom words (clicking, broken, leaking, not working, turning off, etc.)
- Remove action words (fix, repair, check, tell me about, where is, how do, etc.)
- Remove possessive words (my, the, our, etc.)
- If no equipment/product is mentioned, return "none"
- Return ONLY the equipment identifier, nothing else

Examples:
Query: "my self priming transfer pump is click off all the time"
Equipment: self priming transfer pump

Query: "tell me about my fortress anchor"
Equipment: fortress anchor

Query: "where is rocna made"
Equipment: rocna

Query: "how do I use a rocna anchor"
Equipment: rocna anchor

Query: "my water pump is clicking off quite often"
Equipment: water pump

Query: "DST810 information"
Equipment: DST810

Query: "tell me about my fortress"
Equipment: fortress

Query: "how do I fix this"
Equipment: none

Query: "my boat is moving"
Equipment: none

Now extract from this query:
Query: "{query}"
Equipment:`;

/**
 * Extract equipment name from natural language query using LLM
 *
 * @param {string} query - User's natural language query
 * @returns {Promise<string|null>} - Extracted equipment name or null if none found
 */
export async function extractEquipmentName(query) {
  const requestLogger = logger.createRequestLogger();
  const env = getEnv();

  try {
    const openai = new OpenAI({
      apiKey: env.OPENAI_API_KEY
    });

    const startTime = Date.now();

    const response = await openai.chat.completions.create({
      model: env.OPENAI_SUMMARY_MODEL || 'gpt-4o-mini',
      messages: [
        {
          role: 'user',
          content: EXTRACTION_PROMPT.replace('{query}', query)
        }
      ],
      max_tokens: 50,
      temperature: 0.1
    });

    const duration = Date.now() - startTime;
    const extracted = response.choices[0].message.content.trim();

    if (extracted === 'none' || extracted === 'Equipment: none') {
      requestLogger.info('🤖 LLM equipment extraction: no equipment found', {
        query: query.substring(0, 100),
        duration_ms: duration
      });
      return null;
    }

    // Clean up response (sometimes LLM includes "Equipment: " prefix)
    const cleaned = extracted.replace(/^Equipment:\s*/i, '').trim();

    requestLogger.info('✅ LLM equipment extraction successful', {
      query: query.substring(0, 100),
      extracted: cleaned,
      duration_ms: duration
    });

    return cleaned;

  } catch (error) {
    requestLogger.error('❌ LLM equipment extraction failed', {
      query: query.substring(0, 100),
      error: error.message
    });
    return null;
  }
}

export default {
  extractEquipmentName
};
