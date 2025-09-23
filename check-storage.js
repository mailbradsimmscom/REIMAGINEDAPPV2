#!/usr/bin/env node

import { getSupabaseClient } from './src/repositories/supabaseClient.js';

async function checkStorage() {
  try {
    const supabase = await getSupabaseClient();
    const docId = '90d444545130375e9f3b430e12c352cb8fa18db493d6f9774b05e337c2093bae';
    
    console.log(`Checking storage for document: ${docId}`);
    
    // Check for DIP folder
    const dipPath = `manuals/${docId}/DIP`;
    console.log(`\nChecking DIP folder: ${dipPath}`);
    
    const { data: dipFiles, error: dipError } = await supabase.storage
      .from('documents')
      .list(dipPath);
    
    if (dipError) {
      console.log(`❌ Error listing DIP folder: ${dipError.message}`);
    } else {
      console.log(`✅ DIP folder exists with ${dipFiles?.length || 0} files:`);
      if (dipFiles && dipFiles.length > 0) {
        dipFiles.forEach(file => {
          console.log(`  - ${file.name} (${file.metadata?.size || 'unknown size'})`);
        });
      } else {
        console.log('  No files found in DIP folder');
      }
    }
    
    // Check for individual JSON files
    const expectedFiles = [
      `${docId}_spec_suggestions_an.json`,
      `${docId}_golden_rules_an.json`, 
      `${docId}_intent_router_an.json`,
      `${docId}_playbook_hints_an.json`
    ];
    
    console.log(`\nChecking for individual JSON files:`);
    for (const fileName of expectedFiles) {
      const filePath = `manuals/${docId}/DIP/${fileName}`;
      try {
        const { data, error } = await supabase.storage
          .from('documents')
          .download(filePath);
        
        if (error) {
          console.log(`❌ ${fileName}: ${error.message}`);
        } else {
          console.log(`✅ ${fileName}: Found (${data?.size || 'unknown size'} bytes)`);
        }
      } catch (err) {
        console.log(`❌ ${fileName}: ${err.message}`);
      }
    }
    
    // List all files in the document folder
    console.log(`\nListing all files in document folder:`);
    const { data: allFiles, error: allError } = await supabase.storage
      .from('documents')
      .list(`manuals/${docId}`, { limit: 100 });
    
    if (allError) {
      console.log(`❌ Error listing document folder: ${allError.message}`);
    } else {
      console.log(`✅ Document folder has ${allFiles?.length || 0} items:`);
      if (allFiles && allFiles.length > 0) {
        allFiles.forEach(item => {
          console.log(`  - ${item.name} (${item.metadata?.size || 'unknown size'})`);
        });
      }
    }
    
  } catch (error) {
    console.error('Error checking storage:', error);
  }
}

checkStorage();
