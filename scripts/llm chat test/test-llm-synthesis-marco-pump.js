#!/usr/bin/env node
/**
 * Test LLM Synthesis - Marco Pump Troubleshooting
 *
 * Tests 3 real troubleshooting questions about Marco fresh water pump
 * with follow-up "world knowledge" enhancement for each.
 *
 * Usage:
 *   node test-llm-synthesis-marco-pump.js
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

// ========== PROMPTS (copied from Python sidecar) ==========

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

// ========== TEST SCENARIOS ==========

const scenarios = [
  {
    name: "Question 1: Fresh water pump erroring out",
    userQuery: "i am having an issue with my fresh water pump where it is erroring out",
    equipmentContext: `- Marco fresh water pump
  Description: Self-priming transfer pump
  OWNERSHIP: CONFIRMED - This equipment is owned by the user`,
    conversationSummary: "No previous conversation context.",
    dipContext: `
TROUBLESHOOTING DATA:
Equipment: Marco fresh water pump
Entries found: 12
  • LED error diagnostics
  • Motor overload conditions
  • Running dry protection
  • Reset procedures`,
    pineconeContext: `Found 5 relevant documents:

1. Marco-UP3-M-Operating-Manual.pdf (relevance: 0.78)
   Type: troubleshooting
   Content: The electronic pressure sensor with microprocessor controls pump speed. Two LEDs indicate status: blue LED for water presence/priming, multicolored LED (red/green/yellow) for operational states. Red LED solid = motor short circuit. Red LED flashing = overload. Red+Blue alternating = ran dry. Yellow+Blue = power supply issue. Pump attempts 3 automatic resets before shutdown.

2. Marco-UP3-M-Operating-Manual.pdf (relevance: 0.75)
   Type: troubleshooting
   Content: Reset procedures: 1) Reboot pump circuit, or 2) Press Reset button on Marco control panel. After 3rd failure, pump stays off until manual reset. Common causes: running dry, air leaks in suction, loose hose clamps, obstructions, electrical faults, incorrect voltage.

3. Marco-UP3-M-Operating-Manual.pdf (relevance: 0.72)
   Type: procedure
   Content: If pump ran dry or inactive long time: add liquid to chamber before restart, open air vent valve during priming to release air, close once pumping starts. Low speed operation >2 hours causes thermal shutdown.`
  },
  {
    name: "Question 2: Pump needs frequent resets",
    userQuery: "the pump needs to be reset often via the control panel",
    equipmentContext: `- Marco fresh water pump
  Description: Self-priming transfer pump with control panel
  OWNERSHIP: CONFIRMED - This equipment is owned by the user`,
    conversationSummary: `PREVIOUS EXCHANGE (weight: 1):
User asked: "i am having an issue with my fresh water pump where it is erroring out"
Equipment discussed: Marco fresh water pump
Response summary: LED diagnostics indicate various error states. Pump attempts 3 auto-resets before requiring manual intervention...`,
    dipContext: `
TROUBLESHOOTING DATA:
Equipment: Marco fresh water pump
Entries found: 8
  • Frequent reset causes
  • Protection system behavior
  • Diagnostic LED patterns`,
    pineconeContext: `Found 4 relevant documents:

1. Marco-UP3-M-Operating-Manual.pdf (relevance: 0.81)
   Type: troubleshooting
   Content: Frequent resets indicate pump detecting abnormal conditions: running dry, overload, electrical faults. After 3 automatic restart attempts, pump shuts down until reset. Solid red LED = motor short/blockage. Fast flashing red = overload. Reset via control panel button or circuit reboot.

2. Marco-UP3-M-Operating-Manual.pdf (relevance: 0.76)
   Type: troubleshooting
   Content: Common causes requiring frequent resets: blockages/jams in gears, running dry (no liquid), electrical wiring issues, power supply problems, overheating from continuous operation or viscous liquids. Check fluid levels, hose integrity, stable voltage, liquid compatibility.

3. Marco-UP3-M-Operating-Manual.pdf (relevance: 0.70)
   Type: maintenance
   Content: Preventive measures: never run dry, check hose clamps for air leaks, verify correct power voltage, ensure pump rated for liquid type. Adding expansion tank or flexible tubing stabilizes pressure and reduces sensor stress.`
  },
  {
    name: "Question 3: Flashing red LED",
    userQuery: "it is a flashing red",
    equipmentContext: `- Marco fresh water pump
  Description: Self-priming transfer pump with LED diagnostics
  OWNERSHIP: CONFIRMED - This equipment is owned by the user`,
    conversationSummary: `PREVIOUS EXCHANGE (weight: 1):
User asked: "the pump needs to be reset often via the control panel"
Equipment discussed: Marco fresh water pump
Response summary: Frequent resets indicate abnormal conditions. Solid red = motor short, flashing red = overload. Reset via control panel or reboot...`,
    dipContext: `
TROUBLESHOOTING DATA:
Equipment: Marco fresh water pump
Entries found: 6
  • Flashing red LED diagnosis
  • Overload protection behavior
  • Recovery procedures`,
    pineconeContext: `Found 3 relevant documents:

1. Marco-UP3-M-Operating-Manual.pdf (relevance: 0.85)
   Type: troubleshooting
   Content: Flashing red LED = pump overloaded. Causes: liquid too viscous, gears overheating. Control circuit reduces motor speed to keep current nominal for 30 seconds, then tries normal speed. After 3 overload cycles, pump shuts off for protection. Clear by rebooting circuit or pressing Reset on control panel.

2. Marco-UP3-M-Operating-Manual.pdf (relevance: 0.79)
   Type: procedure
   Content: Steps for flashing red (overload): 1) Check liquid viscosity suitable for pump, 2) Inspect gears for free movement/no obstruction, 3) Allow cooling if overheated, 4) Reset via circuit reboot or control panel button, 5) Monitor if error returns, 6) If persistent, requires professional service.

3. Marco-UP3-M-Operating-Manual.pdf (relevance: 0.73)
   Type: specifications
   Content: Pump rated for 26 l/min flow rate. Maintain clean unobstructed pipes and gears. Regular maintenance: check seals, electrical connections. Proper use within specifications prevents overload.`
  }
];

// ========== SYNTHESIS FUNCTION ==========

async function synthesizeResponse(scenario) {
  const prompt = `${PERSONALITY_TRAITS}

USER QUESTION: "${scenario.userQuery}"

EQUIPMENT IN USER'S INVENTORY:
${scenario.equipmentContext}

CONVERSATION HISTORY (if available):
${scenario.conversationSummary}

RELEVANT TECHNICAL DATA FROM DIP TABLES:
${scenario.dipContext}

RELEVANT DOCUMENTS FROM KNOWLEDGE BASE:
${scenario.pineconeContext}

QUERY INTENT: troubleshooting

${RESPONSE_FORMAT_RULES}

${SYNTHESIS_INSTRUCTIONS}

Generate your response now using the technical data provided:`;

  const response = await openai.chat.completions.create({
    model: process.env.OPENAI_SUMMARY_MODEL || 'gpt-4o-mini',
    messages: [{
      role: 'user',
      content: prompt
    }],
    max_tokens: 4000,
    temperature: parseFloat(process.env.OPENAI_TEMPERATURE || '0.3')
  });

  return {
    answer: response.choices[0].message.content.trim(),
    usage: response.usage,
    duration: 0  // Set by caller
  };
}

// ========== WORLD KNOWLEDGE FOLLOW-UP ==========

async function getWorldKnowledge(userQuery, synthesisAnswer) {
  const followUpPrompt = `You just generated this response for a user asking about "${userQuery}":

${synthesisAnswer}

Given your world knowledge about marine equipment, fresh water pump systems, troubleshooting, and general best practices, would you add anything to this response that could be helpful but wasn't in the technical documentation?

Focus on:
- Real-world failure modes and common issues
- Marine-specific considerations (voltage, corrosion, installation)
- Quick diagnostic tricks or "here's what it really means when..."
- Preventive maintenance wisdom from the field
- When to DIY vs. call a tech

Please respond with:
1. "No additions needed" if the response is complete
2. OR a brief paragraph (prefixed with 💡) of additional context, tips, or best practices that would enhance the response`;

  const response = await openai.chat.completions.create({
    model: process.env.OPENAI_SUMMARY_MODEL || 'gpt-4o-mini',
    messages: [{
      role: 'user',
      content: followUpPrompt
    }],
    max_tokens: 1000,
    temperature: 0.5  // Higher for creative suggestions
  });

  return {
    answer: response.choices[0].message.content.trim(),
    usage: response.usage,
    duration: 0  // Set by caller
  };
}

// ========== MAIN TEST RUNNER ==========

async function runTests() {
  console.log('🧪 Testing LLM Synthesis - Marco Pump Troubleshooting\n');
  console.log('='.repeat(80));
  console.log('Model:', process.env.OPENAI_SUMMARY_MODEL || 'gpt-4o-mini');
  console.log('Temperature:', process.env.OPENAI_TEMPERATURE || '0.3');
  console.log('='.repeat(80));
  console.log('');

  for (let i = 0; i < scenarios.length; i++) {
    const scenario = scenarios[i];

    console.log(`\n${'#'.repeat(80)}`);
    console.log(`# ${scenario.name}`);
    console.log(`${'#'.repeat(80)}\n`);

    // STEP 1: Synthesis from technical docs
    console.log('📘 STEP 1: Synthesis from Technical Documentation');
    console.log('-'.repeat(80));

    const synthStart = Date.now();
    const synthResult = await synthesizeResponse(scenario);
    synthResult.duration = Date.now() - synthStart;

    console.log(synthResult.answer);
    console.log('');
    console.log('📊 Metrics:');
    console.log(`  Duration: ${synthResult.duration}ms`);
    console.log(`  Response length: ${synthResult.answer.length} characters`);
    console.log(`  Tokens: ${synthResult.usage.total_tokens} (prompt: ${synthResult.usage.prompt_tokens}, completion: ${synthResult.usage.completion_tokens})`);
    console.log('');

    // STEP 2: World knowledge enhancement
    console.log('🌍 STEP 2: World Knowledge Enhancement');
    console.log('-'.repeat(80));

    const worldStart = Date.now();
    const worldResult = await getWorldKnowledge(scenario.userQuery, synthResult.answer);
    worldResult.duration = Date.now() - worldStart;

    console.log(worldResult.answer);
    console.log('');
    console.log('📊 Metrics:');
    console.log(`  Duration: ${worldResult.duration}ms`);
    console.log(`  Response length: ${worldResult.answer.length} characters`);
    console.log(`  Tokens: ${worldResult.usage.total_tokens} (prompt: ${worldResult.usage.prompt_tokens}, completion: ${worldResult.usage.completion_tokens})`);
    console.log('');
  }

  console.log('\n' + '='.repeat(80));
  console.log('✅ All tests complete');
  console.log('='.repeat(80));
  console.log('');
}

// ========== RUN ==========

runTests().then(() => {
  process.exit(0);
}).catch(error => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});
