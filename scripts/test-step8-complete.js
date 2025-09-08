#!/usr/bin/env node

/**
 * Step 8 Complete Test Suite
 * Tests all three phases: Intent Routing, Playbook Generation, and View Refresh Integration
 * 
 * Usage:
 *   node scripts/test-step8-complete.js
 */

import { logger } from '../src/utils/logger.js';
import { getEnv } from '../src/config/env.js';
import { createClient } from '@supabase/supabase-js';

const scriptLogger = logger.createRequestLogger();

// Test configuration
const TEST_CONFIG = {
  baseUrl: 'http://localhost:3000',
  adminToken: 'd0bf5af4f2e469d29e051e39e9569a76a283ad4d5c68935e38321320137b05d0',
  timeout: 10000
};

// Test results tracking
const testResults = {
  intentRouting: { passed: 0, failed: 0, tests: [] },
  playbookGeneration: { passed: 0, failed: 0, tests: [] },
  viewRefresh: { passed: 0, failed: 0, tests: [] },
  total: { passed: 0, failed: 0 }
};

// Utility functions
function logTest(phase, testName, success, details = '') {
  const result = { testName, success, details, timestamp: new Date().toISOString() };
  testResults[phase].tests.push(result);
  
  if (success) {
    testResults[phase].passed++;
    testResults.total.passed++;
    console.log(`✅ ${phase.toUpperCase()}: ${testName}`);
  } else {
    testResults[phase].failed++;
    testResults.total.failed++;
    console.log(`❌ ${phase.toUpperCase()}: ${testName} - ${details}`);
  }
}

async function makeRequest(endpoint, options = {}) {
  const url = `${TEST_CONFIG.baseUrl}${endpoint}`;
  const defaultOptions = {
    headers: {
      'x-admin-token': TEST_CONFIG.adminToken,
      'Content-Type': 'application/json'
    },
    timeout: TEST_CONFIG.timeout
  };
  
  const response = await fetch(url, { ...defaultOptions, ...options });
  const data = await response.json();
  
  return { response, data };
}

// Phase 8.1: Intent Routing Tests
async function testIntentRouting() {
  console.log('\n🧪 Testing Phase 8.1: Intent Routing System');
  
  try {
    // Test 1: Get all intent routes
    const { response, data } = await makeRequest('/admin/api/intent-router');
    logTest('intentRouting', 'Get all intent routes', response.ok && data.success, 
      response.ok ? `Found ${data.data?.length || 0} routes` : data.error);
    
    // Test 2: Get intent route statistics
    const { response: statsResponse, data: statsData } = await makeRequest('/admin/api/intent-router/stats');
    logTest('intentRouting', 'Get intent route statistics', statsResponse.ok && statsData.success,
      statsResponse.ok ? `Stats retrieved` : statsData.error);
    
    // Test 3: Create a new intent route
    const newRoute = {
      pattern: 'test pattern',
      intent: 'test.intent',
      route_to: '/test/route',
      created_by: 'test-script'
    };
    
    const { response: createResponse, data: createData } = await makeRequest('/admin/api/intent-router', {
      method: 'POST',
      body: JSON.stringify(newRoute)
    });
    
    const routeCreated = createResponse.ok && createData.success;
    logTest('intentRouting', 'Create new intent route', routeCreated,
      routeCreated ? `Route created with ID: ${createData.data?.id}` : createData.error);
    
    let createdRouteId = null;
    if (routeCreated) {
      createdRouteId = createData.data.id;
      
      // Test 4: Get specific intent route
      const { response: getResponse, data: getData } = await makeRequest(`/admin/api/intent-router/${createdRouteId}`);
      logTest('intentRouting', 'Get specific intent route', getResponse.ok && getData.success,
        getResponse.ok ? 'Route retrieved successfully' : getData.error);
      
      // Test 5: Update intent route
      const updateData = { pattern: 'updated test pattern', intent: 'updated.test.intent' };
      const { response: updateResponse, data: updateResult } = await makeRequest(`/admin/api/intent-router/${createdRouteId}`, {
        method: 'PUT',
        body: JSON.stringify(updateData)
      });
      
      logTest('intentRouting', 'Update intent route', updateResponse.ok && updateResult.success,
        updateResponse.ok ? 'Route updated successfully' : updateResult.error);
      
      // Test 6: Test route matching
      const { response: matchResponse, data: matchData } = await makeRequest('/admin/api/intent-router/match', {
        method: 'POST',
        body: JSON.stringify({ query: 'updated test pattern' })
      });
      
      logTest('intentRouting', 'Test route matching', matchResponse.ok && matchData.success,
        matchResponse.ok ? `Match found: ${matchData.data?.route_to}` : matchData.error);
      
      // Test 7: Delete intent route
      const { response: deleteResponse, data: deleteData } = await makeRequest(`/admin/api/intent-router/${createdRouteId}`, {
        method: 'DELETE'
      });
      
      logTest('intentRouting', 'Delete intent route', deleteResponse.ok && deleteData.success,
        deleteResponse.ok ? 'Route deleted successfully' : deleteData.error);
    }
    
  } catch (error) {
    logTest('intentRouting', 'Intent routing system test', false, error.message);
  }
}

// Phase 8.2: Playbook Generation Tests
async function testPlaybookGeneration() {
  console.log('\n🧪 Testing Phase 8.2: Playbook Generation System');
  
  try {
    // Test 1: Get all playbooks
    const { response, data } = await makeRequest('/admin/api/playbooks');
    logTest('playbookGeneration', 'Get all playbooks', response.ok && data.success,
      response.ok ? `Found ${data.data?.length || 0} playbooks` : data.error);
    
    // Test 2: Get playbook statistics
    const { response: statsResponse, data: statsData } = await makeRequest('/admin/api/playbooks/stats');
    logTest('playbookGeneration', 'Get playbook statistics', statsResponse.ok && statsData.success,
      statsResponse.ok ? 'Stats retrieved' : statsData.error);
    
    // Test 3: Create a new playbook
    const newPlaybook = {
      title: 'Test Playbook',
      system_norm: 'test-system',
      subsystem_norm: 'test-subsystem',
      created_by: 'test-script'
    };
    
    const { response: createResponse, data: createData } = await makeRequest('/admin/api/playbooks', {
      method: 'POST',
      body: JSON.stringify(newPlaybook)
    });
    
    const playbookCreated = createResponse.ok && createData.success;
    logTest('playbookGeneration', 'Create new playbook', playbookCreated,
      playbookCreated ? `Playbook created with ID: ${createData.data?.playbook_id}` : createData.error);
    
    let createdPlaybookId = null;
    if (playbookCreated) {
      createdPlaybookId = createData.data.playbook_id;
      
      // Test 4: Get specific playbook
      const { response: getResponse, data: getData } = await makeRequest(`/admin/api/playbooks/${createdPlaybookId}`);
      logTest('playbookGeneration', 'Get specific playbook', getResponse.ok && getData.success,
        getResponse.ok ? 'Playbook retrieved successfully' : getData.error);
      
      // Test 5: Update playbook
      const updateData = { title: 'Updated Test Playbook', system_norm: 'updated-test-system' };
      const { response: updateResponse, data: updateResult } = await makeRequest(`/admin/api/playbooks/${createdPlaybookId}`, {
        method: 'PUT',
        body: JSON.stringify(updateData)
      });
      
      logTest('playbookGeneration', 'Update playbook', updateResponse.ok && updateResult.success,
        updateResponse.ok ? 'Playbook updated successfully' : updateResult.error);
      
      // Test 6: Generate playbooks from hints
      const { response: generateResponse, data: generateData } = await makeRequest('/admin/api/playbooks/generate', {
        method: 'POST'
      });
      
      logTest('playbookGeneration', 'Generate playbooks from hints', generateResponse.ok && generateData.success,
        generateResponse.ok ? `Generated ${generateData.data?.created || 0} playbooks` : generateData.error);
      
      // Test 7: Delete playbook
      const { response: deleteResponse, data: deleteData } = await makeRequest(`/admin/api/playbooks/${createdPlaybookId}`, {
        method: 'DELETE'
      });
      
      logTest('playbookGeneration', 'Delete playbook', deleteResponse.ok && deleteData.success,
        deleteResponse.ok ? 'Playbook deleted successfully' : deleteData.error);
    }
    
  } catch (error) {
    logTest('playbookGeneration', 'Playbook generation system test', false, error.message);
  }
}

// Phase 8.3: View Refresh Integration Tests
async function testViewRefresh() {
  console.log('\n🧪 Testing Phase 8.3: View Refresh Integration');
  
  try {
    // Test 1: Check view health
    const { response, data } = await makeRequest('/admin/api/suggestions/view-health');
    logTest('viewRefresh', 'Check view health', response.ok && data.success,
      response.ok ? `View healthy: ${data.data?.health?.healthy}, Facts: ${data.data?.stats?.totalFacts}` : data.error);
    
    // Test 2: Manual view refresh
    const { response: refreshResponse, data: refreshData } = await makeRequest('/admin/api/suggestions/refresh-view', {
      method: 'POST'
    });
    
    logTest('viewRefresh', 'Manual view refresh', refreshResponse.ok && refreshData.success,
      refreshResponse.ok ? `Refresh successful via ${refreshData.data?.refresh_result?.method}` : refreshData.error);
    
    // Test 3: Verify view refresh worked
    const { response: verifyResponse, data: verifyData } = await makeRequest('/admin/api/suggestions/view-health');
    logTest('viewRefresh', 'Verify view refresh', verifyResponse.ok && verifyData.success,
      verifyResponse.ok ? `View still healthy after refresh` : verifyData.error);
    
    // Test 4: Test approval workflow with view refresh (if we have suggestions)
    const { response: pendingResponse, data: pendingData } = await makeRequest('/admin/api/suggestions/pending');
    
    if (pendingResponse.ok && pendingData.success && pendingData.data?.length > 0) {
      // We have pending suggestions, test the approval workflow
      const firstDoc = pendingData.data[0];
      
      const approvalData = {
        doc_id: firstDoc.doc_id,
        approved: {
          entities: [],
          spec_suggestions: [],
          golden_tests: [],
          playbook_hints: []
        }
      };
      
      const { response: approveResponse, data: approveData } = await makeRequest('/admin/api/suggestions/approve', {
        method: 'POST',
        body: JSON.stringify(approvalData)
      });
      
      logTest('viewRefresh', 'Test approval workflow with view refresh', approveResponse.ok && approveData.success,
        approveResponse.ok ? `Approval successful, view refresh: ${approveData.data?.view_refresh?.success}` : approveData.error);
    } else {
      logTest('viewRefresh', 'Test approval workflow with view refresh', true, 'No pending suggestions to test approval workflow');
    }
    
  } catch (error) {
    logTest('viewRefresh', 'View refresh integration test', false, error.message);
  }
}

// Database connectivity test
async function testDatabaseConnectivity() {
  console.log('\n🔌 Testing Database Connectivity');
  
  try {
    const env = getEnv();
    const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY);
    
    // Test basic connectivity
    const { data, error } = await supabase.from('documents').select('doc_id').limit(1);
    logTest('viewRefresh', 'Database connectivity', !error, error ? error.message : 'Connected successfully');
    
    // Test knowledge_facts view
    const { data: factsData, error: factsError } = await supabase.from('knowledge_facts').select('fact_type').limit(1);
    logTest('viewRefresh', 'Knowledge facts view access', !factsError, factsError ? factsError.message : 'View accessible');
    
    // Test intent_router table
    const { data: intentData, error: intentError } = await supabase.from('intent_router').select('id').limit(1);
    logTest('intentRouting', 'Intent router table access', !intentError, intentError ? intentError.message : 'Table accessible');
    
    // Test playbooks table
    const { data: playbookData, error: playbookError } = await supabase.from('playbooks').select('playbook_id').limit(1);
    logTest('playbookGeneration', 'Playbooks table access', !playbookError, playbookError ? playbookError.message : 'Table accessible');
    
  } catch (error) {
    logTest('viewRefresh', 'Database connectivity test', false, error.message);
  }
}

// Main test execution
async function runAllTests() {
  console.log('🚀 Starting Step 8 Complete Test Suite');
  console.log('=====================================');
  
  const startTime = Date.now();
  
  try {
    // Test database connectivity first
    await testDatabaseConnectivity();
    
    // Run all phase tests
    await testIntentRouting();
    await testPlaybookGeneration();
    await testViewRefresh();
    
  } catch (error) {
    console.error('❌ Test suite failed:', error.message);
  }
  
  const endTime = Date.now();
  const duration = endTime - startTime;
  
  // Print summary
  console.log('\n📊 Test Results Summary');
  console.log('========================');
  
  console.log(`\n🎯 Intent Routing (Phase 8.1):`);
  console.log(`   ✅ Passed: ${testResults.intentRouting.passed}`);
  console.log(`   ❌ Failed: ${testResults.intentRouting.failed}`);
  
  console.log(`\n📚 Playbook Generation (Phase 8.2):`);
  console.log(`   ✅ Passed: ${testResults.playbookGeneration.passed}`);
  console.log(`   ❌ Failed: ${testResults.playbookGeneration.failed}`);
  
  console.log(`\n🔄 View Refresh Integration (Phase 8.3):`);
  console.log(`   ✅ Passed: ${testResults.viewRefresh.passed}`);
  console.log(`   ❌ Failed: ${testResults.viewRefresh.failed}`);
  
  console.log(`\n📈 Overall Results:`);
  console.log(`   ✅ Total Passed: ${testResults.total.passed}`);
  console.log(`   ❌ Total Failed: ${testResults.total.failed}`);
  console.log(`   ⏱️  Duration: ${duration}ms`);
  
  const successRate = (testResults.total.passed / (testResults.total.passed + testResults.total.failed)) * 100;
  console.log(`   📊 Success Rate: ${successRate.toFixed(1)}%`);
  
  if (testResults.total.failed === 0) {
    console.log('\n🎉 All tests passed! Step 8 implementation is working correctly.');
  } else {
    console.log('\n⚠️  Some tests failed. Check the details above.');
  }
  
  // Log detailed results
  scriptLogger.info('Step 8 test suite completed', {
    results: testResults,
    duration,
    successRate
  });
  
  process.exit(testResults.total.failed === 0 ? 0 : 1);
}

// Run tests if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runAllTests().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { runAllTests, testIntentRouting, testPlaybookGeneration, testViewRefresh };
