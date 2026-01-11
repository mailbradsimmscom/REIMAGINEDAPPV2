# Utility Scripts & Shared Utilities

## Overview

This document covers two types of utilities:
1. **Scripts** (`scripts/`) - Development, testing, and maintenance tasks
2. **Shared Utilities** (`src/utils/`) - Reusable modules used across the codebase

---

## Shared Utilities (src/utils/)

Reusable utility modules imported by services throughout the application.

| File | Purpose |
|------|---------|
| `logger.js` | Structured logging with Winston |
| `nominatim.js` | Reverse geocoding for place names |
| `formatter.js` | Text formatting utilities |
| `validation.js` | Input validation helpers |
| `url.js` | URL construction utilities |
| `metrics.js` | Event metrics tracking |
| `retry.js` | Retry logic with backoff |

---

### Nominatim Reverse Geocoding

**File:** `src/utils/nominatim.js`

Shared utility for converting GPS coordinates to human-readable place names. Used by both trips and anchorages for consistent place naming.

**Features:**
- Town-first preference (more recognizable for sailors)
- French Caribbean territory handling (shows "Guadeloupe" instead of "France")
- Rate limiting support for batch operations
- Country context in place names

**Exported Functions:**

```javascript
import { reverseGeocode, delay, batchReverseGeocode } from '../utils/nominatim.js';

// Single coordinate lookup
const placeName = await reverseGeocode(16.3089, -61.7989);
// Returns: "Deshaies, Guadeloupe"

// Delay for rate limiting (Nominatim requires max 1 req/sec)
await delay();  // Waits 1100ms

// Batch geocode with automatic rate limiting
const results = await batchReverseGeocode([
  { lat: 16.3089, lon: -61.7989, id: 'trip-1' },
  { lat: 14.6167, lon: -61.0667, id: 'trip-2' }
]);
// Returns: [{ lat, lon, id, placeName: "Deshaies, Guadeloupe" }, ...]
```

**Place Name Preference Order:**
1. `town` (most recognizable)
2. `village`
3. `city`
4. `island`
5. `municipality`
6. `county`
7. `state_district`
8. `state`

**French Caribbean Handling:**

For locations in French overseas territories, the territory name is shown instead of "France":

| Coordinates | Without Special Handling | With Special Handling |
|-------------|-------------------------|----------------------|
| Deshaies, Guadeloupe | "Deshaies, France" | "Deshaies, Guadeloupe" |
| Fort-de-France | "Fort-de-France, France" | "Fort-de-France, Martinique" |

Supported territories: Guadeloupe, Martinique, Saint Martin, Saint Barthélemy

**Used By:**
- `src/services/trips/trips.service.js` - Trip title generation
- `src/services/anchorages/anchorages.service.js` - Anchorage location names

**API:** [OpenStreetMap Nominatim](https://nominatim.org/release-docs/develop/api/Reverse/)

---

## Scripts (scripts/)

Utility scripts are located in `scripts/` and handle various development, testing, and maintenance tasks. These are primarily for internal use and are not part of the main application flow.

**Location:** `/scripts/*.js`, `/scripts/*.mjs`, `/scripts/*.py`

---

## Script Categories

### Test Scripts

Development and phase testing scripts (internal use).

| Script | Description |
|--------|-------------|
| `test-fact-first-retrieval.js` | Test fact retrieval logic |
| `test-golden-tests-simple.js` | Simple golden test runner |
| `test-knowledge-facts-view.js` | Test knowledge facts view |
| `test-knowledge-repository-simple.js` | Test knowledge repository |
| `test-openai-vision.js` | Test OpenAI vision API |
| `test-phase-1-1.js` | Phase 1.1 tests |
| `test-phase-1-2.js` | Phase 1.2 tests |
| `test-phase-1-3.js` | Phase 1.3 tests |
| `test-phase-1-4.js` | Phase 1.4 tests |
| `test-phase-3-1.js` | Phase 3.1 tests |
| `test-phase-3-2.js` | Phase 3.2 tests |
| `test-phase-3-2-simple.js` | Phase 3.2 simplified tests |
| `test-phase-3-4.js` | Phase 3.4 tests |
| `test-phase-3-5.js` | Phase 3.5 tests |
| `test-phase-3-6-complete-workflow.js` | Phase 3.6 complete workflow |
| `test-phase-3-6-golden-tests.js` | Phase 3.6 golden tests |
| `test-refactored-approval.js` | Test refactored approval flow |
| `test-repository-functions.js` | Test repository functions |
| `test-schema-alignment.js` | Test schema alignment |
| `test-single-upload.js` | Test single file upload |
| `test-step8-complete.js` | Step 8 completion tests |
| `test-upload-refactor.js` | Test upload refactor |
| `upload-test-results.js` | Upload test results to database |
| `upload-nightly-results.js` | Upload nightly test results |

---

### Supplies/Import Scripts

Data import and supplies management.

| Script | Description |
|--------|-------------|
| `import-supplies-csv.js` | Import supplies from CSV file |
| `import-supplies-from-csv.js` | Alternative CSV import |
| `convert-supply-sheet.js` | Convert supply spreadsheet format |
| `delete-all-supplies.js` | Delete all supplies (dangerous) |
| `check-supplies-schema.js` | Validate supplies schema |
| `add-item-type-column.js` | Add item_type column to supplies |
| `migrate-supplies-add-item-type.js` | Migration for item_type |
| `get-all-categories.js` | List all supply categories |

---

### Check/Verify Scripts

Validation and compliance checking.

| Script | Description |
|--------|-------------|
| `check-chat-timing-data.js` | Verify chat timing data |
| `check-document-chunks.js` | Check document chunk integrity |
| `check-existing-chunks.js` | Verify existing chunks |
| `check-playbook-hints-structure.js` | Validate playbook hints |
| `check-systems-with-manuals.js` | List systems with manuals |
| `check-ui-coverage.js` | Check UI test coverage |
| `verify-cleanup.js` | Verify cleanup completed |
| `verify-import.js` | Verify import success |
| `verify-schema-step7.js` | Verify step 7 schema |
| `verify-timing-code.js` | Verify timing code |
| `compliance.mjs` | Run compliance checks |
| `zod-coverage.mjs` | Check Zod validation coverage |

---

### Architecture/Docs Generation

Documentation and architecture generation.

| Script | Description |
|--------|-------------|
| `generate-docs.mjs` | Generate documentation |
| `generate-structurizr.mjs` | Generate Structurizr diagrams |
| `generate-structurizr-sidecar.py` | Structurizr for Python sidecar |
| `combine-structurizr.mjs` | Combine Structurizr files |
| `dump-routes.mjs` | Dump all routes to file |
| `crawl-codebase.mjs` | Crawl and index codebase |
| `update-docs-json.mjs` | Update docs.json index |

---

### Data/Migration Scripts

Database migrations and data operations.

| Script | Description |
|--------|-------------|
| `migrate-phase-1-1.js` | Phase 1.1 migration |
| `run-migration-002.js` | Run migration 002 |
| `create-test-data-step7.js` | Create test data for step 7 |
| `insert-sample-results.js` | Insert sample test results |
| `export-systems-needing-manuals.js` | Export systems without manuals |
| `get-column-structure.js` | Get database column structure |
| `refresh-knowledge-facts.js` | Refresh knowledge facts cache |
| `get-all-units.js` | List all measurement units |

---

### Cleanup Scripts

Data cleanup and maintenance.

| Script | Description |
|--------|-------------|
| `cleanup-doc.py` | Clean up document data |
| `cleanup-pass2.js` | Second pass cleanup |
| `cleanup-test-data.js` | Clean up test data |
| `review-pass1.js` | First pass review |

---

### Debug/Analysis Scripts

Debugging and analysis tools.

| Script | Description |
|--------|-------------|
| `debug-dip-generation.js` | Debug DIP generation |
| `findPressure.js` | Find pressure-related data |
| `findPressureSidecar.js` | Find pressure via sidecar |
| `find-min-chunks-with-all-dips.js` | Find minimum chunks with DIPs |
| `analyze-excel.py` | Analyze Excel files |
| `analyze-failures.py` | Analyze test failures |
| `get-failures.js` | Get failure details |
| `query-test-results.js` | Query test results |

---

### Other Scripts

Miscellaneous utilities.

| Script | Description |
|--------|-------------|
| `discover-ui-pages.js` | Discover UI page routes |
| `list-categories.js` | List available categories |
| `get-test-ids.js` | Get test identifiers |
| `performance-monitor.js` | Performance monitoring |
| `victron_mqtt_test.py` | Test Victron MQTT connection |

---

## Running Scripts

```bash
# From project root
node scripts/<script-name>.js

# For .mjs files
node scripts/<script-name>.mjs

# For Python scripts
python scripts/<script-name>.py
```

---

## Notes

- Most scripts require environment variables from `.env`
- Scripts automatically load `dotenv/config`
- Some scripts modify database data - use caution
- Test scripts are for development phases, not production testing
- See `tests/` directory for actual test suite

---

## Related Docs

- [Agents](./agents.md) - Automated agents (manual-hunter, manual-validator)
- [Batch Scripts](./batch-scripts.md) - Bulk operations (`scripts/bulk/`)
- [CI Testing](../00-foundations/ci-testing.md) - Test suite documentation
