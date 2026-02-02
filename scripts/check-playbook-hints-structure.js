#!/usr/bin/env node

/**
 * Check the structure of playbook_hints table
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

async function checkPlaybookHintsStructure() {
  console.log('🔍 Checking playbook_hints table structure...\n');

  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
    
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Try to insert with minimal data to see what columns exist
    const { data: documents } = await supabase
      .from('documents')
      .select('doc_id')
      .limit(1);
    
    if (!documents || documents.length === 0) {
      console.log('❌ No documents found');
      return;
    }

    const testDocId = documents[0].doc_id;

    // Try minimal insert to see what columns are required
    const { data: result, error } = await supabase
      .from('playbook_hints')
      .insert({
        doc_id: testDocId,
        text: 'Test hint',
        approved_by: 'test-admin'
      })
      .select()
      .single();

    if (error) {
      console.log('❌ Error inserting playbook hint:', error.message);
      console.log('This tells us about the table structure');
    } else {
      console.log('✅ Successfully inserted playbook hint:', result);
      
      // Clean up
      await supabase.from('playbook_hints').delete().eq('id', result.id);
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

checkPlaybookHintsStructure();
