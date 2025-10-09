# Implementation Guide: Multi-Equipment Array Extraction

**Reference:** Code Update #15
**Files to modify:** 2 files, ~235 lines
**Time estimate:** 2 hours

---

## Step 1: Update Equipment Extraction Service (30 min)

**File:** `src/services/equipment-extraction.service.js`

### 1A: Replace the EXTRACTION_PROMPT constant

**Find:** `const EXTRACTION_PROMPT = \`You are an equipment name extractor...`

**Replace with:**
```javascript
const EXTRACTION_PROMPT = `You are a marine expert looking at a colloquial sentence and trying to extract the systems. As you know the marine environment is complex because states and conditions can also be equipment, such as GPS which is a thing and a system, or wind sensor which is a state but also there is a wind sensor. You need to be crafty and careful to parse apart a sentence and pull from it what could be the systems.

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

Query: "how do I navigate"
[]

Now extract from: "{query}"`;
```

### 1B: Update extractEquipmentName() function

**Find:** The entire `extractEquipmentName` function (lines ~57-109)

**Replace with:**
```javascript
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
```

### 1C: Add validation helper function

**Add at the end of the file (before `export default`):**

```javascript
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
```

---

## Step 2: Update Chat Proxy - Path 1 (20 min)

**File:** `src/services/chat-proxy.service.js`
**Location:** Around line 126 (search for "if inference found nothing, try LLM extraction")

**Find this block:**
```javascript
// NEW: If inference found nothing, try LLM extraction as fallback
if (currentEquipmentSearch.length === 0) {
  requestLogger.info('🤖 Inference found no equipment, trying LLM extraction', {
    originalQuery: query.substring(0, 100)
  });

  const extractedEquipment = await extractEquipmentName(query);

  if (extractedEquipment) {
    requestLogger.info('✅ LLM extracted equipment name', {
      extracted: extractedEquipment.substring(0, 100)
    });

    // Search with extracted equipment name
    currentEquipmentSearch = await searchSystems(extractedEquipment, { limit: 10 });

    if (currentEquipmentSearch.length > 0) {
      requestLogger.info('✅ Found equipment after LLM extraction', {
        extracted: extractedEquipment,
        equipmentCount: currentEquipmentSearch.length
      });
    }
  } else {
    requestLogger.info('⚠️ LLM extraction returned no equipment', {
      query: query.substring(0, 100)
    });
  }
}
```

**Replace with:**
```javascript
// NEW: If inference found nothing, try LLM extraction as fallback
if (currentEquipmentSearch.length === 0) {
  requestLogger.info('🤖 Inference found no equipment, trying LLM extraction', {
    originalQuery: query.substring(0, 100)
  });

  const extraction = await extractEquipmentName(query);

  if (extraction.equipment && extraction.equipment.length > 0) {
    requestLogger.info('🔬 [INFERENCE_FALLBACK] Extracted multiple equipment', {
      count: extraction.equipment.length,
      equipment: extraction.equipment.map(e => e.name)
    });

    // Search each equipment separately
    for (const eq of extraction.equipment) {
      requestLogger.info('🔍 [SEARCH_START]', {
        name: eq.name,
        confidence: eq.confidence,
        role: eq.role
      });

      const results = await searchSystems(eq.name, { limit: 10 });

      requestLogger.info('🔍 [SEARCH_RESULT]', {
        name: eq.name,
        found: results.length
      });

      if (results.length > 0) {
        currentEquipmentSearch.push(...results);
      }
    }

    requestLogger.info('✅ [COMBINED_RESULTS]', {
      totalSearched: extraction.equipment.length,
      totalFound: currentEquipmentSearch.length
    });
  } else {
    requestLogger.info('⚠️ LLM extraction returned no equipment', {
      query: query.substring(0, 100)
    });
  }
}
```

---

## Step 3: Update Chat Proxy - Path 2 (20 min)

**File:** `src/services/chat-proxy.service.js`
**Location:** Around line 180 (search for "if no equipment found, try LLM extraction ONCE as fallback")

**Find this block:**
```javascript
// NEW: If no equipment found, try LLM extraction ONCE as fallback
if (currentEquipmentSearch.length === 0) {
  console.log('🔍 [DEBUG] No equipment found, trying LLM extraction');

  requestLogger.info('🤖 No equipment found with keywords, trying LLM extraction', {
    originalQuery: query.substring(0, 100)
  });

  const extractedEquipment = await extractEquipmentName(query);

  console.log('🔍 [DEBUG] LLM extraction result', {
    extracted: extractedEquipment
  });

  if (extractedEquipment) {
    requestLogger.info('✅ LLM extracted equipment name', {
      extracted: extractedEquipment.substring(0, 100)
    });

    // Search AGAIN with extracted equipment name
    currentEquipmentSearch = await searchSystems(extractedEquipment, { limit: 10 });

    console.log('🔍 [DEBUG] LLM extraction search result', {
      extractedEquipment,
      resultsCount: currentEquipmentSearch.length,
      results: currentEquipmentSearch
    });

    // If still no results after extraction, return clarification request
    if (currentEquipmentSearch.length === 0) {
      requestLogger.info('❓ Equipment not found after extraction, requesting user clarification', {
        extracted: extractedEquipment
      });

      return {
        response: `I couldn't find "${extractedEquipment}" in your equipment inventory. Could you provide the manufacturer and model number? Or would you like me to answer generally about ${extractedEquipment}?`,
        classification: {
          intent: 'clarification_needed',
          confidence: 0.3
        },
        sources: [],
        score: 0,
        processing_time_ms: 0
      };
    } else {
      requestLogger.info('✅ Found equipment after LLM extraction', {
        extracted: extractedEquipment,
        equipmentCount: currentEquipmentSearch.length
      });
    }
  } else {
    requestLogger.info('⚠️ LLM extraction returned no equipment', {
      query: query.substring(0, 100)
    });
  }
}
```

**Replace with:**
```javascript
// NEW: If no equipment found, try LLM extraction ONCE as fallback
if (currentEquipmentSearch.length === 0) {
  console.log('🔍 [DEBUG] No equipment found, trying LLM extraction');

  requestLogger.info('🤖 No equipment found with keywords, trying LLM extraction', {
    originalQuery: query.substring(0, 100)
  });

  const extraction = await extractEquipmentName(query);

  console.log('🔍 [DEBUG] LLM extraction result', {
    count: extraction.equipment?.length || 0,
    equipment: extraction.equipment
  });

  if (extraction.equipment && extraction.equipment.length > 0) {
    requestLogger.info('🔬 [KEYWORD_FALLBACK] Extracted multiple equipment', {
      count: extraction.equipment.length,
      equipment: extraction.equipment.map(e => e.name)
    });

    // Search each equipment separately
    for (const eq of extraction.equipment) {
      requestLogger.info('🔍 [SEARCH_START]', {
        name: eq.name,
        confidence: eq.confidence,
        role: eq.role
      });

      const results = await searchSystems(eq.name, { limit: 10 });

      requestLogger.info('🔍 [SEARCH_RESULT]', {
        name: eq.name,
        found: results.length
      });

      if (results.length > 0) {
        currentEquipmentSearch.push(...results);
      }
    }

    console.log('🔍 [DEBUG] Combined search results', {
      totalSearched: extraction.equipment.length,
      totalFound: currentEquipmentSearch.length
    });

    requestLogger.info('✅ [COMBINED_RESULTS]', {
      totalSearched: extraction.equipment.length,
      totalFound: currentEquipmentSearch.length
    });

    // If STILL no results after all searches, return clarification request
    if (currentEquipmentSearch.length === 0) {
      const extractedNames = extraction.equipment.map(e => e.name).join(', ');

      requestLogger.info('❓ Equipment not found after extraction, requesting user clarification', {
        extracted: extractedNames,
        count: extraction.equipment.length
      });

      return {
        response: `I couldn't find "${extractedNames}" in your equipment inventory. Could you provide the manufacturer and model number? Or would you like me to answer generally about ${extractedNames}?`,
        classification: {
          intent: 'clarification_needed',
          confidence: 0.3
        },
        sources: [],
        score: 0,
        processing_time_ms: 0
      };
    }
  } else {
    requestLogger.info('⚠️ LLM extraction returned no equipment', {
      query: query.substring(0, 100)
    });
  }
}
```

---

## Testing Checklist

After implementation, test these queries:

```javascript
const testQueries = [
  // Multi-equipment (THE KEY TEST)
  "My GPS is not showing the same on my V100 and Zeus",
  "compare fortress and rocna anchors",

  // Implicit systems
  "autopilot not responding to wind data",

  // Single equipment (regression test)
  "tell me about fortress anchor",
  "my water pump is turning off frequently",

  // Edge cases
  "how do I navigate",  // No equipment
];
```

**Expected results:**
- Multi-equipment: Finds 2-5 systems ✅
- Implicit systems: Detects wind sensor, GPS receiver ✅
- Single equipment: Still works (1 system) ✅
- No equipment: Returns empty array, graceful handling ✅

---

## Verification Steps

1. **Check logs for extraction:**
   ```bash
   tail -f logs/api/node-api.log | grep "EXTRACT"
   ```
   Should see: `[EXTRACT_START]`, `[EXTRACT_RAW]`, `[EXTRACT_PARSED]`

2. **Check logs for search:**
   ```bash
   tail -f logs/api/node-api.log | grep "SEARCH"
   ```
   Should see: `[SEARCH_START]`, `[SEARCH_RESULT]` for EACH equipment

3. **Check combined results:**
   ```bash
   tail -f logs/api/node-api.log | grep "COMBINED_RESULTS"
   ```
   Should show: `totalSearched: 3, totalFound: 5` (or similar)

---

## Rollback

If issues occur:
```bash
git checkout HEAD~1 src/services/equipment-extraction.service.js
git checkout HEAD~1 src/services/chat-proxy.service.js
npm run dev
```

---

## Success Criteria

✅ Multi-equipment queries return multiple systems
✅ Implicit systems detected (GPS, wind sensor)
✅ Single equipment queries still work
✅ Extensive logging visible in logs
✅ No breaking errors in production

---

**Files to change:** 2
**Lines to change:** ~235
**Time:** 2 hours
**Risk:** Medium (dev phase acceptable)
