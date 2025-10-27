#!/usr/bin/env node
/**
 * Test Perplexity Query Comparison - Basic vs Enhanced
 *
 * Compares a basic query vs an enhanced query with more context
 * to see which produces better real-world troubleshooting results
 *
 * Usage:
 *   node test-perplexity-comparison.js
 */

import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

// Load .env from project root
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, '../..');
config({ path: resolve(projectRoot, '.env') });

// ========== TEST QUERIES ==========

const basicQuery = "Marco fresh water pump on a catamaran keeps erroring out. LED shows different colors. What are common real-world causes and fixes in marine environments?";

const enhancedQuery = "Marco UP6/E 24V self-priming fresh water pump on a catamaran is erroring out. The pump has electronic pressure sensor with blue LED and multicolored LED (red/green/yellow) diagnostics. The system has a Marco control panel for remote monitoring. What are the most common real-world causes boat owners encounter with this specific pump model in marine environments, and what fixes actually work beyond what the manual says? Looking for practical troubleshooting from cruisers and liveaboards who have solved this.";

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

async function runComparison() {
  console.log('🧪 Testing Perplexity Query Comparison - Basic vs Enhanced\n');
  console.log('='.repeat(80));
  console.log('Question: Marco fresh water pump erroring out');
  console.log('Model: sonar-pro');
  console.log('='.repeat(80));
  console.log('');

  // ========== TEST 1: BASIC QUERY ==========
  console.log(`\n${'#'.repeat(80)}`);
  console.log(`# TEST 1: BASIC QUERY`);
  console.log(`${'#'.repeat(80)}\n`);

  console.log('📝 Query:', basicQuery);
  console.log('');
  console.log('🌐 Searching web + synthesizing answer...');
  console.log('-'.repeat(80));

  const basicStart = Date.now();

  try {
    const basicResult = await callPerplexity(basicQuery, 'sonar-pro');
    const basicDuration = Date.now() - basicStart;

    const basicAnswer = basicResult.choices[0].message.content;
    const basicCitations = basicResult.citations || [];

    console.log('✅ Perplexity Response (BASIC):');
    console.log('-'.repeat(80));
    console.log(basicAnswer);
    console.log('-'.repeat(80));
    console.log('');

    if (basicCitations.length > 0) {
      console.log('📚 Sources Found:');
      basicCitations.forEach((url, idx) => {
        console.log(`  ${idx + 1}. ${url}`);
      });
      console.log('');
    }

    console.log('📊 Metrics:');
    console.log(`  Duration: ${basicDuration}ms`);
    console.log(`  Response length: ${basicAnswer.length} characters`);
    console.log(`  Citations: ${basicCitations.length} sources`);
    console.log(`  Model: ${basicResult.model}`);
    if (basicResult.usage) {
      console.log(`  Tokens: ${basicResult.usage.total_tokens} (prompt: ${basicResult.usage.prompt_tokens}, completion: ${basicResult.usage.completion_tokens})`);
    }
    console.log('');

  } catch (error) {
    console.error('❌ Error (BASIC):', error.message);
    console.log('');
  }

  // Small delay between queries
  await new Promise(resolve => setTimeout(resolve, 2000));

  // ========== TEST 2: ENHANCED QUERY ==========
  console.log(`\n${'#'.repeat(80)}`);
  console.log(`# TEST 2: ENHANCED QUERY`);
  console.log(`${'#'.repeat(80)}\n`);

  console.log('📝 Query:', enhancedQuery);
  console.log('');
  console.log('🌐 Searching web + synthesizing answer...');
  console.log('-'.repeat(80));

  const enhancedStart = Date.now();

  try {
    const enhancedResult = await callPerplexity(enhancedQuery, 'sonar-pro');
    const enhancedDuration = Date.now() - enhancedStart;

    const enhancedAnswer = enhancedResult.choices[0].message.content;
    const enhancedCitations = enhancedResult.citations || [];

    console.log('✅ Perplexity Response (ENHANCED):');
    console.log('-'.repeat(80));
    console.log(enhancedAnswer);
    console.log('-'.repeat(80));
    console.log('');

    if (enhancedCitations.length > 0) {
      console.log('📚 Sources Found:');
      enhancedCitations.forEach((url, idx) => {
        console.log(`  ${idx + 1}. ${url}`);
      });
      console.log('');
    }

    console.log('📊 Metrics:');
    console.log(`  Duration: ${enhancedDuration}ms`);
    console.log(`  Response length: ${enhancedAnswer.length} characters`);
    console.log(`  Citations: ${enhancedCitations.length} sources`);
    console.log(`  Model: ${enhancedResult.model}`);
    if (enhancedResult.usage) {
      console.log(`  Tokens: ${enhancedResult.usage.total_tokens} (prompt: ${enhancedResult.usage.prompt_tokens}, completion: ${enhancedResult.usage.completion_tokens})`);
    }
    console.log('');

  } catch (error) {
    console.error('❌ Error (ENHANCED):', error.message);
    console.log('');
  }

  // ========== COMPARISON SUMMARY ==========
  console.log('\n' + '='.repeat(80));
  console.log('📊 COMPARISON SUMMARY');
  console.log('='.repeat(80));
  console.log('');
  console.log('💡 Key Questions to Evaluate:');
  console.log('');
  console.log('1. Which query found more specific/useful sources?');
  console.log('   - Look for marine forums (Cruisers Forum, The Hull Truth, Sailing Anarchy)');
  console.log('   - Look for Marco-specific discussions');
  console.log('   - Look for catamaran/liveaboard communities');
  console.log('');
  console.log('2. Which response includes more practical troubleshooting?');
  console.log('   - Real-world fixes beyond the manual');
  console.log('   - Common issues specific to Marco UP6 pumps');
  console.log('   - Marine-specific considerations (voltage, corrosion, etc.)');
  console.log('');
  console.log('3. Which response sounds like it came from experienced boat owners?');
  console.log('   - Practical tips and tricks');
  console.log('   - "Here\'s what really works" language');
  console.log('   - Mentions of specific parts/fixes');
  console.log('');
  console.log('4. Citation quality comparison:');
  console.log('   - Are sources marine-specific?');
  console.log('   - Are sources from experienced communities vs generic sites?');
  console.log('   - Are there YouTube videos or forum threads?');
  console.log('');
  console.log('='.repeat(80));
  console.log('');
}

// ========== RUN ==========

runComparison().then(() => {
  process.exit(0);
}).catch(error => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});
