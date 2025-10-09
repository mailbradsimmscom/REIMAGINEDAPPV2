import 'dotenv/config';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const COLLOQUIAL_EXTRACTION_PROMPT = `You are analyzing technical documentation to extract colloquial terms that boat owners and marine equipment users would naturally use when referring to this equipment.

Your task: Read the documentation chunks and identify 10 colloquial words or short phrases (1-3 words max) that people would use in conversation when talking about or asking questions about this equipment.

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

Return a JSON array of exactly 10 colloquial terms:`;

async function fetchPineconeChunks(manufacturer, model) {
  try {
    const response = await fetch('http://localhost:8000/v1/pinecone/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        query: `${manufacturer} ${model}`,
        top_k: 10,
        filter: {
          manufacturer: manufacturer,
          model: model
        }
      })
    });

    const data = await response.json();

    if (!data.success || !data.matches) {
      throw new Error(`Pinecone search failed: ${data.error || 'Unknown error'}`);
    }

    return data.matches;
  } catch (error) {
    console.error(`  ❌ Pinecone fetch error: ${error.message}`);
    return [];
  }
}

async function extractColloquialTerms(chunks) {
  try {
    // Combine chunks into a single text, limit to reasonable size
    const combinedText = chunks
      .slice(0, 5) // Use top 5 chunks to stay within token limits
      .map(chunk => chunk.metadata?.text || '')
      .join('\n\n---\n\n')
      .substring(0, 8000); // Limit to ~2k tokens worth of text

    const prompt = COLLOQUIAL_EXTRACTION_PROMPT.replace('{chunks}', combinedText);

    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_SUMMARY_MODEL || 'gpt-4.1-mini',
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

      return terms;
    } catch (parseError) {
      console.error(`  ❌ Failed to parse LLM response as JSON: ${parseError.message}`);
      console.error(`  Raw response: ${responseText}`);
      return [];
    }
  } catch (error) {
    console.error(`  ❌ LLM extraction error: ${error.message}`);
    return [];
  }
}

async function testColloquialExtraction() {
  console.log('🧪 Testing Colloquial Term Extraction from Pinecone Chunks\n');
  console.log(`Model: ${process.env.OPENAI_SUMMARY_MODEL || 'gpt-4.1-mini'}\n`);
  console.log('='.repeat(80));

  // Test equipment to extract colloquial terms for
  const testEquipment = [
    { manufacturer: 'Marco', model: 'self_priming_transfer_pump', name: 'Marco Self-Priming Transfer Pump' },
    { manufacturer: 'Fortress', model: 'fx_37', name: 'Fortress FX-37 Anchor' },
    { manufacturer: 'Rocna', model: 'mkii_50_50kg', name: 'Rocna MkII 50' }
  ];

  for (const equipment of testEquipment) {
    console.log(`\n📦 Equipment: ${equipment.name}`);
    console.log(`   Manufacturer: ${equipment.manufacturer}, Model: ${equipment.model}`);

    // Step 1: Fetch chunks from Pinecone
    console.log('\n   🔍 Fetching chunks from Pinecone...');
    const fetchStart = Date.now();
    const chunks = await fetchPineconeChunks(equipment.manufacturer, equipment.model);
    const fetchDuration = Date.now() - fetchStart;

    if (chunks.length === 0) {
      console.log(`   ⚠️  No chunks found in Pinecone [${fetchDuration}ms]`);
      continue;
    }

    console.log(`   ✅ Found ${chunks.length} chunks [${fetchDuration}ms]`);

    // Show snippet of first chunk
    const firstChunk = chunks[0]?.metadata?.text || '';
    console.log(`   📄 First chunk preview (${firstChunk.length} chars):`);
    console.log(`      ${firstChunk.substring(0, 150)}...`);

    // Step 2: Extract colloquial terms with LLM
    console.log('\n   🤖 Extracting colloquial terms with LLM...');
    const llmStart = Date.now();
    const terms = await extractColloquialTerms(chunks);
    const llmDuration = Date.now() - llmStart;

    if (terms.length === 0) {
      console.log(`   ❌ Failed to extract terms [${llmDuration}ms]`);
      continue;
    }

    console.log(`   ✅ Extracted ${terms.length} colloquial terms [${llmDuration}ms]:`);
    terms.forEach((term, idx) => {
      console.log(`      ${idx + 1}. "${term}"`);
    });

    console.log(`\n   ⏱️  Total time: ${fetchDuration + llmDuration}ms`);
    console.log(`   💡 These terms could be added to synonyms_fts field`);

    console.log('\n   ' + '-'.repeat(76));
  }

  console.log('\n' + '='.repeat(80));
  console.log('✅ Test complete\n');
  process.exit(0);
}

// Run the test
testColloquialExtraction().catch(error => {
  console.error('Test failed:', error);
  process.exit(1);
});
