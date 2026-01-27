# 81 AIS Feature and Missing Files Crisis

**Date:** 2026-01-27
**Status:** IN PROGRESS - Render deploy still failing

---

## What Was Built

### AIS Feature (Complete)
New feature to track AIS vessels around the boat and maintain a "Friends" list.

**Files Created:**
- `src/public/ais.html` - Main page with Around Us / Friends tabs
- `src/public/js/ais.js` - Frontend JavaScript
- `src/repositories/ais.repository.js` - DB queries for ais_vessels and ais_friends
- `src/services/ais.service.js` - Distance calculation (Haversine), business logic
- `src/routes/admin/ais.route.js` - Admin API endpoints
- `scripts/migrations/045_ais_friends_table.sql` - Create ais_friends table
- `scripts/migrations/046_ais_friends_last_seen.sql` - Add last_seen tracking
- `scripts/test-aisstream.cjs` - Test script for aisstream.io API

**Files Modified:**
- `src/routes/admin/index.js` - Mount AIS router
- `src/public/other-links.html` - Add AIS link
- `src/config/env.js` - Add AISSTREAM_API_KEY

**Database Tables:**
```sql
-- Run in Supabase (ALREADY DONE)
CREATE TABLE ais_friends (
  mmsi TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  ship_type TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_latitude DECIMAL(9,6),
  last_longitude DECIMAL(9,6),
  last_seen_at TIMESTAMPTZ
);
```

**API Endpoints:**
- `GET /admin/api/ais/around-us` - Vessels sorted by distance (nm)
- `GET /admin/api/ais/friends` - Friends with last_seen data
- `POST /admin/api/ais/friends` - Add friend (body: {mmsi, name, ship_type})
- `DELETE /admin/api/ais/friends/:mmsi` - Remove friend

**Features:**
- Around Us: Shows vessels from `ais_vessels` sorted by distance in nautical miles
- Heart button to add vessel as friend
- Friends tab with last seen position tracking
- Manual add friend form (MMSI + name)

---

## The Problem: Missing Committed Files

Render deploy kept failing because many files existed locally but were **never committed to git**.

### Files That Were Missing (Now Committed)

**Commit ad7a3811:**
- `src/routes/admin/document-ingest.route.js`
- `src/routes/admin/reference-data.route.js`

**Commit 31e7d039:**
- `src/services/document-ingest.service.js`
- `src/services/vision-pipeline.service.js`
- `src/services/dip-telegram-bot.service.js`
- `src/utils/retry.js`

**Commit ed24edf6:**
- `src/repositories/doc-assets.repository.js`
- `src/services/agents/dip-confidence.service.js`
- `src/services/agents/dip-exemplar.service.js`
- `src/services/agents/dip-metrics.service.js`
- `src/services/agents/dip-policy.service.js`
- `src/services/agents/dip-review-agent.service.js`

---

## Post-Compact Instructions

### If Render Is Still Failing

1. **Get the exact error from Render logs:**
   ```
   Error [ERR_MODULE_NOT_FOUND]: Cannot find module '...'
   ```

2. **Check if the file exists locally but isn't committed:**
   ```bash
   # Check git status for the file
   git status src/path/to/missing-file.js

   # If it shows as untracked (??) or not listed, it needs to be committed
   ```

3. **Find ALL untracked JS files in src/:**
   ```bash
   git ls-files --others --exclude-standard 'src/**/*.js'
   ```

4. **Commit any missing files:**
   ```bash
   git add src/path/to/file.js
   git commit -m "Add missing file required by imports"
   git push
   ```

5. **Trigger fresh Render deploy** (clear build cache)

### To Verify Locally Before Pushing

```bash
# Syntax check all imports resolve
node --check src/start.js
node --check src/app.js

# Or try to actually start (Ctrl+C to stop)
npm run dev
```

### Current Git Status

```bash
# Latest commit
git log --oneline -1
# Should be: ed24edf6 Add all missing repository and agent service files

# Check for remaining untracked src files
git ls-files --others --exclude-standard 'src/**/*.js'
# Should return nothing
```

---

## AIS External API Research

Investigated options for tracking friends globally (when they leave AIS range):

| Service | Type | Issue |
|---------|------|-------|
| aisstream.io | WebSocket | Works but poor Caribbean coverage |
| AISHub | REST | Requires 24/7 data sharing (run a station) |
| MarineTraffic | REST | $100+/month, blocks scraping |
| Datalastic | REST | €199/month minimum |

**Decision:** Use "Last Seen" tracking instead - store last known position when friend leaves AIS range. No external API needed.

---

## Files Still Modified But NOT Committed

These files have local changes but weren't part of the AIS feature commit:

```
M src/app.js
M src/public/documents.html
M src/public/landing.html
M src/public/upload.html
M src/repositories/document.repository.js
M src/routes/admin/jobs.route.js
M src/routes/admin/suggestions.route.js
M src/routes/document/ingest.route.js
M src/routes/document/job-status.route.js
M src/routes/system-management.route.js
M src/schemas/document.schema.js
M src/schemas/systems.schema.js
M src/services/document-deletion.service.js
M src/services/document.service.js
M src/services/keywords-synonyms-generation.service.js
M src/services/system-management.service.js
M src/start.js
M src/utils/validation.js
```

**These may contain imports that reference uncommitted files!** If Render keeps failing, check if any of these modified files import something that doesn't exist in the repo.

---

## Next Steps

1. Get current Render error
2. If still failing, check what file is missing
3. Commit any remaining missing files
4. Consider committing all modified files to ensure consistency
