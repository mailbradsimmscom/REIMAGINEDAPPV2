// scripts/check-chunks-size.js
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

/**
 * Analyze document_chunks table size and estimate Anthropic costs
 */
async function checkChunksSize() {
  console.log('🔍 Analyzing document_chunks table...\n');

  try {
    // Get total count first
    const { count: totalCount, error: countError } = await supabase
      .from('document_chunks')
      .select('*', { count: 'exact', head: true });

    if (countError) {
      console.error('❌ Error counting chunks:', countError);
      return;
    }

    console.log(`Found ${totalCount?.toLocaleString()} chunks in database. Fetching all...\n`);

    // Fetch all chunks with pagination
    const PAGE_SIZE = 1000;
    const chunks = [];

    for (let page = 0; page * PAGE_SIZE < totalCount; page++) {
      const { data, error } = await supabase
        .from('document_chunks')
        .select('text, doc_id')
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      if (error) {
        console.error('❌ Error fetching chunks:', error);
        return;
      }

      chunks.push(...data);
      console.log(`  Fetched ${chunks.length.toLocaleString()} / ${totalCount.toLocaleString()} chunks...`);
    }

    console.log('✓ All chunks loaded\n');

    if (!chunks || chunks.length === 0) {
      console.log('⚠️  No chunks found in document_chunks table');
      return;
    }

    // Calculate sizes
    const totalChunks = chunks.length;
    const totalBytes = chunks.reduce((sum, chunk) => {
      return sum + (chunk.text?.length || 0);
    }, 0);

    const totalKB = (totalBytes / 1024).toFixed(2);
    const totalMB = (totalBytes / 1024 / 1024).toFixed(2);
    const avgChunkBytes = Math.round(totalBytes / totalChunks);
    const avgChunkKB = (avgChunkBytes / 1024).toFixed(2);

    // Rough token estimate (1 token ≈ 4 chars for English text)
    const estimatedTokens = Math.round(totalBytes / 4);
    const tokensPerChunk = Math.round(estimatedTokens / totalChunks);

    // Group by document
    const docStats = {};
    chunks.forEach(chunk => {
      if (!docStats[chunk.doc_id]) {
        docStats[chunk.doc_id] = { count: 0, bytes: 0 };
      }
      docStats[chunk.doc_id].count++;
      docStats[chunk.doc_id].bytes += (chunk.text?.length || 0);
    });

    const totalDocs = Object.keys(docStats).length;
    const avgChunksPerDoc = Math.round(totalChunks / totalDocs);

    // Find largest and smallest docs
    const docArray = Object.entries(docStats).map(([doc_id, stats]) => ({
      doc_id,
      chunks: stats.count,
      mb: (stats.bytes / 1024 / 1024).toFixed(2)
    }));
    docArray.sort((a, b) => b.chunks - a.chunks);

    // Print results
    console.log('📊 CHUNKS SIZE ANALYSIS');
    console.log('═'.repeat(60));
    console.log(`Total documents:        ${totalDocs}`);
    console.log(`Total chunks:           ${totalChunks.toLocaleString()}`);
    console.log(`Avg chunks per doc:     ${avgChunksPerDoc}`);
    console.log('');
    console.log(`Total size:             ${totalMB} MB (${totalKB} KB)`);
    console.log(`Average chunk size:     ${avgChunkKB} KB (${avgChunkBytes.toLocaleString()} bytes)`);
    console.log('');
    console.log(`Estimated tokens:       ${estimatedTokens.toLocaleString()}`);
    console.log(`Avg tokens per chunk:   ${tokensPerChunk.toLocaleString()}`);
    console.log('');

    // Document size distribution
    console.log('📈 DOCUMENT SIZE DISTRIBUTION');
    console.log('═'.repeat(60));
    console.log('Largest documents:');
    docArray.slice(0, 5).forEach((doc, i) => {
      console.log(`  ${i + 1}. ${doc.doc_id.substring(0, 12)}... - ${doc.chunks} chunks (${doc.mb} MB)`);
    });
    console.log('');
    console.log('Smallest documents:');
    docArray.slice(-5).reverse().forEach((doc, i) => {
      console.log(`  ${i + 1}. ${doc.doc_id.substring(0, 12)}... - ${doc.chunks} chunks (${doc.mb} MB)`);
    });
    console.log('');

    // Anthropic cost estimates
    console.log('💰 ANTHROPIC BATCH API COST ESTIMATES');
    console.log('═'.repeat(60));

    // Claude Sonnet 4.5 pricing (as of Oct 2024)
    const inputCostPer1M = 3.00;  // $3 per million input tokens
    const outputCostPer1M = 15.00; // $15 per million output tokens
    const batchDiscount = 0.5; // 50% off for batch API

    // Estimate output tokens (assume 20% of input for extraction tasks)
    const estimatedOutputTokens = Math.round(estimatedTokens * 0.2);

    // Calculate costs
    const inputCostFullPrice = (estimatedTokens / 1_000_000) * inputCostPer1M;
    const outputCostFullPrice = (estimatedOutputTokens / 1_000_000) * outputCostPer1M;
    const totalFullPrice = inputCostFullPrice + outputCostFullPrice;

    const inputCostWithBatch = inputCostFullPrice * batchDiscount;
    const outputCostWithBatch = outputCostFullPrice * batchDiscount;
    const totalWithBatch = inputCostWithBatch + outputCostWithBatch;

    console.log('Model: Claude Sonnet 4.5');
    console.log('');
    console.log('Per extraction pass (ONE of: specs, golden, intent, procedures):');
    console.log(`  Input tokens:   ${estimatedTokens.toLocaleString()}`);
    console.log(`  Output tokens:  ${estimatedOutputTokens.toLocaleString()} (estimated)`);
    console.log(`  Full price:     $${totalFullPrice.toFixed(2)}`);
    console.log(`  Batch API:      $${totalWithBatch.toFixed(2)} (50% off)`);
    console.log('');

    // Option A: Multi-task in one batch
    const optionACost = totalWithBatch;

    // Option B: 4 separate batches
    const optionBCost = totalWithBatch * 4;

    // Current approach (4 scripts, no batching, no caching)
    const currentCost = totalFullPrice * 4;

    console.log('COMPARISON:');
    console.log('─'.repeat(60));
    console.log(`Current approach (4 scripts, real-time):     $${currentCost.toFixed(2)}`);
    console.log(`Option A (1 batch, multi-task):              $${optionACost.toFixed(2)}`);
    console.log(`Option B (4 batches, separate):              $${optionBCost.toFixed(2)}`);
    console.log('');
    console.log(`💡 Option A saves:  $${(currentCost - optionACost).toFixed(2)} (${Math.round(((currentCost - optionACost) / currentCost) * 100)}%)`);
    console.log(`💡 Option B saves:  $${(currentCost - optionBCost).toFixed(2)} (${Math.round(((currentCost - optionBCost) / currentCost) * 100)}%)`);
    console.log('');

    console.log('📝 NOTES:');
    console.log('─'.repeat(60));
    console.log('• Token estimates are rough (1 token ≈ 4 chars)');
    console.log('• Output token estimate assumes 20% of input');
    console.log('• Actual costs may vary based on prompt complexity');
    console.log('• Batch API has up to 24-hour processing time');
    console.log('• Option A requires multi-task prompt engineering');
    console.log('• Option B sends chunks 4x (more expensive but simpler)');
    console.log('');

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

// Run the analysis
console.log('🚀 Document Chunks Size Analyzer\n');
checkChunksSize()
  .then(() => {
    console.log('✅ Analysis complete!\n');
    process.exit(0);
  })
  .catch(error => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });
