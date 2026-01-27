#!/usr/bin/env node
/**
 * Reset Test Upload Script
 *
 * Clears all data from a test document upload so it can be re-tested.
 * Use this during v5 pipeline development to repeatedly test the same document.
 *
 * Usage:
 *   node scripts/reset-test-upload.cjs
 *   node scripts/reset-test-upload.cjs --doc-id=<uuid>
 *   node scripts/reset-test-upload.cjs --asset-uid=engine-yanmar
 *   node scripts/reset-test-upload.cjs --all  (clears ALL test data)
 *
 * What gets cleared:
 *   - jobs table (test jobs)
 *   - documents table
 *   - document_chunks table
 *   - staging_* DIP tables
 *   - Pinecone vectors
 *   - Storage: /dip/*, /page-screenshots/*, /manuals/*
 *
 * What is PRESERVED:
 *   - systems, instances (your test system stays)
 *   - agent_training_decisions, agent_config
 *   - Reference tables (ref_*)
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { Pinecone } = require('@pinecone-database/pinecone');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY
});

// Parse command line args
const args = process.argv.slice(2);
const docIdArg = args.find(a => a.startsWith('--doc-id='));
const assetUidArg = args.find(a => a.startsWith('--asset-uid='));
const clearAll = args.includes('--all');

const targetDocId = docIdArg ? docIdArg.split('=')[1] : null;
const targetAssetUid = assetUidArg ? assetUidArg.split('=')[1] : null;

async function clearDatabase(docIds) {
  console.log('\n📦 Clearing database tables...');

  const tables = [
    { name: 'document_chunks', fk: 'doc_id' },
    { name: 'staging_spec_suggestions', fk: 'doc_id' },
    { name: 'staging_playbook_hints', fk: 'doc_id' },
    { name: 'staging_intent_router', fk: 'doc_id' },
    { name: 'staging_golden_tests', fk: 'doc_id' },
  ];

  for (const table of tables) {
    try {
      let query = supabase.from(table.name).delete();

      if (docIds && docIds.length > 0) {
        query = query.in(table.fk, docIds);
      } else if (clearAll) {
        query = query.neq(table.fk, '00000000-0000-0000-0000-000000000000'); // Delete all
      } else {
        console.log(`  ⏭️  ${table.name} - skipped (no doc IDs)`);
        continue;
      }

      const { error, count } = await query;
      if (error) throw error;
      console.log(`  ✅ ${table.name} - cleared`);
    } catch (err) {
      console.log(`  ⚠️  ${table.name} - ${err.message}`);
    }
  }

  // Clear documents table
  try {
    let query = supabase.from('documents').delete();
    if (docIds && docIds.length > 0) {
      query = query.in('doc_id', docIds);
    } else if (clearAll) {
      query = query.neq('doc_id', '00000000-0000-0000-0000-000000000000');
    }
    const { error } = await query;
    if (error) throw error;
    console.log('  ✅ documents - cleared');
  } catch (err) {
    console.log(`  ⚠️  documents - ${err.message}`);
  }

  // Clear jobs table
  try {
    let query = supabase.from('jobs').delete();
    if (docIds && docIds.length > 0) {
      query = query.in('doc_id', docIds);
    } else if (clearAll) {
      query = query.neq('doc_id', '00000000-0000-0000-0000-000000000000');
    }
    const { error } = await query;
    if (error) throw error;
    console.log('  ✅ jobs - cleared');
  } catch (err) {
    console.log(`  ⚠️  jobs - ${err.message}`);
  }
}

async function clearPinecone(docIds) {
  console.log('\n🌲 Clearing Pinecone vectors...');

  try {
    const index = pinecone.Index(process.env.PINECONE_INDEX);
    const namespace = 'REIMAGINEDDOCS';

    if (clearAll) {
      // Delete all vectors in namespace
      await index.namespace(namespace).deleteAll();
      console.log('  ✅ Deleted all vectors in REIMAGINEDDOCS namespace');
    } else if (docIds && docIds.length > 0) {
      // Delete vectors by doc_id filter
      for (const docId of docIds) {
        try {
          await index.namespace(namespace).deleteMany({
            filter: { doc_id: { $eq: docId } }
          });
          console.log(`  ✅ Deleted vectors for doc_id: ${docId}`);
        } catch (err) {
          // Pinecone might not support this filter, try alternative
          console.log(`  ⚠️  Could not delete by filter for ${docId}: ${err.message}`);
        }
      }
    } else {
      console.log('  ⏭️  Skipped (no doc IDs)');
    }
  } catch (err) {
    console.log(`  ⚠️  Pinecone error: ${err.message}`);
  }
}

async function clearStorage(docIds) {
  console.log('\n🗄️  Clearing Supabase Storage...');

  const buckets = [
    { bucket: 'documents', prefix: 'dip' },
    { bucket: 'documents', prefix: 'page-screenshots' },
    { bucket: 'documents', prefix: 'manuals' }  // Also clear uploaded PDFs for --all
  ];

  for (const { bucket, prefix } of buckets) {
    try {
      if (clearAll) {
        // List items at prefix level (could be files or folders)
        const { data: items, error: listError } = await supabase.storage
          .from(bucket)
          .list(prefix, { limit: 1000 });

        if (listError) throw listError;

        if (items && items.length > 0) {
          let totalDeleted = 0;

          for (const item of items) {
            // Check if it's a folder (has id null) or file
            if (item.id === null) {
              // It's a folder - list files inside it
              const { data: subFiles, error: subError } = await supabase.storage
                .from(bucket)
                .list(`${prefix}/${item.name}`, { limit: 1000 });

              if (!subError && subFiles && subFiles.length > 0) {
                const subPaths = subFiles.map(f => `${prefix}/${item.name}/${f.name}`);
                await supabase.storage.from(bucket).remove(subPaths);
                totalDeleted += subFiles.length;
              }
            } else {
              // It's a file - delete directly
              await supabase.storage.from(bucket).remove([`${prefix}/${item.name}`]);
              totalDeleted++;
            }
          }

          console.log(`  ✅ ${bucket}/${prefix}/* - deleted ${totalDeleted} files`);
        } else {
          console.log(`  ✅ ${bucket}/${prefix}/* - already empty`);
        }
      } else if (docIds && docIds.length > 0) {
        for (const docId of docIds) {
          const { data: files, error: listError } = await supabase.storage
            .from(bucket)
            .list(`${prefix}/${docId}`, { limit: 1000 });

          if (listError) {
            console.log(`  ⏭️  ${bucket}/${prefix}/${docId} - ${listError.message}`);
            continue;
          }

          if (files && files.length > 0) {
            const paths = files.map(f => `${prefix}/${docId}/${f.name}`);
            const { error: deleteError } = await supabase.storage
              .from(bucket)
              .remove(paths);
            if (deleteError) throw deleteError;
            console.log(`  ✅ ${bucket}/${prefix}/${docId} - deleted ${files.length} files`);
          }
        }
      }
    } catch (err) {
      console.log(`  ⚠️  ${bucket}/${prefix} - ${err.message}`);
    }
  }
}

async function getDocIds() {
  let docIds = [];

  if (targetDocId) {
    docIds = [targetDocId];
    console.log(`🎯 Target: doc_id = ${targetDocId}`);
  } else if (targetAssetUid) {
    // Look up doc_ids by asset_uid
    const { data, error } = await supabase
      .from('documents')
      .select('doc_id')
      .eq('asset_uid', targetAssetUid);

    if (error) throw error;
    docIds = data?.map(d => d.doc_id) || [];
    console.log(`🎯 Target: asset_uid = ${targetAssetUid} (${docIds.length} documents)`);
  } else if (clearAll) {
    console.log('🎯 Target: ALL test data (--all flag)');
  } else {
    // Default: find recent test jobs
    const { data, error } = await supabase
      .from('jobs')
      .select('doc_id')
      .order('created_at', { ascending: false })
      .limit(10);

    if (error) throw error;
    docIds = [...new Set(data?.map(j => j.doc_id).filter(Boolean) || [])];
    console.log(`🎯 Target: ${docIds.length} recent jobs`);
  }

  return docIds;
}

async function showCurrentState() {
  console.log('\n📊 Current state:');

  const tables = ['jobs', 'documents', 'document_chunks', 'staging_spec_suggestions'];
  for (const table of tables) {
    try {
      const { count, error } = await supabase
        .from(table)
        .select('*', { count: 'exact', head: true });
      console.log(`  ${table}: ${count || 0} rows`);
    } catch (err) {
      console.log(`  ${table}: error`);
    }
  }

  // Pinecone stats
  try {
    const index = pinecone.Index(process.env.PINECONE_INDEX);
    const stats = await index.describeIndexStats();
    const reimaginedVectors = stats.namespaces?.REIMAGINEDDOCS?.vectorCount || 0;
    console.log(`  Pinecone REIMAGINEDDOCS: ${reimaginedVectors} vectors`);
  } catch (err) {
    console.log(`  Pinecone: error - ${err.message}`);
  }
}

async function main() {
  console.log('🧹 Reset Test Upload Script');
  console.log('============================');

  await showCurrentState();

  const docIds = await getDocIds();

  if (!clearAll && docIds.length === 0) {
    console.log('\n⚠️  No documents to clear. Use --all to clear everything.');
    return;
  }

  // Confirm
  console.log('\n⚠️  This will DELETE the above data. Press Ctrl+C to cancel...');
  await new Promise(resolve => setTimeout(resolve, 3000));

  await clearDatabase(docIds);
  await clearPinecone(docIds);
  await clearStorage(docIds);

  console.log('\n✅ Reset complete!');
  await showCurrentState();
}

main().catch(console.error);
