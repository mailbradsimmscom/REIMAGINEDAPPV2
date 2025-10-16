#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import { Pinecone } from '@pinecone-database/pinecone';
import { OpenAI } from 'openai';
import dotenv from 'dotenv';

dotenv.config();

// Configuration
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const PINECONE_API_KEY = process.env.PINECONE_API_KEY;
const PINECONE_INDEX = process.env.PINECONE_INDEX;
const PINECONE_NAMESPACE = process.env.PINECONE_NAMESPACE;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Missing document IDs (found during investigation)
const MISSING_DOC_IDS = [
  '5ac734a49e2f9b03a8879ddd9507fc4a317b35046d483342105df5cfa95d4443', // Victron Quattro (345 chunks)
  '1b16daed93f3f00a3eceba2927dd92ecb02c8d8ea56f7c4ff7ee1be0472c13cf'  // Peplink Balance 20x (331 chunks)
];

// Initialize clients
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
const pc = new Pinecone({ apiKey: PINECONE_API_KEY });
const index = pc.index(PINECONE_INDEX);

/**
 * Generate embeddings for a batch of texts
 * Replicates: python-sidecar/app/chunking/embeddings.py:_generate_embeddings
 */
async function generateEmbeddings(texts) {
  try {
    const response = await openai.embeddings.create({
      model: 'text-embedding-3-large',
      input: texts,
      encoding_format: 'float'
    });

    return response.data.map(item => item.embedding);
  } catch (error) {
    console.error('❌ Failed to generate embeddings:', error.message);
    throw error;
  }
}

/**
 * Upsert vectors to Pinecone in batches
 * Replicates: python-sidecar/app/pinecone_client.py:upsert_vectors
 */
async function upsertToPinecone(vectors, batchSize = 100) {
  const namespace = index.namespace(PINECONE_NAMESPACE);
  let totalUpserted = 0;

  try {
    for (let i = 0; i < vectors.length; i += batchSize) {
      const batch = vectors.slice(i, i + batchSize);

      // Format for Pinecone
      const pineconeVectors = batch.map(v => ({
        id: v.id,
        values: v.values,
        metadata: v.metadata
      }));

      await namespace.upsert(pineconeVectors);
      totalUpserted += batch.length;

      console.log(`   ✓ Upserted ${totalUpserted} / ${vectors.length} vectors`);
    }

    return { success: true, upserted_count: totalUpserted };
  } catch (error) {
    console.error('❌ Failed to upsert to Pinecone:', error.message);
    return { success: false, error: error.message, upserted_count: totalUpserted };
  }
}

/**
 * Process a single document's chunks
 */
async function processDocument(docId) {
  console.log(`\n📄 Processing document: ${docId.substring(0, 12)}...`);

  try {
    // 1. Fetch all chunks from Supabase
    console.log('   📥 Fetching chunks from Supabase...');
    const { data: chunks, error } = await supabase
      .from('document_chunks')
      .select('chunk_id, text, metadata, doc_id')
      .eq('doc_id', docId)
      .order('chunk_index');

    if (error) {
      throw new Error(`Supabase error: ${error.message}`);
    }

    if (!chunks || chunks.length === 0) {
      console.log('   ⚠️  No chunks found in Supabase');
      return { success: false, chunks_processed: 0 };
    }

    console.log(`   ✓ Found ${chunks.length} chunks`);

    // 2. Generate embeddings in batches
    console.log('   🧠 Generating embeddings...');
    const EMBEDDING_BATCH_SIZE = 100;
    const allEmbeddings = [];

    for (let i = 0; i < chunks.length; i += EMBEDDING_BATCH_SIZE) {
      const batch = chunks.slice(i, i + EMBEDDING_BATCH_SIZE);
      const texts = batch.map(chunk => chunk.text);

      const embeddings = await generateEmbeddings(texts);
      allEmbeddings.push(...embeddings);

      console.log(`   ✓ Generated ${allEmbeddings.length} / ${chunks.length} embeddings`);
    }

    // 3. Format vectors for Pinecone
    console.log('   📦 Formatting vectors...');
    const vectors = chunks.map((chunk, i) => {
      // Clean metadata - remove null values (Pinecone requirement)
      const cleanMetadata = {};
      const rawMetadata = {
        doc_id: chunk.doc_id,
        chunk_id: chunk.chunk_id,
        chunk_index: chunk.metadata?.chunk_index || i,
        ...(chunk.metadata || {})
      };

      // Filter out null/undefined values and ensure correct types
      for (const [key, value] of Object.entries(rawMetadata)) {
        if (value !== null && value !== undefined) {
          // Convert objects/arrays to strings if needed
          if (typeof value === 'object' && !Array.isArray(value)) {
            cleanMetadata[key] = JSON.stringify(value);
          } else {
            cleanMetadata[key] = value;
          }
        }
      }

      return {
        id: chunk.chunk_id,
        values: allEmbeddings[i],
        metadata: cleanMetadata
      };
    });

    console.log(`   ✓ Prepared ${vectors.length} vectors`);

    // 4. Upsert to Pinecone
    console.log('   ⬆️  Upserting to Pinecone...');
    const result = await upsertToPinecone(vectors);

    if (result.success) {
      console.log(`   ✅ Successfully upserted ${result.upserted_count} vectors`);
    } else {
      console.log(`   ⚠️  Partial success: ${result.upserted_count} vectors upserted`);
      console.log(`   Error: ${result.error}`);
    }

    return {
      success: result.success,
      chunks_processed: chunks.length,
      vectors_upserted: result.upserted_count
    };

  } catch (error) {
    console.error(`   ❌ Error processing document: ${error.message}`);
    return {
      success: false,
      error: error.message,
      chunks_processed: 0,
      vectors_upserted: 0
    };
  }
}

/**
 * Main execution
 */
async function main() {
  console.log('🚀 Re-sync Missing Vectors to Pinecone\n');
  console.log('═'.repeat(60));

  // Verify configuration
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('❌ Missing Supabase configuration');
    process.exit(1);
  }

  if (!PINECONE_API_KEY || !PINECONE_INDEX || !PINECONE_NAMESPACE) {
    console.error('❌ Missing Pinecone configuration');
    process.exit(1);
  }

  if (!OPENAI_API_KEY) {
    console.error('❌ Missing OpenAI API key');
    process.exit(1);
  }

  console.log(`📊 Configuration:`);
  console.log(`   Supabase URL: ${SUPABASE_URL}`);
  console.log(`   Pinecone Index: ${PINECONE_INDEX}`);
  console.log(`   Pinecone Namespace: ${PINECONE_NAMESPACE}`);
  console.log(`   Documents to process: ${MISSING_DOC_IDS.length}`);
  console.log('');

  // Get document names from Supabase
  console.log('📋 Documents to re-sync:');
  for (const docId of MISSING_DOC_IDS) {
    const { data: doc } = await supabase
      .from('documents')
      .select('manufacturer_norm, model_norm')
      .eq('doc_id', docId)
      .single();

    if (doc) {
      console.log(`   - ${doc.manufacturer_norm} ${doc.model_norm}`);
    } else {
      console.log(`   - ${docId.substring(0, 12)}... (metadata not found)`);
    }
  }

  console.log('');
  console.log('⏱️  This may take 5-10 minutes for large documents...\n');

  // Process each document
  const results = [];
  const startTime = Date.now();

  for (let i = 0; i < MISSING_DOC_IDS.length; i++) {
    const docId = MISSING_DOC_IDS[i];
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`Document ${i + 1} of ${MISSING_DOC_IDS.length}`);

    const result = await processDocument(docId);
    results.push({ docId, ...result });

    // Add delay between documents to avoid rate limits
    if (i < MISSING_DOC_IDS.length - 1) {
      console.log('\n   ⏸️  Waiting 3 seconds before next document...');
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);

  // Summary
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📊 RE-SYNC SUMMARY\n');
  console.log('═'.repeat(60));

  const totalChunks = results.reduce((sum, r) => sum + r.chunks_processed, 0);
  const totalUpserted = results.reduce((sum, r) => sum + (r.vectors_upserted || 0), 0);
  const successCount = results.filter(r => r.success).length;

  console.log(`Total documents processed:  ${MISSING_DOC_IDS.length}`);
  console.log(`Successful:                 ${successCount}`);
  console.log(`Failed:                     ${MISSING_DOC_IDS.length - successCount}`);
  console.log(`Total chunks processed:     ${totalChunks}`);
  console.log(`Total vectors upserted:     ${totalUpserted}`);
  console.log(`Total time:                 ${totalTime}s`);
  console.log('');

  // Show individual results
  results.forEach((result, i) => {
    const status = result.success ? '✅' : '❌';
    const docShort = result.docId.substring(0, 12);
    console.log(`${status} ${docShort}... - ${result.chunks_processed} chunks, ${result.vectors_upserted || 0} vectors`);
    if (result.error) {
      console.log(`   Error: ${result.error}`);
    }
  });

  console.log('');

  if (successCount === MISSING_DOC_IDS.length) {
    console.log('🎉 All documents successfully re-synced to Pinecone!');
    console.log('');
    console.log('Next steps:');
    console.log('  1. Verify vectors in Pinecone dashboard');
    console.log('  2. Test search functionality');
    console.log('  3. Run DIP processing if needed');
  } else {
    console.log('⚠️  Some documents failed to re-sync.');
    console.log('   Review errors above and retry failed documents.');
  }

  console.log('');
}

// Run the script
main()
  .then(() => {
    console.log('✅ Re-sync complete!\n');
    process.exit(0);
  })
  .catch(error => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });
