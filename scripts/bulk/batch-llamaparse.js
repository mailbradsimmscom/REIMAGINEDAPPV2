#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import { createClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';
import FormData from 'form-data';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from project root
const projectRoot = path.join(path.dirname(new URL(import.meta.url).pathname), '../..');
dotenv.config({ path: path.join(projectRoot, '.env') });

// Configuration
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const PYTHON_SIDECAR_URL = process.env.PYTHON_SIDECAR_URL || 'http://localhost:8000';

// CSV file location
const CSV_FILE = '/Users/brad/code/REIMAGINEDAPPV2/Rename/uploaded/uploaded_documents.csv';
const CSV_BACKUP = CSV_FILE.replace('.csv', `_backup_${Date.now()}.csv`);

// Parse command line arguments
const args = process.argv.slice(2);
const flags = {
  batchSize: 5,
  dryRun: false,
  test: false,
  status: false,
  force: false
};

// Parse arguments
for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case '--batch-size':
      flags.batchSize = parseInt(args[++i]) || 5;
      break;
    case '--dry-run':
      flags.dryRun = true;
      break;
    case '--test':
      flags.test = true;
      flags.batchSize = 1;
      break;
    case '--status':
      flags.status = true;
      break;
    case '--force':
      flags.force = true;
      break;
    case '--help':
      showHelp();
      process.exit(0);
  }
}

function showHelp() {
  console.log(`
📚 Batch LlamaParse Processing Script

Usage: node batch-llamaparse.js [options]

Options:
  --batch-size N   Process N documents at a time (default: 5)
  --dry-run        Preview what would be processed without doing it
  --test           Process just one document for testing
  --status         Show current processing status from CSV
  --force          Reprocess documents even if already completed
  --help           Show this help message

Examples:
  node batch-llamaparse.js --batch-size 10    # Process 10 documents at a time
  node batch-llamaparse.js --test             # Test with 1 document
  node batch-llamaparse.js --dry-run          # Preview what would be processed
  node batch-llamaparse.js --status           # Show processing statistics
`);
}

// Initialize Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Add processing columns to CSV data if they don't exist
function enhanceCSVData(records) {
  return records.map(record => ({
    ...record,
    parse_status: record.parse_status || 'pending',
    parse_started_at: record.parse_started_at || '',
    parse_completed_at: record.parse_completed_at || '',
    chunks_processed: record.chunks_processed || '',
    vectors_upserted: record.vectors_upserted || '',
    chunks_in_db: record.chunks_in_db || '',
    chunks_in_storage: record.chunks_in_storage || '',
    chunking_strategy: record.chunking_strategy || '',
    error_message: record.error_message || ''
  }));
}

// Show processing status
function showStatus(records) {
  const stats = {
    total: records.length,
    pending: records.filter(r => r.parse_status === 'pending' || !r.parse_status).length,
    processing: records.filter(r => r.parse_status === 'processing').length,
    completed: records.filter(r => r.parse_status === 'completed').length,
    failed: records.filter(r => r.parse_status === 'failed').length
  };

  console.log('\n📊 PROCESSING STATUS\n');
  console.log(`Total documents:     ${stats.total}`);
  console.log(`✅ Completed:        ${stats.completed} (${((stats.completed/stats.total)*100).toFixed(1)}%)`);
  console.log(`⏳ Processing:       ${stats.processing}`);
  console.log(`⏸️  Pending:          ${stats.pending}`);
  console.log(`❌ Failed:           ${stats.failed}`);

  if (stats.completed > 0) {
    const completedRecords = records.filter(r => r.parse_status === 'completed');
    const totalChunks = completedRecords.reduce((sum, r) => sum + (parseInt(r.chunks_processed) || 0), 0);
    const totalVectors = completedRecords.reduce((sum, r) => sum + (parseInt(r.vectors_upserted) || 0), 0);

    console.log(`\n📦 Processing Totals:`);
    console.log(`Total chunks created:  ${totalChunks}`);
    console.log(`Total vectors in Pinecone: ${totalVectors}`);
  }

  if (stats.failed > 0) {
    console.log('\n❌ Failed Documents:');
    records.filter(r => r.parse_status === 'failed').forEach(r => {
      console.log(`  - ${r.filename}: ${r.error_message}`);
    });
  }

  return stats;
}

// Download file from Supabase storage
async function downloadFromStorage(storagePath) {
  try {
    // storage_path format: manuals/{doc_id}/{filename}
    // We need to download from documents bucket
    const { data, error } = await supabase.storage
      .from('documents')
      .download(storagePath);

    if (error) {
      throw error;
    }

    // Convert blob to buffer
    const arrayBuffer = await data.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (error) {
    console.error(`Failed to download from storage: ${error.message}`);
    throw error;
  }
}

// Process a single document
async function processDocument(record) {
  const startTime = Date.now();

  try {
    console.log(`\n📄 Processing: ${record.filename}`);
    console.log(`   Doc ID: ${record.doc_id}`);
    console.log(`   Storage path: ${record.storage_path}`);

    // Download PDF from storage
    console.log('   📥 Downloading from Supabase storage...');
    const fileBuffer = await downloadFromStorage(record.storage_path);
    console.log(`   ✓ Downloaded ${(fileBuffer.length / 1024 / 1024).toFixed(2)} MB`);

    // Prepare form data for Python sidecar
    const formData = new FormData();

    // Add file
    formData.append('file', fileBuffer, {
      filename: record.filename,
      contentType: 'application/pdf'
    });

    // Add metadata (matching what document.service.js sends)
    const metadata = {
      doc_id: record.doc_id,
      manufacturer: record.manufacturer,
      model: record.model,
      revision_date: null,
      language: 'en',
      job_id: `batch_${Date.now()}`,
      file_name: record.filename,
      asset_uid: record.asset_uid
    };
    formData.append('doc_metadata', JSON.stringify(metadata));

    // Add processing options
    formData.append('extract_tables', 'true');
    formData.append('ocr_enabled', 'false'); // Set to false for speed, change if needed

    // Call Python sidecar
    console.log('   🐍 Calling Python /v1/process-document...');
    const response = await fetch(`${PYTHON_SIDECAR_URL}/v1/process-document`, {
      method: 'POST',
      body: formData,
      headers: formData.getHeaders(),
      timeout: 1200000 // 20 minute timeout
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Python sidecar error: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    const processingTime = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log(`   ✅ Success!`);
    console.log(`      - Chunks processed: ${result.chunks_processed}`);
    console.log(`      - Vectors upserted: ${result.vectors_upserted}`);
    console.log(`      - Chunks in DB: ${result.chunks_written_db}`);
    console.log(`      - Chunks in storage: ${result.chunks_written_storage}`);
    console.log(`      - Strategy: ${result.chunking_strategy}`);
    console.log(`      - Processing time: ${processingTime}s`);

    // Update record with success
    record.parse_status = 'completed';
    record.parse_completed_at = new Date().toISOString();
    record.chunks_processed = result.chunks_processed;
    record.vectors_upserted = result.vectors_upserted;
    record.chunks_in_db = result.chunks_written_db;
    record.chunks_in_storage = result.chunks_written_storage;
    record.chunking_strategy = result.chunking_strategy;
    record.error_message = '';

    return { success: true, record };

  } catch (error) {
    console.error(`   ❌ Error: ${error.message}`);

    // Update record with failure
    record.parse_status = 'failed';
    record.parse_completed_at = new Date().toISOString();
    record.error_message = error.message.substring(0, 500); // Truncate long errors

    return { success: false, record, error: error.message };
  }
}

// Main processing function
async function processBatch() {
  try {
    // Check if CSV exists
    if (!existsSync(CSV_FILE)) {
      console.error(`❌ CSV file not found: ${CSV_FILE}`);
      console.log('Please run batch-upload-pdfs.js first to create the CSV.');
      process.exit(1);
    }

    // Read and parse CSV
    const csvContent = readFileSync(CSV_FILE, 'utf-8');
    let records = parse(csvContent, {
      columns: true,
      skip_empty_lines: true
    });

    console.log(`📋 Loaded ${records.length} documents from CSV\n`);

    // Enhance records with processing columns
    records = enhanceCSVData(records);

    // If --status flag, just show status and exit
    if (flags.status) {
      showStatus(records);
      return;
    }

    // Create backup before processing
    if (!flags.dryRun) {
      writeFileSync(CSV_BACKUP, csvContent);
      console.log(`📁 Created backup: ${path.basename(CSV_BACKUP)}\n`);
    }

    // Filter records to process
    let toProcess = records.filter(r => {
      if (flags.force) return true;
      return !r.parse_status || r.parse_status === 'pending' || r.parse_status === 'failed';
    });

    if (toProcess.length === 0) {
      console.log('✅ All documents already processed!');
      showStatus(records);
      return;
    }

    // Apply batch size limit
    const batchSize = flags.test ? 1 : flags.batchSize;
    toProcess = toProcess.slice(0, batchSize);

    console.log(`🔄 Processing ${toProcess.length} documents (batch size: ${batchSize})\n`);

    // Dry run - just show what would be processed
    if (flags.dryRun) {
      console.log('DRY RUN - Would process these documents:');
      toProcess.forEach((r, i) => {
        console.log(`  ${i + 1}. ${r.filename} (${r.manufacturer} ${r.model})`);
      });
      console.log('\nNo actual processing performed (--dry-run mode)');
      return;
    }

    // Process documents
    const results = {
      success: 0,
      failed: 0,
      errors: []
    };

    for (let i = 0; i < toProcess.length; i++) {
      const record = toProcess[i];
      console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`Processing ${i + 1}/${toProcess.length}`);

      // Mark as processing and save
      record.parse_status = 'processing';
      record.parse_started_at = new Date().toISOString();

      // Update the record in the main array
      const index = records.findIndex(r => r.doc_id === record.doc_id);
      records[index] = record;

      // Save progress after marking as processing
      const updatedCSV = stringify(records, { header: true });
      writeFileSync(CSV_FILE, updatedCSV);

      // Process the document
      const result = await processDocument(record);

      if (result.success) {
        results.success++;
        records[index] = result.record;
      } else {
        results.failed++;
        results.errors.push({ filename: record.filename, error: result.error });
        records[index] = result.record;
      }

      // Save progress after each document
      const progressCSV = stringify(records, { header: true });
      writeFileSync(CSV_FILE, progressCSV);
      console.log('   💾 Progress saved to CSV');

      // Add delay between documents to avoid overloading
      if (i < toProcess.length - 1) {
        console.log('   ⏸️  Waiting 2 seconds before next document...');
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    // Final summary
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📊 BATCH PROCESSING COMPLETE\n');
    console.log(`✅ Successful: ${results.success}`);
    console.log(`❌ Failed:     ${results.failed}`);

    if (results.errors.length > 0) {
      console.log('\n❌ Errors:');
      results.errors.forEach(e => {
        console.log(`  - ${e.filename}: ${e.error}`);
      });
    }

    // Show final status
    console.log('\n');
    showStatus(records);

    // Suggest next steps
    const remaining = records.filter(r => !r.parse_status || r.parse_status === 'pending').length;
    if (remaining > 0) {
      console.log(`\n💡 Run again to process remaining ${remaining} documents`);
    } else if (results.success > 0) {
      console.log('\n🎉 All documents processed!');
      console.log('Next steps:');
      console.log('  1. Review the results in the CSV');
      console.log('  2. Check Pinecone dashboard for vectors');
      console.log('  3. Verify document_chunks table in Supabase');
      console.log('  4. When ready, run DIP processing for these documents');
    }

  } catch (error) {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  }
}

// Check Python sidecar health before starting
async function checkPythonSidecar() {
  try {
    const response = await fetch(`${PYTHON_SIDECAR_URL}/health`);
    if (!response.ok) {
      throw new Error(`Health check failed: ${response.status}`);
    }
    const health = await response.json();
    console.log('✅ Python sidecar is healthy:', health.status);
    return true;
  } catch (error) {
    console.error('❌ Python sidecar is not running!');
    console.log(`   Please start it first: cd python-sidecar && python3 -m app.main`);
    console.log(`   Expected URL: ${PYTHON_SIDECAR_URL}`);
    return false;
  }
}

// Main execution
async function main() {
  console.log('🚀 Batch LlamaParse Processing Script\n');

  // Check Python sidecar
  const sidecarHealthy = await checkPythonSidecar();
  if (!sidecarHealthy) {
    process.exit(1);
  }

  // Check Supabase credentials
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('❌ Missing Supabase credentials in environment');
    console.log('   Required: SUPABASE_URL and SUPABASE_SERVICE_KEY');
    process.exit(1);
  }

  console.log(`📍 Using Python sidecar at: ${PYTHON_SIDECAR_URL}`);
  console.log(`📍 Using Supabase at: ${SUPABASE_URL}\n`);

  // Run batch processing
  await processBatch();
}

// Run the script
main().catch(console.error);