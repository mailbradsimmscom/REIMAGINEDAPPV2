#!/usr/bin/env node
/**
 * Diagnostic script to verify if timing collection code is deployed
 * 
 * Makes a test API call and checks if node_timing has non-zero values
 */

import { getEnv } from '../src/config/env.js';

const BASE_URL = process.env.BASE_URL || getEnv().BASE_URL || 'http://localhost:3000';

async function verifyTimingCode() {
  console.log('🔍 Verifying timing collection code...\n');
  console.log(`Testing against: ${BASE_URL}\n`);

  try {
    const payload = {
      query: 'What is the status of the system?',
      thread_id: `timing-verify-${Date.now()}`
    };

    console.log('📤 Making test API call...');
    const response = await fetch(`${BASE_URL}/chat/process`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`API returned ${response.status}: ${await response.text()}`);
    }

    const result = await response.json();
    
    // Extract node_timing from response
    const nodeTiming = result?.data?.telemetry?.node_timing || result?.telemetry?.node_timing || {};
    
    console.log('\n📊 Results:');
    console.log('─────────────────────────────────────────');
    console.log('✅ API call successful\n');
    
    if (!nodeTiming || Object.keys(nodeTiming).length === 0) {
      console.log('❌ node_timing object is MISSING from response');
      console.log('   This means the code that creates the object is not deployed.\n');
      return false;
    }

    console.log('✅ node_timing object EXISTS\n');
    console.log('📈 Timing values:');
    
    const fields = [
      'conversation_context_ms',
      'equipment_search_ms',
      'equipment_extraction_ms',
      'equipment_inference_ms',
      'equipment_context_build_ms',
      'system_details_fetch_ms',
      'equipment_context_update_ms',
      'python_call_ms',
      'response_format_ms'
    ];

    let allZero = true;
    let totalTime = 0;
    
    for (const field of fields) {
      const value = nodeTiming[field] || 0;
      totalTime += value;
      const status = value > 0 ? '✅' : '❌';
      console.log(`   ${status} ${field}: ${value}ms`);
      if (value > 0) allZero = false;
    }

    console.log(`\n   Total Node.js time: ${totalTime}ms\n`);

    if (allZero) {
      console.log('❌ PROBLEM DETECTED:');
      console.log('   All timing values are 0ms.');
      console.log('   This means:');
      console.log('   - The node_timing object structure is deployed ✅');
      console.log('   - But the timing assignment code is NOT deployed ❌');
      console.log('   - Production needs to be updated with timing assignments\n');
      return false;
    } else {
      console.log('✅ SUCCESS:');
      console.log('   Timing collection code is working correctly!');
      console.log('   Non-zero values indicate the assignment code is deployed.\n');
      return true;
    }

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.cause) console.error('   Cause:', error.cause);
    return false;
  }
}

// Run verification
verifyTimingCode()
  .then(success => {
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
