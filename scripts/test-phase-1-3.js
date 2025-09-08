#!/usr/bin/env node

/**
 * Phase 1.3 Validation Script
 * Tests the enhanced DIP file generation with real document processing
 * 
 * Usage: node scripts/test-phase-1-3.js
 */

import 'dotenv/config';
import { logger } from '../src/utils/logger.js';
import { getEnv } from '../src/config/env.js';
import fs from 'fs';
import path from 'path';

const requestLogger = logger.createRequestLogger();

async function testEnhancedDIPGeneration() {
  console.log('🧪 Testing Enhanced DIP File Generation...');
  
  try {
    const sidecarUrl = getEnv({ loose: true }).PYTHON_SIDECAR_URL || 'http://localhost:8000';
    
    // Create a more realistic test PDF content
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
    formData.append('file', new Blob([testPdfContent], { type: 'application/pdf' }), 'test-grill-manual.pdf');
    formData.append('doc_id', 'test-grill-' + Date.now());
    formData.append('options', JSON.stringify({ enhanced: true }));
    
    const response = await fetch(`${sidecarUrl}/v1/dip`, {
      method: 'POST',
      body: formData
    });
    
    if (!response.ok) {
      console.log('❌ Enhanced DIP generation failed:', response.status, response.statusText);
      const errorText = await response.text();
      console.log('Error details:', errorText);
      return false;
    }
    
    const dipResult = await response.json();
    console.log('✅ Enhanced DIP generation working:', {
      success: dipResult.success,
      doc_id: dipResult.doc_id,
      entities_count: dipResult.entities_count,
      hints_count: dipResult.hints_count,
      tests_count: dipResult.tests_count,
      processing_time: dipResult.processing_time
    });
    
    // Test the enhanced file generation
    if (dipResult.entities && dipResult.entities.length > 0) {
      console.log('📋 Sample entities found:');
      dipResult.entities.slice(0, 3).forEach((entity, index) => {
        console.log(`  ${index + 1}. ${entity.entity_type}: ${entity.value} (confidence: ${entity.confidence})`);
      });
    }
    
    if (dipResult.spec_hints && dipResult.spec_hints.length > 0) {
      console.log('📋 Sample spec hints found:');
      dipResult.spec_hints.slice(0, 3).forEach((hint, index) => {
        console.log(`  ${index + 1}. ${hint.hint_type}: ${hint.value} ${hint.unit || ''} (confidence: ${hint.confidence})`);
      });
    }
    
    if (dipResult.golden_tests && dipResult.golden_tests.length > 0) {
      console.log('📋 Sample golden tests found:');
      dipResult.golden_tests.slice(0, 2).forEach((test, index) => {
        console.log(`  ${index + 1}. ${test.test_type}: ${test.description} (confidence: ${test.confidence})`);
      });
    }
    
    return true;
  } catch (error) {
    console.log('❌ Enhanced DIP generation test failed:', error.message);
    return false;
  }
}

async function testDIPPacketFileGeneration() {
  console.log('\n🧪 Testing DIP Packet File Generation...');
  
  try {
    const sidecarUrl = getEnv({ loose: true }).PYTHON_SIDECAR_URL || 'http://localhost:8000';
    
    // Create a temporary test file
    const testDir = '/tmp/dip_test';
    const testFile = '/tmp/dip_test/test-manual.pdf';
    
    // Create test directory
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
    
    // Create a test PDF file
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
/Length 300
>>
stream
BT
/F1 12 Tf
72 720 Td
(Commercial Grill Manual) Tj
0 -20 Td
(Model: CG-240V) Tj
0 -20 Td
(Manufacturer: ProGrill Systems) Tj
0 -20 Td
(Operating Pressure: 20 psi maximum) Tj
0 -20 Td
(Temperature: 300-600°F range) Tj
0 -20 Td
(Power: 240V AC, 3000W rated) Tj
0 -20 Td
(Capacity: 50 lbs maximum) Tj
0 -20 Td
(Efficiency: 85% thermal efficiency) Tj
0 -20 Td
(Warning: High temperature hazard) Tj
0 -20 Td
(Procedure: Startup sequence) Tj
0 -20 Td
(Step 1: Check gas supply) Tj
0 -20 Td
(Step 2: Open main valve) Tj
0 -20 Td
(Step 3: Ignite burners) Tj
0 -20 Td
(Check: Verify flame pattern) Tj
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
504
%%EOF`);
    
    fs.writeFileSync(testFile, testPdfContent);
    
    const requestData = {
      doc_id: 'test-packet-' + Date.now(),
      file_path: testFile,
      output_dir: testDir,
      options: { enhanced: true }
    };
    
    const response = await fetch(`${sidecarUrl}/v1/runDocIntelligencePacket`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestData)
    });
    
    if (!response.ok) {
      console.log('❌ DIP packet file generation failed:', response.status, response.statusText);
      const errorText = await response.text();
      console.log('Error details:', errorText);
      return false;
    }
    
    const packetResult = await response.json();
    console.log('✅ DIP packet file generation working:', {
      success: packetResult.success,
      doc_id: packetResult.doc_id,
      processing_time: packetResult.processing_time,
      output_files: Object.keys(packetResult.output_files || {})
    });
    
    // Check if files were actually created
    if (packetResult.success && packetResult.output_files) {
      console.log('📁 Generated files:');
      for (const [fileType, filePath] of Object.entries(packetResult.output_files)) {
        if (fs.existsSync(filePath)) {
          const stats = fs.statSync(filePath);
          console.log(`  ✅ ${fileType}: ${filePath} (${stats.size} bytes)`);
        } else {
          console.log(`  ❌ ${fileType}: ${filePath} (not found)`);
        }
      }
    }
    
    // Clean up test files
    try {
      fs.unlinkSync(testFile);
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch (cleanupError) {
      console.log('⚠️  Cleanup warning:', cleanupError.message);
    }
    
    return true;
  } catch (error) {
    console.log('❌ DIP packet file generation test failed:', error.message);
    return false;
  }
}

async function testFileStructure() {
  console.log('\n🧪 Testing Enhanced File Structure...');
  
  try {
    const sidecarUrl = getEnv({ loose: true }).PYTHON_SIDECAR_URL || 'http://localhost:8000';
    
    // Test with a simple document to check file structure
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
/Length 100
>>
stream
BT
/F1 12 Tf
72 720 Td
(Test Document) Tj
0 -20 Td
(Model: TEST-001) Tj
0 -20 Td
(Pressure: 10 psi) Tj
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
304
%%EOF`);
    
    const formData = new FormData();
    formData.append('file', new Blob([testPdfContent], { type: 'application/pdf' }), 'structure-test.pdf');
    formData.append('doc_id', 'structure-test-' + Date.now());
    formData.append('options', JSON.stringify({ enhanced: true }));
    
    const response = await fetch(`${sidecarUrl}/v1/dip`, {
      method: 'POST',
      body: formData
    });
    
    if (!response.ok) {
      console.log('❌ Structure test failed:', response.status, response.statusText);
      return false;
    }
    
    const result = await response.json();
    
    // Check if the response has the expected enhanced structure
    const hasEnhancedStructure = result.entities && 
                                result.spec_hints && 
                                result.golden_tests &&
                                typeof result.processing_time === 'number';
    
    if (hasEnhancedStructure) {
      console.log('✅ Enhanced file structure working correctly');
      console.log(`  - Entities: ${result.entities_count}`);
      console.log(`  - Spec hints: ${result.hints_count}`);
      console.log(`  - Golden tests: ${result.tests_count}`);
      console.log(`  - Processing time: ${result.processing_time}s`);
    } else {
      console.log('❌ Enhanced file structure not working');
      return false;
    }
    
    return true;
  } catch (error) {
    console.log('❌ Structure test failed:', error.message);
    return false;
  }
}

async function runTests() {
  console.log('🚀 Starting Phase 1.3 Validation Tests\n');
  
  const results = {
    enhancedGeneration: await testEnhancedDIPGeneration(),
    packetFileGeneration: await testDIPPacketFileGeneration(),
    fileStructure: await testFileStructure()
  };
  
  console.log('\n📊 Test Results:');
  console.log('================');
  console.log(`Enhanced DIP generation: ${results.enhancedGeneration ? '✅' : '❌'}`);
  console.log(`Packet file generation: ${results.packetFileGeneration ? '✅' : '❌'}`);
  console.log(`File structure: ${results.fileStructure ? '✅' : '❌'}`);
  
  const allPassed = Object.values(results).every(result => result === true);
  
  if (allPassed) {
    console.log('\n🎉 All Phase 1.3 tests passed!');
    console.log('\n📋 Next Steps:');
    console.log('1. Proceed to Phase 1.4 (Node.js DIP Service Integration)');
    console.log('2. Test with real PDF documents');
    console.log('3. Validate file generation in production environment');
  } else {
    console.log('\n❌ Some tests failed. Please check the enhanced DIP implementation.');
    console.log('\n🔧 Troubleshooting:');
    console.log('1. Make sure Python sidecar is running with latest code');
    console.log('2. Check sidecar logs for any errors');
    console.log('3. Verify the enhanced patterns are working correctly');
  }
}

runTests().catch(console.error);
