#!/usr/bin/env node

/**
 * Chat Timing Test
 *
 * Measures timing for each hop in the chat flow:
 * 1. Node.js API response time
 * 2. Python sidecar processing
 * 3. Individual components (Pinecone, Perplexity, LLM)
 *
 * Results are saved to results/chat-timing.json for dashboard display.
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '../..');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const PYTHON_URL = process.env.PYTHON_SIDECAR_URL || 'http://localhost:8000';

// Test queries with different complexity levels
const TEST_QUERIES = [
  {
    name: 'Simple health check',
    type: 'health',
    query: null, // Just health endpoint
  },
  {
    name: 'Simple question',
    type: 'simple',
    query: 'What is the oil capacity?',
  },
  {
    name: 'Equipment-specific question',
    type: 'equipment',
    query: 'What is the maintenance schedule for the Yanmar engine?',
    context: { asset_uid: 'yanmar-4jh57' }
  },
  {
    name: 'Complex multi-hop question',
    type: 'complex',
    query: 'How do I troubleshoot low oil pressure on my diesel engine and what are the safety considerations?',
  }
];

/**
 * Measure time for a fetch request
 */
async function timedFetch(url, options = {}) {
  const start = performance.now();
  let response, error, data;

  try {
    response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      }
    });
    data = await response.json();
  } catch (e) {
    error = e.message;
  }

  const end = performance.now();
  const duration = Math.round(end - start);

  return {
    duration,
    status: response?.status,
    success: response?.ok && !error,
    error,
    data
  };
}

/**
 * Test Node.js health endpoint
 */
async function testNodeHealth() {
  return timedFetch(`${BASE_URL}/health`);
}

/**
 * Test Python sidecar health endpoint
 */
async function testPythonHealth() {
  return timedFetch(`${PYTHON_URL}/health`);
}

/**
 * Test chat endpoint with timing breakdown
 */
async function testChatEndpoint(query, context = {}) {
  const payload = {
    query,
    thread_id: `timing-test-${Date.now()}`,
    systems_context: context.asset_uid ? [{ asset_uid: context.asset_uid }] : []
  };

  const result = await timedFetch(`${BASE_URL}/chat/process`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });

  // Extract internal timing from detailed_metrics (Python sidecar returns this)
  const detailedMetrics = result.data?.data?.detailed_metrics || result.data?.detailed_metrics || {};
  const nodeTiming = result.data?.data?.telemetry?.node_timing || result.data?.telemetry?.node_timing || {};
  const internalTiming = {
    classification_ms: detailedMetrics?.classification?.duration_ms || 0,
    pinecone_ms: detailedMetrics?.pinecone?.duration_ms || 0,
    synthesis_ms: detailedMetrics?.synthesis?.duration_ms || 0,
    total_processing_ms: result.data?.data?.processing_time_ms || result.data?.processing_time_ms || 0
  };

  return {
    ...result,
    internalTiming,
    detailedMetrics,
    nodeTiming
  };
}

/**
 * Test Python sidecar directly
 */
async function testPythonDirect(query, context = {}) {
  const payload = {
    query,
    thread_id: `timing-test-direct-${Date.now()}`,
    systems_context: context.asset_uid ? [{ asset_uid: context.asset_uid }] : []
  };

  const result = await timedFetch(`${PYTHON_URL}/v1/chat/process`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });

  // Extract internal timing from detailed_metrics
  const detailedMetrics = result.data?.detailed_metrics || {};
  const internalTiming = {
    classification_ms: detailedMetrics?.classification?.duration_ms || 0,
    pinecone_ms: detailedMetrics?.pinecone?.duration_ms || 0,
    synthesis_ms: detailedMetrics?.synthesis?.duration_ms || 0,
    total_processing_ms: result.data?.processing_time_ms || 0
  };

  return {
    ...result,
    internalTiming,
    detailedMetrics
  };
}

/**
 * Run all timing tests
 */
async function runTimingTests() {
  console.log('Running chat timing tests...\n');

  const results = {
    timestamp: new Date().toISOString(),
    baseUrl: BASE_URL,
    pythonUrl: PYTHON_URL,
    tests: []
  };

  // Health checks
  console.log('1. Testing health endpoints...');

  const nodeHealth = await testNodeHealth();
  results.tests.push({
    name: 'Node.js Health',
    category: 'health',
    duration: nodeHealth.duration,
    success: nodeHealth.success,
    error: nodeHealth.error
  });
  console.log(`   Node.js: ${nodeHealth.duration}ms ${nodeHealth.success ? '✓' : '✗'}`);

  const pythonHealth = await testPythonHealth();
  results.tests.push({
    name: 'Python Sidecar Health',
    category: 'health',
    duration: pythonHealth.duration,
    success: pythonHealth.success,
    error: pythonHealth.error
  });
  console.log(`   Python:  ${pythonHealth.duration}ms ${pythonHealth.success ? '✓' : '✗'}`);

  // Skip chat tests if services are down
  if (!nodeHealth.success || !pythonHealth.success) {
    console.log('\n⚠️  Services not available, skipping chat tests');
    results.summary = {
      servicesAvailable: false,
      totalTests: 2,
      passed: (nodeHealth.success ? 1 : 0) + (pythonHealth.success ? 1 : 0)
    };
    saveResults(results);
    return results;
  }

  // Chat endpoint tests
  console.log('\n2. Testing chat endpoints...');

  for (const test of TEST_QUERIES) {
    if (test.type === 'health') continue;

    console.log(`\n   ${test.name}:`);

    // Test via Node.js (full stack)
    const fullStack = await testChatEndpoint(test.query, test.context || {});
    results.tests.push({
      name: `${test.name} (Full Stack)`,
      category: 'chat',
      type: test.type,
      duration: fullStack.duration,
      success: fullStack.success,
      error: fullStack.error,
      internalTiming: fullStack.internalTiming,
      nodeTiming: fullStack.nodeTiming
    });
    console.log(`     Full stack: ${fullStack.duration}ms ${fullStack.success ? '✓' : '✗'}`);

    // Test Python directly (bypass Node.js)
    const pythonDirect = await testPythonDirect(test.query, test.context || {});
    results.tests.push({
      name: `${test.name} (Python Direct)`,
      category: 'chat',
      type: test.type,
      duration: pythonDirect.duration,
      success: pythonDirect.success,
      error: pythonDirect.error,
      internalTiming: pythonDirect.internalTiming
    });
    console.log(`     Python direct: ${pythonDirect.duration}ms ${pythonDirect.success ? '✓' : '✗'}`);

    // Calculate Node.js overhead
    const nodeOverhead = fullStack.duration - pythonDirect.duration;
    console.log(`     Node overhead: ${nodeOverhead}ms`);

    // Show internal timing breakdown
    const timing = pythonDirect.internalTiming;
    if (timing.total_processing_ms > 0) {
      console.log('     Breakdown (Python sidecar):');
      console.log(`       Classification: ${timing.classification_ms}ms`);
      console.log(`       Pinecone:       ${timing.pinecone_ms}ms`);
      console.log(`       LLM Synthesis:  ${timing.synthesis_ms}ms`);
      console.log(`       Total Internal: ${timing.total_processing_ms}ms`);
    }
  }

  // Calculate summary
  const chatTests = results.tests.filter(t => t.category === 'chat');
  const fullStackTests = chatTests.filter(t => t.name.includes('Full Stack') && t.success);
  const pythonDirectTests = chatTests.filter(t => t.name.includes('Python Direct') && t.success);

  const avgFullStack = fullStackTests.reduce((sum, t) => sum + t.duration, 0) / fullStackTests.length || 0;
  const avgPythonDirect = pythonDirectTests.reduce((sum, t) => sum + t.duration, 0) / pythonDirectTests.length || 0;

  // Calculate average internal timing breakdown (Python)
  const avgBreakdown = {
    classification_ms: 0,
    pinecone_ms: 0,
    synthesis_ms: 0,
    total_internal_ms: 0
  };

  for (const test of pythonDirectTests) {
    const timing = test.internalTiming || {};
    avgBreakdown.classification_ms += timing.classification_ms || 0;
    avgBreakdown.pinecone_ms += timing.pinecone_ms || 0;
    avgBreakdown.synthesis_ms += timing.synthesis_ms || 0;
    avgBreakdown.total_internal_ms += timing.total_processing_ms || 0;
  }

  if (pythonDirectTests.length > 0) {
    avgBreakdown.classification_ms = Math.round(avgBreakdown.classification_ms / pythonDirectTests.length);
    avgBreakdown.pinecone_ms = Math.round(avgBreakdown.pinecone_ms / pythonDirectTests.length);
    avgBreakdown.synthesis_ms = Math.round(avgBreakdown.synthesis_ms / pythonDirectTests.length);
    avgBreakdown.total_internal_ms = Math.round(avgBreakdown.total_internal_ms / pythonDirectTests.length);
  }

  // Calculate average Node.js step-by-step timing breakdown
  const avgNodeTiming = {
    conversation_context_ms: 0,
    equipment_search_ms: 0,
    equipment_extraction_ms: 0,
    equipment_inference_ms: 0,
    equipment_context_build_ms: 0,
    system_details_fetch_ms: 0,
    equipment_context_update_ms: 0,
    python_call_ms: 0,
    response_format_ms: 0
  };

  const fullStackTestsWithTiming = fullStackTests.filter(t => t.nodeTiming);
  for (const test of fullStackTestsWithTiming) {
    const timing = test.nodeTiming || {};
    avgNodeTiming.conversation_context_ms += timing.conversation_context_ms || 0;
    avgNodeTiming.equipment_search_ms += timing.equipment_search_ms || 0;
    avgNodeTiming.equipment_extraction_ms += timing.equipment_extraction_ms || 0;
    avgNodeTiming.equipment_inference_ms += timing.equipment_inference_ms || 0;
    avgNodeTiming.equipment_context_build_ms += timing.equipment_context_build_ms || 0;
    avgNodeTiming.system_details_fetch_ms += timing.system_details_fetch_ms || 0;
    avgNodeTiming.equipment_context_update_ms += timing.equipment_context_update_ms || 0;
    avgNodeTiming.python_call_ms += timing.python_call_ms || 0;
    avgNodeTiming.response_format_ms += timing.response_format_ms || 0;
  }

  if (fullStackTestsWithTiming.length > 0) {
    avgNodeTiming.conversation_context_ms = Math.round(avgNodeTiming.conversation_context_ms / fullStackTestsWithTiming.length);
    avgNodeTiming.equipment_search_ms = Math.round(avgNodeTiming.equipment_search_ms / fullStackTestsWithTiming.length);
    avgNodeTiming.equipment_extraction_ms = Math.round(avgNodeTiming.equipment_extraction_ms / fullStackTestsWithTiming.length);
    avgNodeTiming.equipment_inference_ms = Math.round(avgNodeTiming.equipment_inference_ms / fullStackTestsWithTiming.length);
    avgNodeTiming.equipment_context_build_ms = Math.round(avgNodeTiming.equipment_context_build_ms / fullStackTestsWithTiming.length);
    avgNodeTiming.system_details_fetch_ms = Math.round(avgNodeTiming.system_details_fetch_ms / fullStackTestsWithTiming.length);
    avgNodeTiming.equipment_context_update_ms = Math.round(avgNodeTiming.equipment_context_update_ms / fullStackTestsWithTiming.length);
    avgNodeTiming.python_call_ms = Math.round(avgNodeTiming.python_call_ms / fullStackTestsWithTiming.length);
    avgNodeTiming.response_format_ms = Math.round(avgNodeTiming.response_format_ms / fullStackTestsWithTiming.length);
  }

  results.summary = {
    servicesAvailable: true,
    totalTests: results.tests.length,
    passed: results.tests.filter(t => t.success).length,
    failed: results.tests.filter(t => !t.success).length,
    avgFullStackMs: Math.round(avgFullStack),
    avgPythonDirectMs: Math.round(avgPythonDirect),
    avgNodeOverheadMs: Math.round(avgFullStack - avgPythonDirect),
    breakdown: avgBreakdown,  // Python breakdown
    node_timing: avgNodeTiming,  // Node.js step-by-step breakdown
    healthCheck: {
      nodeMs: nodeHealth.duration,
      pythonMs: pythonHealth.duration
    }
  };

  console.log('\n╔════════════════════════════════════════╗');
  console.log('║       CHAT TIMING SUMMARY              ║');
  console.log('╠════════════════════════════════════════╣');
  console.log(`║ TOTAL AVG RESPONSE: ${String(results.summary.avgFullStackMs).padStart(6)}ms          ║`);
  console.log('╠════════════════════════════════════════╣');
  console.log('║ Breakdown:                             ║');
  console.log(`║   Node.js Routing:    ${String(results.summary.avgNodeOverheadMs).padStart(6)}ms          ║`);
  console.log(`║   Python Sidecar:     ${String(results.summary.avgPythonDirectMs).padStart(6)}ms          ║`);
  console.log(`║     ├─ Classification: ${String(avgBreakdown.classification_ms).padStart(5)}ms          ║`);
  console.log(`║     ├─ Pinecone:       ${String(avgBreakdown.pinecone_ms).padStart(5)}ms          ║`);
  console.log(`║     └─ LLM Synthesis:  ${String(avgBreakdown.synthesis_ms).padStart(5)}ms          ║`);
  console.log('╠════════════════════════════════════════╣');
  console.log(`║ Health: Node ${nodeHealth.duration}ms, Python ${pythonHealth.duration}ms          ║`);
  console.log(`║ Tests: ${results.summary.passed}/${results.summary.totalTests} passed                         ║`);
  console.log('╚════════════════════════════════════════╝');

  saveResults(results);
  return results;
}

/**
 * Save results to JSON file
 */
function saveResults(results) {
  const resultsDir = join(projectRoot, 'results');
  if (!existsSync(resultsDir)) {
    mkdirSync(resultsDir, { recursive: true });
  }

  const outputPath = join(resultsDir, 'chat-timing.json');
  writeFileSync(outputPath, JSON.stringify(results, null, 2));
  console.log(`\nResults saved to: ${outputPath}`);
}

// Run tests
runTimingTests().catch(console.error);
