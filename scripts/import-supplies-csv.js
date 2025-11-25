#!/usr/bin/env node
// ============================================================================
// CSV Import Script for Supplies Management
// ============================================================================
// Created: 2024-11-24
// Purpose: One-time bulk import of 267 supply items from CSV
//
// Features:
// - Category mapping (CSV headers → Database categories)
// - Unit mapping and normalization
// - Quantity parsing (fractions, "many", numeric)
// - Location normalization
// - Validation and error reporting
// - Detailed import report
// ============================================================================

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parse } from 'csv-parse/sync';
import { getSupabaseClient } from '../src/repositories/supabaseClient.js';
import { logger } from '../src/utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================================
// CONFIGURATION
// ============================================================================

const CSV_PATH = path.join(__dirname, '../code updates/Supply Sheet.csv');
const DRY_RUN = process.argv.includes('--dry-run');

// ============================================================================
// CATEGORY MAPPING (CSV category headers → Database category IDs)
// ============================================================================

const CATEGORY_MAP = {
  'Plumbing': '34514d14-36c1-4e58-be78-0271c2ab31de', // General Plumbing
  'Bilge pump & Gori Props': 'b78f2268-c433-4989-94d5-9a4b0b8319cc', // Bilge & Pumps
  'General': '6bb7975b-66ec-4351-84d6-bc258d03e816', // Miscellaneous
  'Nuts & Bolts': '588258d2-8da0-46cc-bccc-bc122deff265', // Nuts, Bolts & Screws
  'Integrel': 'bca3d119-4037-4d46-84de-be86bafbe420', // Engine Parts & Service
  'Fresh & Salt water pump and throttle cable': 'c14b5ecf-09f5-4044-9921-e34a95be7a33', // Freshwater System
  'Plumbing Fittings': '34514d14-36c1-4e58-be78-0271c2ab31de', // General Plumbing
  'Electrical': 'b9478701-f8ec-4b20-8f84-178739c65ab7', // Wiring & Connectors
  'Engine Service/Spares': 'bca3d119-4037-4d46-84de-be86bafbe420', // Engine Parts & Service
  'Sails': 'b6df8435-6a19-4766-bab0-ad6346f72db5', // Sail Repair
  'Hose': '34514d14-36c1-4e58-be78-0271c2ab31de', // General Plumbing
  'Clamps': 'b804b9f3-590f-42a1-bd69-d738fcae1423', // Hose Clamps
  'Steering Rope': '0254f297-fb5d-4b82-a3ec-f9d6b9afe1c8', // Steering Components
  'Watermaker': '675246ab-9dd8-43d6-8f37-ff2aad004a2e', // Watermaker
  'FASTENER': '588258d2-8da0-46cc-bccc-bc122deff265', // Nuts, Bolts & Screws
  'Adhesives & Ties': '95bb38cd-493f-46ad-95e5-5c8dfdc6c6e7', // Adhesives & Sealants
  'Tools (not in tool drawer)': 'ea9c0fe6-6646-4297-a133-668821c29db8', // Hand Tools
  'Tool Kit for CNC Tool Drawer': 'ea9c0fe6-6646-4297-a133-668821c29db8', // Hand Tools
  'Rudder': '0254f297-fb5d-4b82-a3ec-f9d6b9afe1c8', // Steering Components
  'Tender/dingy': '80a1ef68-d2b5-49d5-863d-c9b9115e1b88', // Dinghy Parts
  'Outdoor cleaning, smelly spray cans, boat hooks, brushes & misc': 'f7944c5d-c440-415c-9e58-d65297d8f6fe', // Cleaning Products
  'Eletrical and gadgets': 'b9478701-f8ec-4b20-8f84-178739c65ab7', // Wiring & Connectors (note: typo in CSV "Eletrical")
  'Other': '6bb7975b-66ec-4351-84d6-bc258d03e816', // Miscellaneous
  'Lines and line-related': '5fc7271d-c9dd-4f91-901f-ed8411bd2e8c', // Running & Standing Rigging
};

// ============================================================================
// UNIT MAPPING (CSV units → Database unit IDs)
// ============================================================================

const UNIT_MAP = {
  'item': 'cca8949b-cb1f-47a0-911e-73d0f059ddb5',
  'bag': '13a2b379-0da4-4890-b82e-d60c351d91d4',
  'roll': 'bc3e8ce2-6a72-40f8-87e4-504facbcad98',
  'bottle': '11f61720-124d-4a51-8545-c3ed2fa896bc',
  'can': '48bf91c0-edf3-4669-b9d9-724e908f499c',
  'tube': '11af1a84-6d5e-43a0-8b28-486b728d2d5f',
  'kit': 'e54ae7fe-3d9e-4c2c-ba44-faae669f2553',
  'box': '1ec6d44e-f8ca-4d41-ad9e-1c669c30be4c',
  'liter': '4588b66e-dc0c-495a-a67b-b7179aa2c698',
  'gallon': '8a84a070-e0d0-44d1-b702-464d7a67eadc',
  'meter': '44ae1d08-e81d-4d55-8679-be092e74fd01',
  'foot': '6fd6b3d5-5e9e-4d6a-b80d-3fcd7d2ac8ef',
  'kg': '7b6aac3d-4cae-4fee-be8a-3c80bb360251',
  'gram': 'cc5fc1fe-4c9d-4bfa-8938-bc83e67321dd',
  'pound': 'c162f7af-6ce0-464c-abfc-0e0b75b5b094',
  'piece': '4376ec9f-7b9f-40ff-8a50-6f3e609e016e',
  'pair': '7a15bd5d-f38b-4d34-bf4f-4778c12eae87',
  'set': '6b8d3b71-871a-4982-8514-548d4772e199',
};

// Default to 'piece' if no unit specified
const DEFAULT_UNIT_ID = '4376ec9f-7b9f-40ff-8a50-6f3e609e016e'; // piece

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Parse quantity from CSV (handles fractions, "many", numeric values)
 * @param {string} qtyStr - Quantity string from CSV
 * @returns {number|null} - Parsed quantity or null
 */
function parseQuantity(qtyStr) {
  if (!qtyStr || qtyStr.trim() === '') return null;

  const str = qtyStr.toLowerCase().trim();

  // Handle special cases
  if (str === 'many' || str === 'several' || str === 'some') {
    return null; // Will require manual entry
  }

  // Handle fractions like "3/4 bag" → extract "3/4"
  const fractionMatch = str.match(/^(\d+)\/(\d+)/);
  if (fractionMatch) {
    const numerator = parseFloat(fractionMatch[1]);
    const denominator = parseFloat(fractionMatch[2]);
    return Math.round((numerator / denominator) * 100) / 100; // Round to 2 decimals
  }

  // Handle regular numbers (strip any text after the number)
  const numberMatch = str.match(/^(\d+\.?\d*)/);
  if (numberMatch) {
    return parseFloat(numberMatch[1]);
  }

  return null; // Can't parse
}

/**
 * Extract unit from quantity string (e.g., "3 rolls" → "roll")
 * @param {string} qtyStr - Quantity string
 * @param {string} unitCol - Unit column value
 * @returns {string} - Extracted unit
 */
function extractUnit(qtyStr, unitCol) {
  // If unit column has value, use it
  if (unitCol && unitCol.trim()) {
    return unitCol.trim().toLowerCase();
  }

  // Try to extract from quantity string
  if (qtyStr) {
    const str = qtyStr.toLowerCase();
    if (str.includes('bag')) return 'bag';
    if (str.includes('roll')) return 'roll';
    if (str.includes('bottle')) return 'bottle';
    if (str.includes('can')) return 'can';
    if (str.includes('tube')) return 'tube';
    if (str.includes('kit')) return 'kit';
    if (str.includes('box')) return 'box';
  }

  return 'item'; // Default
}

/**
 * Normalize location string
 * @param {string} location - Raw location from CSV
 * @returns {string} - Normalized location
 */
function normalizeLocation(location) {
  if (!location) return null;

  const normalized = location
    .trim()
    .replace(/['"]/g, '') // Remove quotes
    .replace(/\s+/g, ' ') // Collapse whitespace
    .replace(/^port\s+/i, 'Port ') // Capitalize "Port"
    .replace(/^starboard\s+/i, 'Starboard ') // Capitalize "Starboard"
    .replace(/^strbd\s+/i, 'Starboard ') // Expand "Strbd"
    .replace(/storage\s*\d/i, (match) => match.replace(/storage/, 'Storage ')); // "storage2" → "Storage 2"

  return normalized || null;
}

/**
 * Check if row is a category header (empty columns after Qty)
 * @param {object} row - CSV row
 * @returns {boolean}
 */
function isCategoryHeader(row) {
  // Skip rows that are clearly not categories (questions, notes)
  if (row.Qty && row.Qty.toLowerCase().includes('what is in')) {
    return false; // Skip question rows
  }

  // Category headers have Qty filled but Unit, Description columns are empty
  return row.Qty &&
         (!row.Unit || row.Unit.trim() === '') &&
         (!row.Description || row.Description.trim() === '') &&
         (!row.Supplier || row.Supplier.trim() === '');
}

// ============================================================================
// MAIN IMPORT FUNCTION
// ============================================================================

async function importSupplies() {
  console.log('='.repeat(80));
  console.log('CSV IMPORT: Supplies Management');
  console.log('='.repeat(80));
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no database changes)' : 'LIVE IMPORT'}`);
  console.log(`File: ${CSV_PATH}`);
  console.log('');

  // Read CSV file
  const fileContent = fs.readFileSync(CSV_PATH, 'utf-8');
  const rows = parse(fileContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  console.log(`Total rows in CSV: ${rows.length}`);
  console.log('');

  // Initialize tracking
  let currentCategory = null;
  const results = {
    total: 0,
    imported: 0,
    skipped: 0,
    errorCount: 0,
    categoryHeaders: 0,
    items: [],
    errorDetails: [],
    skippedDetails: [],
  };

  // Get Supabase client
  const supabase = await getSupabaseClient();

  // Process each row
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2; // +2 because CSV header is row 1, data starts at row 2

    // Check if this is a category header
    if (isCategoryHeader(row)) {
      const categoryName = row.Qty.trim();
      currentCategory = CATEGORY_MAP[categoryName] || null;
      results.categoryHeaders++;

      console.log(`\n📂 Category: ${categoryName} ${currentCategory ? '✅' : '❌ UNMAPPED'}`);

      if (!currentCategory) {
        results.errorDetails.push({
          row: rowNum,
          type: 'unmapped_category',
          category: categoryName,
          message: `Category "${categoryName}" not found in mapping`,
        });
        results.errorCount++;
      }

      continue; // Skip to next row
    }

    // Skip empty rows (no description)
    if (!row.Description || row.Description.trim() === '') {
      continue;
    }

    results.total++;

    // Parse item data
    const itemName = row.Description.trim();
    const supplier = row.Supplier?.trim() || null;
    const location = normalizeLocation(row['Where stored?']);
    const quantity = parseQuantity(row.Qty);
    const unitStr = extractUnit(row.Qty, row.Unit);
    const unitId = UNIT_MAP[unitStr] || DEFAULT_UNIT_ID;

    // Build supply object
    const supplyData = {
      item_name: itemName,
      category_id: currentCategory,
      current_stock: quantity || 0,
      unit_id: unitId,
      location: location,
      supplier: supplier,
      part_number: row['Part/Area']?.trim() || null,
      notes: row['Need to Order']?.trim() || null,
      reorder_threshold: quantity ? Math.max(1, Math.floor(quantity * 0.3)) : 1, // 30% of stock
      auto_reorder_enabled: false, // User can enable later
    };

    // Validation
    const validationErrors = [];
    if (!currentCategory) {
      validationErrors.push('No category assigned (missing category header above)');
    }
    if (!itemName) {
      validationErrors.push('Missing item name');
    }

    if (validationErrors.length > 0) {
      results.errorDetails.push({
        row: rowNum,
        item: itemName,
        errors: validationErrors,
      });
      results.errorCount++;
      console.log(`  ❌ Row ${rowNum}: ${itemName} - ${validationErrors.join(', ')}`);
      continue;
    }

    // Import to database (if not dry run)
    if (!DRY_RUN) {
      try {
        const { data, error } = await supabase
          .from('supplies')
          .insert(supplyData)
          .select()
          .single();

        if (error) {
          throw error;
        }

        results.imported++;
        results.items.push({
          row: rowNum,
          id: data.id,
          name: itemName,
          quantity: quantity,
          unit: unitStr,
          location: location,
        });

        console.log(`  ✅ Row ${rowNum}: ${itemName} (${quantity || '?'} ${unitStr})`);
      } catch (error) {
        results.errorCount++;
        results.errorDetails.push({
          row: rowNum,
          item: itemName,
          error: error.message,
        });
        console.log(`  ❌ Row ${rowNum}: ${itemName} - ${error.message}`);
      }
    } else {
      // Dry run - just log
      results.imported++;
      console.log(`  🔍 Row ${rowNum}: ${itemName} (${quantity || '?'} ${unitStr}) at ${location || 'no location'}`);
    }
  }

  // ============================================================================
  // GENERATE REPORT
  // ============================================================================

  console.log('');
  console.log('='.repeat(80));
  console.log('IMPORT COMPLETE');
  console.log('='.repeat(80));
  console.log(`Total items processed: ${results.total}`);
  console.log(`Successfully imported: ${results.imported}`);
  console.log(`Errors: ${results.errorCount}`);
  console.log(`Category headers found: ${results.categoryHeaders}`);
  console.log('');

  if (results.errorDetails.length > 0) {
    console.log('❌ ERRORS:');
    results.errorDetails.forEach((err) => {
      console.log(`  Row ${err.row}: ${err.item || err.category || 'Unknown'}`);
      if (err.errors) {
        err.errors.forEach(e => console.log(`    - ${e}`));
      } else if (err.error) {
        console.log(`    - ${err.error}`);
      } else if (err.message) {
        console.log(`    - ${err.message}`);
      }
    });
    console.log('');
  }

  // Write detailed report to file
  const reportPath = path.join(__dirname, '../code updates/52 Supply Mgmt - Import Report.json');
  fs.writeFileSync(reportPath, JSON.stringify(results, null, 2));
  console.log(`📄 Detailed report saved to: ${reportPath}`);
  console.log('');

  if (DRY_RUN) {
    console.log('⚠️  DRY RUN MODE - No changes made to database');
    console.log('   Run without --dry-run to perform actual import');
  } else {
    console.log('✅ Import complete! Check database for imported items.');
  }

  console.log('='.repeat(80));
}

// ============================================================================
// RUN
// ============================================================================

importSupplies()
  .then(() => {
    console.log('Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
