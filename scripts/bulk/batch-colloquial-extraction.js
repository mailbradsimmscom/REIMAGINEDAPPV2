#!/usr/bin/env node
/**
 * Bulk Colloquial Keyword Extraction
 *
 * Extracts colloquial keywords for existing documents and updates systems table
 * Follows same pattern as batch-dip-extraction scripts for CSV tracking
 *
 * Usage:
 *   node scripts/bulk/batch-colloquial-extraction.js [options]
 *
 * Options:
 *   --batch-size N    Process N documents at a time (default: 10)
 *   --dry-run         Preview what would be processed without doing it
 *   --test            Process just one document for testing
 *   --status          Show current processing status from CSV
 *   --force           Reprocess documents even if already completed
 *   --help            Show this help message
 *
 * Examples:
 *   # Test with one document
 *   node scripts/bulk/batch-colloquial-extraction.js --test
 *
 *   # Process 10 documents
 *   node scripts/bulk/batch-colloquial-extraction.js --batch-size 10
 *
 *   # Check status
 *   node scripts/bulk/batch-colloquial-extraction.js --status
 */

import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import { extractColloquialKeywords } from '../../src/services/colloquial-extraction.service.js';
import documentRepository from '../../src/repositories/document.repository.js';
import { logger } from '../../src/utils/logger.js';

const CSV_PATH = 'Rename/uploaded/uploaded_documents.csv';
const requestLogger = logger.createModuleLogger('bulk-colloquial');

// Parse command line arguments
const args = process.argv.slice(2);
const flags = {
  batchSize: 10,
  dryRun: args.includes('--dry-run'),
  test: args.includes('--test'),
  status: args.includes('--status'),
  force: args.includes('--force'),
  help: args.includes('--help')
};

// Parse batch size
const batchSizeIndex = args.indexOf('--batch-size');
if (batchSizeIndex !== -1 && args[batchSizeIndex + 1]) {
  flags.batchSize = parseInt(args[batchSizeIndex + 1], 10);
}

// Override batch size for test mode
if (flags.test) {
  flags.batchSize = 1;
}

// Show help
if (flags.help) {
  console.log(`
Bulk Colloquial Keyword Extraction

Usage:
  node scripts/bulk/batch-colloquial-extraction.js [options]

Options:
  --batch-size N    Process N documents at a time (default: 10)
  --dry-run         Preview what would be processed without doing it
  --test            Process just one document for testing
  --status          Show current processing status from CSV
  --force           Reprocess documents even if already completed
  --help            Show this help message

Examples:
  # Test with one document
  node scripts/bulk/batch-colloquial-extraction.js --test

  # Process 10 documents
  node scripts/bulk/batch-colloquial-extraction.js --batch-size 10

  # Check status
  node scripts/bulk/batch-colloquial-extraction.js --status
  `);
  process.exit(0);
}

// ============================================================================
// CSV FUNCTIONS
// ============================================================================

function readCsv() {
  if (!fs.existsSync(CSV_PATH)) {
    console.error(`❌ CSV file not found: ${CSV_PATH}`);
    process.exit(1);
  }

  const content = fs.readFileSync(CSV_PATH, 'utf-8');
  const rows = parse(content, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true
  });

  return rows;
}

function writeCsv(rows) {
  if (!rows || rows.length === 0) {
    return;
  }

  const content = stringify(rows, {
    header: true,
    quoted: true
  });

  fs.writeFileSync(CSV_PATH, content, 'utf-8');
}

function ensureColloquialColumns(rows) {
  if (!rows || rows.length === 0) {
    return rows;
  }

  const requiredColumns = [
    'colloquial_status',
    'colloquial_started_at',
    'colloquial_completed_at',
    'colloquial_keywords',
    'colloquial_keywords_count',
    'colloquial_tokens_used',
    'colloquial_cost_usd',
    'colloquial_error_message'
  ];

  for (const row of rows) {
    for (const col of requiredColumns) {
      if (!(col in row)) {
        row[col] = '';
      }
    }
  }

  return rows;
}

function showStatus(rows) {
  const stats = {
    total: rows.length,
    pending: rows.filter(r => !r.colloquial_status || r.colloquial_status === 'pending').length,
    processing: rows.filter(r => r.colloquial_status === 'processing').length,
    completed: rows.filter(r => r.colloquial_status === 'completed').length,
    failed: rows.filter(r => r.colloquial_status === 'failed').length
  };

  console.log('\n📊 COLLOQUIAL KEYWORD EXTRACTION STATUS\n');
  console.log(`Total documents:     ${stats.total}`);
  console.log(`✅ Completed:        ${stats.completed} (${(stats.completed/stats.total*100).toFixed(1)}%)`);
  console.log(`⏳ Processing:       ${stats.processing}`);
  console.log(`⏸️  Pending:          ${stats.pending}`);
  console.log(`❌ Failed:           ${stats.failed}`);

  if (stats.completed > 0) {
    const completedRows = rows.filter(r => r.colloquial_status === 'completed');
    const totalKeywordsCount = completedRows.reduce((sum, r) => sum + (parseInt(r.colloquial_keywords_count) || 0), 0);
    const totalTokens = completedRows.reduce((sum, r) => sum + (parseInt(r.colloquial_tokens_used) || 0), 0);
    const totalCost = completedRows.reduce((sum, r) => sum + (parseFloat(r.colloquial_cost_usd) || 0), 0);

    console.log(`\n📦 Extraction Totals:`);
    console.log(`Total keywords:      ${totalKeywordsCount}`);
    console.log(`Total tokens:        ${totalTokens.toLocaleString()}`);
    console.log(`Total cost:          $${totalCost.toFixed(4)}`);
  }

  if (stats.failed > 0) {
    console.log('\n❌ Failed Documents:');
    const failedRows = rows.filter(r => r.colloquial_status === 'failed');
    for (const r of failedRows.slice(0, 5)) {
      const errorMsg = (r.colloquial_error_message || 'Unknown error').substring(0, 100);
      console.log(`  - ${r.filename || 'unknown'}: ${errorMsg}`);
    }
    if (failedRows.length > 5) {
      console.log(`  ... and ${failedRows.length - 5} more`);
    }
  }

  return stats;
}

// ============================================================================
// PROCESSING FUNCTIONS
// ============================================================================

async function processDocument(row, index, total) {
  const { doc_id, manufacturer, model, asset_uid } = row;

  console.log(`\n${'='.repeat(80)}`);
  console.log(`[${index}/${total}] ${manufacturer} ${model}`);
  console.log(`Asset UID: ${asset_uid}`);
  console.log(`Doc ID: ${doc_id.substring(0, 16)}...`);
  console.log(`${'='.repeat(80)}`);

  const startTime = Date.now();
  let totalTokens = 0;

  try {
    // Extract colloquial keywords
    console.log('📥 Extracting colloquial keywords...');
    const keywords = await extractColloquialKeywords(manufacturer, model);

    if (!keywords || keywords.length === 0) {
      console.log('   ⚠️  No keywords extracted (likely no chunks found yet)');
      return {
        success: true,
        keywords: '',
        keywordsCount: 0,
        tokensUsed: 0,
        costUsd: 0
      };
    }

    // Count tokens (rough estimate: prompt + response)
    // Prompt is ~300 tokens + chunk text (limited to 8000 chars / ~2000 tokens) + response (~150 tokens)
    const estimatedPromptTokens = 300 + 2000; // prompt + chunks
    const estimatedResponseTokens = 150;
    totalTokens = estimatedPromptTokens + estimatedResponseTokens;

    // Calculate cost (GPT-4o-mini pricing: $0.150/1M input, $0.600/1M output)
    const inputCost = (estimatedPromptTokens / 1_000_000) * 0.15;
    const outputCost = (estimatedResponseTokens / 1_000_000) * 0.60;
    const totalCost = inputCost + outputCost;

    // Count keywords
    const keywordsArray = keywords.split(',').map(k => k.trim()).filter(k => k.length > 0);
    const keywordsCount = keywordsArray.length;

    console.log(`   ✓ Extracted ${keywordsCount} keywords`);
    console.log(`   ✓ Keywords: ${keywords.substring(0, 100)}${keywords.length > 100 ? '...' : ''}`);

    // Update systems table
    console.log('💾 Updating systems table...');
    await documentRepository.updateSystemColloquialKeywords(asset_uid, keywords);
    console.log('   ✓ Systems table updated');

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n✅ Document complete in ${duration}s`);
    console.log(`   Tokens: ${totalTokens.toLocaleString()}`);
    console.log(`   Cost: $${totalCost.toFixed(6)}`);

    return {
      success: true,
      keywords,
      keywordsCount,
      tokensUsed: totalTokens,
      costUsd: totalCost
    };

  } catch (error) {
    const errorType = error.constructor.name;
    const errorMsg = error.message;
    console.log(`\n❌ ${errorType}: ${errorMsg}`);

    return {
      success: false,
      error: `${errorType}: ${errorMsg}`
    };
  }
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log('🚀 Bulk Colloquial Keyword Extraction');
  console.log(`   CSV: ${CSV_PATH}`);
  if (!flags.status) {
    console.log(`   Batch size: ${flags.batchSize}`);
  }
  console.log();

  // Read CSV
  console.log('📖 Reading CSV...');
  let rows = readCsv();
  rows = ensureColloquialColumns(rows);

  // If --status flag, just show status and exit
  if (flags.status) {
    showStatus(rows);
    return;
  }

  // Filter docs that need processing
  let docsToProcess;
  if (flags.force) {
    docsToProcess = rows.filter(r => r.asset_uid && r.manufacturer && r.model);
  } else {
    docsToProcess = rows.filter(r => {
      const hasRequiredFields = r.asset_uid && r.manufacturer && r.model;
      const needsProcessing = !r.colloquial_status ||
                             r.colloquial_status === 'pending' ||
                             r.colloquial_status === 'failed' ||
                             r.colloquial_status === 'processing';
      return hasRequiredFields && needsProcessing;
    });
  }

  if (docsToProcess.length === 0) {
    console.log('✅ No documents need processing (all complete)');
    showStatus(rows);
    return;
  }

  // Apply batch size limit
  docsToProcess = docsToProcess.slice(0, flags.batchSize);

  console.log(`📋 Found ${docsToProcess.length} documents to process\n`);

  // Dry run - just show what would be processed
  if (flags.dryRun) {
    console.log('DRY RUN - Would process these documents:');
    for (let i = 0; i < docsToProcess.length; i++) {
      const row = docsToProcess[i];
      console.log(`  ${i + 1}. ${row.manufacturer} ${row.model} (${row.filename || 'unknown'})`);
    }
    console.log('\nNo actual processing performed (--dry-run mode)');
    return;
  }

  // Create backup
  const backupPath = CSV_PATH.replace('.csv', `_backup_${Math.floor(Date.now() / 1000)}.csv`);
  fs.copyFileSync(CSV_PATH, backupPath);
  console.log(`📁 Created backup: ${path.basename(backupPath)}\n`);

  // Process each document
  let processedCount = 0;
  let failedCount = 0;

  for (let i = 0; i < docsToProcess.length; i++) {
    const row = docsToProcess[i];

    // Mark as processing
    row.colloquial_status = 'processing';
    row.colloquial_started_at = new Date().toISOString();
    writeCsv(rows);

    // Process document
    const result = await processDocument(row, i + 1, docsToProcess.length);

    // Update CSV row
    if (result.success) {
      row.colloquial_status = 'completed';
      row.colloquial_completed_at = new Date().toISOString();
      row.colloquial_keywords = result.keywords;
      row.colloquial_keywords_count = result.keywordsCount;
      row.colloquial_tokens_used = result.tokensUsed;
      row.colloquial_cost_usd = result.costUsd.toFixed(6);
      row.colloquial_error_message = '';
      processedCount++;
    } else {
      row.colloquial_status = 'failed';
      row.colloquial_completed_at = new Date().toISOString();
      row.colloquial_error_message = result.error.substring(0, 500);
      failedCount++;
    }

    // Save CSV after each document
    writeCsv(rows);
    console.log('💾 CSV updated');

    // Small delay between documents
    if (i < docsToProcess.length - 1) {
      console.log('⏸️  Waiting 2 seconds before next document...');
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  // Final summary
  console.log(`\n${'='.repeat(80)}`);
  console.log('🎉 BATCH COMPLETE');
  console.log(`${'='.repeat(80)}`);
  console.log(`✅ Processed: ${processedCount}`);
  console.log(`❌ Failed: ${failedCount}`);
  console.log(`📄 CSV updated: ${CSV_PATH}`);

  // Show final status
  showStatus(rows);

  // Suggest next steps
  const remaining = rows.filter(r => !r.colloquial_status || r.colloquial_status === 'pending').length;
  if (remaining > 0) {
    console.log(`\n💡 Run again to process remaining ${remaining} documents`);
  } else if (processedCount > 0) {
    console.log('\n🎉 All documents processed!');
    console.log('Next steps:');
    console.log('  1. Verify colloquial_keywords populated in systems table');
    console.log('  2. Test search with colloquial terms');
    console.log('  3. Review cost totals in CSV');
  }
  console.log();
}

// Run main
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
