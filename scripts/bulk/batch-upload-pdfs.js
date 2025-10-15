// scripts/bulk/batch-upload-pdfs.js
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

/**
 * Batch Upload PDFs to Supabase Storage
 *
 * Uploads renamed PDFs from /Rename folder to Supabase Storage
 * Following existing pattern: manuals/{docId}/{filename}
 * Creates entries in documents table
 *
 * Usage:
 *   node scripts/bulk/batch-upload-pdfs.js [--dry-run] [--move]
 */

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const RENAME_FOLDER = path.join(process.cwd(), 'Rename');
const UPLOADED_FOLDER = path.join(process.cwd(), 'Rename', 'uploaded');

// Parse command line arguments
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const PROCESS_DIP = args.includes('--process'); // Trigger DIP processing
const TEST_MODE = args.includes('--test'); // Test with just one file

// CSV file for tracking uploads
const CSV_FILE = path.join(UPLOADED_FOLDER, 'uploaded_documents.csv');
const CSV_HEADERS = 'doc_id,filename,asset_uid,manufacturer,model,storage_path,file_size_mb,uploaded_at\n';

async function batchUploadPDFs() {
  console.log('📤 Starting Batch PDF Upload...');
  console.log(`📁 Source: ${RENAME_FOLDER}`);
  console.log(`🔧 Mode: ${DRY_RUN ? 'DRY RUN (no actual uploads)' : 'LIVE UPLOAD'}\n`);

  // Check if folder exists
  if (!fs.existsSync(RENAME_FOLDER)) {
    console.log(`❌ Folder not found: ${RENAME_FOLDER}`);
    return;
  }

  // Always create uploaded folder (not just for dry run)
  if (!fs.existsSync(UPLOADED_FOLDER)) {
    fs.mkdirSync(UPLOADED_FOLDER, { recursive: true });
    console.log(`📁 Created: ${UPLOADED_FOLDER}\n`);
  }

  // Initialize CSV file if it doesn't exist
  let csvFileExists = fs.existsSync(CSV_FILE);
  if (!csvFileExists && !DRY_RUN) {
    fs.writeFileSync(CSV_FILE, CSV_HEADERS);
    console.log(`📄 Created CSV tracking file: uploaded_documents.csv\n`);
  } else if (csvFileExists && !DRY_RUN) {
    console.log(`📄 Appending to existing CSV: uploaded_documents.csv\n`);
  }

  // Read all PDF files with standardized names (underscore format)
  let files = fs.readdirSync(RENAME_FOLDER)
    .filter(f => f.toLowerCase().endsWith('.pdf'))
    .filter(f => f.includes('_')) // Only process renamed files
    .sort(); // Sort alphabetically for consistent ordering

  console.log(`📄 Found ${files.length} standardized PDF files\n`);

  if (files.length === 0) {
    console.log('❌ No standardized PDFs found (looking for files with underscores)');
    return;
  }

  // In test mode, only process the first file (or specific test file)
  if (TEST_MODE) {
    // Try to find a victron file for testing, otherwise use first file
    const testFile = files.find(f => f.toLowerCase().startsWith('victron_')) || files[0];
    files = [testFile];
    console.log(`🧪 TEST MODE: Processing only 1 file (${files[0]})\n`);
  }

  // Track results
  const results = {
    uploaded: [],
    skipped: [],
    notFound: [],
    errors: []
  };

  // Process each PDF
  for (let i = 0; i < files.length; i++) {
    const fileName = files[i];
    const filePath = path.join(RENAME_FOLDER, fileName);

    console.log(`[${i + 1}/${files.length}] ${fileName}`);

    try {
      // 1. Parse standardized filename to extract manufacturer and model
      const { manufacturer, model } = parseStandardizedFilename(fileName);
      console.log(`  📋 Parsed: ${manufacturer} / ${model}`);

      // 2. Look up system in database
      let system = null;
      let systemError = null;

      // Handle special cases for manufacturer names
      // Map filename manufacturer to database manufacturer_norm
      let dbManufacturer = manufacturer;
      if (manufacturer.toLowerCase() === 'bg') {
        dbManufacturer = 'B&G';
      } else if (manufacturer.toLowerCase() === 'cyclopsmarine') {
        dbManufacturer = 'Cyclops Marine';
      } else if (manufacturer.toLowerCase() === 'oceansafety') {
        dbManufacturer = 'Ocean Safety';
      } else if (manufacturer.toLowerCase() === 'ritchienavigation') {
        dbManufacturer = 'Ritchie Navigation';
      } else if (manufacturer.toLowerCase() === 'octender') {
        dbManufacturer = 'OC Tender';
      }

      // Debug: Show what we're searching for
      console.log(`  🔍 Searching: manufacturer="${dbManufacturer}", model="${model}"`);

      // Try with the model as-is first (with underscores)
      const result1 = await supabase
        .from('systems')
        .select('asset_uid, manufacturer_norm, model_norm')
        .ilike('manufacturer_norm', dbManufacturer)
        .ilike('model_norm', model)
        .single();

      system = result1.data;
      systemError = result1.error;

      if (systemError && DRY_RUN) {
        console.log(`  ⚠️ Query 1 error: ${systemError.message}`);
      }

      // If not found, try with spaces instead of underscores in model
      if (!system) {
        const result2 = await supabase
          .from('systems')
          .select('asset_uid, manufacturer_norm, model_norm')
          .ilike('manufacturer_norm', dbManufacturer)
          .ilike('model_norm', model.replace(/_/g, ' '))
          .single();

        system = result2.data;
        systemError = result2.error;
      }

      if (systemError || !system) {
        console.log(`  ⚠️  System not found in database`);
        results.notFound.push({
          fileName,
          manufacturer,
          model,
          reason: 'System not found'
        });
        continue;
      }

      console.log(`  ✓ Found system: ${system.asset_uid}`);

      // 3. Read file and generate doc_id (SHA256 hash)
      const fileBuffer = fs.readFileSync(filePath);
      const docId = crypto.createHash('sha256').update(fileBuffer).digest('hex');
      const fileSize = fileBuffer.length;

      console.log(`  📊 File size: ${(fileSize / 1024 / 1024).toFixed(2)} MB`);
      console.log(`  🔑 Doc ID: ${docId.substring(0, 16)}...`);

      // 4. Check if document already exists
      const { data: existingDoc, error: docCheckError } = await supabase
        .from('documents')
        .select('doc_id, storage_path, created_at')
        .eq('doc_id', docId)
        .single();

      if (existingDoc && existingDoc.storage_path) {
        console.log(`  ⏭️  Already uploaded on ${new Date(existingDoc.created_at).toLocaleDateString()}`);
        results.skipped.push({
          fileName,
          docId,
          reason: 'Already uploaded',
          uploadedAt: existingDoc.created_at
        });
        continue;
      }

      // 5. Upload to Supabase Storage (unless dry run)
      const storagePath = `manuals/${docId}/${fileName}`;

      if (DRY_RUN) {
        console.log(`  🔍 [DRY RUN] Would upload to: ${storagePath}`);
      } else {
        console.log(`  📤 Uploading to: ${storagePath}`);

        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('documents')
          .upload(storagePath, fileBuffer, {
            contentType: 'application/pdf',
            upsert: false // Don't overwrite existing files
          });

        if (uploadError) {
          if (uploadError.message?.includes('already exists')) {
            console.log(`  ⚠️  File already exists in storage`);
            // Update document record even if file exists
          } else {
            throw uploadError;
          }
        } else {
          console.log(`  ✅ Upload successful`);
        }
      }

      // 6. Create/update document record (unless dry run)
      if (!DRY_RUN) {
        const documentData = {
          doc_id: docId,
          manufacturer: system.manufacturer_norm,
          model: system.model_norm,
          manufacturer_norm: system.manufacturer_norm,
          model_norm: system.model_norm,
          asset_uid: system.asset_uid,
          storage_path: storagePath,
          language: 'en',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };

        const { data: docData, error: docError } = await supabase
          .from('documents')
          .upsert(documentData, {
            onConflict: 'doc_id'
          })
          .select()
          .single();

        if (docError) {
          throw docError;
        }

        console.log(`  ✅ Document record created/updated`);

        // 7. Update systems table to mark manual as present
        const { error: systemUpdateError } = await supabase
          .from('systems')
          .update({
            manual: true,
            manual_doc_id: docId,
            updated_at: new Date().toISOString()
          })
          .eq('asset_uid', system.asset_uid);

        if (!systemUpdateError) {
          console.log(`  ✅ System manual flag updated`);
        }

        // 8. Move file to uploaded folder (always for successful uploads)
        const newPath = path.join(UPLOADED_FOLDER, fileName);
        fs.renameSync(filePath, newPath);
        console.log(`  📁 Moved to uploaded/`);

        // 9. Append to CSV tracking file
        const csvRow = [
          docId,
          fileName,
          system.asset_uid,
          system.manufacturer_norm,
          system.model_norm,
          storagePath,
          (fileSize / 1024 / 1024).toFixed(2),
          new Date().toISOString()
        ].join(',') + '\n';

        fs.appendFileSync(CSV_FILE, csvRow);
        console.log(`  📝 Added to CSV tracking file`);
      }

      results.uploaded.push({
        fileName,
        docId,
        storagePath,
        assetUid: system.asset_uid,
        fileSize,
        manufacturer: system.manufacturer_norm,
        model: system.model_norm
      });

      console.log('');

    } catch (error) {
      console.log(`  ❌ Error: ${error.message}\n`);
      results.errors.push({
        fileName,
        error: error.message
      });
    }
  }

  // Print summary
  console.log('\n' + '='.repeat(70));
  console.log('📊 UPLOAD SUMMARY');
  console.log('='.repeat(70));
  console.log(`✅ Uploaded:     ${results.uploaded.length}`);
  console.log(`⏭️  Skipped:      ${results.skipped.length}`);
  console.log(`⚠️  Not found:    ${results.notFound.length}`);
  console.log(`❌ Errors:       ${results.errors.length}`);

  // Calculate total size uploaded
  const totalSize = results.uploaded.reduce((sum, f) => sum + f.fileSize, 0);
  console.log(`📦 Total size:   ${(totalSize / 1024 / 1024).toFixed(2)} MB`);
  console.log('='.repeat(70) + '\n');

  if (results.uploaded.length > 0 && !DRY_RUN) {
    console.log('✅ Uploaded files:');
    results.uploaded.forEach(u => {
      console.log(`   ${u.fileName}`);
      console.log(`   → ${u.storagePath}`);
      console.log(`     Doc ID: ${u.docId.substring(0, 16)}...`);
      console.log(`     Asset: ${u.assetUid}\n`);
    });

    console.log(`📝 CSV tracking file updated: ${CSV_FILE}`);
    console.log(`📁 Uploaded files moved to: ${UPLOADED_FOLDER}\n`);

    if (PROCESS_DIP) {
      console.log('💡 Next step: Process these documents with DIP');
      console.log('   Use the admin interface or API to trigger processing');
      console.log('   Doc IDs are saved in the CSV file for reference\n');
    }
  }

  if (results.notFound.length > 0) {
    console.log('⚠️  Systems not found in database:');
    results.notFound.forEach(n => {
      console.log(`   - ${n.fileName}`);
      console.log(`     ${n.manufacturer} / ${n.model}`);
    });
    console.log('');
  }

  if (results.errors.length > 0) {
    console.log('❌ Upload errors:');
    results.errors.forEach(e => {
      console.log(`   - ${e.fileName}`);
      console.log(`     ${e.error}`);
    });
    console.log('');
  }

  if (DRY_RUN) {
    console.log('🔍 This was a DRY RUN - no files were actually uploaded');
    console.log('   Remove --dry-run flag to perform actual upload\n');
  }
}

/**
 * Parse standardized filename to extract manufacturer and model
 * Format: {manufacturer}_{model}.pdf
 * Example: victron_smartshunt_500a_50mv.pdf
 */
function parseStandardizedFilename(fileName) {
  // Remove .pdf extension
  const name = fileName.replace(/\.pdf$/i, '');

  // Split by first underscore
  const parts = name.split('_');

  if (parts.length < 2) {
    throw new Error('Invalid filename format - expected manufacturer_model.pdf');
  }

  const manufacturer = parts[0];
  const model = parts.slice(1).join('_'); // Everything after first underscore is model

  return { manufacturer, model };
}

// Run script
console.log('🚀 Batch PDF Upload Utility\n');
console.log('Options:');
console.log('  --dry-run   Preview what will be uploaded without doing it');
console.log('  --test      Process only ONE file for testing');
console.log('  --process   Show reminder to trigger DIP processing\n');
console.log('Behavior:');
console.log('  • Successfully uploaded files are moved to /Rename/uploaded/');
console.log('  • Doc IDs are tracked in /Rename/uploaded/uploaded_documents.csv\n');

batchUploadPDFs()
  .then(() => {
    console.log('✅ Complete!');
    process.exit(0);
  })
  .catch(error => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });