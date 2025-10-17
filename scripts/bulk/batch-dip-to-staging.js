#!/usr/bin/env node

/**
 * Batch DIP to Staging - Copy DIP extraction files from storage to staging tables
 *
 * This script reads DIP extraction JSON files from Supabase storage and inserts them
 * into the staging tables, exactly mirroring the production dip.ingest.service.js
 *
 * Usage:
 *   node scripts/bulk/batch-dip-to-staging.js [options]
 *
 * Options:
 *   --doc-id <id>      Process specific document by doc_id
 *   --limit <n>        Process only N documents (default: all)
 *   --dry-run          Preview what would be processed without doing it
 *   --force            Reprocess even if already in staging
 *   --status           Show current staging status from CSV
 *   --help             Show this help message
 *
 * Examples:
 *   node scripts/bulk/batch-dip-to-staging.js --limit 5
 *   node scripts/bulk/batch-dip-to-staging.js --doc-id 174f0beb475c39ef...
 *   node scripts/bulk/batch-dip-to-staging.js --dry-run
 *   node scripts/bulk/batch-dip-to-staging.js --status
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import csv from 'csv-parser';
import { createObjectCsvWriter } from 'csv-writer';
import path from 'path';
import 'dotenv/config';

// Configuration
const CSV_PATH = 'Rename/uploaded/uploaded_documents.csv';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

// Validate environment
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing Supabase credentials (SUPABASE_URL, SUPABASE_SERVICE_KEY)');
  process.exit(1);
}

// Initialize Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Parse command line arguments
const args = process.argv.slice(2);
const options = {
  docId: null,
  limit: null,
  dryRun: false,
  force: false,
  status: false,
  help: false
};

for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case '--doc-id':
      options.docId = args[++i];
      break;
    case '--limit':
      options.limit = parseInt(args[++i]);
      break;
    case '--dry-run':
      options.dryRun = true;
      break;
    case '--force':
      options.force = true;
      break;
    case '--status':
      options.status = true;
      break;
    case '--help':
      options.help = true;
      break;
  }
}

// Show help if requested
if (options.help) {
  console.log(`
Batch DIP to Staging - Copy DIP extraction files from storage to staging tables

Usage:
  node scripts/bulk/batch-dip-to-staging.js [options]

Options:
  --doc-id <id>      Process specific document by doc_id
  --limit <n>        Process only N documents (default: all)
  --dry-run          Preview what would be processed without doing it
  --force            Reprocess even if already in staging
  --status           Show current staging status from CSV
  --help             Show this help message

Examples:
  node scripts/bulk/batch-dip-to-staging.js --limit 5
  node scripts/bulk/batch-dip-to-staging.js --doc-id 174f0beb475c39ef...
  node scripts/bulk/batch-dip-to-staging.js --dry-run
  node scripts/bulk/batch-dip-to-staging.js --status
`);
  process.exit(0);
}

/**
 * Read CSV file and return parsed data
 */
async function readCSV() {
  return new Promise((resolve, reject) => {
    const results = [];
    if (!fs.existsSync(CSV_PATH)) {
      reject(new Error(`CSV file not found: ${CSV_PATH}`));
      return;
    }

    fs.createReadStream(CSV_PATH)
      .pipe(csv())
      .on('data', (data) => results.push(data))
      .on('end', () => resolve(results))
      .on('error', reject);
  });
}

/**
 * Write updated CSV data
 */
async function writeCSV(documents) {
  // Get headers from first document
  if (!documents || documents.length === 0) return;

  const headers = Object.keys(documents[0]).map(key => ({
    id: key,
    title: key
  }));

  const csvWriter = createObjectCsvWriter({
    path: CSV_PATH,
    header: headers
  });

  await csvWriter.writeRecords(documents);
}

/**
 * Show staging status from CSV
 */
function showStatus(documents) {
  const stats = {
    total: documents.length,
    dipCompleted: 0,
    stagingPending: 0,
    stagingCompleted: 0,
    stagingFailed: 0
  };

  documents.forEach(doc => {
    if (doc.dip_status === 'completed') {
      stats.dipCompleted++;

      if (!doc.staging_status || doc.staging_status === 'pending') {
        stats.stagingPending++;
      } else if (doc.staging_status === 'completed') {
        stats.stagingCompleted++;
      } else if (doc.staging_status === 'failed') {
        stats.stagingFailed++;
      }
    }
  });

  console.log('\n📊 STAGING STATUS');
  console.log('=' .repeat(50));
  console.log(`Total documents:         ${stats.total}`);
  console.log(`DIP completed:           ${stats.dipCompleted}`);
  console.log(`Ready for staging:       ${stats.stagingPending}`);
  console.log(`✅ Staging completed:    ${stats.stagingCompleted}`);
  console.log(`❌ Staging failed:       ${stats.stagingFailed}`);
  console.log('=' .repeat(50));
}

/**
 * Fetch JSON from Supabase Storage
 */
async function fetchJsonFromStorage(storagePath) {
  try {
    const { data, error } = await supabase.storage
      .from('documents')
      .download(storagePath);

    if (error) {
      if (error.message.includes('404') || error.message.includes('not found')) {
        return null;
      }
      throw error;
    }

    if (!data) {
      return null;
    }

    const text = await data.text();
    return JSON.parse(text);
  } catch (error) {
    console.error(`  ❌ Failed to fetch ${storagePath}: ${error.message}`);
    return null;
  }
}

/**
 * Process spec_suggestions and insert into staging table
 */
async function processSpecSuggestions(docId, storagePath, systemMetadata) {
  const jsonData = await fetchJsonFromStorage(storagePath);

  if (!jsonData || !jsonData.specifications || !Array.isArray(jsonData.specifications)) {
    return 0;
  }

  // Clean up existing rows for this doc_id
  await supabase
    .from('staging_spec_suggestions')
    .delete()
    .eq('doc_id', docId);

  // Prepare insert data (mirroring production exactly)
  const insertData = jsonData.specifications
    .filter(item => item.parameter) // Skip invalid items
    .map(item => {
      // Convert value to number if possible
      let convertedValue = null;
      if (item.converted_value !== undefined && item.converted_value !== null) {
        convertedValue = item.converted_value;
      } else if (item.value && item.value !== '.' && item.value !== 'N/A' && item.value !== '---') {
        const numValue = parseFloat(item.value);
        if (!isNaN(numValue)) {
          convertedValue = numValue;
        }
      }

      return {
        doc_id: docId,
        manufacturer_norm: systemMetadata?.manufacturer_norm || null,
        model_norm: systemMetadata?.model_norm || null,
        asset_uid: systemMetadata?.asset_uid || null,
        description: item.models ? item.models.join(', ') : '',
        parameter: item.parameter || '',
        normalized_parameter: item.normalized_parameter || '',
        parameter_aliases: item.parameter_aliases || [],
        value: item.value || '',
        range: item.range || '',
        units: item.units || item.unit || '',
        normalized_units: item.normalized_units || '',
        converted_value: convertedValue,
        category: item.category || '',
        search_terms: item.search_terms || [],
        concept_group: item.concept_group || '',
        references: item.references || [],
        status: 'pending'
      };
    });

  if (insertData.length === 0) {
    return 0;
  }

  // Batch insert
  const { error } = await supabase
    .from('staging_spec_suggestions')
    .insert(insertData);

  if (error) {
    throw new Error(`Failed to insert spec_suggestions: ${error.message}`);
  }

  return insertData.length;
}

/**
 * Process playbook_hints (procedures) and insert into staging table
 */
async function processPlaybookHints(docId, storagePath, systemMetadata) {
  const jsonData = await fetchJsonFromStorage(storagePath);

  // Note: File contains 'procedures' but table expects 'playbook_hints'
  const procedures = jsonData?.procedures || jsonData?.playbook_hints;

  if (!procedures || !Array.isArray(procedures)) {
    return 0;
  }

  // Clean up existing rows for this doc_id
  await supabase
    .from('staging_playbook_hints')
    .delete()
    .eq('doc_id', docId);

  // Prepare insert data (mirroring production exactly)
  const insertData = procedures
    .filter(item => item.title) // Skip invalid items
    .map(item => ({
      doc_id: docId,
      manufacturer_norm: systemMetadata?.manufacturer_norm || null,
      model_norm: systemMetadata?.model_norm || null,
      asset_uid: systemMetadata?.asset_uid || null,
      description: item.models ? item.models.join(', ') : '',
      title: item.title || 'Untitled Procedure',
      steps: Array.isArray(item.steps) ? item.steps : [],
      expected_outcome: item.expected_outcome || null,
      preconditions: Array.isArray(item.preconditions) ? item.preconditions : [],
      error_codes: Array.isArray(item.error_codes) ? item.error_codes : [],
      status: 'pending'
    }));

  if (insertData.length === 0) {
    return 0;
  }

  // Batch insert
  const { error } = await supabase
    .from('staging_playbook_hints')
    .insert(insertData);

  if (error) {
    throw new Error(`Failed to insert playbook_hints: ${error.message}`);
  }

  return insertData.length;
}

/**
 * Process intent_router and insert into staging table
 */
async function processIntentRouter(docId, storagePath, systemMetadata) {
  const jsonData = await fetchJsonFromStorage(storagePath);

  if (!jsonData || !jsonData.intent_routes || !Array.isArray(jsonData.intent_routes)) {
    return 0;
  }

  // Clean up existing rows for this doc_id
  await supabase
    .from('staging_intent_router')
    .delete()
    .eq('doc_id', docId);

  // Prepare insert data (mirroring production exactly)
  const insertData = jsonData.intent_routes
    .filter(item => item.question) // Skip invalid items
    .map(item => ({
      doc_id: docId,
      manufacturer_norm: systemMetadata?.manufacturer_norm || null,
      model_norm: systemMetadata?.model_norm || null,
      asset_uid: systemMetadata?.asset_uid || null,
      description: item.models ? item.models.join(', ') : '',
      question: item.question || '',
      question_variations: item.question_variations || [],
      answer: item.answer || '',
      question_type: item.question_type || '',
      references: item.references || [],
      created_by: 'system',
      status: 'pending'
    }));

  if (insertData.length === 0) {
    return 0;
  }

  // Batch insert
  const { error } = await supabase
    .from('staging_intent_router')
    .insert(insertData);

  if (error) {
    throw new Error(`Failed to insert intent_router: ${error.message}`);
  }

  return insertData.length;
}

/**
 * Process golden_tests and insert into staging table
 */
async function processGoldenTests(docId, storagePath, systemMetadata) {
  const jsonData = await fetchJsonFromStorage(storagePath);

  if (!jsonData || !jsonData.golden_rules || !Array.isArray(jsonData.golden_rules)) {
    return 0;
  }

  // Clean up existing rows for this doc_id
  await supabase
    .from('staging_golden_tests')
    .delete()
    .eq('doc_id', docId);

  // Prepare insert data (mirroring production exactly)
  const insertData = jsonData.golden_rules
    .filter(item => item.query) // Skip invalid items
    .map(item => ({
      doc_id: docId,
      manufacturer_norm: systemMetadata?.manufacturer_norm || null,
      model_norm: systemMetadata?.model_norm || null,
      asset_uid: systemMetadata?.asset_uid || null,
      description: item.models ? item.models.join(', ') : '',
      query: item.query || '',
      expected: item.expected_value || '',
      test_method: item.test_method || '',
      failure_indication: item.failure_indication || '',
      related_procedures: item.related_procedures || [],
      status: 'pending'
    }));

  if (insertData.length === 0) {
    return 0;
  }

  // Batch insert
  const { error } = await supabase
    .from('staging_golden_tests')
    .insert(insertData);

  if (error) {
    throw new Error(`Failed to insert golden_tests: ${error.message}`);
  }

  return insertData.length;
}

/**
 * Process a single document
 */
async function processDocument(doc, dryRun = false) {
  const docId = doc.doc_id;

  console.log(`\n${'='.repeat(80)}`);
  console.log(`Processing: ${doc.manufacturer} - ${doc.model}`);
  console.log(`Doc ID: ${docId.substring(0, 16)}...`);
  console.log(`${'='.repeat(80)}`);

  if (dryRun) {
    console.log('  🔍 [DRY RUN] Would process this document');
    return { success: true, dryRun: true };
  }

  const results = {
    specs: 0,
    playbook: 0,
    intent: 0,
    golden: 0
  };

  try {
    // Get system metadata
    const systemMetadata = {
      manufacturer_norm: doc.manufacturer,
      model_norm: doc.model,
      asset_uid: doc.asset_uid
    };

    // Process each DIP file
    const basePath = `manuals/${docId}/DIP`;

    // 1. Spec Suggestions
    console.log('\n  📋 Processing specifications...');
    const specsPath = `${basePath}/${docId}_spec_suggestions_an.json`;
    results.specs = await processSpecSuggestions(docId, specsPath, systemMetadata);
    console.log(`     ✅ Inserted ${results.specs} specifications`);

    // 2. Playbook Hints (Procedures)
    console.log('  📋 Processing procedures...');
    const playbookPath = `${basePath}/${docId}_playbook_hints_an.json`;
    results.playbook = await processPlaybookHints(docId, playbookPath, systemMetadata);
    console.log(`     ✅ Inserted ${results.playbook} procedures`);

    // 3. Intent Router
    console.log('  📋 Processing intent router...');
    const intentPath = `${basePath}/${docId}_intent_router_an.json`;
    results.intent = await processIntentRouter(docId, intentPath, systemMetadata);
    console.log(`     ✅ Inserted ${results.intent} Q&A pairs`);

    // 4. Golden Tests
    console.log('  📋 Processing golden tests...');
    const goldenPath = `${basePath}/${docId}_golden_rules_an.json`;
    results.golden = await processGoldenTests(docId, goldenPath, systemMetadata);
    console.log(`     ✅ Inserted ${results.golden} golden tests`);

    const total = results.specs + results.playbook + results.intent + results.golden;
    console.log(`\n  ✅ Total: ${total} items inserted to staging`);

    return {
      success: true,
      results,
      total
    };

  } catch (error) {
    console.error(`\n  ❌ Error: ${error.message}`);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Main execution
 */
async function main() {
  console.log('🚀 Batch DIP to Staging');
  console.log(`   CSV: ${CSV_PATH}`);

  try {
    // Read CSV
    console.log('\n📖 Reading CSV...');
    const documents = await readCSV();
    console.log(`   Found ${documents.length} documents`);

    // Show status and exit if requested
    if (options.status) {
      showStatus(documents);
      return;
    }

    // Filter documents
    let docsToProcess = documents.filter(doc => {
      // Must have completed DIP extraction
      if (doc.dip_status !== 'completed') {
        return false;
      }

      // Check if specific doc_id requested
      if (options.docId && doc.doc_id !== options.docId) {
        return false;
      }

      // Check if already in staging (unless force)
      if (!options.force && doc.staging_status === 'completed') {
        return false;
      }

      return true;
    });

    // Apply limit if specified
    if (options.limit) {
      docsToProcess = docsToProcess.slice(0, options.limit);
    }

    if (docsToProcess.length === 0) {
      console.log('\n✅ No documents need processing');
      showStatus(documents);
      return;
    }

    console.log(`\n📋 Processing ${docsToProcess.length} documents...`);

    // Process each document
    let successCount = 0;
    let failCount = 0;
    let totalItems = 0;

    for (let i = 0; i < docsToProcess.length; i++) {
      const doc = docsToProcess[i];
      const docIndex = documents.findIndex(d => d.doc_id === doc.doc_id);

      // Update status to processing
      if (!options.dryRun) {
        documents[docIndex].staging_status = 'processing';
        documents[docIndex].staging_started_at = new Date().toISOString();
        await writeCSV(documents);
      }

      // Process document
      const result = await processDocument(doc, options.dryRun);

      // Update CSV based on result
      if (!options.dryRun) {
        if (result.success) {
          documents[docIndex].staging_status = 'completed';
          documents[docIndex].staging_completed_at = new Date().toISOString();
          documents[docIndex].staging_specs_count = result.results?.specs || 0;
          documents[docIndex].staging_playbook_count = result.results?.playbook || 0;
          documents[docIndex].staging_intent_count = result.results?.intent || 0;
          documents[docIndex].staging_golden_count = result.results?.golden || 0;
          documents[docIndex].staging_total_count = result.total || 0;
          documents[docIndex].staging_error = '';
          successCount++;
          totalItems += result.total || 0;
        } else {
          documents[docIndex].staging_status = 'failed';
          documents[docIndex].staging_completed_at = new Date().toISOString();
          documents[docIndex].staging_error = result.error;
          failCount++;
        }

        await writeCSV(documents);
      } else if (result.dryRun) {
        successCount++;
      }
    }

    // Final summary
    console.log(`\n${'='.repeat(80)}`);
    console.log('📊 BATCH COMPLETE');
    console.log(`${'='.repeat(80)}`);
    console.log(`✅ Success: ${successCount}`);
    console.log(`❌ Failed: ${failCount}`);
    if (!options.dryRun) {
      console.log(`📦 Total items: ${totalItems}`);
      console.log(`📄 CSV updated: ${CSV_PATH}`);
    } else {
      console.log('\n🔍 This was a DRY RUN - no data was modified');
    }

  } catch (error) {
    console.error(`\n❌ Fatal error: ${error.message}`);
    process.exit(1);
  }
}

// Run the script
main().catch(console.error);