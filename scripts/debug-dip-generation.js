#!/usr/bin/env node

/**
 * Debug DIP Generation Script
 * Tests individual patterns to identify the "no such group" error
 * 
 * Usage: node scripts/debug-dip-generation.js
 */

import 'dotenv/config';
import { logger } from '../src/utils/logger.js';
import { getEnv } from '../src/config/env.js';

const requestLogger = logger.createRequestLogger();

async function testSimpleDIPGeneration() {
  console.log('🧪 Testing Simple DIP Generation...');
  
  try {
    const sidecarUrl = getEnv({ loose: true }).PYTHON_SIDECAR_URL || 'http://localhost:8000';
    
    // Create a very simple test PDF content
    const testPdfContent = Buffer.from(`%PDF-1.4
1 0 obj
<<
/Type /Catalog
/Pages 2 0 R
>>
endobj
2 0 obj
<<
/Type /Pages
/Kids [3 0 R]
/Count 1
>>
endobj
3 0 obj
<<
/Type /Page
/Parent 2 0 R
/MediaBox [0 0 612 792]
/Contents 4 0 R
>>
endobj
4 0 obj
<<
/Length 50
>>
stream
BT
/F1 12 Tf
72 720 Td
(Model: TEST-001) Tj
ET
endstream
endobj
xref
0 5
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000204 00000 n 
trailer
<<
/Size 5
/Root 1 0 R
>>
startxref
254
%%EOF`);
    
    const formData = new FormData();
    formData.append('file', new Blob([testPdfContent], { type: 'application/pdf' }), 'simple-test.pdf');
    formData.append('doc_id', 'simple-test-' + Date.now());
    formData.append('options', JSON.stringify({ debug: true }));
    
    const response = await fetch(`${sidecarUrl}/v1/dip`, {
      method: 'POST',
      body: formData
    });
    
    if (!response.ok) {
      console.log('❌ Simple DIP generation failed:', response.status, response.statusText);
      const errorText = await response.text();
      console.log('Error details:', errorText);
      return false;
    }
    
    const dipResult = await response.json();
    console.log('✅ Simple DIP generation working:', {
      success: dipResult.success,
      doc_id: dipResult.doc_id,
      entities_count: dipResult.entities_count,
      hints_count: dipResult.hints_count,
      tests_count: dipResult.tests_count
    });
    
    return true;
  } catch (error) {
    console.log('❌ Simple DIP generation test failed:', error.message);
    return false;
  }
}

async function testComplexDIPGeneration() {
  console.log('\n🧪 Testing Complex DIP Generation...');
  
  try {
    const sidecarUrl = getEnv({ loose: true }).PYTHON_SIDECAR_URL || 'http://localhost:8000';
    
    // Create a more complex test PDF content
    const testPdfContent = Buffer.from(`%PDF-1.4
1 0 obj
<<
/Type /Catalog
/Pages 2 0 R
>>
endobj
2 0 obj
<<
/Type /Pages
/Kids [3 0 R]
/Count 1
>>
endobj
3 0 obj
<<
/Type /Page
/Parent 2 0 R
/MediaBox [0 0 612 792]
/Contents 4 0 R
>>
endobj
4 0 obj
<<
/Length 200
>>
stream
BT
/F1 12 Tf
72 720 Td
(IntelliKen Grill Model IG-48VDC) Tj
0 -20 Td
(Manufacturer: IntelliKen Technologies Inc.) Tj
0 -20 Td
(Operating Pressure: 15 psi) Tj
0 -20 Td
(Temperature Range: 200-500°F) Tj
0 -20 Td
(Power: 120V AC, 1500W) Tj
0 -20 Td
(Capacity: 25 lbs cooking capacity) Tj
0 -20 Td
(Warning: Hot surface - do not touch) Tj
0 -20 Td
(Step 1: Turn on power switch) Tj
0 -20 Td
(Step 2: Set temperature to 350°F) Tj
0 -20 Td
(Check: Verify pressure gauge reads 15 psi) Tj
ET
endstream
endobj
xref
0 5
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000204 00000 n 
trailer
<<
/Size 5
/Root 1 0 R
>>
startxref
404
%%EOF`);
    
    const formData = new FormData();
    formData.append('file', new Blob([testPdfContent], { type: 'application/pdf' }), 'complex-test.pdf');
    formData.append('doc_id', 'complex-test-' + Date.now());
    formData.append('options', JSON.stringify({ debug: true }));
    
    const response = await fetch(`${sidecarUrl}/v1/dip`, {
      method: 'POST',
      body: formData
    });
    
    if (!response.ok) {
      console.log('❌ Complex DIP generation failed:', response.status, response.statusText);
      const errorText = await response.text();
      console.log('Error details:', errorText);
      return false;
    }
    
    const dipResult = await response.json();
    console.log('✅ Complex DIP generation working:', {
      success: dipResult.success,
      doc_id: dipResult.doc_id,
      entities_count: dipResult.entities_count,
      hints_count: dipResult.hints_count,
      tests_count: dipResult.tests_count
    });
    
    return true;
  } catch (error) {
    console.log('❌ Complex DIP generation test failed:', error.message);
    return false;
  }
}

async function runDebugTests() {
  console.log('🚀 Starting DIP Generation Debug Tests\n');
  
  const results = {
    simple: await testSimpleDIPGeneration(),
    complex: await testComplexDIPGeneration()
  };
  
  console.log('\n📊 Debug Results:');
  console.log('================');
  console.log(`Simple DIP generation: ${results.simple ? '✅' : '❌'}`);
  console.log(`Complex DIP generation: ${results.complex ? '✅' : '❌'}`);
  
  if (results.simple && !results.complex) {
    console.log('\n🔍 Analysis: The issue occurs with complex content, likely in one of the enhanced regex patterns.');
  } else if (!results.simple) {
    console.log('\n🔍 Analysis: The issue occurs even with simple content, likely in basic patterns.');
  } else {
    console.log('\n🎉 Both tests passed! The issue might be intermittent or fixed.');
  }
}

runDebugTests().catch(console.error);
