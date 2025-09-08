#!/usr/bin/env node

/**
 * Phase 3.2 Validation Script
 * Tests DIP file persistence to Supabase Storage
 * 
 * Usage: node scripts/test-phase-3-2.js
 */

import 'dotenv/config';
import { logger } from '../src/utils/logger.js';
import { getSupabaseClient } from '../src/repositories/supabaseClient.js';
import dipService from '../src/services/dip.service.js';

const requestLogger = logger.createRequestLogger();

async function testDIPFileGeneration() {
  console.log('🧪 Testing DIP file generation...');
  
  try {
    // Create a test PDF content
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
(Test Grill Manual) Tj
0 -20 Td
(Model: TG-240V) Tj
0 -20 Td
(Manufacturer: TestGrill Systems) Tj
0 -20 Td
(Operating Pressure: 20 psi) Tj
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
404
%%EOF`);
    
    const docId = 'test-persistence-' + Date.now();
    const fileName = 'test-grill-manual.pdf';
    
    // Test DIP generation
    const dipResult = await dipService.generateDIP(testPdfContent, docId, fileName, {
      test: true,
      enhanced: true
    });
    
    console.log('✅ DIP generation working:', {
      success: dipResult.success,
      docId: dipResult.doc_id,
      entitiesCount: dipResult.entities_count,
      hintsCount: dipResult.hints_count,
      testsCount: dipResult.tests_count,
      processingTime: dipResult.processing_time
    });
    
    return { success: true, docId, dipResult };
  } catch (error) {
    console.log('❌ DIP file generation failed:', error.message);
    return { success: false, error: error.message };
  }
}

async function testSupabaseStorageAccess() {
  console.log('\n🧪 Testing Supabase Storage access...');
  
  try {
    const supabase = await getSupabaseClient();
    if (!supabase) {
      throw new Error('Supabase client not available');
    }

    // Test listing files in documents bucket
    const { data: files, error } = await supabase.storage
      .from('documents')
      .list('manuals', {
        limit: 10,
        offset: 0
      });

    if (error) {
      console.log('❌ Supabase Storage access failed:', error.message);
      return false;
    }

    console.log('✅ Supabase Storage access working');
    console.log('📁 Sample files in manuals folder:', files?.length || 0);
    
    return true;
  } catch (error) {
    console.log('❌ Supabase Storage access test failed:', error.message);
    return false;
  }
}

async function testDIPFileUpload() {
  console.log('\n🧪 Testing DIP file upload to Supabase Storage...');
  
  try {
    const supabase = await getSupabaseClient();
    if (!supabase) {
      throw new Error('Supabase client not available');
    }

    const docId = 'test-upload-' + Date.now();
    const testContent = JSON.stringify({
      document_id: docId,
      extraction_timestamp: new Date().toISOString(),
      extraction_version: '1.0.0',
      total_entities: 3,
      entities: [
        { entity_type: 'manufacturer', value: 'TestManufacturer', confidence: 0.95 },
        { entity_type: 'model', value: 'TestModel', confidence: 0.90 },
        { entity_type: 'specification', value: 'TestSpec', confidence: 0.85 }
      ]
    });

    const storagePath = `manuals/${docId}/DIP/entities.json`;
    
    // Upload test file
    const { data, error } = await supabase.storage
      .from('documents')
      .upload(storagePath, testContent, {
        contentType: 'application/json',
        cacheControl: '3600'
      });

    if (error) {
      console.log('❌ DIP file upload failed:', error.message);
      return false;
    }

    console.log('✅ DIP file upload successful:', storagePath);

    // Test file retrieval
    const { data: fileData, error: downloadError } = await supabase.storage
      .from('documents')
      .download(storagePath);

    if (downloadError) {
      console.log('❌ DIP file download failed:', downloadError.message);
      return false;
    }

    const content = await fileData.text();
    const parsedContent = JSON.parse(content);
    
    console.log('✅ DIP file download successful:', {
      docId: parsedContent.document_id,
      totalEntities: parsedContent.total_entities
    });

    // Clean up test file
    try {
      await supabase.storage
        .from('documents')
        .remove([storagePath]);
      console.log('✅ Test file cleaned up');
    } catch (cleanupError) {
      console.log('⚠️  Cleanup warning:', cleanupError.message);
    }

    return true;
  } catch (error) {
    console.log('❌ DIP file upload test failed:', error.message);
    return false;
  }
}

async function testDIPSuccessTracking() {
  console.log('\n🧪 Testing DIP success tracking...');
  
  try {
    const supabase = await getSupabaseClient();
    if (!supabase) {
      throw new Error('Supabase client not available');
    }

    // Test if dip_success column exists and is queryable
    const { data, error } = await supabase
      .from('jobs')
      .select('job_id, dip_success')
      .eq('job_type', 'DIP')
      .limit(5);

    if (error) {
      console.log('❌ DIP success tracking test failed:', error.message);
      return false;
    }

    console.log('✅ DIP success tracking working');
    console.log('📊 Sample DIP jobs:', data?.length || 0);
    
    if (data && data.length > 0) {
      console.log('📋 DIP success statuses:', data.map(job => ({
        jobId: job.job_id.substring(0, 8) + '...',
        dipSuccess: job.dip_success
      })));
    }

    return true;
  } catch (error) {
    console.log('❌ DIP success tracking test failed:', error.message);
    return false;
  }
}

async function runTests() {
  console.log('🚀 Starting Phase 3.2 Validation Tests\n');
  
  const results = {
    dipGeneration: await testDIPFileGeneration(),
    storageAccess: await testSupabaseStorageAccess(),
    fileUpload: await testDIPFileUpload(),
    successTracking: await testDIPSuccessTracking()
  };
  
  console.log('\n📊 Test Results:');
  console.log('================');
  console.log(`DIP file generation: ${results.dipGeneration.success ? '✅' : '❌'}`);
  console.log(`Supabase Storage access: ${results.storageAccess ? '✅' : '❌'}`);
  console.log(`DIP file upload: ${results.fileUpload ? '✅' : '❌'}`);
  console.log(`DIP success tracking: ${results.successTracking ? '✅' : '❌'}`);
  
  const allPassed = results.dipGeneration.success && 
                   results.storageAccess && 
                   results.fileUpload && 
                   results.successTracking;
  
  if (allPassed) {
    console.log('\n🎉 All Phase 3.2 tests passed!');
    console.log('\n📋 Next Steps:');
    console.log('1. Proceed to Phase 3.3: DIP Success Tracking');
    console.log('2. Test DIP processing with real documents');
    console.log('3. Verify DIP files are uploaded to Supabase Storage');
  } else {
    console.log('\n❌ Some tests failed. Please check the DIP file persistence implementation.');
    console.log('\n🔧 Troubleshooting:');
    console.log('1. Make sure Python sidecar is running');
    console.log('2. Check Supabase Storage configuration');
    console.log('3. Verify DIP file upload logic');
  }
}

runTests().catch(console.error);
