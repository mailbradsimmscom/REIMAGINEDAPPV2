#!/usr/bin/env node

import { getSupabaseClient } from './src/repositories/supabaseClient.js';
import { logger } from './src/utils/logger.js';

const log = logger.createRequestLogger();

async function testAuth() {
  try {
    log.info('🔍 Testing Supabase authentication...');
    
    const supabase = await getSupabaseClient();
    if (!supabase) {
      log.error('❌ No Supabase client created');
      return;
    }

    // Test file access
    const testPath = 'documents/manuals/d80bc2d7cf6c924dfab471f7da56ce230965a7631482b482dca7c7dbb0d06366/DIP/d80bc2d7cf6c924dfab471f7da56ce230965a7631482b482dca7c7dbb0d06366_golden_rules_an.json';
    
    log.info('🧪 Testing file download...', { path: testPath });
    
    const { data, error } = await supabase.storage
      .from('documents')
      .download(testPath);

    if (error) {
      log.error('❌ Download failed', { error: error.message, code: error.statusCode });
    } else {
      log.info('✅ Download SUCCESS!', { size: data?.size });
    }

  } catch (error) {
    log.error('💥 Test failed', { error: error.message });
  }
}

testAuth();
