/**
 * Convert Supply Sheet.csv to new structure
 * Auto-populates what it can, flags rows needing manual review
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const INPUT_FILE = path.join(__dirname, '../code updates/Supply Sheet.csv');
const OUTPUT_FILE = path.join(__dirname, '../code updates/Supply Sheet - CONVERTED.csv');

// Unit standardization
const UNIT_MAP = {
  'metre': 'meter',
  'feet': 'foot',
  'ft': 'foot',
  'l': 'liter',
  'item': 'piece',
  '': 'piece'
};

// Keywords for type detection
const SUPPLY_KEYWORDS = ['filter', 'oil', 'belt', 'hose', 'fitting', 'clamp', 'adhesive', 'tape', 'sealant', 'sika', 'battery', 'cleaning', 'chemical', 'grease', 'lubricant', 'fuel', 'coolant', 'impeller', 'anode'];
const TOOL_KEYWORDS = ['meter', 'cutter', 'wrench', 'drill', 'punch', 'fids', 'splice', 'funnel', 'tool', 'pump manual', 'grommets punch'];
const ITEM_KEYWORDS = ['cover', 'line', 'rope', 'shackle', 'bag', 'hook', 'ladder', 'cooler', 'marker', 'board', 'net', 'enclosure', 'vest'];

function parseCSV(content) {
  const lines = content.split('\n');
  const rows = [];

  for (let line of lines) {
    if (!line.trim()) continue;

    // Simple CSV parsing (handles basic quoted fields)
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

function cleanQuantity(qty) {
  if (!qty || qty.trim() === '') return { value: '1', flag: 'QTY_BLANK' };

  const cleaned = qty.trim().toLowerCase();

  // Check for problematic values
  if (cleaned.includes('bag') || cleaned.includes('/')) return { value: qty, flag: 'QTY_UNCLEAR' };
  if (cleaned === 'multiple' || cleaned === 'many') return { value: qty, flag: 'QTY_UNCLEAR' };

  // Try to parse as number
  const num = parseFloat(cleaned);
  if (isNaN(num)) return { value: qty, flag: 'QTY_UNCLEAR' };

  return { value: num.toString(), flag: null };
}

function standardizeUnit(unit) {
  if (!unit) return 'piece';
  const cleaned = unit.trim().toLowerCase();
  return UNIT_MAP[cleaned] || unit.trim();
}

function detectItemType(description, mainCategory) {
  const desc = description.toLowerCase();

  // Check keywords
  const isSupply = SUPPLY_KEYWORDS.some(kw => desc.includes(kw));
  const isTool = TOOL_KEYWORDS.some(kw => desc.includes(kw));
  const isItem = ITEM_KEYWORDS.some(kw => desc.includes(kw));

  // Category-based detection
  if (mainCategory.includes('Engine Service') || mainCategory.includes('Watermaker') || mainCategory.includes('Plumbing')) {
    if (!isTool && !isItem) return 'Supply';
  }

  if (isTool) return 'Tool';
  if (isItem) return 'Item';
  if (isSupply) return 'Supply';

  return 'UNKNOWN';
}

function extractBrand(description, supplier) {
  const desc = description.toLowerCase();

  // Known brands
  const brands = ['racor', 'wix', 'sika', 'gorilla', 'vetus', 'schenker', 'schneker', 'victron', 'harken', 'bote', 'yeti', 'mantus'];

  for (const brand of brands) {
    if (desc.includes(brand)) {
      return brand.charAt(0).toUpperCase() + brand.slice(1);
    }
  }

  return '';
}

function extractPartNumber(description) {
  // Look for patterns like BE1454, 8PK1330HD, UP6/E, etc.
  const patterns = [
    /\b[A-Z]{2}\d{4}\b/,           // BE1454
    /\b\d+[A-Z]{2}\d+[A-Z]*\b/,    // 8PK1330HD
    /\b[A-Z]+\d+\/[A-Z]\b/,        // UP6/E
    /\bSch[A-Za-z]+\d+\b/          // SchSsZ15
  ];

  for (const pattern of patterns) {
    const match = description.match(pattern);
    if (match) return match[0];
  }

  return '';
}

function isHeaderRow(row) {
  // Section headers have NON-NUMERIC text in Qty column and empty columns after
  const [qty, unit, desc, supplier] = row;

  if (!qty || qty.trim() === '') return false;

  const qtyTrimmed = qty.trim();

  // If Qty is a number, it's not a header
  if (!isNaN(parseFloat(qtyTrimmed)) && isFinite(qtyTrimmed)) {
    return false;
  }

  // If Qty is text and most other fields are empty, it's a header
  const emptyCount = [unit, desc, supplier].filter(f => !f || f.trim() === '').length;
  if (emptyCount >= 2) {
    return true;
  }

  return false;
}

function processInventoryStatus(value) {
  if (!value || value.trim() === '') return { status: 'UNKNOWN', flag: 'STOCK_UNKNOWN' };

  const cleaned = value.trim().toLowerCase();
  if (cleaned === 'x') return { status: 'Yes', flag: null };
  if (cleaned === 'no') return { status: 'No', flag: null };

  // Dates or other values
  return { status: value, flag: 'STOCK_UNCLEAR' };
}

function convertRow(row, currentCategory, rowNum) {
  const [qty, unit, description, supplier, partArea, needOrder, inventory, location, ...extra] = row;

  // Check if this is a section header FIRST (before checking description)
  if (isHeaderRow(row)) {
    return { isHeader: true, category: qty.trim() }; // Category name is in Qty column!
  }

  // Skip empty rows (non-header rows without description)
  if (!description || description.trim() === '') return null;

  const flags = [];

  // Clean quantity
  const qtyResult = cleanQuantity(qty);
  if (qtyResult.flag) flags.push(qtyResult.flag);

  // Standardize unit
  const stdUnit = standardizeUnit(unit);

  // Detect type
  const itemType = detectItemType(description, currentCategory);
  if (itemType === 'UNKNOWN') flags.push('TYPE_UNKNOWN');

  // Extract brand and part number
  const brand = extractBrand(description, supplier);
  const partNumber = extractPartNumber(description);

  // Process inventory status
  const stockResult = processInventoryStatus(inventory);
  if (stockResult.flag) flags.push(stockResult.flag);

  // Check location
  if (!location || location.trim() === '') flags.push('NO_LOCATION');

  // Set reorder threshold for supplies
  let reorderThreshold = '';
  if (itemType === 'Supply') {
    const isCritical = description.toLowerCase().includes('filter') ||
                       description.toLowerCase().includes('oil') ||
                       description.toLowerCase().includes('belt');
    reorderThreshold = isCritical ? '1' : '2';
  }

  return {
    isHeader: false,
    data: {
      mainCategory: currentCategory,
      itemType,
      itemName: description.trim(),
      quantity: qtyResult.value,
      unit: stdUnit,
      brand,
      partNumber,
      subcategory: (partArea || '').trim(),
      supplier: (supplier || '').trim(),
      location: (location || '').trim(),
      reorderThreshold,
      condition: '',
      notes: '',
      criticalItem: '',
      inStock: stockResult.status
    },
    flags,
    originalRow: rowNum
  };
}

function main() {
  console.log('📖 Reading input file...');
  const content = fs.readFileSync(INPUT_FILE, 'utf-8');

  console.log('🔄 Parsing CSV...');
  const rows = parseCSV(content);

  console.log(`✅ Found ${rows.length} rows`);

  // Debug: Show first 10 rows to check parsing
  console.log('\n🔍 First 10 rows (for debugging):');
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    console.log(`   Row ${i}: [${rows[i].slice(0, 4).map(f => `"${f}"`).join(', ')}...]`);
  }
  console.log('');

  // Skip header row
  const dataRows = rows.slice(1);

  let currentCategory = 'Uncategorized';
  const converted = [];
  let headerCount = 0;
  let flaggedCount = 0;

  console.log('🔧 Converting rows...');

  for (let i = 0; i < dataRows.length; i++) {
    const result = convertRow(dataRows[i], currentCategory, i + 2); // +2 for header and 0-index

    if (!result) continue;

    if (result.isHeader) {
      currentCategory = result.category;
      headerCount++;
      console.log(`  📁 Section #${headerCount}: ${currentCategory}`);
      continue;
    }

    if (result.flags.length > 0) {
      flaggedCount++;
    }

    converted.push(result);
  }

  console.log(`✅ Converted ${converted.length} items`);
  console.log(`📁 Found ${headerCount} sections`);
  console.log(`🚩 Flagged ${flaggedCount} rows for review`);

  // Build output CSV
  console.log('📝 Writing output CSV...');

  const header = [
    'Main Category',
    'Item Type',
    'Item Name',
    'Quantity',
    'Unit',
    'Brand',
    'Part Number',
    'Subcategory',
    'Supplier',
    'Location',
    'Reorder Threshold',
    'Condition',
    'Notes',
    'Critical Item',
    'In Stock',
    'NEEDS_REVIEW',
    'Original Row'
  ];

  const csvLines = [header.join(',')];

  for (const item of converted) {
    const flagText = item.flags.length > 0 ? item.flags.join('; ') : '';

    const row = [
      item.data.mainCategory,
      item.data.itemType,
      `"${item.data.itemName.replace(/"/g, '""')}"`,
      item.data.quantity,
      item.data.unit,
      item.data.brand,
      item.data.partNumber,
      item.data.subcategory,
      item.data.supplier,
      `"${item.data.location.replace(/"/g, '""')}"`,
      item.data.reorderThreshold,
      item.data.condition,
      item.data.notes,
      item.data.criticalItem,
      item.data.inStock,
      flagText,
      item.originalRow
    ];

    csvLines.push(row.join(','));
  }

  fs.writeFileSync(OUTPUT_FILE, csvLines.join('\n'), 'utf-8');

  console.log(`✅ Output written to: ${OUTPUT_FILE}`);
  console.log('');
  console.log('📊 Summary:');
  console.log(`   Total items: ${converted.length}`);
  console.log(`   Needs review: ${flaggedCount}`);
  console.log('');
  console.log('🎯 Next steps:');
  console.log('   1. Open the CONVERTED file in Google Sheets');
  console.log('   2. Filter by NEEDS_REVIEW column to find flagged rows');
  console.log('   3. Fix flagged issues manually');
  console.log('   4. Fill in blank Brand, Part Number, Condition, Critical Item columns');
  console.log('   5. Export as CSV when done');
}

main();
