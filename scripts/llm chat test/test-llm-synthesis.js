#!/usr/bin/env node
/**
 * Test LLM Synthesis - Mimic Python sidecar synthesis call
 *
 * This script tests the final synthesis step where the LLM generates
 * a natural language response from DIP data + Pinecone chunks.
 *
 * Usage:
 *   node test-llm-synthesis.js
 *
 * Data source: Real grill query from logs (2025-10-26 16:14)
 */

import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import OpenAI from 'openai';

// Load .env from project root (2 levels up from this script)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, '../..');
config({ path: resolve(projectRoot, '.env') });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// ========== PROMPTS (copied from python-sidecar/app/chat/config/system_prompts.py) ==========

const PERSONALITY_TRAITS = `You are a helpful marine equipment expert assistant with an optimistic, curious, and people-focused personality. You're a critical thinker but positive. You believe that with hard work and cheerful resilience, you can make a real difference. Bring this positive, can-do spirit to your responses while staying grounded in technical facts.`;

const RESPONSE_FORMAT_RULES = `
FORMAT REQUIREMENTS:
1. NO stage directions or action descriptions (no "*brightens up*", "*smiles*", etc.)
2. First paragraph MUST be conversational technical context from DIP/Vector data - prefix with 📊 icon
3. If the query asks for steps/procedures/how-to, the second section MUST extract and list those steps explicitly - prefix with 🔧 icon. They should be numbered and clear.
4. Third section can include world knowledge and context - prefix with 💡 icon (not yet implemented)
5. Use actual numbers and specifications from the technical data provided
6. Be conversational but precise in context paragraphs
7. Be direct and verbatim when listing procedural steps
8. Keep paragraphs focused and scannable
`;

const SYNTHESIS_INSTRUCTIONS = `
CRITICAL DATA USAGE RULES:
1. You MUST use the technical data provided in RELEVANT TECHNICAL DATA and RELEVANT DOCUMENTS sections
2. DO NOT say "I don't have information" if technical data is provided above
3. DO NOT use general knowledge for specifications when DIP data is available
4. Directly answer the question using the specs, procedures, and data shown
5. Cite specific numbers, parameters, and values from the technical data
6. EQUIPMENT IDENTIFICATION IS NON-NEGOTIABLE: NEVER change manufacturer or model from EQUIPMENT IN USER'S INVENTORY - this is ground truth
7. Use documents for technical specifications ONLY, not for equipment identification
8. If documents mention different manufacturers/models, ignore that - stick to inventory data
9. If DIP data contradicts your general knowledge, ALWAYS use the DIP data
10. Show genuine curiosity and enthusiasm about the user's equipment
11. If you spot opportunities for improvement or optimization, mention them positively in the 💡 section

PROCEDURE EXTRACTION RULES:
12. When query asks for steps/procedures/how-to AND documents contain procedures, you MUST include a 🔧 section
13. The 🔧 section must come AFTER the 📊 conversational context paragraph
14. Extract and LIST steps explicitly - DO NOT summarize procedures conversationally
15. Format as numbered lists - preserve section structure from source (e.g., "Preliminary Checks:", "Start-up:")
16. Include all steps verbatim from source documents - do not abbreviate or paraphrase
17. Be direct: Lead with section heading, then list steps immediately
18. Example format:
    📊 [Brief conversational context about the equipment/system]

    🔧 **First Start-up Procedure**

    **Preliminary Checks:**
    1. [Step exactly as written in document]
    2. [Step exactly as written in document]

    **Start-up:**
    1. [Step exactly as written in document]

19. Installation information is not overly helpful as most items are installed. So skip it unless asked for or helpful in the context of the technical answer
`;

// ========== TEST DATA (from real grill query logs - 2025-10-26 16:14) ==========

const USER_QUERY = "tell me about the basic operations";

const EQUIPMENT_CONTEXT = `- Kenyon silken_grill
  Description: Silken Grill
  OWNERSHIP: LIKELY - This equipment is likely owned by the user (confidence: 0.83)`;

const CONVERSATION_SUMMARY = `PREVIOUS EXCHANGE (weight: 1):
User asked: "have a question about my grill"
Equipment discussed: None
Response summary: 📊 Your Kenyon Silken Grill is a fantastic piece of marine cooking equipment designed for all-season use with a 48V DC power supply and a maximum output of 1300 watts. It features a heating element th...`;

const DIP_CONTEXT = `
PROCEDURE DATA:
Equipment: Kenyon silken_grill
Entries found: 7
  • Grill ready for cooking
  • Safe operation of grill during use`;

const PINECONE_CONTEXT = `Found 5 relevant documents:

1. 145775-48VDC-SINGLE-ZONE-INTELLIKEN-GRILL-1-1.pdf (relevance: 0.66)
   Type: document
   Content: Always clean the grill with a cloth and a stainless steel or glass surface cleaner. ## CLEAN GRILL WITH CAUTION
If a wet sponge or cloth is used to wipe spills on a hot cooking surface, be careful to avoid steam burns. Some cleaners produce noxious fumes if applied to a hot surface. Read the cleaner label for details prior to using.

## STORAGE
When used as a portable grill, store indoors when not in use. When used as a built-in grill, suitable shelter must be provided to prevent direct exposure to rain. Covers available at www.cookwithkenyon.com.

## DO NOT TOUCH HEATING ELEMENT OR GRATE
The heating element and grate will be hot for some time after cooking. These components should be allowed to cool and then be handled with care and caution while cleaning, as they may be hot enough to cause severe burns. Do not operate appliance with damaged wires. If the appliance malfunctions, discontinue use and contact the nearest authorized appliance dealer or the factory for examination, repair, or adjustment.

## DO NOT USE POTS OR OTHER BAKEWARE ON THE GRILL

## NEVER LEAVE GRILL UNATTENDED AT HIGH HEAT SETTINGS
High heat setting may cause heavy smoking and ignite grease.

## TO PREVENT SMOKE
To prevent the contents of the drip tray from smoking, place 2 cups of water (or enough to cover the bottom of the pan) in the drip tray before cooking.

2. 145775-48VDC-SINGLE-ZONE-INTELLIKEN-GRILL-1-1.pdf (relevance: 0.63)
   Type: document
   Content: # Before Using the Grill
1. Remove the cooking grate and drip tray from the grill. Wash the grill with warm soapy water using a non-abrasive cloth. **USE ONLY HIGH TEMP PLASTIC UTENSILS WHEN GRILLING.** Visit our website to purchase a set of high quality stainless steel/high temp plastic grill utensils, www.cookwithkenyon.com.

2. Make sure the drip tray is inserted all the way into the bottom of the grill and electric element bracket is resting on the element support bracket.

3. Cover the bottom of the drip tray with a liquid. Water is fine. **PLEASE DO NOT USE A FLAMMABLE LIQUID!** Doing so would ruin your cookout. Using apple juice if you are grilling pork adds a nice flavor to the meat. A can of lime soda is wonderful if you are grilling fish. Just remember to always add liquid to the drip tray prior to grilling.

4. To keep your grill smoke free, always clean the grilling surface after each use. Simply wash with warm soapy water using a non-abrasive cloth or place in your dishwasher. Empty the drip tray and wipe with a damp paper towel. The drip tray can be used multiple times before needing to be replaced.

5. Place your cooking grate or optional griddle (part #B96000) onto the element with drip tray installed. Use the griddle for foods such as eggs, pancakes, bacon, and more!

6. Preheat grill with the lid closed for 5 - 7 minutes on desired heat setting for type of food:
- Steak - Temp setting 550˚F / Power setting 16
- Burgers - Temp setting 500˚F / Power setting 9
- Pork and Fish - Temp setting 400˚F / Power setting 5
- Vegetables - Temp setting 350˚F / Power setting 4

7. Close the lid and cook. Enjoy the best grilled food you have ever tasted!

3. 145775-48VDC-SINGLE-ZONE-INTELLIKEN-GRILL-1-1.pdf (relevance: 0.61)
   Type: document
   Content: Contact KENYON Customer Care immediately at (860) 664-4906.
- The use of accessory attachments not supplied by the manufacturer of the appliance may cause injuries.
- Do not use appliance for other than intended use.

4. 145775-48VDC-SINGLE-ZONE-INTELLIKEN-GRILL-1-1.pdf (relevance: 0.66)
   Type: document
   Content: |

# Operation

## Grill Parts

### GRATE ### Heating Element
The heating element is designed to pivot as shown to remove/replace the baffle tray and drip tray. It will stay in the up position. To put down, apply slight downward pressure.

### Baffle Tray
The baffle tray supports the drip tray, heating element, and grate and must always be used when operating the grill.

### Drip Tray
The drip tray collects all the fat and juices created during the cooking process. The drip tray must be emptied after each use. When replacing the drip tray, position the drip tray so that it is completely contained inside the baffle tray and ensure that the side of the rim of the drip tray does not protrude outside of the baffle tray.

5. 145775-48VDC-SINGLE-ZONE-INTELLIKEN-GRILL-1-1.pdf (relevance: 0.62)
   Type: document
   Content: The display will flash and a double beep alarm will sound every ten seconds until the power button is touched, or after 3 minutes, the flashing display and alarm will deactivate.`;

const QUERY_INTENT = "general_information";

// ========== BUILD PROMPT (same as Python sidecar) ==========

const prompt = `${PERSONALITY_TRAITS}

USER QUESTION: "${USER_QUERY}"

EQUIPMENT IN USER'S INVENTORY:
${EQUIPMENT_CONTEXT}

CONVERSATION HISTORY (if available):
${CONVERSATION_SUMMARY}

RELEVANT TECHNICAL DATA FROM DIP TABLES:
${DIP_CONTEXT}

RELEVANT DOCUMENTS FROM KNOWLEDGE BASE:
${PINECONE_CONTEXT}

QUERY INTENT: ${QUERY_INTENT}

${RESPONSE_FORMAT_RULES}

${SYNTHESIS_INSTRUCTIONS}

Generate your response now using the technical data provided:`;

// ========== TEST FUNCTION ==========

async function testSynthesis() {
  console.log('🧪 Testing LLM Synthesis Call\n');
  console.log('='.repeat(80));
  console.log('Query:', USER_QUERY);
  console.log('Model:', process.env.OPENAI_SUMMARY_MODEL || 'gpt-4o-mini');
  console.log('Temperature:', process.env.OPENAI_TEMPERATURE || '0.3');
  console.log('='.repeat(80));
  console.log('');

  try {
    const startTime = Date.now();

    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_SUMMARY_MODEL || 'gpt-4o-mini',
      messages: [{
        role: 'user',
        content: prompt
      }],
      max_tokens: 4000,
      temperature: parseFloat(process.env.OPENAI_TEMPERATURE || '0.3')
    });

    const duration = Date.now() - startTime;
    const answer = response.choices[0].message.content.trim();

    console.log('✅ LLM Response:');
    console.log('-'.repeat(80));
    console.log(answer);
    console.log('-'.repeat(80));
    console.log('');
    console.log('📊 Metrics:');
    console.log(`  Duration: ${duration}ms`);
    console.log(`  Response length: ${answer.length} characters`);
    console.log(`  Tokens used: ${response.usage.total_tokens}`);
    console.log(`    - Prompt: ${response.usage.prompt_tokens}`);
    console.log(`    - Completion: ${response.usage.completion_tokens}`);
    console.log('');

  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.response) {
      console.error('Response:', error.response.data);
    }
    process.exit(1);
  }
}

// ========== RUN TEST ==========

testSynthesis().then(() => {
  console.log('✅ Test complete\n');
  process.exit(0);
}).catch(error => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});
