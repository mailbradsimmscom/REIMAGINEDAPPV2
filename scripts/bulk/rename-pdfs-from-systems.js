// scripts/rename-pdfs-from-systems.js
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

/**
 * PDF Renaming Script - Uses systems table
 *
 * Reads PDFs from /Rename folder and renames them based on systems.local_manual_file_name
 * Creates standardized filenames: {manufacturer_norm}_{model_norm}.pdf
 *
 * Usage:
 *   node scripts/rename-pdfs-from-systems.js
 */

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const RENAME_FOLDER = path.join(process.cwd(), 'Rename');

async function renamePDFs() {
  console.log('🔍 Starting PDF rename process...');
  console.log(`📁 Folder: ${RENAME_FOLDER}\n`);

  // Check if folder exists
  if (!fs.existsSync(RENAME_FOLDER)) {
    console.log(`❌ Folder not found: ${RENAME_FOLDER}`);
    console.log('   Create the folder first: mkdir Rename');
    return;
  }

  // 1. Read all PDF files
  const files = fs.readdirSync(RENAME_FOLDER)
    .filter(f => f.toLowerCase().endsWith('.pdf'));

  console.log(`📄 Found ${files.length} PDF files\n`);

  if (files.length === 0) {
    console.log('❌ No PDF files found in /Rename folder');
    return;
  }

  // Track results
  const results = {
    renamed: [],
    notFound: [],
    skipped: [],
    errors: []
  };

  // 2. Process each PDF
  for (let i = 0; i < files.length; i++) {
    const oldFileName = files[i];
    const oldFilePath = path.join(RENAME_FOLDER, oldFileName);

    console.log(`[${i + 1}/${files.length}] ${oldFileName}`);

    try {
      // Look up in systems table by local_manual_file_name
      // Try both with and without .pdf extension
      const fileNameWithoutExt = oldFileName.replace(/\.pdf$/i, '');

      let { data: system, error } = await supabase
        .from('systems')
        .select('asset_uid, manufacturer_norm, model_norm, local_manual_file_name')
        .eq('local_manual_file_name', oldFileName)
        .single();

      // Debug first query
      if (error) {
        console.log(`  → First query error: ${error.message}`);
      }

      // If not found with full filename, try without extension
      if (error || !system) {
        console.log(`  → Trying without extension: "${fileNameWithoutExt}"`);
        const result = await supabase
          .from('systems')
          .select('asset_uid, manufacturer_norm, model_norm, local_manual_file_name')
          .eq('local_manual_file_name', fileNameWithoutExt)
          .single();

        system = result.data;
        error = result.error;

        // Debug the database response
        if (error) {
          console.log(`  → Database error: ${error.message}`);
        }
      }

      if (error || !system) {
        console.log(`  ⚠️  Not found in systems table (tried "${oldFileName}" and "${fileNameWithoutExt}")\n`);
        results.notFound.push(oldFileName);
        continue;
      }

      console.log(`  ✓ Found: ${system.manufacturer_norm} ${system.model_norm}`);

      // Generate new standardized filename
      const newFileName = generateStandardFilename(
        system.manufacturer_norm,
        system.model_norm
      );

      // Check if rename needed
      if (oldFileName === newFileName) {
        console.log(`  ✓ Already has correct name\n`);
        results.skipped.push({
          fileName: oldFileName,
          system: system
        });
        continue;
      }

      const newFilePath = path.join(RENAME_FOLDER, newFileName);

      // Check if target filename already exists
      if (fs.existsSync(newFilePath)) {
        console.log(`  ⚠️  Target file already exists: ${newFileName}`);
        console.log(`     Manual intervention needed\n`);
        results.errors.push({
          oldFileName,
          reason: 'Target exists',
          newFileName,
          asset_uid: system.asset_uid
        });
        continue;
      }

      // Rename the file
      fs.renameSync(oldFilePath, newFilePath);

      console.log(`  ✅ → ${newFileName}\n`);

      results.renamed.push({
        oldName: oldFileName,
        newName: newFileName,
        manufacturer: system.manufacturer_norm,
        model: system.model_norm,
        asset_uid: system.asset_uid
      });

    } catch (error) {
      console.log(`  ❌ Error: ${error.message}\n`);
      results.errors.push({
        oldFileName,
        reason: error.message
      });
    }
  }

  // Print summary
  console.log('\n' + '='.repeat(70));
  console.log('📊 RENAME SUMMARY');
  console.log('='.repeat(70));
  console.log(`✅ Renamed:    ${results.renamed.length}`);
  console.log(`⏭️  Skipped:    ${results.skipped.length} (already correct)`);
  console.log(`⚠️  Not found:  ${results.notFound.length} (not in systems table)`);
  console.log(`❌ Errors:     ${results.errors.length}`);
  console.log('='.repeat(70) + '\n');

  if (results.renamed.length > 0) {
    console.log('✅ Renamed files:');
    results.renamed.forEach(r => {
      console.log(`   ${r.oldName}`);
      console.log(`   → ${r.newName}`);
      console.log(`     (${r.manufacturer} ${r.model} - ${r.asset_uid})\n`);
    });
  }

  if (results.notFound.length > 0) {
    console.log('⚠️  Files not found in systems.local_manual_file_name:');
    results.notFound.forEach(f => console.log(`   - ${f}`));
    console.log('\n   Action: Update systems table with local_manual_file_name values\n');
  }

  if (results.errors.length > 0) {
    console.log('❌ Errors encountered:');
    results.errors.forEach(e => {
      console.log(`   - ${e.oldFileName}`);
      console.log(`     Reason: ${e.reason}`);
      if (e.newFileName) {
        console.log(`     Target: ${e.newFileName}`);
      }
    });
    console.log('');
  }

  if (results.renamed.length > 0) {
    console.log('🎉 Files renamed successfully!');
    console.log('   Next step: node scripts/batch-upload-pdfs.js\n');

    // Generate preview of what upload will do
    console.log('📋 Preview of batch upload (first 5):');
    results.renamed.slice(0, 5).forEach(r => {
      console.log(`   ${r.newName} → systems/${r.asset_uid}`);
    });
    if (results.renamed.length > 5) {
      console.log(`   ... and ${results.renamed.length - 5} more`);
    }
    console.log('');
  }
}

/**
 * Generate standardized filename from systems table
 * Format: {manufacturer_norm}_{model_norm}.pdf
 *
 * Normalizes to lowercase and replaces spaces/special chars with underscores
 */
function generateStandardFilename(manufacturer, model) {
  const clean = (str) => str
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')              // Replace spaces with underscore
    .replace(/[^a-z0-9_-]/g, '_')      // Replace special chars with underscore
    .replace(/_+/g, '_')               // Collapse multiple underscores
    .replace(/^_|_$/g, '');            // Trim underscores from ends

  const mfg = clean(manufacturer);
  const mdl = clean(model);

  return `${mfg}_${mdl}.pdf`;
}

// Run script
console.log('🚀 PDF Rename Utility\n');

renamePDFs()
  .then(() => {
    console.log('✅ Complete!');
    process.exit(0);
  })
  .catch(error => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });