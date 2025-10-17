#!/usr/bin/env node
/**
 * Add temporary rows to CSV for systems with manual=true
 * These rows will be processed by batch-colloquial-extraction.js
 * Then removed by remove-manual-systems-from-csv.js
 */

import fs from 'fs';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import { getSupabaseClient } from '../../src/repositories/supabaseClient.js';

const CSV_PATH = 'Rename/uploaded/uploaded_documents.csv';

async function main() {
  try {
    console.log('🔍 Fetching systems with manual=true...\n');

    const supabase = await getSupabaseClient();

    const { data: systems, error } = await supabase
      .from('systems')
      .select('asset_uid, manufacturer_norm, model_norm')
      .eq('manual', true)
      .order('manufacturer_norm', { ascending: true });

    if (error) {
      throw error;
    }

    if (!systems || systems.length === 0) {
      console.log('❌ No systems found with manual=true');
      return;
    }

    console.log(`✅ Found ${systems.length} systems with manual=true\n`);

    // Read existing CSV
    const csvContent = fs.readFileSync(CSV_PATH, 'utf-8');
    const rows = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
      relax_column_count: true
    });

    // Check if any temp rows already exist
    const existingTempRows = rows.filter(r => r.doc_id && r.doc_id.startsWith('TEMP_MANUAL_'));
    if (existingTempRows.length > 0) {
      console.log(`⚠️  Warning: ${existingTempRows.length} temporary rows already exist in CSV`);
      console.log('   Run remove-manual-systems-from-csv.js first to clean up\n');
      process.exit(1);
    }

    console.log('➕ Adding temporary rows to CSV...\n');

    // Add temp rows for each system
    for (const system of systems) {
      const tempRow = {
        doc_id: `TEMP_MANUAL_${system.asset_uid}`,
        filename: `${system.manufacturer_norm}_${system.model_norm}_manual.pdf`,
        asset_uid: system.asset_uid,
        manufacturer: system.manufacturer_norm,
        model: system.model_norm,
        storage_path: '',
        file_size_mb: '',
        uploaded_at: '',
        parse_status: '',
        parse_started_at: '',
        parse_completed_at: '',
        chunks_processed: '',
        vectors_upserted: '',
        chunks_in_db: '',
        chunks_in_storage: '',
        chunking_strategy: '',
        error_message: '',
        dip_status: '',
        dip_started_at: '',
        dip_completed_at: '',
        specs_count: '',
        golden_count: '',
        intent_count: '',
        procedures_count: '',
        cache_tokens_written: '',
        cache_tokens_read: '',
        total_input_tokens: '',
        total_output_tokens: '',
        estimated_cost_usd: '',
        dip_error_message: '',
        colloquial_status: 'pending',
        colloquial_started_at: '',
        colloquial_completed_at: '',
        colloquial_keywords: '',
        colloquial_keywords_count: '',
        colloquial_tokens_used: '',
        colloquial_cost_usd: '',
        colloquial_error_message: ''
      };

      rows.push(tempRow);

      console.log(`   ✓ Added: ${system.manufacturer_norm} ${system.model_norm}`);
    }

    // Write updated CSV
    const output = stringify(rows, {
      header: true,
      quoted: true
    });

    fs.writeFileSync(CSV_PATH, output, 'utf-8');

    console.log(`\n✅ Successfully added ${systems.length} temporary rows to CSV`);
    console.log(`\n📄 CSV: ${CSV_PATH}`);
    console.log(`\nNext steps:`);
    console.log(`  1. Run: node scripts/bulk/batch-colloquial-extraction.js --batch-size ${systems.length}`);
    console.log(`  2. Run: node scripts/bulk/remove-manual-systems-from-csv.js\n`);

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

main();
