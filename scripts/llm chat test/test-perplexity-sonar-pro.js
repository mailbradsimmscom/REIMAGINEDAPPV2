#!/usr/bin/env node
/**
 * Test Perplexity Sonar Pro - Marco Pump Troubleshooting
 *
 * Tests Perplexity's web search + synthesis for real-world marine wisdom
 * Compares to manual-only approach to see if web search adds value
 *
 * Usage:
 *   node test-perplexity-sonar-pro.js
 */

import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

// Load .env from project root
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, '../..');
config({ path: resolve(projectRoot, '.env') });

// ========== TEST SCENARIOS ==========

const scenarios = [
  {
    name: "Question 1: Fresh water pump erroring out",
    query: "Marco fresh water pump on a catamaran keeps erroring out. LED shows different colors. What are common real-world causes and fixes in marine environments?",
    context: "User has a Marco self-priming transfer pump with LED diagnostics"
  },
  {
    name: "Question 2: Pump needs frequent resets",
    query: "Marco fresh water pump needs to be reset often via the control panel. What causes this in marine installations and how to fix it permanently?",
    context: "Pump has protection system that shuts down and requires manual reset"
  },
  {
    name: "Question 3: Flashing red LED",
    query: "Marco fresh water pump has a flashing red LED. What does this mean specifically and what are the most common fixes from boat owners?",
    context: "LED indicates overload condition, pump shuts off after 3 attempts"
  }
];

// ========== PERPLEXITY API CALL ==========

async function callPerplexity(query, model = 'sonar-pro') {
  const response = await fetch('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.PERPLEXITY_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: model,
      messages: [{
        role: 'user',
        content: query
      }],
      temperature: 0.3,
      max_tokens: 2000
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Perplexity API error: ${response.status} ${error}`);
  }

  return await response.json();
}

// ========== MAIN TEST RUNNER ==========

async function runTests() {
  console.log('🧪 Testing Perplexity Sonar Pro - Marco Pump Troubleshooting\n');
  console.log('='.repeat(80));
  console.log('Model: sonar-pro (Advanced search with deeper content understanding)');
  console.log('='.repeat(80));
  console.log('');

  for (let i = 0; i < scenarios.length; i++) {
    const scenario = scenarios[i];

    console.log(`\n${'#'.repeat(80)}`);
    console.log(`# ${scenario.name}`);
    console.log(`${'#'.repeat(80)}\n`);

    console.log('📝 Query:', scenario.query);
    console.log('📌 Context:', scenario.context);
    console.log('');
    console.log('🌐 Searching web + synthesizing answer...');
    console.log('-'.repeat(80));

    const startTime = Date.now();

    try {
      const result = await callPerplexity(scenario.query, 'sonar-pro');
      const duration = Date.now() - startTime;

      const answer = result.choices[0].message.content;
      const citations = result.citations || [];

      console.log('✅ Perplexity Response:');
      console.log('-'.repeat(80));
      console.log(answer);
      console.log('-'.repeat(80));
      console.log('');

      if (citations.length > 0) {
        console.log('📚 Sources Found:');
        citations.forEach((url, idx) => {
          console.log(`  ${idx + 1}. ${url}`);
        });
        console.log('');
      }

      console.log('📊 Metrics:');
      console.log(`  Duration: ${duration}ms`);
      console.log(`  Response length: ${answer.length} characters`);
      console.log(`  Citations: ${citations.length} sources`);
      console.log(`  Model: ${result.model}`);
      if (result.usage) {
        console.log(`  Tokens: ${result.usage.total_tokens} (prompt: ${result.usage.prompt_tokens}, completion: ${result.usage.completion_tokens})`);
      }
      console.log('');

    } catch (error) {
      console.error('❌ Error:', error.message);
      console.log('');
    }

    // Small delay between queries to be nice to API
    if (i < scenarios.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('✅ All tests complete');
  console.log('');
  console.log('💡 Key Questions:');
  console.log('  1. Did Perplexity find real forum posts, YouTube videos, or marine blogs?');
  console.log('  2. Does it add practical wisdom beyond what\'s in the manual?');
  console.log('  3. Are the citations useful (marine forums vs random websites)?');
  console.log('  4. How does this compare to the two-pass OpenAI approach?');
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
