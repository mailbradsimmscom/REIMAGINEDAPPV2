#!/usr/bin/env node
/**
 * Test: Storage paths resolve to accessible images
 * Validates: ${SUPABASE_URL}/storage/v1/object/public/documents/${storage_path}
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const baseUrl = process.env.SUPABASE_URL;

async function test() {
  console.log('🔬 Testing Storage Path Resolution');
  console.log('===================================\n');
  console.log(`Base URL: ${baseUrl}\n`);

  // Try doc_assets first
  const { data: assets, error: assetsErr } = await supabase
    .from('doc_assets')
    .select('storage_path, asset_type, doc_id')
    .not('storage_path', 'is', null)
    .limit(5);

  if (assetsErr) {
    console.log('⚠️  Could not query doc_assets:', assetsErr.message);
  }

  let pathsToTest = [];

  if (assets && assets.length > 0) {
    console.log(`Found ${assets.length} doc_assets with storage paths:\n`);
    pathsToTest = assets.map(a => ({
      path: a.storage_path,
      type: a.asset_type,
      source: 'doc_assets'
    }));
  } else {
    console.log('No doc_assets found. Checking document_chunks for screenshot_path...\n');

    const { data: chunks, error: chunksErr } = await supabase
      .from('document_chunks')
      .select('screenshot_path, doc_id')
      .not('screenshot_path', 'is', null)
      .limit(5);

    if (chunksErr) {
      console.log('⚠️  Could not query document_chunks:', chunksErr.message);
    }

    if (chunks && chunks.length > 0) {
      console.log(`Found ${chunks.length} document_chunks with screenshot paths:\n`);
      pathsToTest = chunks.map(c => ({
        path: c.screenshot_path,
        type: 'screenshot',
        source: 'document_chunks'
      }));
    }
  }

  if (pathsToTest.length === 0) {
    console.log('❌ No storage paths found in database to test.');
    console.log('\nTry uploading a document first, then re-run this test.');
    return;
  }

  // Test each path
  let passed = 0;
  let failed = 0;

  for (const item of pathsToTest) {
    const url = `${baseUrl}/storage/v1/object/public/documents/${item.path}`;

    console.log(`Path:   ${item.path}`);
    console.log(`Type:   ${item.type}`);
    console.log(`Source: ${item.source}`);
    console.log(`URL:    ${url}`);

    try {
      const res = await fetch(url, { method: 'HEAD' });

      if (res.ok) {
        passed++;
        console.log(`✅ Status: ${res.status} ${res.statusText}`);
        console.log(`   Content-Type: ${res.headers.get('content-type')}`);
        console.log(`   Size: ${res.headers.get('content-length')} bytes`);
      } else {
        failed++;
        console.log(`❌ Status: ${res.status} ${res.statusText}`);
      }
    } catch (err) {
      failed++;
      console.log(`❌ Fetch error: ${err.message}`);
    }
    console.log();
  }

  // Summary
  console.log('='.repeat(50));
  console.log('SUMMARY');
  console.log('='.repeat(50));
  console.log(`  Passed: ${passed}/${pathsToTest.length}`);
  console.log(`  Failed: ${failed}/${pathsToTest.length}`);

  if (failed === 0) {
    console.log('\n✅ ASSUMPTION VALIDATED: Storage paths resolve to accessible images');
  } else {
    console.log('\n⚠️  Some paths failed - check bucket permissions or path format');
  }
}

test().catch(console.error);
