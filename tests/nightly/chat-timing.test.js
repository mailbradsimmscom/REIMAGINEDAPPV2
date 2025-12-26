#!/usr/bin/env node

/**
 * Chat Timing Test
 *
 * Measures end-to-end timing for chat requests through the full stack:
 * - Node.js processing (equipment search, extraction, context building)
 * - Python sidecar processing (classification, retrieval, synthesis)
 *
 * Makes ONE call per query through Node.js, extracts all timing from response.
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
 * Test chat endpoint - extracts all timing from single full-stack call
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

  // Extract timing from response
  const detailedMetrics = result.data?.data?.detailed_metrics || result.data?.detailed_metrics || {};
  const nodeTiming = result.data?.data?.telemetry?.node_timing || result.data?.telemetry?.node_timing || {};
  const timingSummary = detailedMetrics?.timing_summary || {};
  const breakdown = timingSummary?.breakdown || {};

  // Python sidecar breakdown
  const pythonBreakdown = {
    classification_ms: breakdown.classification_ms || detailedMetrics?.classification?.duration_ms || 0,
    dip_retrieval_ms: breakdown.dip_retrieval_ms || detailedMetrics?.dip_retrieval?.duration_ms || 0,
    pinecone_ms: breakdown.pinecone_search_ms || detailedMetrics?.pinecone?.duration_ms || 0,
    chunk_ranking_ms: breakdown.chunk_ranking_ms || detailedMetrics?.chunk_ranking?.duration_ms || 0,
    synthesis_ms: breakdown.synthesis_ms || detailedMetrics?.synthesis?.duration_ms || 0,
    perplexity_ms: breakdown.perplexity_ms || detailedMetrics?.perplexity?.duration_ms || 0,
    assembly_ms: breakdown.assembly_ms || detailedMetrics?.assembly?.duration_ms || 0,
    total_internal_ms: timingSummary.total_processing_ms || result.data?.data?.processing_time_ms || 0,
    total_measured_ms: timingSummary.total_measured_ms || 0,
    unmeasured_ms: timingSummary.unmeasured_ms || 0
  };

  return {
    ...result,
    nodeTiming,
    pythonBreakdown
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
  console.log('1. Health checks...');

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
  console.log('\n2. Chat timing tests...');

  for (const test of TEST_QUERIES) {
    console.log(`\n   ${test.name}:`);

    const result = await testChatEndpoint(test.query, test.context || {});

    results.tests.push({
      name: test.name,
      category: 'chat',
      type: test.type,
      duration: result.duration,
      success: result.success,
      error: result.error,
      nodeTiming: result.nodeTiming,
      pythonBreakdown: result.pythonBreakdown
    });

    console.log(`     Total: ${result.duration}ms ${result.success ? '✓' : '✗'}`);

    if (result.success) {
      // Show Node.js breakdown
      const node = result.nodeTiming;
      const nodeTotal = (node.conversation_context_ms || 0) +
                        (node.equipment_search_ms || 0) +
                        (node.equipment_extraction_ms || 0) +
                        (node.equipment_context_build_ms || 0) +
                        (node.system_details_fetch_ms || 0) +
                        (node.equipment_context_update_ms || 0);
      console.log(`     Node.js: ${nodeTotal}ms`);
      console.log(`       ├─ Conversation Context: ${node.conversation_context_ms || 0}ms`);
      console.log(`       ├─ Equipment Search:     ${node.equipment_search_ms || 0}ms`);
      console.log(`       ├─ Equipment Extraction: ${node.equipment_extraction_ms || 0}ms`);
      console.log(`       ├─ Context Build:        ${node.equipment_context_build_ms || 0}ms`);
      console.log(`       ├─ System Details:       ${node.system_details_fetch_ms || 0}ms`);
      console.log(`       └─ Context Update:       ${node.equipment_context_update_ms || 0}ms`);

      // Show Python breakdown
      const py = result.pythonBreakdown;
      console.log(`     Python: ${node.python_call_ms || py.total_internal_ms}ms`);
      console.log(`       ├─ Classification:       ${py.classification_ms}ms`);
      console.log(`       ├─ DIP Retrieval:        ${py.dip_retrieval_ms}ms`);
      console.log(`       ├─ Pinecone:             ${py.pinecone_ms}ms`);
      console.log(`       ├─ Chunk Ranking:        ${py.chunk_ranking_ms}ms`);
      console.log(`       ├─ LLM Synthesis:        ${py.synthesis_ms}ms`);
      console.log(`       └─ Perplexity (parallel):${py.perplexity_ms}ms`);
    }
  }

  // Calculate averages for summary
  const chatTests = results.tests.filter(t => t.category === 'chat' && t.success);

  if (chatTests.length === 0) {
    results.summary = {
      servicesAvailable: true,
      totalTests: results.tests.length,
      passed: results.tests.filter(t => t.success).length,
      failed: results.tests.filter(t => !t.success).length,
      healthCheck: { nodeMs: nodeHealth.duration, pythonMs: pythonHealth.duration }
    };
    saveResults(results);
    return results;
  }

  // Average Node.js timing
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

  // Average Python breakdown
  const avgBreakdown = {
    classification_ms: 0,
    dip_retrieval_ms: 0,
    pinecone_ms: 0,
    chunk_ranking_ms: 0,
    synthesis_ms: 0,
    perplexity_ms: 0,
    assembly_ms: 0,
    total_internal_ms: 0,
    total_measured_ms: 0,
    unmeasured_ms: 0
  };

  for (const test of chatTests) {
    // Sum Node.js timing
    const node = test.nodeTiming || {};
    avgNodeTiming.conversation_context_ms += node.conversation_context_ms || 0;
    avgNodeTiming.equipment_search_ms += node.equipment_search_ms || 0;
    avgNodeTiming.equipment_extraction_ms += node.equipment_extraction_ms || 0;
    avgNodeTiming.equipment_inference_ms += node.equipment_inference_ms || 0;
    avgNodeTiming.equipment_context_build_ms += node.equipment_context_build_ms || 0;
    avgNodeTiming.system_details_fetch_ms += node.system_details_fetch_ms || 0;
    avgNodeTiming.equipment_context_update_ms += node.equipment_context_update_ms || 0;
    avgNodeTiming.python_call_ms += node.python_call_ms || 0;
    avgNodeTiming.response_format_ms += node.response_format_ms || 0;

    // Sum Python breakdown
    const py = test.pythonBreakdown || {};
    avgBreakdown.classification_ms += py.classification_ms || 0;
    avgBreakdown.dip_retrieval_ms += py.dip_retrieval_ms || 0;
    avgBreakdown.pinecone_ms += py.pinecone_ms || 0;
    avgBreakdown.chunk_ranking_ms += py.chunk_ranking_ms || 0;
    avgBreakdown.synthesis_ms += py.synthesis_ms || 0;
    avgBreakdown.perplexity_ms += py.perplexity_ms || 0;
    avgBreakdown.assembly_ms += py.assembly_ms || 0;
    avgBreakdown.total_internal_ms += py.total_internal_ms || 0;
    avgBreakdown.total_measured_ms += py.total_measured_ms || 0;
    avgBreakdown.unmeasured_ms += py.unmeasured_ms || 0;
  }

  // Calculate averages
  const count = chatTests.length;
  for (const key of Object.keys(avgNodeTiming)) {
    avgNodeTiming[key] = Math.round(avgNodeTiming[key] / count);
  }
  for (const key of Object.keys(avgBreakdown)) {
    avgBreakdown[key] = Math.round(avgBreakdown[key] / count);
  }

  const avgTotalMs = Math.round(chatTests.reduce((sum, t) => sum + t.duration, 0) / count);

  results.summary = {
    servicesAvailable: true,
    totalTests: results.tests.length,
    passed: results.tests.filter(t => t.success).length,
    failed: results.tests.filter(t => !t.success).length,
    avgFullStackMs: avgTotalMs,
    breakdown: avgBreakdown,
    node_timing: avgNodeTiming,
    healthCheck: {
      nodeMs: nodeHealth.duration,
      pythonMs: pythonHealth.duration
    }
  };

  // Print summary
  const nodeOnlyMs = avgNodeTiming.conversation_context_ms +
                     avgNodeTiming.equipment_search_ms +
                     avgNodeTiming.equipment_extraction_ms +
                     avgNodeTiming.equipment_context_build_ms +
                     avgNodeTiming.system_details_fetch_ms +
                     avgNodeTiming.equipment_context_update_ms;

  console.log('\n╔════════════════════════════════════════════════╗');
  console.log('║           CHAT TIMING SUMMARY                  ║');
  console.log('╠════════════════════════════════════════════════╣');
  console.log(`║ TOTAL AVG RESPONSE:    ${String(avgTotalMs).padStart(6)}ms               ║`);
  console.log('╠════════════════════════════════════════════════╣');
  console.log(`║ Node.js:               ${String(nodeOnlyMs).padStart(6)}ms               ║`);
  console.log(`║   ├─ Conversation:     ${String(avgNodeTiming.conversation_context_ms).padStart(6)}ms               ║`);
  console.log(`║   ├─ Equipment Search: ${String(avgNodeTiming.equipment_search_ms).padStart(6)}ms               ║`);
  console.log(`║   ├─ Extraction:       ${String(avgNodeTiming.equipment_extraction_ms).padStart(6)}ms               ║`);
  console.log(`║   ├─ Context Build:    ${String(avgNodeTiming.equipment_context_build_ms).padStart(6)}ms               ║`);
  console.log(`║   ├─ System Details:   ${String(avgNodeTiming.system_details_fetch_ms).padStart(6)}ms               ║`);
  console.log(`║   └─ Context Update:   ${String(avgNodeTiming.equipment_context_update_ms).padStart(6)}ms               ║`);
  console.log('╠════════════════════════════════════════════════╣');
  console.log(`║ Python:                ${String(avgNodeTiming.python_call_ms).padStart(6)}ms               ║`);
  console.log(`║   ├─ Classification:   ${String(avgBreakdown.classification_ms).padStart(6)}ms               ║`);
  console.log(`║   ├─ DIP Retrieval:    ${String(avgBreakdown.dip_retrieval_ms).padStart(6)}ms               ║`);
  console.log(`║   ├─ Pinecone:         ${String(avgBreakdown.pinecone_ms).padStart(6)}ms               ║`);
  console.log(`║   ├─ Chunk Ranking:    ${String(avgBreakdown.chunk_ranking_ms).padStart(6)}ms               ║`);
  console.log(`║   ├─ LLM Synthesis:    ${String(avgBreakdown.synthesis_ms).padStart(6)}ms               ║`);
  console.log(`║   └─ Perplexity:       ${String(avgBreakdown.perplexity_ms).padStart(6)}ms (parallel)    ║`);
  console.log('╠════════════════════════════════════════════════╣');
  console.log(`║ Health: Node ${nodeHealth.duration}ms, Python ${pythonHealth.duration}ms                 ║`);
  console.log(`║ Tests: ${results.summary.passed}/${results.summary.totalTests} passed                                ║`);
  console.log('╚════════════════════════════════════════════════╝');

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
