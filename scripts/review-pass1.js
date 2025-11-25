/**
 * Review Pass 1 CSV and update NEEDS_REVIEW column
 * Validates current data and flags remaining issues
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const INPUT_FILE = path.join(__dirname, '../code updates/Pass 1 - Supply Sheet - CONVERTED.csv');
const OUTPUT_FILE = path.join(__dirname, '../code updates/Pass 1 - Supply Sheet - REVIEWED.csv');

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
  } else if (!['Supply', 'Tool', 'Item'].includes(data['Item Type'])) {
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

  // Check Reorder Threshold for Supplies
  if (data['Item Type'] === 'Supply' && (!data['Reorder Threshold'] || data['Reorder Threshold'].trim() === '')) {
    flags.push('REORDER_MISSING');
  }

  // Check Condition for Tools/Items
  if ((data['Item Type'] === 'Tool' || data['Item Type'] === 'Item') && (!data['Condition'] || data['Condition'].trim() === '')) {
    flags.push('CONDITION_MISSING');
  }

  // Check Critical Item
  if (!data['Critical Item'] || data['Critical Item'].trim() === '') {
    flags.push('CRITICAL_MISSING');
  } else if (data['Critical Item'] !== 'Yes' && data['Critical Item'] !== 'No') {
    flags.push('CRITICAL_INVALID');
  }

  return flags;
}

function main() {
  console.log('📖 Reading Pass 1 file...');
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
  const reviewColIndex = headers.indexOf('NEEDS_REVIEW');
  if (reviewColIndex === -1) {
    console.error('❌ NEEDS_REVIEW column not found');
    return;
  }

  const dataRows = rows.slice(1);
  let clearedCount = 0;
  let stillFlaggedCount = 0;
  let newFlagsCount = 0;

  console.log('🔍 Validating rows...\n');

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    const oldFlags = row[reviewColIndex] || '';
    const newFlags = validateRow(row, headers);
    const newFlagText = newFlags.join('; ');

    // Update the NEEDS_REVIEW column
    row[reviewColIndex] = newFlagText;

    // Track changes
    if (oldFlags && !newFlagText) {
      clearedCount++;
      console.log(`✅ Row ${i + 2}: Cleared (was: ${oldFlags})`);
    } else if (!oldFlags && newFlagText) {
      newFlagsCount++;
      console.log(`⚠️  Row ${i + 2}: New flags: ${newFlagText}`);
    } else if (oldFlags && newFlagText && oldFlags !== newFlagText) {
      console.log(`🔄 Row ${i + 2}: Updated flags\n   Was: ${oldFlags}\n   Now: ${newFlagText}`);
    } else if (newFlagText) {
      stillFlaggedCount++;
    }
  }

  console.log('\n📝 Writing reviewed file...');

  // Rebuild CSV
  const csvLines = [headers.join(',')];
  for (const row of dataRows) {
    const escapedRow = row.map(field => {
      if (field.includes(',') || field.includes('"') || field.includes('\n')) {
        return `"${field.replace(/"/g, '""')}"`;
      }
      return field;
    });
    csvLines.push(escapedRow.join(','));
  }

  fs.writeFileSync(OUTPUT_FILE, csvLines.join('\n'), 'utf-8');

  console.log(`✅ Output written to: ${OUTPUT_FILE}\n`);

  // Summary
  console.log('📊 REVIEW SUMMARY:');
  console.log(`   Total rows: ${dataRows.length}`);
  console.log(`   ✅ Issues fixed (cleared): ${clearedCount}`);
  console.log(`   ⚠️  Still has issues: ${stillFlaggedCount}`);
  console.log(`   🆕 New issues found: ${newFlagsCount}`);

  const totalFlagged = dataRows.filter((row) => row[reviewColIndex]).length;
  console.log(`\n   Total rows needing review: ${totalFlagged}`);
  console.log(`   Completion: ${Math.round(((dataRows.length - totalFlagged) / dataRows.length) * 100)}%`);

  // Breakdown by flag type
  console.log('\n📋 ISSUES BREAKDOWN:');
  const flagCounts = {};
  for (const row of dataRows) {
    const flags = (row[reviewColIndex] || '').split('; ').filter(f => f);
    for (const flag of flags) {
      flagCounts[flag] = (flagCounts[flag] || 0) + 1;
    }
  }

  Object.entries(flagCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([flag, count]) => {
      console.log(`   ${flag}: ${count}`);
    });

  console.log('\n🎯 NEXT STEPS:');
  console.log('   1. Open Pass 1 - REVIEWED.csv in Google Sheets');
  console.log('   2. Filter by NEEDS_REVIEW to see remaining issues');
  console.log('   3. Fix the issues and run this script again');
  console.log('   4. When NEEDS_REVIEW is empty for all rows, you\'re done!');
}

main();
