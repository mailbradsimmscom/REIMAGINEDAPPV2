# 104 Supabase 1000-Row Limit — Trip Display Bug

**Date:** 2026-04-25
**Severity:** High - Trip stats and display truncated on long passages
**Affected Trip:** Fajardo, PR to Ashton, SVG (April 22-24, 2026) — 425.85 nm, 1,821 telemetry rows

---

## What Happened

The Fajardo-to-Ashton passage (425.85 nm, ~61 hours) initially showed as 234.18 nm with the track/map ending mid-ocean. The trip collector worked correctly the entire passage — all 1,821 telemetry rows with full SignalK data were captured with zero gaps.

**The bug was in the Node.js backend**, not the trip collector. Supabase REST API has a default 1,000 row limit. Multiple queries in `trips.service.js` fetched telemetry without pagination, so only the first 1,000 rows were used for:
- `stopTrip()` — computed wrong distance, end coordinates, and title
- `getTrip()` — returned truncated track for map display
- `getActiveTripStats()` — showed wrong live stats
- `getTelemetrySamples()` — data table cut off at row 1,000

---

## What Was Fixed (2026-04-25)

### 1. Trip stats recalculated via direct Supabase API
- Fetched all 1,821 rows with pagination
- Updated trip record: 234.18 nm → 425.85 nm, correct end coords (12.61°N, 61.47°W)
- No telemetry rows were modified or deleted

### 2. Added `fetchAllTelemetry()` helper to `trips.service.js`
Paginates through all telemetry rows in batches of 1,000. Applied to:
- `getTrip()` (line ~125) — map track ✅ verified working
- `stopTrip()` (line ~257) — summary computation ✅ fixed
- `getActiveTripStats()` (line ~477) — live stats ✅ fixed
- `getTelemetrySamples()` (line ~912) — data table ⚠️ fix applied but NOT yet verified

### 3. Still needs verification
- The telemetry samples table on the trip detail page was still showing truncated data after restart
- Stopped making changes to avoid further issues
- May be a caching issue, a different code path, or the fix needs debugging

---

## Trip Collector Offline Resilience Bug (Still Exists)

The original concern was that the trip collector would stop recording when internet drops mid-ocean. Investigation confirmed the trip collector DID work on this passage, but the underlying bug still exists in `rpi/trip-collector/trip_collector.py`:

- Line 236: `check_for_active_trip()` returns `None` on connection failure
- Lines 338-340: `None` is treated as "trip ended" → `stop_collection()`
- If internet had dropped, collection would have stopped

This needs to be fixed before the next long passage. See "Proposed Fix" below.

### Proposed Fix for Trip Collector
- Three-state return from `check_for_active_trip()`: trip ID, `None` (confirmed no trip), or error/unreachable
- Only stop collection when Supabase explicitly confirms no active trip
- Keep collecting when Supabase is unreachable
- Add watchdog for collection thread
- Add local trip state persistence (write active trip ID to disk)

---

## Other Supabase Queries to Audit

There may be other queries across the codebase hitting the 1,000 row default limit. Any query that:
1. Fetches from a table that could exceed 1,000 rows
2. Does NOT specify a `.limit()` or `.range()`

...will silently truncate results. Priority tables to check: `trip_telemetry`, `gps_position`, `chat_messages`, `document_chunks`.

---

## Files Modified

| File | Change |
|------|--------|
| `src/services/trips/trips.service.js` | Added `fetchAllTelemetry()`, updated 4 queries to use it |

## Data Changes

| Table | Action | Details |
|-------|--------|---------|
| `trips` | UPDATE (1 row) | Recalculated stats for trip `1012a595...` |
| `trip_telemetry` | NO CHANGES | All 1,821 rows untouched |
