/**
 * Import supplies from cleaned CSV
 *
 * Reads Pass 3 - Supply Sheet - CLEANED.csv and imports into supplies table
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getSupabaseClient } from '../src/repositories/supabaseClient.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CSV_FILE = path.join(__dirname, '../code updates/Pass 3 - Supply Sheet - CLEANED.csv');

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

async function getCategoryIdByPath(supabase, categoryPath) {
  // Try exact match first
  const { data, error } = await supabase
    .from('supply_categories')
    .select('id')
    .eq('category_path', categoryPath)
    .single();

  if (!error && data) return data.id;

  // Try by category name
  const categoryName = categoryPath.split('/').pop();
  const { data: nameMatch } = await supabase
    .from('supply_categories')
    .select('id')
    .eq('category_name', categoryName)
    .single();

  if (nameMatch) return nameMatch.id;

  // Default to "Other"
  const { data: defaultCat } = await supabase
    .from('supply_categories')
    .select('id')
    .ilike('category_name', '%other%')
    .single();

  return defaultCat?.id || null;
}

async function getUnitIdByName(supabase, unitName) {
  const { data } = await supabase
    .from('supply_units')
    .select('id')
    .or(`unit_name.ilike.${unitName},abbreviation.ilike.${unitName}`)
    .single();

  return data?.id || null;
}

async function main() {
  console.log('📦 Starting CSV import...\n');

  const supabase = await getSupabaseClient();

  // Read CSV
  console.log('📖 Reading CSV file...');
  const content = fs.readFileSync(CSV_FILE, 'utf-8');
  const rows = parseCSV(content);

  if (rows.length === 0) {
    console.error('❌ No rows found in CSV');
    process.exit(1);
  }

  const headers = rows[0];
  const dataRows = rows.slice(1);

  console.log(`   ✅ Found ${dataRows.length} rows to import\n`);

  // Build lookup caches
  console.log('🔍 Building lookup caches...');

  const { data: categories } = await supabase
    .from('supply_categories')
    .select('id, category_name, category_path');

  const { data: units } = await supabase
    .from('supply_units')
    .select('id, unit_name, abbreviation');

  console.log(`   ✅ ${categories?.length || 0} categories`);
  console.log(`   ✅ ${units?.length || 0} units\n`);

  // Create lookup maps
  const categoryMap = {};
  categories?.forEach(cat => {
    categoryMap[cat.category_name.toLowerCase()] = cat.id;
    categoryMap[cat.category_path.toLowerCase()] = cat.id;
  });

  // CSV category name → Database category name mapping
  const categoryNameMap = {
    'plumbing': 'General Plumbing',
    'bilge pump & gori props': 'Gori Props & Anodes',
    'general': 'General Supplies',
    'nuts & bolts': 'Nuts, Bolts & Screws',
    'integrel': 'Engine Parts & Service',
    'fresh & salt water pump and throttle cable': 'Freshwater System',
    'plumbing fittings': 'General Plumbing',
    'electrical': 'Electrical & Electronics',
    'engine service/spares': 'Engine Parts & Service',
    'watermaker': 'Freshwater System',
    'fastener': 'Hardware & Fasteners',
    'sails': 'Sail Repair',
    'hose': 'General Plumbing',
    'clamps': 'Hose Clamps',
    'steering rope': 'Running & Standing Rigging',
    'rudder': 'Propulsion & Steering',
    'tender/dingy': 'Dinghy Parts',
    'outdoor cleaning': 'Cleaning Products',
    'eletrical and gadgets': 'Electrical & Electronics',
    'adhesives & ties': 'Adhesives & Sealants',
    'tools (not in tool drawer)': 'Hand Tools',
    'tool kit for cnc tool drawer': 'Hand Tools',
    'lines and line-related': 'Running & Standing Rigging',
    'multiple': 'Miscellaneous',
    'many': 'Miscellaneous',
    'as of nov 13': 'Miscellaneous',
    'other': 'Miscellaneous'
  };

  const unitMap = {};
  units?.forEach(unit => {
    unitMap[unit.unit_name.toLowerCase()] = unit.id;
    unitMap[unit.abbreviation.toLowerCase()] = unit.id;
  });

  // Find default category (Miscellaneous)
  const defaultCategory = categories?.find(c => c.category_name.toLowerCase() === 'miscellaneous') ||
                         categories?.find(c => c.category_name.toLowerCase().includes('general'));

  // Process rows
  console.log('⚙️  Processing rows...\n');

  let successCount = 0;
  let errorCount = 0;
  const errors = [];

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    const data = {};
    headers.forEach((header, idx) => {
      data[header] = row[idx] || '';
    });

    try {
      // Map CSV columns to database columns
      const itemType = data['Item Type']?.toLowerCase() || 'supply';
      const csvCategoryName = data['Main Category'] || 'Other';
      const unitName = data['Unit'] || 'piece';

      // Map CSV category to database category
      const mappedCategoryName = categoryNameMap[csvCategoryName.toLowerCase()] || csvCategoryName;

      // Look up IDs
      const categoryId = categoryMap[mappedCategoryName.toLowerCase()] || defaultCategory?.id;
      const unitId = unitMap[unitName.toLowerCase()];

      if (!unitId) {
        errors.push({ row: i + 2, error: `Unknown unit: ${unitName}` });
        errorCount++;
        continue;
      }

      // Build supply record
      const supply = {
        item_name: data['Item Name'],
        item_type: itemType,
        category_id: categoryId,
        current_stock: parseFloat(data['Quantity']) || 1,
        unit_id: unitId,
        location: data['Location'] || null,
        brand: data['Brand'] || null,
        supplier: data['Supplier'] || null,
        part_number: data['Part Number'] || null,
        reorder_threshold: itemType === 'supply' ? (parseFloat(data['Reorder Threshold']) || 0) : null,
        auto_reorder_enabled: false,
        notes: data['Notes'] || null,
        is_critical: data['Critical Item'] === 'Yes',
        photos: [],
        ai_suggested_systems: []
      };

      // Insert
      const { error } = await supabase
        .from('supplies')
        .insert(supply);

      if (error) {
        errors.push({ row: i + 2, error: error.message });
        errorCount++;
        console.log(`   ❌ Row ${i + 2}: ${data['Item Name']} - ${error.message}`);
      } else {
        successCount++;
        if (successCount % 20 === 0) {
          console.log(`   ✅ Imported ${successCount}/${dataRows.length} items...`);
        }
      }

    } catch (err) {
      errors.push({ row: i + 2, error: err.message });
      errorCount++;
      console.log(`   ❌ Row ${i + 2}: ${err.message}`);
    }
  }

  console.log('\n📊 Import Summary:');
  console.log(`   ✅ Success: ${successCount}`);
  console.log(`   ❌ Errors: ${errorCount}`);

  if (errors.length > 0) {
    console.log('\n❌ Errors:');
    errors.forEach(({ row, error }) => {
      console.log(`   Row ${row}: ${error}`);
    });
  }

  console.log('\n🎉 Import complete!\n');
}

main().catch(console.error);
