#!/usr/bin/env node

/**
 * Check document_chunks table structure
 */

import { createClient } from '@supabase/supabase-js';

async function checkDocumentChunks() {
  console.log('🔍 Checking document_chunks table structure...\n');

  try {
    const supabaseUrl = 'https://eriquneakfcfmeecqyof.supabase.co';
    const supabaseKey = 'sb_secret_VYgTw3lmc1DNcFxrQNaV-w_tDqqxiyR';
    
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get a real document ID
    const { data: documents } = await supabase
      .from('documents')
      .select('doc_id')
      .limit(1);
    
    if (!documents || documents.length === 0) {
      console.log('❌ No documents found');
      return;
    }

    const testDocId = documents[0].doc_id;

    // Try different column names for document_chunks
    const possibleColumns = [
      { text: 'test content', page_start: 1, page_end: 1, chunk_index: 1 },
      { chunk_text: 'test content', page_start: 1, page_end: 1, chunk_index: 1 },
      { chunk_content: 'test content', page_start: 1, page_end: 1, chunk_index: 1 },
      { content: 'test content', page_number: 1, chunk_index: 1 },
      { text: 'test content', page: 1, chunk_index: 1 }
    ];

    for (let i = 0; i < possibleColumns.length; i++) {
      const testData = { doc_id: testDocId, ...possibleColumns[i] };
      
      console.log(`\nTrying columns: ${Object.keys(testData).join(', ')}`);
      
      const { data: result, error } = await supabase
        .from('document_chunks')
        .insert(testData)
        .select()
        .single();

      if (error) {
        console.log(`❌ Failed: ${error.message}`);
      } else {
        console.log(`✅ Success! Document chunks columns:`, Object.keys(result));
        // Clean up
        await supabase.from('document_chunks').delete().eq('id', result.id);
        break;
      }
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

checkDocumentChunks();
