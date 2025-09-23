#!/usr/bin/env node

import { getSupabaseClient } from './src/repositories/supabaseClient.js';

async function checkStagingTables() {
  try {
    const supabase = await getSupabaseClient();
    const docId = '90d444545130375e9f3b430e12c352cb8fa18db493d6f9774b05e337c2093bae';
    
    console.log(`🔍 Checking staging tables for document: ${docId}`);
    
    // Check each staging table
    const tables = [
      'staging_spec_suggestions',
      'staging_playbook_hints', 
      'staging_intent_router',
      'staging_golden_tests'
    ];
    
    for (const tableName of tables) {
      try {
        const { data, error } = await supabase
          .from(tableName)
          .select('*')
          .eq('doc_id', docId)
          .limit(5); // Show first 5 records
        
        if (error) {
          console.log(`❌ ${tableName}: Error - ${error.message}`);
        } else {
          console.log(`✅ ${tableName}: ${data.length} records found`);
          if (data.length > 0) {
            console.log(`   Sample record: ${JSON.stringify(data[0], null, 2).substring(0, 200)}...`);
          }
        }
      } catch (err) {
        console.log(`❌ ${tableName}: Exception - ${err.message}`);
      }
    }
    
    // Get total counts
    console.log('\n📊 Total counts:');
    for (const tableName of tables) {
      try {
        const { count, error } = await supabase
          .from(tableName)
          .select('*', { count: 'exact', head: true })
          .eq('doc_id', docId);
        
        if (error) {
          console.log(`   ${tableName}: Error getting count`);
        } else {
          console.log(`   ${tableName}: ${count} total records`);
        }
      } catch (err) {
        console.log(`   ${tableName}: Error getting count`);
      }
    }
    
  } catch (error) {
    console.error('❌ Error checking staging tables:', error.message);
  }
}

checkStagingTables();
