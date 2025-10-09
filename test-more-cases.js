import 'dotenv/config';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const NEW_EXTRACTION_PROMPT = 'You are a marine expert looking at a colloquial sentence and trying to extract the systems. As you know the marine environment is complex because states and conditions can also be equipment, such as GPS which is a thing and a system, or wind sensor which is a state but also there is a wind sensor. You need to be crafty and careful to parse apart a sentence and pull from it what could be the systems.\n\nOUTPUT FORMAT: Return JSON array only.\n\nRULES:\n1. Extract explicit mentions (V100, Zeus, fortress anchor)\n2. Infer implicit systems:\n   - "GPS data" implies GPS receiver exists\n   - "wind data" implies wind sensor exists\n   - "not showing same" implies multiple displays\n3. Include confidence (0-1) for each\n4. Identify role: data_source, display, control, or equipment\n\nEXAMPLES:\n\nQuery: "GPS showing different on V100 and Zeus"\n{\n  "equipment": [\n    {"name": "GPS", "confidence": 0.8, "role": "data_source"},\n    {"name": "V100", "confidence": 0.95, "role": "display"},\n    {"name": "Zeus", "confidence": 0.95, "role": "display"}\n  ]\n}\n\nQuery: "autopilot not responding to wind data"\n{\n  "equipment": [\n    {"name": "autopilot", "confidence": 1.0, "role": "control"},\n    {"name": "wind sensor", "confidence": 0.75, "role": "data_source"}\n  ]\n}\n\nQuery: "tell me about fortress anchor"\n{\n  "equipment": [\n    {"name": "fortress anchor", "confidence": 1.0, "role": "equipment"}\n  ]\n}\n\nQuery: "how do I navigate"\n{\n  "equipment": []\n}\n\nNow extract from: "{query}"';

const testQueries = [
  "my water pump is turning off frequently",
  "my helm controls for the engine will not switch from the upper to lower helm",
];

async function extractEquipmentArray(query) {
  try {
    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_SUMMARY_MODEL || 'gpt-4o-mini',
      messages: [{
        role: 'user',
        content: NEW_EXTRACTION_PROMPT.replace('{query}', query)
      }],
      max_tokens: 300,
      temperature: 0.1
    });

    const rawResponse = response.choices[0].message.content.trim();

    let cleaned = rawResponse;
    if (cleaned.startsWith('```')) {
      const lines = cleaned.split('\n');
      lines.shift();
      if (lines[lines.length - 1].trim() === '```') {
        lines.pop();
      }
      cleaned = lines.join('\n').trim();
    }

    const parsed = JSON.parse(cleaned);
    
    const equipmentArray = Array.isArray(parsed) 
      ? parsed 
      : (parsed.equipment || []);

    return { equipment: equipmentArray };

  } catch (error) {
    console.error('  Parse error:', error.message);
    return { equipment: [] };
  }
}

async function runTest() {
  console.log('ADDITIONAL TEST CASES\n');
  console.log('='.repeat(80));

  for (const query of testQueries) {
    console.log('\nQuery:', query);

    const startTime = Date.now();
    const extraction = await extractEquipmentArray(query);
    const duration = Date.now() - startTime;

    if (!extraction.equipment || extraction.equipment.length === 0) {
      console.log('  Extracted: (none)', duration, 'ms');
    } else {
      console.log('  Extracted', extraction.equipment.length, 'systems in', duration, 'ms:');
      extraction.equipment.forEach((eq, i) => {
        console.log('     ', i + 1 + '.', eq.name);
        console.log('         confidence:', eq.confidence);
        console.log('         role:', eq.role);
      });
    }
  }

  console.log('\n' + '='.repeat(80));
  process.exit(0);
}

runTest().catch(error => {
  console.error('Test failed:', error);
  process.exit(1);
});
