#!/usr/bin/env node

/**
 * Document Upload Refactor Test Script
 * Tests the enhanced upload flow with system lookup and normalized metadata
 * 
 * Usage: node scripts/test-upload-refactor.js
 */

import { lookupSystemByManufacturerAndModel } from '../src/repositories/systems.repository.js';
import { uploadDocumentSchema, systemMetadataSchema } from '../src/schemas/uploadDocument.schema.js';
import { logger } from '../src/utils/logger.js';

const requestLogger = logger.createRequestLogger();

async function testSystemLookup() {
  console.log('🧪 Testing System Lookup...');
  
  try {
    // Test with a known manufacturer/model combination
    // Note: This will only work if the systems table has data
    const testManufacturer = 'Kenyon';
    const testModel = 'BBQ Grill System';
    
    console.log(`Looking up system for: ${testManufacturer} - ${testModel}`);
    
    const systemMetadata = await lookupSystemByManufacturerAndModel(testManufacturer, testModel);
    
    console.log('✅ System lookup successful!');
    console.log('📊 System metadata:', systemMetadata);
    
    // Validate the response using Zod schema
    const validationResult = systemMetadataSchema.safeParse(systemMetadata);
    if (validationResult.success) {
      console.log('✅ System metadata validation passed');
    } else {
      console.log('❌ System metadata validation failed:', validationResult.error.errors);
    }
    
    return systemMetadata;
    
  } catch (error) {
    console.log('❌ System lookup failed:', error.message);
    console.log('ℹ️  This is expected if no systems data exists yet');
    return null;
  }
}

function testSchemaValidation() {
  console.log('\n🧪 Testing Schema Validation...');
  
  // Test valid metadata
  const validMetadata = {
    manufacturer_norm: 'Kenyon',
    model_norm: 'BBQ Grill System'
  };
  
  const validResult = uploadDocumentSchema.safeParse(validMetadata);
  if (validResult.success) {
    console.log('✅ Valid metadata validation passed');
  } else {
    console.log('❌ Valid metadata validation failed:', validResult.error.errors);
  }
  
  // Test invalid metadata
  const invalidMetadata = {
    manufacturer_norm: '', // Empty string should fail
    model_norm: 'BBQ Grill System'
  };
  
  const invalidResult = uploadDocumentSchema.safeParse(invalidMetadata);
  if (!invalidResult.success) {
    console.log('✅ Invalid metadata correctly rejected');
  } else {
    console.log('❌ Invalid metadata should have been rejected');
  }
  
  // Test missing fields
  const missingFieldsMetadata = {
    manufacturer_norm: 'Kenyon'
    // model_norm missing
  };
  
  const missingResult = uploadDocumentSchema.safeParse(missingFieldsMetadata);
  if (!missingResult.success) {
    console.log('✅ Missing fields correctly rejected');
  } else {
    console.log('❌ Missing fields should have been rejected');
  }
}

async function testDatabaseConnection() {
  console.log('\n🧪 Testing Database Connection...');
  
  try {
    // Import the Supabase client to test connection
    const { getSupabaseClient } = await import('../src/repositories/supabaseClient.js');
    const supabase = await getSupabaseClient();
    
    if (supabase) {
      console.log('✅ Database connection successful');
      
      // Test if systems table exists and has data
      const { data, error } = await supabase
        .from('systems')
        .select('manufacturer_norm, model_norm')
        .limit(5);
      
      if (error) {
        console.log('❌ Systems table query failed:', error.message);
      } else {
        console.log('✅ Systems table accessible');
        console.log(`📊 Found ${data?.length || 0} systems`);
        if (data && data.length > 0) {
          console.log('📋 Sample systems:', data.slice(0, 3));
        }
      }
    } else {
      console.log('❌ Database connection failed');
    }
  } catch (error) {
    console.log('❌ Database connection test failed:', error.message);
  }
}

async function runTests() {
  console.log('🚀 Starting Document Upload Refactor Tests\n');
  
  await testDatabaseConnection();
  testSchemaValidation();
  await testSystemLookup();
  
  console.log('\n✅ All tests completed!');
  console.log('\n📋 Next Steps:');
  console.log('1. Run the database migration: node scripts/migrations/run-migration.js 001_add_normalized_system_metadata_to_documents.sql');
  console.log('2. Test the upload flow through the admin UI');
  console.log('3. Verify documents are created with normalized system metadata');
}

runTests().catch(console.error);
