/**
 * Cleanup Pass 2 - Remove Condition column, default Reorder Threshold, re-validate
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const INPUT_FILE = path.join(__dirname, '../code updates/Untitled spreadsheet - Pass 2 - Supply Sheet - CLEANED.csv');
const OUTPUT_FILE = path.join(__dirname, '../code updates/Pass 3 - Supply Sheet - CLEANED.csv');

function parseCSV(content) {
  const lines = content.split('\n');
  const rows = [];

  for (let line of lines) {
    if (!line.trim()) continue;

    const fields = [];
    let currentField = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];

      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        fields.push(currentField.trim());
        currentField = '';
      } else {
        currentField += char;
      }
    }
    fields.push(currentField.trim());

    rows.push(fields);
  }

  return rows;
}

function validateRow(row, headers) {
  const data = {};
  headers.forEach((header, i) => {
    data[header] = row[i] || '';
  });

  const flags = [];

  // Check Item Type
  if (!data['Item Type'] || data['Item Type'].trim() === '' || data['Item Type'] === 'UNKNOWN') {
    flags.push('TYPE_MISSING');
  } else if (!['Supply', 'Tool', 'Item', 'item'].includes(data['Item Type'])) {
    flags.push('TYPE_INVALID');
  }

  // Check In Stock
  const inStock = data['In Stock'];
  if (!inStock || inStock.trim() === '' || inStock === 'UNKNOWN') {
    flags.push('STOCK_UNKNOWN');
  } else if (inStock !== 'Yes' && inStock !== 'No') {
    // Check if it's a year like "2025" or date or other unclear value
    if (/\d{4}/.test(inStock) || inStock.includes('/') || inStock.includes(',')) {
      flags.push('STOCK_UNCLEAR');
    } else {
      flags.push('STOCK_INVALID');
    }
  }

  // Check Location
  if (!data['Location'] || data['Location'].trim() === '') {
    // Only flag if In Stock = Yes (no location needed if we don't have it)
    if (inStock === 'Yes') {
      flags.push('NO_LOCATION');
    }
  }

  // Check Quantity
  const qty = data['Quantity'];
  if (!qty || qty.trim() === '') {
    flags.push('QTY_MISSING');
  } else if (isNaN(parseFloat(qty))) {
    flags.push('QTY_INVALID');
  }

  // Check Unit
  if (!data['Unit'] || data['Unit'].trim() === '') {
    flags.push('UNIT_MISSING');
  }

  // Check Item Name
  if (!data['Item Name'] || data['Item Name'].trim() === '') {
    flags.push('NAME_MISSING');
  }

  // Check Main Category
  if (!data['Main Category'] || data['Main Category'].trim() === '' || data['Main Category'] === 'Uncategorized') {
    flags.push('CATEGORY_MISSING');
  }

  // Check Reorder Threshold for Supplies (should never be missing now - we default to 0)
  // Skip this check since we're auto-filling

  // NO CONDITION CHECK - column removed

  // Check Critical Item
  if (!data['Critical Item'] || data['Critical Item'].trim() === '') {
    flags.push('CRITICAL_MISSING');
  } else if (data['Critical Item'] !== 'Yes' && data['Critical Item'] !== 'No') {
    flags.push('CRITICAL_INVALID');
  }

  return flags;
}

function main() {
  console.log('📖 Reading input file...');
  const content = fs.readFileSync(INPUT_FILE, 'utf-8');

  console.log('🔄 Parsing CSV...');
  const rows = parseCSV(content);

  if (rows.length === 0) {
    console.error('❌ No rows found in file');
    return;
  }

  const headers = rows[0];
  console.log(`✅ Found ${rows.length - 1} data rows`);

  // Find column indexes
  const conditionColIndex = headers.indexOf('Condition');
  const reorderColIndex = headers.indexOf('Reorder Threshold');
  const criticalColIndex = headers.indexOf('Critical Item');
  const reviewColIndex = headers.indexOf('NEEDS_REVIEW');

  if (conditionColIndex === -1) {
    console.log('⚠️  Condition column not found (may already be removed)');
  }

  // Remove Condition column from headers
  const newHeaders = headers.filter((h, i) => i !== conditionColIndex);

  console.log('🗑️  Removing Condition column...');
  console.log('⚙️  Setting blank Reorder Thresholds to 0...');
  console.log('⚙️  Setting blank Critical Item to No...');
  console.log('🔍 Re-validating rows...\n');

  const dataRows = rows.slice(1);
  const newDataRows = [];
  let clearedCount = 0;
  let stillFlaggedCount = 0;

  // Calculate new indexes after removing Condition column
  const newReorderColIndex = reorderColIndex > conditionColIndex ? reorderColIndex - 1 : reorderColIndex;
  const newCriticalColIndex = criticalColIndex > conditionColIndex ? criticalColIndex - 1 : criticalColIndex;
  const newReviewColIndex = reviewColIndex > conditionColIndex ? reviewColIndex - 1 : reviewColIndex;

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];

    // Remove Condition column from data
    const newRow = row.filter((val, idx) => idx !== conditionColIndex);

    // Default blank Reorder Threshold to 0
    if (!newRow[newReorderColIndex] || newRow[newReorderColIndex].trim() === '') {
      newRow[newReorderColIndex] = '0';
    }

    // Default blank Critical Item to No
    if (!newRow[newCriticalColIndex] || newRow[newCriticalColIndex].trim() === '') {
      newRow[newCriticalColIndex] = 'No';
    }

    // Re-validate
    const flags = validateRow(newRow, newHeaders);
    const flagText = flags.join('; ');

    // Update NEEDS_REVIEW column
    newRow[newReviewColIndex] = flagText;

    if (flagText) {
      stillFlaggedCount++;
      if (i < 20 || flags.length > 3) {
        console.log(`⚠️  Row ${i + 2}: ${flagText}`);
      }
    } else {
      clearedCount++;
    }

    newDataRows.push(newRow);
  }

  console.log('\n📝 Writing cleaned file...');

  // Rebuild CSV
  const csvLines = [newHeaders.join(',')];
  for (const row of newDataRows) {
    const escapedRow = row.map(field => {
      const fieldStr = String(field || '');
      if (fieldStr.includes(',') || fieldStr.includes('"') || fieldStr.includes('\n')) {
        return `"${fieldStr.replace(/"/g, '""')}"`;
      }
      return fieldStr;
    });
    csvLines.push(escapedRow.join(','));
  }

  fs.writeFileSync(OUTPUT_FILE, csvLines.join('\n'), 'utf-8');

  console.log(`✅ Output written to: ${OUTPUT_FILE}\n`);

  // Summary
  console.log('📊 CLEANUP SUMMARY:');
  console.log(`   Total rows: ${newDataRows.length}`);
  console.log(`   ✅ Clean rows (no issues): ${clearedCount}`);
  console.log(`   ⚠️  Rows still needing review: ${stillFlaggedCount}`);
  console.log(`   Completion: ${Math.round((clearedCount / newDataRows.length) * 100)}%`);

  // Breakdown by flag type
  console.log('\n📋 REMAINING ISSUES:');
  const flagCounts = {};
  for (const row of newDataRows) {
    const flags = (row[newReviewColIndex] || '').split('; ').filter(f => f);
    for (const flag of flags) {
      flagCounts[flag] = (flagCounts[flag] || 0) + 1;
    }
  }

  if (Object.keys(flagCounts).length === 0) {
    console.log('   🎉 No issues remaining!');
  } else {
    Object.entries(flagCounts)
      .sort((a, b) => b[1] - a[1])
      .forEach(([flag, count]) => {
        console.log(`   ${flag}: ${count}`);
      });
  }

  console.log('\n✅ CHANGES MADE:');
  console.log('   - Removed "Condition" column');
  console.log('   - Set blank "Reorder Threshold" values to "0"');
  console.log('   - Set blank "Critical Item" values to "No"');
  console.log('   - Re-validated all rows (no more CONDITION_MISSING or CRITICAL_MISSING flags)');

  console.log('\n🎯 NEXT STEPS:');
  console.log('   1. Open Pass 2 - CLEANED.csv in Google Sheets');
  console.log('   2. Fix remaining issues (especially rows 163-232 which have data corruption)');
  console.log('   3. Re-run review when ready');
}

main();
