import OpenAI from 'openai';
import { getEnv } from '../config/env.js';
import { logger } from '../utils/logger.js';

const requestLogger = logger.createModuleLogger('colloquial-extraction');

// Lazy-load OpenAI client to use getEnv()
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

const COLLOQUIAL_EXTRACTION_PROMPT = `You are analyzing technical documentation to extract colloquial terms that boat owners and marine equipment users would naturally use when referring to this equipment.

Your task: Read the documentation chunks and identify 10-20 colloquial words or short phrases (1-3 words max) that people would use in conversation when talking about or asking questions about this equipment.

Rules:
- Focus on how USERS talk, not technical jargon
- Include common abbreviations and casual terms
- Include both specific and generic terms (e.g., "water pump" AND "pump")
- Include problem/symptom-related terms if mentioned (e.g., "clicking pump", "leaking")
- Do NOT include manufacturer names or model numbers
- Each term should be 1-3 words maximum
- Return ONLY a JSON array of strings, nothing else

Examples of good colloquial terms:
- "water pump" (generic type)
- "pump" (very generic)
- "12v pump" (common spec)
- "freshwater pump" (usage context)
- "pressure pump" (function)
- "clicking pump" (common symptom)

Documentation chunks:
{chunks}

Return a JSON array of  10-20 colloquial terms:`;

/**
 * Fetch chunks from Pinecone for specific equipment
 */
async function fetchPineconeChunks(manufacturer, model) {
  try {
    const env = getEnv();

    // Set 2-minute timeout for Pinecone search
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), 120000); // 2 minutes

    let response;
    try {
      response = await fetch(`${env.PYTHON_SIDECAR_URL}/v1/pinecone/search`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          query: `${manufacturer} ${model}`,
          topK: 15,
          filter: {
            manufacturer: manufacturer,
            model: model
          }
        }),
        signal: abortController.signal
      });
      clearTimeout(timeoutId);
    } catch (fetchError) {
      clearTimeout(timeoutId);

      if (fetchError.name === 'AbortError') {
        throw new Error(`Pinecone search timeout: Search took longer than 2 minutes`);
      }
      throw fetchError;
    }

    const data = await response.json();

    if (!data.success || !data.matches) {
      throw new Error(`Pinecone search failed: ${data.error || 'Unknown error'}`);
    }

    requestLogger.info('Fetched chunks from Pinecone', {
      manufacturer,
      model,
      chunksFound: data.matches.length
    });

    return data.matches;
  } catch (error) {
    requestLogger.error('Failed to fetch Pinecone chunks', {
      manufacturer,
      model,
      error: error.message
    });
    throw error;
  }
}

/**
 * Fetch chunks from Pinecone for a specific document + user-selected models (v5 tagging).
 *
 * This is intended to run AFTER indexing has upserted chunks to Pinecone with:
 * - doc_id
 * - primary_models[]
 * - is_universal
 */
async function fetchPineconeChunksV5({ docId, selectedModels }) {
  const safeSelected = Array.isArray(selectedModels) ? selectedModels.filter(Boolean) : [];
  if (!docId) throw new Error('docId is required');
  if (safeSelected.length === 0) throw new Error('selectedModels is required and cannot be empty');

  try {
    const env = getEnv();

    // Set 2-minute timeout for Pinecone search
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), 120000); // 2 minutes

    const filter = {
      doc_id: { $eq: docId },
      $or: [
        { is_universal: { $eq: true } },
        { primary_models: { $in: safeSelected } }
      ]
    };

    let response;
    try {
      // Query text doesn't matter much as long as we constrain by filter;
      // we just want representative chunks for LLM to extract colloquial terms.
      response = await fetch(`${env.PYTHON_SIDECAR_URL}/v1/pinecone/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: `${safeSelected[0]} manual`,
          topK: 25,
          filter
        }),
        signal: abortController.signal
      });
      clearTimeout(timeoutId);
    } catch (fetchError) {
      clearTimeout(timeoutId);
      if (fetchError.name === 'AbortError') {
        throw new Error('Pinecone search timeout: Search took longer than 2 minutes');
      }
      throw fetchError;
    }

    const data = await response.json();
    if (!data.success || !data.matches) {
      throw new Error(`Pinecone search failed: ${data.error || 'Unknown error'}`);
    }

    requestLogger.info('Fetched chunks from Pinecone (v5)', {
      docId,
      selectedModels: safeSelected,
      chunksFound: data.matches.length
    });

    return data.matches;
  } catch (error) {
    requestLogger.error('Failed to fetch Pinecone chunks (v5)', {
      docId,
      selectedModels: safeSelected,
      error: error.message
    });
    throw error;
  }
}

/**
 * Extract colloquial terms from chunks using LLM
 */
async function extractTermsWithLLM(chunks) {
  try {
    // Combine chunks into a single text, limit to reasonable size
    const combinedText = chunks
      .slice(0, 15) // Use top 15 chunks to stay within token limits
      .map(chunk => chunk.metadata?.text || '')
      .join('\n\n---\n\n')
      .substring(0, 8000); // Limit to ~2k tokens worth of text

    const prompt = COLLOQUIAL_EXTRACTION_PROMPT.replace('{chunks}', combinedText);

    const env = getEnv();
    const model = env.OPENAI_SUMMARY_MODEL || 'gpt-4o-mini';

    requestLogger.debug('Calling LLM for colloquial extraction', {
      model,
      chunkCount: chunks.slice(0, 15).length,
      textLength: combinedText.length
    });

    const response = await getOpenAIClient().chat.completions.create({
      model: model,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ],
      max_tokens: 200,
      temperature: 0.3
    });

    const responseText = response.choices[0].message.content.trim();

    // Try to parse JSON response
    try {
      // Remove markdown code fences if present
      let cleaned = responseText;
      if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      }

      const terms = JSON.parse(cleaned);

      if (!Array.isArray(terms)) {
        throw new Error('Response is not an array');
      }

      requestLogger.info('Extracted colloquial terms', {
        termsCount: terms.length,
        terms: terms.slice(0, 5) // Log first 5 for debugging
      });

      return terms;
    } catch (parseError) {
      requestLogger.error('Failed to parse LLM response as JSON', {
        parseError: parseError.message,
        rawResponse: responseText.substring(0, 200)
      });
      throw new Error('Invalid LLM response format');
    }
  } catch (error) {
    requestLogger.error('LLM extraction failed', {
      error: error.message
    });
    throw error;
  }
}

/**
 * Sleep utility for retry delays
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Main entry point: Extract colloquial keywords for equipment with retry logic
 * @param {string} manufacturer - Equipment manufacturer
 * @param {string} model - Equipment model
 * @returns {Promise<string>} Comma-separated colloquial keywords
 */
export async function extractColloquialKeywords(manufacturer, model) {
  try {
    requestLogger.info('Starting colloquial keyword extraction', {
      manufacturer,
      model
    });

    // Retry configuration
    const MAX_RETRIES = 3;
    const RETRY_DELAYS = [10000, 5000, 5000]; // 10s, 5s, 5s

    let chunks = [];
    let lastError = null;

    // Step 1: Fetch chunks from Pinecone with retry logic
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        // Wait before each attempt (including first)
        const delay = RETRY_DELAYS[attempt - 1];
        requestLogger.info('Waiting before Pinecone search attempt', {
          manufacturer,
          model,
          attempt,
          delayMs: delay
        });
        await sleep(delay);

        chunks = await fetchPineconeChunks(manufacturer, model);

        if (chunks.length > 0) {
          requestLogger.info('Successfully fetched chunks from Pinecone', {
            manufacturer,
            model,
            attempt,
            chunksFound: chunks.length
          });
          break; // Success - exit retry loop
        }

        requestLogger.warn('No chunks found in Pinecone', {
          manufacturer,
          model,
          attempt,
          retriesRemaining: MAX_RETRIES - attempt
        });

      } catch (error) {
        lastError = error;
        requestLogger.warn('Pinecone search attempt failed', {
          manufacturer,
          model,
          attempt,
          error: error.message,
          retriesRemaining: MAX_RETRIES - attempt
        });
      }
    }

    // If still no chunks after all retries, give up gracefully
    if (chunks.length === 0) {
      requestLogger.warn('No chunks found in Pinecone after all retry attempts', {
        manufacturer,
        model,
        attemptsTotal: MAX_RETRIES,
        lastError: lastError?.message
      });
      return {
        keywords: '',
        stats: {
          colloquial_keywords_count: 0,
          colloquial_tokens_used: 0
        }
      };
    }

    // Step 2: Extract terms with LLM
    const terms = await extractTermsWithLLM(chunks);

    if (terms.length === 0) {
      requestLogger.warn('No terms extracted', {
        manufacturer,
        model
      });
      return {
        keywords: '',
        stats: {
          colloquial_keywords_count: 0,
          colloquial_tokens_used: 0
        }
      };
    }

    // Step 3: Join as comma-separated string
    const keywords = terms.join(', ');

    // Calculate token usage (rough estimate based on typical extraction)
    // Prompt: ~300 tokens + chunks (~2000 tokens) + response (~150 tokens)
    const estimatedTokens = 2450;

    requestLogger.info('Colloquial keyword extraction complete', {
      manufacturer,
      model,
      keywordsCount: terms.length,
      keywords: keywords.substring(0, 100) + (keywords.length > 100 ? '...' : ''),
      tokensUsed: estimatedTokens
    });

    // Return object with keywords and stats
    return {
      keywords,
      stats: {
        colloquial_keywords_count: terms.length,
        colloquial_tokens_used: estimatedTokens
      }
    };

  } catch (error) {
    requestLogger.error('Colloquial keyword extraction failed', {
      manufacturer,
      model,
      error: error.message
    });
    throw error;
  }
}

/**
 * v5 entry point: extract colloquial keywords based on a doc's indexed chunks
 * and the user's selected primary model(s).
 *
 * Runs AFTER indexing, because it depends on Pinecone content.
 */
export async function extractColloquialKeywordsV5({ docId, selectedModels }) {
  requestLogger.info('Starting colloquial keyword extraction (v5)', { docId, selectedModels });

  const MAX_RETRIES = 3;
  const RETRY_DELAYS = [10000, 5000, 5000]; // 10s, 5s, 5s

  let chunks = [];
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const delay = RETRY_DELAYS[attempt - 1];
      requestLogger.info('Waiting before Pinecone search attempt (v5)', {
        docId,
        attempt,
        delayMs: delay
      });
      // Wait before each attempt (including first), matching legacy behavior.
      // This reduces flakiness immediately after indexing.
      // eslint-disable-next-line no-await-in-loop
      await sleep(delay);

      // eslint-disable-next-line no-await-in-loop
      chunks = await fetchPineconeChunksV5({ docId, selectedModels });

      if (chunks.length > 0) break;

      requestLogger.warn('No chunks found in Pinecone (v5)', {
        docId,
        attempt,
        retriesRemaining: MAX_RETRIES - attempt
      });
    } catch (error) {
      lastError = error;
      requestLogger.warn('Pinecone search attempt failed (v5)', {
        docId,
        attempt,
        error: error.message,
        retriesRemaining: MAX_RETRIES - attempt
      });
    }
  }

  if (chunks.length === 0) {
    requestLogger.warn('No chunks found in Pinecone after all retry attempts (v5)', {
      docId,
      attemptsTotal: MAX_RETRIES,
      lastError: lastError?.message
    });
    return {
      keywords: '',
      stats: {
        colloquial_keywords_count: 0,
        colloquial_tokens_used: 0
      }
    };
  }

  const terms = await extractTermsWithLLM(chunks);
  if (terms.length === 0) {
    return {
      keywords: '',
      stats: {
        colloquial_keywords_count: 0,
        colloquial_tokens_used: 0
      }
    };
  }

  const keywords = terms.join(', ');
  const estimatedTokens = 2450;

  requestLogger.info('Colloquial keyword extraction complete (v5)', {
    docId,
    keywordsCount: terms.length,
    keywords: keywords.substring(0, 100) + (keywords.length > 100 ? '...' : ''),
    tokensUsed: estimatedTokens
  });

  return {
    keywords,
    stats: {
      colloquial_keywords_count: terms.length,
      colloquial_tokens_used: estimatedTokens
    }
  };
}
