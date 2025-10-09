import 'dotenv/config';
import OpenAI from 'openai';

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
  "My GPS is not showing the same on my V100 and Zeus",
  "autopilot not responding to wind data"
];

async function extractEquipmentName(query) {
  try {
    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_SUMMARY_MODEL || 'gpt-4o-mini',
      messages: [{
        role: 'user',
        content: EXTRACTION_PROMPT.replace('{query}', query)
      }],
      max_tokens: 50,
      temperature: 0.1
    });

    const extracted = response.choices[0].message.content.trim();

    if (extracted === 'none' || extracted === 'Equipment: none') {
      return null;
    }

    const cleaned = extracted.replace(/^Equipment:\s*/i, '').trim();
    return cleaned;

  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    return null;
  }
}

async function runBaseline() {
  console.log('🧪 BASELINE TEST - Current Single-String Extraction\n');
  console.log('='.repeat(80));

  for (const query of testQueries) {
    console.log(`\n📝 Query: "${query}"`);
    
    const startTime = Date.now();
    const extracted = await extractEquipmentName(query);
    const duration = Date.now() - startTime;

    if (!extracted) {
      console.log(`  ❌ Extracted: (none) [${duration}ms]`);
    } else {
      console.log(`  ✅ Extracted: "${extracted}" [${duration}ms]`);
      console.log(`  ⚠️  Problem: This will search for literal "${extracted}" and find nothing!`);
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('📊 BASELINE RESULTS:');
  console.log('   - Multi-equipment queries return comma-separated strings');
  console.log('   - Implicit equipment (GPS, wind sensor) may or may not be detected');
  console.log('   - Searches fail because comma-separated strings not in database\n');
  
  process.exit(0);
}

runBaseline().catch(error => {
  console.error('Test failed:', error);
  process.exit(1);
});
