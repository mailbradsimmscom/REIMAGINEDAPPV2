#!/usr/bin/env node
/**
 * Remove temporary rows from CSV that were added by add-manual-systems-to-csv.js
 * Removes all rows where doc_id starts with "TEMP_MANUAL_"
 */

import fs from 'fs';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';

const CSV_PATH = 'Rename/uploaded/uploaded_documents.csv';

async function main() {
  try {
    console.log('🔍 Reading CSV...\n');

    // Read existing CSV
    const csvContent = fs.readFileSync(CSV_PATH, 'utf-8');
    const rows = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
      relax_column_count: true
    });

    // Find temp rows
    const tempRows = rows.filter(r => r.doc_id && r.doc_id.startsWith('TEMP_MANUAL_'));
    const keepRows = rows.filter(r => !r.doc_id || !r.doc_id.startsWith('TEMP_MANUAL_'));

    if (tempRows.length === 0) {
      console.log('✅ No temporary rows found in CSV - nothing to remove\n');
      return;
    }

    console.log(`Found ${tempRows.length} temporary rows to remove:\n`);

    for (const row of tempRows) {
      const status = row.colloquial_status || 'pending';
      const statusIcon = status === 'completed' ? '✅' : status === 'failed' ? '❌' : '⏸️';
      console.log(`   ${statusIcon} ${row.manufacturer} ${row.model} (${status})`);
    }

    // Write updated CSV (without temp rows)
    const output = stringify(keepRows, {
      header: true,
      quoted: true
    });

    fs.writeFileSync(CSV_PATH, output, 'utf-8');

    console.log(`\n✅ Successfully removed ${tempRows.length} temporary rows from CSV`);
    console.log(`📄 CSV: ${CSV_PATH}`);
    console.log(`📊 Remaining rows: ${keepRows.length}\n`);

    // Show summary of what was processed
    const completed = tempRows.filter(r => r.colloquial_status === 'completed').length;
    const failed = tempRows.filter(r => r.colloquial_status === 'failed').length;

    if (completed > 0 || failed > 0) {
      console.log(`Summary:`);
      console.log(`  ✅ Completed: ${completed}`);
      console.log(`  ❌ Failed: ${failed}`);
      console.log(`\nColloquial keywords have been saved to the systems table.`);
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

main();
