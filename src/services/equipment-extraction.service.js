import OpenAI from 'openai';
import { getEnv } from '../config/env.js';
import { logger } from '../utils/logger.js';

const EXTRACTION_PROMPT = `You are a marine expert looking at a colloquial sentence and trying to extract the systems. As you know the marine environment is complex because states and conditions can also be equipment, such as GPS which is a thing and a system, or wind sensor which is a state but also there is a wind sensor. You need to be crafty and careful to parse apart a sentence and pull from it what could be the systems. The questions will be all over the place as this is the lead in from a chat application. the goal is to find the marine item in the sentence and surface it - from trouble shooting, to general inqury, to asking about what equipment or supplies we have, to random questions, we need to be on our toes and find that marine item. But and this is a but. this is a luxury catamaran and has showers, kitchen, tv's and so we need to keep an eye out for systems that would be on a luxury boat also. Returning a few options is not a bad thing as this response flows into query our systems and supplies tables.

OUTPUT FORMAT: Return JSON array only.

RULES:
1. Extract explicit mentions (V100, Zeus, fortress anchor)
2. Infer implicit systems:
   - "GPS data" implies GPS receiver exists
   - "wind data" implies wind sensor exists
   - "not showing same" implies multiple displays
3. Include confidence (0-1) for each
4. Identify role: data_source, display, control, or equipment

EXAMPLES:

Query: "GPS showing different on V100 and Zeus"
[
  {"name": "GPS", "confidence": 0.8, "role": "data_source"},
  {"name": "V100", "confidence": 0.95, "role": "display"},
  {"name": "Zeus", "confidence": 0.95, "role": "display"}
]

Query: "autopilot not responding to wind data"
[
  {"name": "autopilot", "confidence": 1.0, "role": "control"},
  {"name": "wind sensor", "confidence": 0.75, "role": "data_source"}
]

Query: "tell me about fortress anchor"
[
  {"name": "fortress anchor", "confidence": 1.0, "role": "equipment"}
]

Query: "tell me the models of harken winches I have?"
[
  {"name": "harken winches", "confidence": 0.9, "role": "equipment"}
]

Query: "what types of anchors do I have"
[
  {"name": "anchors", "confidence": 0.9, "role": "equipment"}
]

Query: "how do I navigate"
[]

Now extract from: "{query}"`;

/**
 * Extract equipment name from natural language query using LLM
 *
 * @param {string} query - User's natural language query
 * @returns {Promise<{equipment: Array}>} - Object containing array of extracted equipment with name, confidence, role
 */
export async function extractEquipmentName(query) {
  const requestLogger = logger.createRequestLogger();
  const env = getEnv();

  try {
    const openai = new OpenAI({
      apiKey: env.OPENAI_API_KEY
    });

    const startTime = Date.now();

    // Log extraction start
    requestLogger.info('🔬 [EXTRACT_START] LLM extraction initiated', {
      query: query.substring(0, 100),
      queryLength: query.length
    });

    const response = await openai.chat.completions.create({
      model: env.OPENAI_SUMMARY_MODEL || 'gpt-4o-mini',
      messages: [
        {
          role: 'user',
          content: EXTRACTION_PROMPT.replace('{query}', query)
        }
      ],
      max_tokens: 300,  // Increased for array response
      temperature: 0.1
    });

    const duration = Date.now() - startTime;
    const rawResponse = response.choices[0].message.content.trim();

    // Log raw response
    requestLogger.info('🔬 [EXTRACT_RAW] Raw LLM response', {
      query: query.substring(0, 50),
      rawResponse: rawResponse.substring(0, 200),
      duration_ms: duration
    });

    // Parse JSON - handle both bare array [] and wrapped {equipment: []}
    let cleaned = rawResponse;
    if (cleaned.startsWith('```')) {
      const lines = cleaned.split('\n');
      lines.shift(); // Remove first ```json or ```
      if (lines[lines.length - 1].trim() === '```') {
        lines.pop(); // Remove last ```
      }
      cleaned = lines.join('\n').trim();
    }

    try {
      const parsed = JSON.parse(cleaned);

      // Handle both formats: bare array or wrapped object
      const equipmentArray = Array.isArray(parsed)
        ? parsed
        : (parsed.equipment || []);

      // Validate
      const validated = validateEquipmentArray(equipmentArray, query, requestLogger);

      // Log parsed result
      requestLogger.info('🔬 [EXTRACT_PARSED] Successfully parsed response', {
        query: query.substring(0, 50),
        equipmentCount: validated.length,
        equipment: validated.map(e => ({
          name: e.name,
          confidence: e.confidence
        }))
      });

      return { equipment: validated };

    } catch (parseError) {
      requestLogger.error('🔬 [EXTRACT_PARSE_ERROR] Failed to parse LLM response', {
        query: query.substring(0, 100),
        rawResponse,
        parseError: parseError.message
      });

      // Return empty array on parse failure
      return { equipment: [] };
    }

  } catch (error) {
    requestLogger.error('🔬 [EXTRACT_ERROR] LLM extraction failed', {
      query: query.substring(0, 100),
      error: error.message,
      stack: error.stack
    });

    return { equipment: [] };
  }
}

/**
 * Validate equipment array structure
 */
function validateEquipmentArray(equipmentArray, query, requestLogger) {
  if (!Array.isArray(equipmentArray)) {
    requestLogger.warn('🚨 [VALIDATION] Not an array', {
      query: query.substring(0, 100),
      type: typeof equipmentArray
    });
    return [];
  }

  const validated = [];

  for (let i = 0; i < equipmentArray.length; i++) {
    const eq = equipmentArray[i];

    // Must have name
    if (!eq.name || typeof eq.name !== 'string' || eq.name.trim() === '') {
      requestLogger.warn('🚨 [VALIDATION] Missing or invalid name', {
        index: i,
        equipment: eq
      });
      continue;
    }

    // Validate confidence (0-1)
    if (eq.confidence !== undefined) {
      if (typeof eq.confidence !== 'number' || eq.confidence < 0 || eq.confidence > 1) {
        requestLogger.warn('🚨 [VALIDATION] Invalid confidence, using default', {
          name: eq.name,
          confidence: eq.confidence
        });
        eq.confidence = 0.5;
      }
    } else {
      eq.confidence = 1.0; // Default if missing
    }

    // Validate role
    const validRoles = ['data_source', 'display', 'control', 'equipment'];
    if (!eq.role || !validRoles.includes(eq.role)) {
      eq.role = 'equipment'; // Default
    }

    validated.push(eq);
  }

  // Log if we filtered any out
  if (validated.length < equipmentArray.length) {
    requestLogger.warn('🚨 [VALIDATION] Filtered invalid items', {
      original: equipmentArray.length,
      validated: validated.length
    });
  }

  return validated;
}

export default {
  extractEquipmentName
};
