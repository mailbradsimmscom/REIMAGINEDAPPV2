// scripts/bulk/fix-manufacturer-underscores.js
import fs from 'fs';
import path from 'path';

/**
 * Fix Manufacturer Underscores in Filenames
 *
 * Fixes problematic underscores in manufacturer names:
 * - b_g_* → bg_*
 * - B_G_* → bg_*
 * - cyclops_marine_* → cyclopsmarine_*
 * - Cyclops_Marine_* → cyclopsmarine_*
 * - ocean_safety_* → oceansafety_*
 * - Ocean_Safety_* → oceansafety_*
 * - ritchie_navigation_* → ritchienavigation_*
 * - Ritchie_Navigation_* → ritchienavigation_*
 */

const RENAME_FOLDER = path.join(process.cwd(), 'Rename');

async function fixManufacturerUnderscores() {
  console.log('🔧 Fixing manufacturer underscores in filenames...');
  console.log(`📁 Folder: ${RENAME_FOLDER}\n`);

  // Check if folder exists
  if (!fs.existsSync(RENAME_FOLDER)) {
    console.log(`❌ Folder not found: ${RENAME_FOLDER}`);
    return;
  }

  // Read all PDF files
  const files = fs.readdirSync(RENAME_FOLDER)
    .filter(f => f.toLowerCase().endsWith('.pdf'));

  console.log(`📄 Found ${files.length} PDF files\n`);

  const results = {
    renamed: [],
    skipped: [],
    errors: []
  };

  // Define manufacturer fixes
  const manufacturerFixes = [
    // B&G products
    { pattern: /^b_g_/i, replacement: 'bg_' },
    { pattern: /^B_G_/i, replacement: 'bg_' },

    // Cyclops Marine products
    { pattern: /^cyclops_marine_/i, replacement: 'cyclopsmarine_' },
    { pattern: /^Cyclops_Marine_/i, replacement: 'cyclopsmarine_' },

    // Ocean Safety
    { pattern: /^ocean_safety_/i, replacement: 'oceansafety_' },
    { pattern: /^Ocean_Safety_/i, replacement: 'oceansafety_' },

    // Ritchie Navigation
    { pattern: /^ritchie_navigation_/i, replacement: 'ritchienavigation_' },
    { pattern: /^Ritchie_Navigation_/i, replacement: 'ritchienavigation_' },

    // OC Tender (special case)
    { pattern: /^oc_tender_/i, replacement: 'octender_' }
  ];

  // Process each file
  for (let i = 0; i < files.length; i++) {
    const oldFileName = files[i];
    const oldFilePath = path.join(RENAME_FOLDER, oldFileName);

    console.log(`[${i + 1}/${files.length}] ${oldFileName}`);

    let newFileName = oldFileName;
    let wasFixed = false;

    // Apply manufacturer fixes
    for (const fix of manufacturerFixes) {
      if (fix.pattern.test(oldFileName)) {
        newFileName = oldFileName.replace(fix.pattern, fix.replacement);
        wasFixed = true;
        break;
      }
    }

    // If no fix applied, skip this file
    if (!wasFixed) {
      console.log(`  ✓ No fix needed\n`);
      results.skipped.push(oldFileName);
      continue;
    }

    const newFilePath = path.join(RENAME_FOLDER, newFileName);

    // Check if target already exists
    if (fs.existsSync(newFilePath)) {
      console.log(`  ⚠️ Target file already exists: ${newFileName}\n`);
      results.errors.push({
        oldFileName,
        newFileName,
        reason: 'Target exists'
      });
      continue;
    }

    try {
      // Rename the file
      fs.renameSync(oldFilePath, newFilePath);
      console.log(`  ✅ → ${newFileName}\n`);

      results.renamed.push({
        oldName: oldFileName,
        newName: newFileName
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
  console.log('='.repeat(70));
  console.log('📊 FIX SUMMARY');
  console.log('='.repeat(70));
  console.log(`✅ Fixed:       ${results.renamed.length}`);
  console.log(`⏭️  Skipped:     ${results.skipped.length}`);
  console.log(`❌ Errors:      ${results.errors.length}`);
  console.log('='.repeat(70) + '\n');

  if (results.renamed.length > 0) {
    console.log('✅ Fixed files:');
    results.renamed.forEach(r => {
      console.log(`   ${r.oldName} → ${r.newName}`);
    });
    console.log('');
    console.log('🎉 Files fixed! Now run the upload script again:');
    console.log('   node scripts/bulk/batch-upload-pdfs.js\n');
  }

  if (results.errors.length > 0) {
    console.log('❌ Errors:');
    results.errors.forEach(e => {
      console.log(`   ${e.oldFileName}: ${e.reason}`);
    });
    console.log('');
  }
}

// Run script
console.log('🚀 Manufacturer Underscore Fix Utility\n');
console.log('This will fix problematic underscores in manufacturer names:');
console.log('  • b_g_* → bg_*');
console.log('  • cyclops_marine_* → cyclopsmarine_*');
console.log('  • ocean_safety_* → oceansafety_*');
console.log('  • ritchie_navigation_* → ritchienavigation_*\n');

fixManufacturerUnderscores()
  .then(() => {
    console.log('✅ Complete!');
    process.exit(0);
  })
  .catch(error => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });