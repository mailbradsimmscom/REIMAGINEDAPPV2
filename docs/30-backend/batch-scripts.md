# Batch Scripts

## Overview

Batch scripts handle bulk operations that are too large or complex for the UI. Located in `/scripts/` directory.

**When to use:** Bulk uploads, data migrations, cleanup operations, reporting

---

## Available Scripts (`scripts/bulk/`)

| Script | Purpose |
|--------|---------|
| `batch-upload-pdfs.js` | Bulk upload PDFs with system lookup |
| `batch-dip-to-staging.js` | Process DIP extractions |
| `batch-llamaparse.js` | Process with LlamaParse |
| `check-duplicates.js` | Find duplicate chunks |
| `check-chunks-size.js` | Verify chunk sizes |
| `resync-missing-vectors.js` | Resync missing Pinecone vectors |
| `analyze-systems-keywords.js` | Extract system keywords |
| `add-manual-systems-to-csv.js` | Add systems to tracking |
| `remove-manual-systems-from-csv.js` | Remove from tracking |
| `rename-pdfs-from-systems.js` | Standardize PDF filenames |
| `fix-manufacturer-underscores.js` | Fix naming issues |
| `generate-keywords-synonyms.js` | Generate search synonyms |
| `sample-systems-data.js` | Sample data for testing |
| `check-local-manual-names.js` | Validate local PDF names |
| `batch-colloquial-extraction.js` | Extract colloquial terms |

---

## Key Script: batch-upload-pdfs.js

The primary script for bulk document upload with full system lookup.

### Usage

```bash
# Preview what will be uploaded (no changes)
node scripts/bulk/batch-upload-pdfs.js --dry-run

# Upload with live database changes
node scripts/bulk/batch-upload-pdfs.js

# Test with single file
node scripts/bulk/batch-upload-pdfs.js --test

# Show reminder to trigger DIP after
node scripts/bulk/batch-upload-pdfs.js --process
```

### Script Flow

```javascript
// scripts/bulk/batch-upload-pdfs.js:37-360
async function batchUploadPDFs() {
  console.log('📤 Starting Batch PDF Upload...');
  console.log(`📁 Source: ${RENAME_FOLDER}`);
  console.log(`🔧 Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE UPLOAD'}\n`);

  // 1. Read PDF files with standardized names
  let files = fs.readdirSync(RENAME_FOLDER)
    .filter(f => f.toLowerCase().endsWith('.pdf'))
    .filter(f => f.includes('_'))  // Only renamed files
    .sort();

  // 2. Process each PDF
  for (let i = 0; i < files.length; i++) {
    const fileName = files[i];

    // 3. Parse filename: {manufacturer}_{model}.pdf
    const { manufacturer, model } = parseStandardizedFilename(fileName);

    // 4. Look up system in database
    const result = await supabase
      .from('systems')
      .select('asset_uid, manufacturer_norm, model_norm')
      .ilike('manufacturer_norm', manufacturer)
      .ilike('model_norm', model)
      .single();

    if (!result.data) {
      console.log(`  ⚠️ System not found: ${manufacturer} / ${model}`);
      continue;
    }

    // 5. Generate doc_id from file hash
    const fileBuffer = fs.readFileSync(filePath);
    const docId = crypto.createHash('sha256').update(fileBuffer).digest('hex');

    // 6. Check if already uploaded
    const { data: existingDoc } = await supabase
      .from('documents')
      .select('doc_id, storage_path')
      .eq('doc_id', docId)
      .single();

    if (existingDoc?.storage_path) {
      console.log(`  ⏭️ Already uploaded`);
      continue;
    }

    // 7. Upload to Supabase Storage
    const storagePath = `manuals/${docId}/${fileName}`;
    await supabase.storage
      .from('documents')
      .upload(storagePath, fileBuffer, {
        contentType: 'application/pdf',
        upsert: false
      });

    // 8. Create document record
    await supabase.from('documents').upsert({
      doc_id: docId,
      manufacturer_norm: result.data.manufacturer_norm,
      model_norm: result.data.model_norm,
      asset_uid: result.data.asset_uid,
      storage_path: storagePath,
      language: 'en'
    });

    // 9. Update systems table
    await supabase.from('systems').update({
      manual: true,
      manual_doc_id: docId
    }).eq('asset_uid', result.data.asset_uid);

    // 10. Move to uploaded folder
    fs.renameSync(filePath, path.join(UPLOADED_FOLDER, fileName));
  }
}
```

### Filename Convention

Files must follow: `{manufacturer}_{model}.pdf`

```javascript
// scripts/bulk/batch-upload-pdfs.js:367-382
function parseStandardizedFilename(fileName) {
  // Remove .pdf extension
  const name = fileName.replace(/\.pdf$/i, '');

  // Split by first underscore
  const parts = name.split('_');

  if (parts.length < 2) {
    throw new Error('Invalid filename format - expected manufacturer_model.pdf');
  }

  const manufacturer = parts[0];
  const model = parts.slice(1).join('_');  // Rest is model

  return { manufacturer, model };
}
```

### Manufacturer Mapping

Special cases for manufacturer names:

```javascript
// scripts/bulk/batch-upload-pdfs.js:110-122
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
```

### Output Tracking

Results tracked in CSV file:

```javascript
// scripts/bulk/batch-upload-pdfs.js:34-35
const CSV_FILE = path.join(UPLOADED_FOLDER, 'uploaded_documents.csv');
const CSV_HEADERS = 'doc_id,filename,asset_uid,manufacturer,model,storage_path,file_size_mb,uploaded_at\n';
```

### Result Summary

```javascript
// scripts/bulk/batch-upload-pdfs.js:306-317
console.log('📊 UPLOAD SUMMARY');
console.log(`✅ Uploaded:     ${results.uploaded.length}`);
console.log(`⏭️  Skipped:      ${results.skipped.length}`);
console.log(`⚠️  Not found:    ${results.notFound.length}`);
console.log(`❌ Errors:       ${results.errors.length}`);

const totalSize = results.uploaded.reduce((sum, f) => sum + f.fileSize, 0);
console.log(`📦 Total size:   ${(totalSize / 1024 / 1024).toFixed(2)} MB`);
```

---

## Directory Structure

```
scripts/
├── bulk/                    # Bulk operations
│   ├── batch-upload-pdfs.js
│   ├── check-duplicates.js
│   └── resync-missing-vectors.js
├── agents/                  # Automated agents
├── debug/                   # Debug utilities
├── dump-routes.mjs          # Route documentation
├── compliance.mjs           # Code compliance checks
└── export-systems-needing-manuals.js
```

---

## Running Scripts

### From Project Root

```bash
cd /Users/brad/code/REIMAGINEDAPPV2
node scripts/bulk/batch-upload-pdfs.js --dry-run
```

### With Environment Variables

Scripts automatically load `.env` via `dotenv/config`:

```javascript
// Top of script
import 'dotenv/config';
```

---

## Script Pattern

Standard structure for new scripts:

```javascript
// scripts/bulk/example.js
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Parse command line arguments
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');

async function main() {
  console.log(`🔧 Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}\n`);

  // Script logic here

  console.log('✅ Complete!');
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });
```

---

## Important Notes

1. **Always use `--dry-run` first** to preview changes
2. **Test with `--test` flag** on single file first
3. **Check output summary** for errors before continuing
4. **Files moved after upload** to prevent duplicates
5. **CSV tracking** maintains audit trail

---

## What We DON'T Do

| Misconception | Reality |
|---------------|---------|
| "Scripts are UI-accessible" | **No.** CLI only |
| "Scripts auto-run" | **No.** Manual execution |
| "Safe to run anytime" | **Careful.** Some modify data |
| "No backup needed" | **Wrong.** Always backup first |

---

## Related Docs

- [Documents](../20-admin-tools/documents.md) - Document pipeline
- [Pinecone](../20-admin-tools/pinecone.md) - Vector operations
- [Systems](../20-admin-tools/systems.md) - System lookup
- [Python Sidecar](./python-sidecar.md) - Python scripts
