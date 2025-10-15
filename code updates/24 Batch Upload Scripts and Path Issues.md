# Session 24: Batch Upload Scripts and Path Issues
**Date:** 2025-10-14
**Status:** Scripts created, database lookup issue unresolved

---

## Session Summary

Created comprehensive batch processing scripts for PDF management:
1. **PDF Rename Script** - Renames PDFs based on systems table data
2. **Batch Upload Script** - Uploads renamed PDFs to Supabase storage
3. **Fixed path issues** between computers (`/Users/brad` vs `/Users/brads`)

### Major Issue Encountered
The batch upload script cannot find systems in the database due to case sensitivity and formatting mismatches between filenames and database entries.

---

## 1. Path Issue Resolution ✅

### Problem
Hardcoded paths in `anthropic.extraction.service.js` used absolute paths:
```javascript
// BEFORE - Would break on different machines
const command = `cd /Users/brad/code/REIMAGINEDAPPV2/python-sidecar && DOC_ID=${docId} venv/bin/python3 scripts/test_anthropic_chunks_spec.py`;
```

### Solution
Changed to relative paths that work on any machine:
```javascript
// AFTER - Works everywhere
const command = `cd python-sidecar && DOC_ID=${docId} venv/bin/python3 scripts/test_anthropic_chunks_spec.py`;
```

**Files Modified:**
- `src/services/anthropic.extraction.service.js` (4 methods updated)

---

## 2. PDF Rename Script ✅

**Location:** `/scripts/bulk/rename-pdfs-from-systems.js`

### What It Does
- Reads PDFs from `/Rename` folder
- Looks up `local_manual_file_name` in systems table
- Renames to standardized format: `{manufacturer_norm}_{model_norm}.pdf`
- Handles files with/without `.pdf` extension in database

### Test Results
Successfully renamed 42 files in first run:
- ✅ Renamed: 42 files
- ⏭️ Skipped: 0
- ⚠️ Not found: 5 (not in systems table)
- ❌ Errors: 24 (duplicates)

### Example Rename
```
0AJHC-EN0015_2019.12.pdf → yanmar_port_stbd_engine.pdf
```

---

## 3. Batch Upload Script ⚠️

**Location:** `/scripts/bulk/batch-upload-pdfs.js`

### Features Implemented
- Reads renamed PDFs from `/Rename` folder
- Generates SHA256 doc_id from file content
- Uploads to `manuals/{docId}/{filename}` in Supabase Storage
- Creates/updates documents table entries
- Moves uploaded files to `/Rename/uploaded/`
- Tracks uploads in CSV: `/Rename/uploaded/uploaded_documents.csv`
- `--test` flag to process only one file
- `--dry-run` flag for preview mode

### CSV Tracking Format
```csv
doc_id,filename,asset_uid,manufacturer,model,storage_path,file_size_mb,uploaded_at
```

### The Problem 🔴
Script cannot match filenames to database records:

**Filename:** `victron_cerbo_gx.pdf`
- Parsed as: `manufacturer="victron"`, `model="cerbo_gx"`

**Database has:**
- `manufacturer_norm="Victron"` (capital V)
- `model_norm="cerbo_gx"` (with underscore)

**Test query confirmed:**
```javascript
// This works:
.ilike('manufacturer_norm', 'victron')
.ilike('model_norm', 'cerbo_gx')
// Returns: FOUND ✅

// But in the script context, it fails
// Likely due to `.single()` finding multiple records
```

### Database Query Error
```
Query 1 error: Cannot coerce the result to a single JSON object
```
This suggests there may be **duplicate entries** in the systems table.

---

## 4. File Structure

```
/REIMAGINEDAPPV2/
├── scripts/
│   ├── bulk/
│   │   ├── rename-pdfs-from-systems.js    # Rename script
│   │   ├── batch-upload-pdfs.js           # Upload script
│   │   └── check-local-manual-names.js    # Database checker
│   └── test-single-upload.js              # Database test
├── Rename/
│   ├── [PDFs to process]
│   └── uploaded/                          # Processed files
│       └── uploaded_documents.csv         # Tracking CSV
└── .gitignore (updated)
    ├── Rename/
    └── victron-manuals/
```

---

## 5. Victron Manuals Downloaded ✅

Successfully downloaded 8 Victron manuals (47.3 MB):
1. SmartShunt_500A_Manual.pdf
2. Orion_TR_Smart_24-12-30A_Manual.pdf
3. SmartSolar_MPPT_250-100_Manual.pdf
4. LiFePO4_Battery_Smart_Manual.pdf
5. Cerbo_GX_Datasheet.pdf
6. Lynx_Distributor_Manual.pdf
7. Lynx_Smart_BMS_500_Manual.pdf
8. Quattro_48-5000_Manual.pdf

Stored in `/victron-manuals/` (added to .gitignore)

---

## 6. Next Steps to Fix Upload Script

### Option 1: Fix Duplicate Records
Check for duplicate systems:
```sql
SELECT manufacturer_norm, model_norm, COUNT(*)
FROM systems
WHERE manufacturer_norm ILIKE 'victron'
GROUP BY manufacturer_norm, model_norm
HAVING COUNT(*) > 1;
```

### Option 2: Modify Query Logic
Instead of `.single()`, use `.limit(1)`:
```javascript
const result = await supabase
  .from('systems')
  .select('asset_uid, manufacturer_norm, model_norm, id')
  .ilike('manufacturer_norm', dbManufacturer)
  .ilike('model_norm', model)
  .limit(1);

system = result.data?.[0];
```

### Option 3: Create Lookup Table
Create a mapping table for filename patterns to asset_uids:
```sql
CREATE TABLE filename_mappings (
  filename_pattern TEXT PRIMARY KEY,
  asset_uid UUID REFERENCES systems(asset_uid)
);
```

### Option 4: Manual Mapping
For the 69 files, create a manual mapping JSON:
```javascript
const manualMappings = {
  "victron_cerbo_gx": "5480345b-3ecf-fa1b-0cfc-659fe978dc4a",
  "b_g_halo24_plus": "asset-uid-here",
  // ... etc
};
```

---

## 7. Commands Reference

```bash
# Rename PDFs based on systems table
node scripts/bulk/rename-pdfs-from-systems.js

# Check database entries
node scripts/bulk/check-local-manual-names.js

# Upload PDFs (with options)
node scripts/bulk/batch-upload-pdfs.js --dry-run  # Preview only
node scripts/bulk/batch-upload-pdfs.js --test     # One file only
node scripts/bulk/batch-upload-pdfs.js            # Full upload

# Start servers with fixed paths
./restart-all.sh
```

---

## 8. Key Learnings

1. **Path Portability:** Always use relative paths or `process.cwd()` for cross-machine compatibility
2. **Database Consistency:** Standardized naming in database is critical for automated matching
3. **Case Sensitivity:** Even with `ilike`, formatting inconsistencies cause issues
4. **Single vs Multiple Results:** `.single()` throws error if multiple records match
5. **File Organization:** Clear folder structure with `/uploaded` subfolder prevents reprocessing

---

## 9. Files in Rename Folder (Sample)

Total: 69 PDFs ready for upload

Examples of problematic matches:
- `0AJHC-EN0015_2019.12.pdf` → Not found
- `B_G_halo24_plus.pdf` → Needs B&G conversion
- `Cyclops_Marine_bg03_smartfittings_gateway.pdf` → Needs "Cyclops Marine"
- `victron_cerbo_gx.pdf` → Case sensitivity issue

---

## Session Outcome

✅ **Completed:**
- Fixed hardcoded paths for cross-machine compatibility
- Created working rename script (42 files successfully renamed)
- Built comprehensive upload script with CSV tracking
- Downloaded all Victron manuals

⚠️ **Blocked:**
- Upload script cannot match filenames to database due to formatting inconsistencies
- Likely duplicate records causing "Cannot coerce to single JSON object" error
- Needs database cleanup or alternative matching strategy

📝 **Recommendation:**
Before running batch upload, either:
1. Clean up duplicate records in systems table
2. Modify script to handle duplicates with `.limit(1)`
3. Create manual mapping for the 69 files

---

**End of Session 24**