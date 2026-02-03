#!/usr/bin/env node
/**
 * Test script: Generate search_blob for doc_assets using cheap LLM
 *
 * Usage: node scripts/test-search-blob-generation.mjs [--dry-run] [--limit N]
 *
 * Options:
 *   --dry-run   Don't update DB, just show what would be generated
 *   --limit N   Process only first N assets (default: all)
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Parse CLI args
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const limitIdx = args.indexOf('--limit');
const limit = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : null;

const DOC_ID = '759ac8ff51c98c10358e2c0604c1ca73cf975023949d6e122f9af6e8cb32f061';

/**
 * Extract surrounding text snippet for an asset from LlamaParse data
 */
function extractSnippet(pageData, assetIndex, assetKind) {
  const items = pageData.items || [];
  const layout = pageData.layout || [];

  // Find layout elements of this kind (picture or table)
  const layoutLabel = assetKind === 'figure' ? 'picture' : 'table';
  const layoutElements = layout
    .filter(el => el.label === layoutLabel && !el.isLikelyNoise)
    .sort((a, b) => (a.bbox?.y || 0) - (b.bbox?.y || 0)); // Sort by y position

  if (assetIndex >= layoutElements.length) {
    return { snippet: '', context: 'Asset index out of range' };
  }

  const targetElement = layoutElements[assetIndex];
  const targetY = targetElement.bbox?.y || 0;

  // Collect all text items and their approximate positions
  const textItems = [];
  items.forEach((item, idx) => {
    if (item.type === 'heading' || item.type === 'text' || item.type === 'image') {
      textItems.push({
        idx,
        type: item.type,
        value: item.value || item.alt || '',
        // Items don't have reliable y positions, so we use index as proxy
      });
    }
  });

  // Find image items (these correlate with layout pictures)
  const imageItems = items
    .map((item, idx) => ({ ...item, idx }))
    .filter(item => item.type === 'image');

  // Build snippet from surrounding items
  const snippetParts = [];

  // If we have a corresponding image item, use it as anchor
  if (assetKind === 'figure' && assetIndex < imageItems.length) {
    const imageItem = imageItems[assetIndex];
    const imageIdx = imageItem.idx;

    // Get items before (up to 5, stop at previous image)
    for (let i = imageIdx - 1; i >= Math.max(0, imageIdx - 10); i--) {
      const item = items[i];
      if (item.type === 'image') break;
      if (item.type === 'heading') {
        snippetParts.unshift(`[HEADING] ${item.value}`);
        break; // Stop at heading
      }
      if (item.type === 'text' && item.value?.trim()) {
        snippetParts.unshift(`[TEXT] ${item.value.trim()}`);
      }
    }

    // Add the image reference
    if (imageItem.alt) {
      snippetParts.push(`[FIGURE REF] ${imageItem.alt}`);
    }

    // Get items after (up to 10, stop at next image or heading)
    for (let i = imageIdx + 1; i < Math.min(items.length, imageIdx + 15); i++) {
      const item = items[i];
      if (item.type === 'image' || item.type === 'heading') break;
      if (item.type === 'text' && item.value?.trim()) {
        snippetParts.push(`[TEXT] ${item.value.trim()}`);
      }
    }
  } else {
    // Fallback: just get nearby text items based on layout position
    // This is less accurate but better than nothing
    snippetParts.push('[NOTE] No direct item correlation available');

    // Grab some items from around the middle of the page
    const midIdx = Math.floor(items.length / 2);
    for (let i = Math.max(0, midIdx - 5); i < Math.min(items.length, midIdx + 10); i++) {
      const item = items[i];
      if (item.type === 'heading') {
        snippetParts.push(`[HEADING] ${item.value}`);
      } else if (item.type === 'text' && item.value?.trim()) {
        snippetParts.push(`[TEXT] ${item.value.trim().substring(0, 200)}`);
      }
    }
  }

  return {
    snippet: snippetParts.join('\n'),
    itemCount: snippetParts.length
  };
}

/**
 * Generate search_blob using OpenAI mini
 */
async function generateSearchBlob(asset, snippet) {
  const prompt = `You are helping make a technical diagram searchable. Given the following information about a figure/diagram from a marine equipment manual, write a concise searchable description (100-150 words max).

Include:
- What type of diagram this is (wiring diagram, exploded view, installation diagram, parts list, schematic, etc.)
- Key components or parts shown
- What system or equipment it relates to
- Any part numbers or references visible
- What a technician might search for to find this diagram

ASSET INFO:
- Page: ${asset.page_number}
- Type: ${asset.asset_kind}
- Title: ${asset.title || 'Unknown'}
- Figure Reference: ${asset.figure_reference || 'None'}
- Existing Description: ${asset.description || 'None'}

SURROUNDING TEXT FROM DOCUMENT:
${snippet || 'No surrounding text available'}

Write a natural, searchable description. Do not use bullet points. Do not repeat "this diagram shows" - just describe what it is.`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 300,
    temperature: 0.3
  });

  return response.choices[0]?.message?.content?.trim() || '';
}

async function main() {
  console.log('=== Search Blob Generation Test ===');
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE (will update DB)'}`);
  console.log(`Limit: ${limit || 'all'}`);
  console.log('');

  // 1. Fetch assets
  console.log('Fetching assets...');
  let query = supabase
    .from('doc_assets')
    .select('id, doc_id, page_number, asset_kind, asset_index, title, description, figure_reference')
    .eq('doc_id', DOC_ID)
    .order('page_number')
    .order('asset_index');

  if (limit) {
    query = query.limit(limit);
  }

  const { data: assets, error: assetsErr } = await query;

  if (assetsErr) {
    console.error('Failed to fetch assets:', assetsErr);
    process.exit(1);
  }

  console.log(`Found ${assets.length} assets`);

  // 2. Download LlamaParse data
  console.log('Downloading LlamaParse data...');
  const llamaparsePath = `manuals/${DOC_ID}/llamaparse_raw.json`;
  const { data: llamaparseBlob, error: dlErr } = await supabase.storage
    .from('documents')
    .download(llamaparsePath);

  if (dlErr) {
    console.error('Failed to download LlamaParse:', dlErr);
    process.exit(1);
  }

  const llamaparseText = await llamaparseBlob.text();
  const llamaparseData = JSON.parse(llamaparseText);
  console.log(`Loaded ${llamaparseData.pages?.length || 0} pages`);

  // 3. Process each asset
  console.log('');
  console.log('Processing assets...');

  let totalCost = 0;
  let successCount = 0;
  let errorCount = 0;
  const results = [];

  for (const asset of assets) {
    const pageData = llamaparseData.pages?.find(p => p.page === asset.page_number);

    if (!pageData) {
      console.log(`  Page ${asset.page_number} idx ${asset.asset_index}: No page data`);
      errorCount++;
      continue;
    }

    // Extract snippet
    const { snippet, itemCount } = extractSnippet(pageData, asset.asset_index, asset.asset_kind);

    console.log(`  Page ${asset.page_number} idx ${asset.asset_index} (${asset.asset_kind}): ${snippet.length} chars snippet`);

    try {
      // Generate search blob
      const searchBlob = await generateSearchBlob(asset, snippet);

      // Estimate cost (rough: ~1500 input + 200 output tokens)
      const estimatedCost = (1500 * 0.00000015) + (200 * 0.0000006);
      totalCost += estimatedCost;

      results.push({
        id: asset.id,
        page: asset.page_number,
        index: asset.asset_index,
        kind: asset.asset_kind,
        title: asset.title,
        figure_reference: asset.figure_reference,
        search_blob: searchBlob,
        snippet_length: snippet.length
      });

      // Update DB if not dry run
      if (!dryRun) {
        const { error: updateErr } = await supabase
          .from('doc_assets')
          .update({ search_blob: searchBlob })
          .eq('id', asset.id);

        if (updateErr) {
          console.error(`    Failed to update: ${updateErr.message}`);
          errorCount++;
        } else {
          successCount++;
        }
      } else {
        successCount++;
      }

      // Show preview
      console.log(`    Generated: "${searchBlob.substring(0, 100)}..."`);

    } catch (err) {
      console.error(`    Error: ${err.message}`);
      errorCount++;
    }

    // Small delay to avoid rate limits
    await new Promise(r => setTimeout(r, 100));
  }

  // 4. Summary
  console.log('');
  console.log('=== SUMMARY ===');
  console.log(`Total assets: ${assets.length}`);
  console.log(`Successful: ${successCount}`);
  console.log(`Errors: ${errorCount}`);
  console.log(`Estimated cost: $${totalCost.toFixed(4)}`);

  if (dryRun) {
    console.log('');
    console.log('=== SAMPLE RESULTS (first 5) ===');
    results.slice(0, 5).forEach(r => {
      console.log('');
      console.log(`Page ${r.page} ${r.kind} ${r.index}:`);
      console.log(`  Title: ${r.title || 'null'}`);
      console.log(`  FigRef: ${r.figure_reference || 'null'}`);
      console.log(`  Search Blob: ${r.search_blob}`);
    });
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
