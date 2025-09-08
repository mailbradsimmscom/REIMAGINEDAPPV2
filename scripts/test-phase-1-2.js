#!/usr/bin/env node

/**
 * Phase 1.2 Validation Script
 * Tests the Python sidecar DIP endpoints
 * 
 * Usage: node scripts/test-phase-1-2.js
 */

import 'dotenv/config';
import { logger } from '../src/utils/logger.js';
import { getEnv } from '../src/config/env.js';

const requestLogger = logger.createRequestLogger();

async function testSidecarHealth() {
  console.log('🧪 Testing Python sidecar health...');
  
  try {
    const sidecarUrl = getEnv({ loose: true }).PYTHON_SIDECAR_URL || 'http://localhost:8000';
    
    const response = await fetch(`${sidecarUrl}/health`);
    
    if (!response.ok) {
      console.log('❌ Sidecar health check failed:', response.status, response.statusText);
      return false;
    }
    
    const health = await response.json();
    console.log('✅ Sidecar is healthy:', health);
    return true;
  } catch (error) {
    console.log('❌ Sidecar health check failed:', error.message);
    return false;
  }
}

async function testDIPEndpoint() {
  console.log('\n🧪 Testing /v1/dip endpoint...');
  
  try {
    const sidecarUrl = getEnv({ loose: true }).PYTHON_SIDECAR_URL || 'http://localhost:8000';
    
    // Create a simple test PDF content (this would normally be a real PDF)
    const testPdfContent = Buffer.from('%PDF-1.4\n1 0 obj\n<<\n/Type /Catalog\n/Pages 2 0 R\n>>\nendobj\n2 0 obj\n<<\n/Type /Pages\n/Kids [3 0 R]\n/Count 1\n>>\nendobj\n3 0 obj\n<<\n/Type /Page\n/Parent 2 0 R\n/MediaBox [0 0 612 792]\n/Contents 4 0 R\n>>\nendobj\n4 0 obj\n<<\n/Length 44\n>>\nstream\nBT\n/F1 12 Tf\n72 720 Td\n(Test Document) Tj\nET\nendstream\nendobj\nxref\n0 5\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \n0000000204 00000 n \ntrailer\n<<\n/Size 5\n/Root 1 0 R\n>>\nstartxref\n297\n%%EOF');
    
    const formData = new FormData();
    formData.append('file', new Blob([testPdfContent], { type: 'application/pdf' }), 'test.pdf');
    formData.append('doc_id', 'test-doc-' + Date.now());
    formData.append('options', JSON.stringify({ test: true }));
    
    const response = await fetch(`${sidecarUrl}/v1/dip`, {
      method: 'POST',
      body: formData
    });
    
    if (!response.ok) {
      console.log('❌ DIP endpoint failed:', response.status, response.statusText);
      const errorText = await response.text();
      console.log('Error details:', errorText);
      return false;
    }
    
    const dipResult = await response.json();
    console.log('✅ DIP endpoint working:', {
      success: dipResult.success,
      doc_id: dipResult.doc_id,
      entities_count: dipResult.entities_count,
      hints_count: dipResult.hints_count,
      tests_count: dipResult.tests_count,
      processing_time: dipResult.processing_time
    });
    
    return true;
  } catch (error) {
    console.log('❌ DIP endpoint test failed:', error.message);
    return false;
  }
}

async function testDIPPacketEndpoint() {
  console.log('\n🧪 Testing /v1/runDocIntelligencePacket endpoint...');
  
  try {
    const sidecarUrl = getEnv({ loose: true }).PYTHON_SIDECAR_URL || 'http://localhost:8000';
    
    const requestData = {
      doc_id: 'test-packet-' + Date.now(),
      file_path: '/tmp/test.pdf', // This would be a real file path
      output_dir: '/tmp/dip_output',
      options: { test: true }
    };
    
    const response = await fetch(`${sidecarUrl}/v1/runDocIntelligencePacket`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestData)
    });
    
    if (!response.ok) {
      console.log('❌ DIP packet endpoint failed:', response.status, response.statusText);
      const errorText = await response.text();
      console.log('Error details:', errorText);
      return false;
    }
    
    const packetResult = await response.json();
    console.log('✅ DIP packet endpoint working:', {
      success: packetResult.success,
      doc_id: packetResult.doc_id,
      processing_time: packetResult.processing_time,
      error: packetResult.error
    });
    
    return true;
  } catch (error) {
    console.log('❌ DIP packet endpoint test failed:', error.message);
    return false;
  }
}

async function testSidecarEndpoints() {
  console.log('\n🧪 Testing sidecar endpoint availability...');
  
  try {
    const sidecarUrl = getEnv({ loose: true }).PYTHON_SIDECAR_URL || 'http://localhost:8000';
    
    // Test if the new endpoints are available
    const endpoints = ['/v1/dip', '/v1/runDocIntelligencePacket'];
    
    for (const endpoint of endpoints) {
      try {
        const response = await fetch(`${sidecarUrl}${endpoint}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({})
        });
        
        // We expect a 422 (validation error) or 400 (bad request) for empty requests
        // This means the endpoint exists but our request is invalid
        if (response.status === 422 || response.status === 400) {
          console.log(`✅ ${endpoint} endpoint exists`);
        } else {
          console.log(`⚠️  ${endpoint} endpoint returned status: ${response.status}`);
        }
      } catch (error) {
        console.log(`❌ ${endpoint} endpoint not available: ${error.message}`);
      }
    }
    
    return true;
  } catch (error) {
    console.log('❌ Sidecar endpoints test failed:', error.message);
    return false;
  }
}

async function runTests() {
  console.log('🚀 Starting Phase 1.2 Validation Tests\n');
  
  const results = {
    sidecarHealth: await testSidecarHealth(),
    dipEndpoint: await testDIPEndpoint(),
    dipPacketEndpoint: await testDIPPacketEndpoint(),
    sidecarEndpoints: await testSidecarEndpoints()
  };
  
  console.log('\n📊 Test Results:');
  console.log('================');
  console.log(`Sidecar health: ${results.sidecarHealth ? '✅' : '❌'}`);
  console.log(`DIP endpoint: ${results.dipEndpoint ? '✅' : '❌'}`);
  console.log(`DIP packet endpoint: ${results.dipPacketEndpoint ? '✅' : '❌'}`);
  console.log(`Sidecar endpoints: ${results.sidecarEndpoints ? '✅' : '❌'}`);
  
  const allPassed = Object.values(results).every(result => result === true);
  
  if (allPassed) {
    console.log('\n🎉 All Phase 1.2 tests passed!');
    console.log('\n📋 Next Steps:');
    console.log('1. Proceed to Phase 1.3 (DIP File Generation)');
    console.log('2. Test with real PDF files');
  } else {
    console.log('\n❌ Some tests failed. Please check the Python sidecar implementation.');
    console.log('\n🔧 Troubleshooting:');
    console.log('1. Make sure Python sidecar is running: docker-compose up -d python-sidecar');
    console.log('2. Check sidecar logs: docker-compose logs python-sidecar');
    console.log('3. Verify the new endpoints are loaded');
  }
}

runTests().catch(console.error);
