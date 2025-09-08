#!/usr/bin/env node

/**
 * Check existing document_chunks records to see structure
 */

import { createClient } from '@supabase/supabase-js';

async function checkExistingDocumentChunks() {
  console.log('🔍 Checking existing document_chunks records...\n');

  try {
    const supabaseUrl = 'https://eriquneakfcfmeecqyof.supabase.co';
    const supabaseKey = 'sb_secret_VYgTw3lmc1DNcFxrQNaV-w_tDqqxiyR';
    
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Try to get existing records
    const { data: existingChunks, error } = await supabase
      .from('document_chunks')
      .select('*')
      .limit(1);

    if (error) {
      console.log(`❌ Error querying document_chunks: ${error.message}`);
    } else if (existingChunks && existingChunks.length > 0) {
      console.log('✅ Found existing document_chunks record:');
      console.log('Columns:', Object.keys(existingChunks[0]));
      console.log('Sample data:', existingChunks[0]);
    } else {
      console.log('⚠️  No existing document_chunks records found');
      console.log('This table may be empty or have a different structure');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

checkExistingDocumentChunks();
