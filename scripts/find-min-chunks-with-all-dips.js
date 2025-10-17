#!/usr/bin/env node

/**
 * Find document with least chunks that has all 4 DIP extraction types
 * with at least 1 entry each
 */

import { createClient } from '@supabase/supabase-js';

async function findMinChunksWithAllDIPs() {
  console.log('🔍 Finding document with minimum chunks and all 4 DIP extraction types...\n');

  try {
    const supabaseUrl = process.env.SUPABASE_URL || 'https://eriquneakfcfmeecqyof.supabase.co';
    const supabaseKey = process.env.PY_SUPABASE_SERVICE_KEY || 'sb_secret_VYgTw3lmc1DNcFxrQNaV-w_tDqqxiyR';

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Step 1: Get all documents with their chunk counts
    console.log('📊 Step 1: Querying documents and chunk counts...');

    const { data: documents, error: docsError } = await supabase
      .from('documents')
      .select('doc_id, manufacturer, model');

    if (docsError) {
      throw new Error(`Failed to fetch documents: ${docsError.message}`);
    }

    console.log(`   Found ${documents.length} documents\n`);

    // Get chunk counts for each document
    const { data: chunkCounts, error: chunksError } = await supabase
      .from('document_chunks')
      .select('doc_id');

    if (chunksError) {
      throw new Error(`Failed to fetch chunks: ${chunksError.message}`);
    }

    // Count chunks per document
    const chunkCountMap = {};
    chunkCounts.forEach(chunk => {
      chunkCountMap[chunk.doc_id] = (chunkCountMap[chunk.doc_id] || 0) + 1;
    });

    console.log(`   Counted chunks for ${Object.keys(chunkCountMap).length} documents\n`);

    // Step 2: Check DIP extraction files for each document
    console.log('📁 Step 2: Checking DIP extraction files...\n');

    const dipFiles = [
      'spec_suggestions_an.json',
      'golden_rules_an.json',
      'intent_router_an.json',
      'playbook_hints_an.json'
    ];

    const results = [];

    for (const doc of documents) {
      const docId = doc.doc_id;
      const chunkCount = chunkCountMap[docId] || 0;

      // Skip documents with no chunks
      if (chunkCount === 0) {
        continue;
      }

      console.log(`   Checking ${doc.manufacturer} ${doc.model} (${docId})`);
      console.log(`      Chunks: ${chunkCount}`);

      const dipCounts = {};
      let hasAllDIPs = true;

      // Check each DIP file
      for (const dipFile of dipFiles) {
        const fileName = `${docId}_${dipFile}`;
        const filePath = `manuals/${docId}/DIP/${fileName}`;

        try {
          const { data: fileData, error: fileError } = await supabase.storage
            .from('documents')
            .download(filePath);

          if (fileError) {
            console.log(`      ❌ Missing: ${dipFile}`);
            hasAllDIPs = false;
            dipCounts[dipFile] = 0;
            continue;
          }

          // Parse JSON and count entries
          const text = await fileData.text();
          const jsonData = JSON.parse(text);

          let entryCount = 0;

          // Different DIP types have different structures
          if (dipFile === 'spec_suggestions_an.json') {
            // Array of specifications
            entryCount = Array.isArray(jsonData) ? jsonData.length : 0;
          } else if (dipFile === 'golden_rules_an.json') {
            // Object with rules array
            entryCount = Array.isArray(jsonData?.rules) ? jsonData.rules.length : 0;
          } else if (dipFile === 'intent_router_an.json') {
            // Object with intents array
            entryCount = Array.isArray(jsonData?.intents) ? jsonData.intents.length : 0;
          } else if (dipFile === 'playbook_hints_an.json') {
            // Object with hints array
            entryCount = Array.isArray(jsonData?.hints) ? jsonData.hints.length : 0;
          }

          dipCounts[dipFile] = entryCount;

          if (entryCount === 0) {
            console.log(`      ⚠️  Empty: ${dipFile}`);
            hasAllDIPs = false;
          } else {
            console.log(`      ✅ ${dipFile}: ${entryCount} entries`);
          }

        } catch (error) {
          console.log(`      ❌ Error reading ${dipFile}: ${error.message}`);
          hasAllDIPs = false;
          dipCounts[dipFile] = 0;
        }
      }

      if (hasAllDIPs) {
        results.push({
          doc_id: docId,
          manufacturer: doc.manufacturer,
          model: doc.model,
          chunk_count: chunkCount,
          dip_counts: dipCounts
        });
        console.log(`      🎯 Qualified! All 4 DIP types present with entries\n`);
      } else {
        console.log(`      ⏭️  Skipped (missing or empty DIP files)\n`);
      }
    }

    // Step 3: Find document with minimum chunks
    console.log('🏆 Step 3: Finding document with minimum chunks...\n');

    if (results.length === 0) {
      console.log('❌ No documents found with all 4 DIP extraction types and at least 1 entry each');
      return;
    }

    // Sort by chunk count ascending
    results.sort((a, b) => a.chunk_count - b.chunk_count);

    console.log('═══════════════════════════════════════════════════════════');
    console.log('🎯 RESULT: Document with Minimum Chunks and All 4 DIP Types');
    console.log('═══════════════════════════════════════════════════════════\n');

    const winner = results[0];

    console.log(`Document ID:    ${winner.doc_id}`);
    console.log(`Manufacturer:   ${winner.manufacturer}`);
    console.log(`Model:          ${winner.model}`);
    console.log(`Chunk Count:    ${winner.chunk_count}`);
    console.log('\nDIP Extraction Counts:');
    console.log(`  • Spec Suggestions:  ${winner.dip_counts['spec_suggestions_an.json']} entries`);
    console.log(`  • Golden Rules:      ${winner.dip_counts['golden_rules_an.json']} entries`);
    console.log(`  • Intent Router:     ${winner.dip_counts['intent_router_an.json']} entries`);
    console.log(`  • Playbook Hints:    ${winner.dip_counts['playbook_hints_an.json']} entries`);

    console.log('\n═══════════════════════════════════════════════════════════\n');

    // Show top 5 for comparison
    if (results.length > 1) {
      console.log('📊 Top 5 Documents with All 4 DIP Types (by chunk count):\n');
      results.slice(0, 5).forEach((doc, idx) => {
        console.log(`${idx + 1}. ${doc.manufacturer} ${doc.model} (${doc.doc_id})`);
        console.log(`   Chunks: ${doc.chunk_count}`);
        console.log(`   DIPs: Specs=${doc.dip_counts['spec_suggestions_an.json']}, ` +
                    `Rules=${doc.dip_counts['golden_rules_an.json']}, ` +
                    `Intents=${doc.dip_counts['intent_router_an.json']}, ` +
                    `Hints=${doc.dip_counts['playbook_hints_an.json']}\n`);
      });
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  }
}

findMinChunksWithAllDIPs();
