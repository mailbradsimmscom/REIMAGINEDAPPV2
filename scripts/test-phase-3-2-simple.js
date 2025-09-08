#!/usr/bin/env node

/**
 * Phase 3.2 Simple Validation Script
 * Tests core DIP functionality without Supabase Storage
 * 
 * Usage: node scripts/test-phase-3-2-simple.js
 */

import 'dotenv/config';
import { logger } from '../src/utils/logger.js';
import { getSupabaseClient } from '../src/repositories/supabaseClient.js';

const requestLogger = logger.createRequestLogger();

async function testDIPSuccessTracking() {
  console.log('🧪 Testing DIP success tracking...');
  
  try {
    const supabase = await getSupabaseClient();
    if (!supabase) {
      throw new Error('Supabase client not available');
    }

    // Test if dip_success column exists and is queryable
    const { data, error } = await supabase
      .from('jobs')
      .select('job_id, dip_success, job_type')
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
        contentType: 'text/plain',
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

async function testPythonSidecarHealth() {
  console.log('\n🧪 Testing Python sidecar health...');
  
  try {
    const response = await fetch('http://localhost:8000/health');
    
    if (!response.ok) {
      throw new Error(`Health check failed: ${response.status}`);
    }
    
    const health = await response.json();
    console.log('✅ Python sidecar is healthy:', health);
    
    return true;
  } catch (error) {
    console.log('❌ Python sidecar health check failed:', error.message);
    return false;
  }
}

async function runTests() {
  console.log('🚀 Starting Phase 3.2 Simple Validation Tests\n');
  
  const results = {
    sidecarHealth: await testPythonSidecarHealth(),
    successTracking: await testDIPSuccessTracking(),
    storageAccess: await testSupabaseStorageAccess(),
    fileUpload: await testDIPFileUpload()
  };
  
  console.log('\n📊 Test Results:');
  console.log('================');
  console.log(`Python sidecar health: ${results.sidecarHealth ? '✅' : '❌'}`);
  console.log(`DIP success tracking: ${results.successTracking ? '✅' : '❌'}`);
  console.log(`Supabase Storage access: ${results.storageAccess ? '✅' : '❌'}`);
  console.log(`DIP file upload: ${results.fileUpload ? '✅' : '❌'}`);
  
  const allPassed = results.sidecarHealth && 
                   results.successTracking && 
                   results.storageAccess && 
                   results.fileUpload;
  
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
