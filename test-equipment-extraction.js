import 'dotenv/config';
import OpenAI from 'openai';
import { searchSystems } from './src/repositories/systems.repository.js';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

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

const testQueries = [
  // Clean queries (should work without LLM)
  "tell me about my fortress anchor",
  "DST810 information",
  "my Rocna anchor",

  // Messy queries with symptoms (need LLM extraction)
  "my water pump is clicking off quite often",
  "my self priming transfer pump is click off all the time",
  "the anchor keeps dragging",
  "my DST810 is showing wrong temperature",

  // Multi-equipment queries (THE KEY TEST)
  "My GPS is not showing the same on my V100 and Zeus",
  "compare fortress and rocna anchors",
  "Zeus and V100 displaying different data",

  // Edge cases
  "my boat",
  "how do I fix this",
  "pump problem",
  "clicking noise",
];

async function extractEquipmentName(query) {
  try {
    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_SUMMARY_MODEL || 'gpt-4o-mini',
      messages: [
        {
          role: 'user',
          content: EXTRACTION_PROMPT.replace('{query}', query)
        }
      ],
      max_tokens: 50,
      temperature: 0.1
    });

    const extracted = response.choices[0].message.content.trim();

    // Match production logic: handle "none" or "Equipment: none"
    if (extracted === 'none' || extracted === 'Equipment: none') {
      return null;
    }

    // Clean up response (sometimes LLM includes "Equipment: " prefix)
    const cleaned = extracted.replace(/^Equipment:\s*/i, '').trim();
    return cleaned;

  } catch (error) {
    console.error(`  ❌ LLM Error: ${error.message}`);
    return null;
  }
}

async function testExtraction() {
  console.log('🧪 Testing Equipment Extraction with LLM Fallback\n');
  console.log(`Model: ${process.env.OPENAI_SUMMARY_MODEL || 'gpt-4o-mini'}\n`);
  console.log('='.repeat(80));

  for (const query of testQueries) {
    console.log(`\n📝 Query: "${query}"`);

    // Step 1: Extract equipment name with LLM
    const startTime = Date.now();
    const extracted = await extractEquipmentName(query);
    const llmDuration = Date.now() - startTime;

    if (!extracted) {
      console.log(`  ❌ Extracted: (none) [${llmDuration}ms]`);
      console.log(`  ⏭️  Skipping system search`);
      continue;
    }

    console.log(`  ✅ Extracted: "${extracted}" [${llmDuration}ms]`);

    // Step 2: Search systems table with extracted term (original AND logic)
    try {
      const searchStart = Date.now();
      const results = await searchSystems(extracted, { limit: 3 });
      const searchDuration = Date.now() - searchStart;

      if (results.length > 0) {
        console.log(`  🎯 Systems found (AND): ${results.length} [${searchDuration}ms]`);
        results.forEach((system, idx) => {
          console.log(`     ${idx + 1}. ${system.manufacturer || 'Unknown'} ${system.model || system.asset_uid} (rank: ${system.rank?.toFixed(3)})`);
        });
      } else {
        console.log(`  ⚠️  No systems found (AND) [${searchDuration}ms]`);
      }

    } catch (error) {
      console.log(`  ❌ Search error (AND): ${error.message}`);
    }

    // Step 3: Try with OR logic for websearch_to_tsquery (word1 OR word2 OR word3)
    try {
      const orQuery = extracted.split(/\s+/).join(' OR ');
      console.log(`  🔄 Trying websearch OR query: "${orQuery}"`);
      console.log(`     (This requires RPC to use websearch_to_tsquery)`);

      const searchStart = Date.now();
      const resultsOr = await searchSystems(orQuery, { limit: 3 });
      const searchDuration = Date.now() - searchStart;

      if (resultsOr.length > 0) {
        console.log(`  🎯 Systems found (OR): ${resultsOr.length} [${searchDuration}ms]`);
        resultsOr.forEach((system, idx) => {
          console.log(`     ${idx + 1}. ${system.manufacturer || 'Unknown'} ${system.model || system.asset_uid} (rank: ${system.rank?.toFixed(3)})`);
        });
      } else {
        console.log(`  ⚠️  No systems found (OR) [${searchDuration}ms]`);
      }

      console.log(`  ⏱️  Total: ${llmDuration + searchDuration}ms`);

    } catch (error) {
      console.log(`  ❌ Search error (OR): ${error.message}`);
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('✅ Test complete\n');
  process.exit(0);
}

// Run the test
testExtraction().catch(error => {
  console.error('Test failed:', error);
  process.exit(1);
});
