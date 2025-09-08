#!/usr/bin/env node

/**
 * Phase 3.4 Validation Script
 * Tests DIP file access endpoints
 * 
 * Usage: node scripts/test-phase-3-4.js
 */

import 'dotenv/config';
import { logger } from '../src/utils/logger.js';
import { getEnv } from '../src/config/env.js';

const requestLogger = logger.createRequestLogger();

async function testAdminSuggestionsEndpoints() {
  console.log('🧪 Testing admin suggestions endpoints...');
  
  try {
    const baseUrl = 'http://localhost:3000';
    const adminToken = getEnv().ADMIN_TOKEN;
    
    if (!adminToken) {
      console.log('❌ ADMIN_TOKEN not configured');
      return false;
    }

    const headers = {
      'x-admin-token': adminToken,
      'Content-Type': 'application/json'
    };

    // Test GET /admin/suggestions/pending
    console.log('📋 Testing GET /admin/suggestions/pending...');
    const pendingResponse = await fetch(`${baseUrl}/admin/suggestions/pending`, {
      method: 'GET',
      headers
    });

    if (!pendingResponse.ok) {
      console.log('❌ Pending suggestions endpoint failed:', pendingResponse.status, pendingResponse.statusText);
      return false;
    }

    const pendingData = await pendingResponse.json();
    console.log('✅ Pending suggestions endpoint working:', {
      success: pendingData.success,
      count: pendingData.data?.count || 0
    });

    // Test GET /admin/suggestions/:docId (with a test UUID)
    console.log('📋 Testing GET /admin/suggestions/:docId...');
    const testDocId = '550e8400-e29b-41d4-a716-446655440000';
    const docResponse = await fetch(`${baseUrl}/admin/suggestions/${testDocId}`, {
      method: 'GET',
      headers
    });

    if (!docResponse.ok) {
      console.log('❌ Document suggestions endpoint failed:', docResponse.status, docResponse.statusText);
      return false;
    }

    const docData = await docResponse.json();
    console.log('✅ Document suggestions endpoint working:', {
      success: docData.success,
      docId: docData.data?.doc_id,
      filesLoaded: Object.keys(docData.data?.dip_files || {}).length
    });

    // Test POST /admin/suggestions/approve
    console.log('📋 Testing POST /admin/suggestions/approve...');
    const approvePayload = {
      doc_id: testDocId,
      approved: {
        entities: [
          {
            entity_type: 'manufacturer',
            value: 'TestManufacturer',
            page: 1,
            context: 'Test context',
            confidence: 0.95
          }
        ],
        specs: [
          {
            hint_type: 'pressure',
            value: '20 psi',
            unit: 'psi',
            page: 1,
            context: 'Operating pressure',
            confidence: 0.90
          }
        ],
        golden_tests: [
          {
            test_name: 'Pressure Test',
            test_type: 'procedure',
            description: 'Test operating pressure',
            steps: ['Step 1: Check pressure', 'Step 2: Verify reading'],
            expected_result: 'Pressure within range',
            page: 1,
            confidence: 0.85
          }
        ]
      }
    };

    const approveResponse = await fetch(`${baseUrl}/admin/suggestions/approve`, {
      method: 'POST',
      headers,
      body: JSON.stringify(approvePayload)
    });

    if (!approveResponse.ok) {
      console.log('❌ Approve suggestions endpoint failed:', approveResponse.status, approveResponse.statusText);
      return false;
    }

    const approveData = await approveResponse.json();
    console.log('✅ Approve suggestions endpoint working:', {
      success: approveData.success,
      totalInserted: approveData.data?.total_inserted || 0
    });

    return true;
  } catch (error) {
    console.log('❌ Admin suggestions endpoints test failed:', error.message);
    return false;
  }
}

async function testUnauthorizedAccess() {
  console.log('\n🧪 Testing unauthorized access...');
  
  try {
    const baseUrl = 'http://localhost:3000';

    // Test without admin token
    const response = await fetch(`${baseUrl}/admin/suggestions/pending`, {
      method: 'GET'
    });

    if (response.status === 401 || response.status === 403) {
      console.log('✅ Unauthorized access properly blocked');
      return true;
    } else {
      console.log('❌ Unauthorized access not blocked:', response.status);
      return false;
    }
  } catch (error) {
    console.log('❌ Unauthorized access test failed:', error.message);
    return false;
  }
}

async function testServerAvailability() {
  console.log('🧪 Testing server availability...');
  
  try {
    const response = await fetch('http://localhost:3000/health');
    
    if (!response.ok) {
      throw new Error(`Health check failed: ${response.status}`);
    }
    
    const health = await response.json();
    console.log('✅ Server is available:', health);
    
    return true;
  } catch (error) {
    console.log('❌ Server availability test failed:', error.message);
    return false;
  }
}

async function runTests() {
  console.log('🚀 Starting Phase 3.4 Validation Tests\n');
  
  const results = {
    serverAvailability: await testServerAvailability(),
    adminEndpoints: await testAdminSuggestionsEndpoints(),
    unauthorizedAccess: await testUnauthorizedAccess()
  };
  
  console.log('\n📊 Test Results:');
  console.log('================');
  console.log(`Server availability: ${results.serverAvailability ? '✅' : '❌'}`);
  console.log(`Admin suggestions endpoints: ${results.adminEndpoints ? '✅' : '❌'}`);
  console.log(`Unauthorized access blocked: ${results.unauthorizedAccess ? '✅' : '❌'}`);
  
  const allPassed = results.serverAvailability && 
                   results.adminEndpoints && 
                   results.unauthorizedAccess;
  
  if (allPassed) {
    console.log('\n🎉 All Phase 3.4 tests passed!');
    console.log('\n📋 Next Steps:');
    console.log('1. Proceed to Phase 3.5: Admin UI Implementation');
    console.log('2. Build the suggestion review interface');
    console.log('3. Test end-to-end DIP suggestion workflow');
  } else {
    console.log('\n❌ Some tests failed. Please check the file access endpoints.');
    console.log('\n🔧 Troubleshooting:');
    console.log('1. Make sure the server is running');
    console.log('2. Check admin authentication configuration');
    console.log('3. Verify DIP file access endpoints');
  }
}

runTests().catch(console.error);
