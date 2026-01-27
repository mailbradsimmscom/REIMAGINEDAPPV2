# 77 Anchorage Detection Fix and Photos Feature

**Date:** 2026-01-12
**Status:** Detection Fix COMPLETE, Photos Feature PLANNED (not implemented)

---

## Part 1: Anchorage Detection Algorithm Fix (COMPLETED)

### Problems Identified

1. **False movement detection** - 55m threshold too tight, GPS noise/anchor swing broke stays into fragments
2. **No merge logic** - Overlapping anchorages at same location stored as separate entries
3. **No update on refresh** - Existing short-duration anchorages not extended when new data available
4. **Fixed 90-day lookback** - Inefficient, scanned all GPS data regardless of recent activity
5. **"Still here" never detected** - `departed_at` always set, never null for auto-detected anchorages

### Evidence from Data

**Port Elizabeth (same spot, should be 1 record):**
- Entry 1: 13.00975, -61.24442 | Nov 27 → Nov 30 | 60 hrs
- Entry 2: 13.00974, -61.24442 | Nov 22 → Nov 30 | 179 hrs
- Difference: 0.00001° = ~1 meter - SAME SPOT

**Jolly Harbour (duration wrong):**
- Recorded: Jan 9 3PM → Jan 9 7PM (4 hours)
- Actual GPS data: Jan 9 → Jan 12 (~3 days stationary)

### Changes Made (Committed: cb4dbe66)

#### Change 1: Movement Threshold
**File:** `src/repositories/anchorages.repository.js` line 250
```javascript
// BEFORE
const MOVEMENT_THRESHOLD = 0.0005; // ~55m

// AFTER
const MOVEMENT_THRESHOLD = 0.0027; // ~300m (allows for anchor swing)
```

#### Change 2: Dynamic Lookback
**File:** `src/repositories/anchorages.repository.js` lines 169-189
```javascript
// Get 2 most recent anchorages
const recentAnchorages = await this.getRecentAnchorages(2);
let startTime;

if (recentAnchorages.length >= 2 && recentAnchorages[1].departed_at) {
  // Start from when we left the 2nd most recent anchorage
  startTime = new Date(recentAnchorages[1].departed_at);
} else {
  // Fallback to 90 days
  startTime = new Date();
  startTime.setDate(startTime.getDate() - 90);
}
```

#### Change 3: "Still Here" Detection
**File:** `src/repositories/anchorages.repository.js` lines 285-302
```javascript
// After building candidates, check if last one is current
if (candidates.length > 0) {
  const lastCandidate = candidates[candidates.length - 1];
  const lastDepartedAt = new Date(lastCandidate.departed_at);
  const now = new Date();
  const hoursAgo = (now - lastDepartedAt) / (1000 * 60 * 60);

  if (hoursAgo <= 2) {
    // Boat is still anchored
    lastCandidate.departed_at = null;
    lastCandidate.hours_anchored = null;
  }
}
```

#### Change 4: Merge Overlapping Candidates
**File:** `src/services/anchorages/anchorages.service.js` lines 222-285
```javascript
function mergeCandidates(candidates) {
  const MERGE_THRESHOLD = 0.0027; // ~300m
  const merged = [];
  const used = new Set();

  for (let i = 0; i < candidates.length; i++) {
    if (used.has(i)) continue;

    const group = [candidates[i]];
    used.add(i);

    // Find all candidates within threshold
    for (let j = i + 1; j < candidates.length; j++) {
      if (used.has(j)) continue;
      const dist = distanceDegrees(
        candidates[i].latitude, candidates[i].longitude,
        candidates[j].latitude, candidates[j].longitude
      );
      if (dist <= MERGE_THRESHOLD) {
        group.push(candidates[j]);
        used.add(j);
      }
    }

    if (group.length === 1) {
      merged.push(group[0]);
    } else {
      // Merge: earliest arrival, latest departure
      const arrivals = group.map(c => new Date(c.arrived_at)).sort((a, b) => a - b);
      const departures = group.filter(c => c.departed_at).map(c => new Date(c.departed_at)).sort((a, b) => b - a);

      merged.push({
        latitude: group.reduce((sum, c) => sum + c.latitude, 0) / group.length,
        longitude: group.reduce((sum, c) => sum + c.longitude, 0) / group.length,
        arrived_at: arrivals[0].toISOString(),
        departed_at: departures.length > 0 ? departures[0].toISOString() : null,
        avg_wind_speed: group.reduce((sum, c) => sum + (c.avg_wind_speed || 0), 0) / group.length,
        avg_wind_direction: group[0].avg_wind_direction
      });
    }
  }
  return merged;
}
```

#### Change 5: Update Existing Anchorages (Extend Duration)
**File:** `src/services/anchorages/anchorages.service.js` lines 315-372
```javascript
// In detectNewAnchorages(), for each candidate:
const existing = await anchoragesRepository.findAtLocation(candidate.latitude, candidate.longitude);

if (existing) {
  const shouldExtendDeparture = candidateDeparted && (!existingDeparted || candidateDeparted > existingDeparted);
  const shouldExtendArrival = candidateArrived < existingArrived;
  const isNowStillHere = candidate.departed_at === null && existing.departed_at !== null;

  if (shouldExtendDeparture || shouldExtendArrival || isNowStillHere) {
    const updates = {};
    if (shouldExtendArrival) updates.arrived_at = candidate.arrived_at;
    if (shouldExtendDeparture || isNowStillHere) updates.departed_at = candidate.departed_at;

    // Recalculate duration
    const finalArrived = new Date(updates.arrived_at || existing.arrived_at);
    const finalDeparted = updates.departed_at ? new Date(updates.departed_at) : null;
    updates.duration_hours = finalDeparted ? Math.round((finalDeparted - finalArrived) / (1000 * 60 * 60)) : null;

    await anchoragesRepository.update(existing.id, updates);
  }
}
```

#### Change 6: Auto-Merge Existing Duplicates
**File:** `src/services/anchorages/anchorages.service.js` lines 448-567
```javascript
export async function mergeExistingDuplicates() {
  const allAnchorages = await anchoragesRepository.findAll();
  const MERGE_THRESHOLD = 0.0027;
  const groups = [];
  const used = new Set();

  // Group by location
  for (let i = 0; i < allAnchorages.length; i++) {
    if (used.has(allAnchorages[i].id)) continue;
    const group = [allAnchorages[i]];
    used.add(allAnchorages[i].id);

    for (let j = i + 1; j < allAnchorages.length; j++) {
      if (used.has(allAnchorages[j].id)) continue;
      const dist = distanceDegrees(...);
      if (dist <= MERGE_THRESHOLD) {
        group.push(allAnchorages[j]);
        used.add(allAnchorages[j].id);
      }
    }
    if (group.length > 1) groups.push(group);
  }

  // For each group: keep earliest arrival, update with latest departure, delete others
  for (const group of groups) {
    group.sort((a, b) => new Date(a.arrived_at) - new Date(b.arrived_at));
    const keeper = group[0];
    const toDelete = group.slice(1);

    // Update keeper with latest departure, best location name
    // Delete duplicates
    for (const dup of toDelete) {
      await anchoragesRepository.remove(dup.id);
    }
  }
  return { merged: count };
}
```

#### New Repository Methods Added

**findAtLocation()** - Find anchorage within 300m of coordinates
```javascript
async findAtLocation(latitude, longitude) {
  const tolerance = 0.0027; // ~300m
  const { data } = await supabase
    .from('anchorages')
    .select('*')
    .gte('latitude', latitude - tolerance)
    .lte('latitude', latitude + tolerance)
    .gte('longitude', longitude - tolerance)
    .lte('longitude', longitude + tolerance)
    .order('arrived_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}
```

**getRecentAnchorages()** - Get N most recent anchorages for dynamic lookback
```javascript
async getRecentAnchorages(limit = 2) {
  const { data } = await supabase
    .from('anchorages')
    .select('id, arrived_at, departed_at')
    .order('arrived_at', { ascending: false })
    .limit(limit);
  return data || [];
}
```

### Files Modified (Detection Fix)

| File | Changes |
|------|---------|
| `src/repositories/anchorages.repository.js` | Threshold, dynamic lookback, still-here, findAtLocation, getRecentAnchorages |
| `src/services/anchorages/anchorages.service.js` | mergeCandidates, extend duration, mergeExistingDuplicates |
| `docs/10-user-features/anchorages.md` | Updated documentation |

### To Test Detection Fix

1. **Restart server** (code was committed but server was running old code)
2. Click "Refresh New Anchorages" button
3. Verify:
   - Port Elizabeth: 2 entries → 1 entry (merged)
   - Jolly Harbour: 4 hours → ~3 days (extended)
   - Current location: "Still here" instead of departure time
   - Total count reduced (duplicates merged)

---

## Part 2: Anchorage Photos Feature (PLANNED, NOT IMPLEMENTED)

### User Request
Allow attaching photos to anchorages - specifically photos of anchor drop location.

### Existing Pattern (from Supplies)

The supplies feature already has multi-photo support:

| Component | Implementation |
|-----------|----------------|
| Storage | Supabase Storage bucket `documents`, folder `supply-photos/` |
| Database | `photos TEXT[]` column (array of public URLs) |
| Upload | Base64 → Buffer → Supabase Storage → Public URL |
| Service | `src/services/supplies/photo-storage.service.js` |

### Implementation Plan

#### Step 1: Database Migration
Create `scripts/migrations/027_anchorage_photos.sql`:
```sql
ALTER TABLE anchorages
ADD COLUMN photos TEXT[] DEFAULT ARRAY[]::TEXT[];
```

#### Step 2: Extend Photo Storage Service
**File:** `src/services/supplies/photo-storage.service.js`

Add function:
```javascript
async function uploadAnchoragePhoto(anchorageId, base64Data, photoIndex = 1) {
  const FOLDER = 'anchorage-photos';

  const matches = base64Data.match(/^data:image\/(\w+);base64,(.+)$/);
  const imageType = matches[1];
  const base64Content = matches[2];
  const buffer = Buffer.from(base64Content, 'base64');

  const extension = imageType === 'jpeg' ? 'jpg' : imageType;
  const filename = `${anchorageId}-${photoIndex}.${extension}`;
  const filePath = `${FOLDER}/${filename}`;

  const { data, error } = await supabase.storage
    .from('documents')
    .upload(filePath, buffer, {
      contentType: `image/${imageType}`,
      upsert: true
    });

  return supabase.storage.from('documents').getPublicUrl(filePath).data.publicUrl;
}

export { uploadAnchoragePhoto };
```

#### Step 3: Backend Route
**File:** `src/routes/anchorages/anchorages.route.js`

Add endpoint:
```javascript
import { uploadAnchoragePhoto } from '../../services/supplies/photo-storage.service.js';

// POST /api/anchorages/:id/photo
router.post('/:id/photo', async (req, res) => {
  const { id } = req.params;
  const { imageBase64, photoIndex = 1 } = req.body;

  const photoUrl = await uploadAnchoragePhoto(id, imageBase64, photoIndex);

  const anchorage = await anchoragesRepository.findById(id);
  const existingPhotos = anchorage?.photos || [];
  const updatedPhotos = [...existingPhotos];
  updatedPhotos[photoIndex - 1] = photoUrl;

  await anchoragesRepository.update(id, { photos: updatedPhotos });

  return res.json({
    success: true,
    data: { url: photoUrl, photos: updatedPhotos },
    requestId: res.locals.requestId
  });
});
```

#### Step 4: Frontend Changes
**File:** `src/public/js/anchorages/anchorages.js`

In `renderCard()` method, add before notes section:
```javascript
<div class="field-group">
  <div class="field-label">Photos</div>
  <div class="photo-section">
    ${a.photos && a.photos.length > 0 ?
      a.photos.map((url, i) => `
        <img src="${url}" class="photo-thumb" onclick="window.open('${url}')" />
      `).join('') :
      '<span class="field-value muted">No photos</span>'
    }
    <button class="button button-small button-secondary add-photo-btn" data-id="${a.id}">+ Photo</button>
  </div>
</div>
<input type="file" accept="image/*" capture="environment" class="photo-input" data-id="${a.id}" style="display:none">
```

In `renderAnchorages()` method, add event listeners:
```javascript
// Photo button triggers file input
this.container.querySelectorAll('.add-photo-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const input = this.container.querySelector(`.photo-input[data-id="${btn.dataset.id}"]`);
    input?.click();
  });
});

// File input uploads photo
this.container.querySelectorAll('.photo-input').forEach(input => {
  input.addEventListener('change', (e) => this.uploadPhoto(e.target.dataset.id, e.target.files[0]));
});
```

Add methods:
```javascript
async uploadPhoto(anchorageId, file) {
  if (!file || !file.type.startsWith('image/')) return;
  if (file.size > 5 * 1024 * 1024) {
    this.showToast('Image must be under 5MB', 'error');
    return;
  }

  this.showToast('Uploading...', '');

  const base64 = await this.fileToBase64(file);

  // Determine next photo index
  const card = this.container.querySelector(`[data-anchorage-id="${anchorageId}"]`);
  const existingPhotos = card?.querySelectorAll('.photo-thumb').length || 0;
  const photoIndex = existingPhotos + 1;

  const response = await fetch(`/api/anchorages/${anchorageId}/photo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageBase64: base64, photoIndex })
  });

  if (response.ok) {
    this.showToast('Photo added', 'success');
    await this.loadAnchorages();
  } else {
    this.showToast('Upload failed', 'error');
  }
}

fileToBase64(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(file);
  });
}
```

#### Step 5: CSS
**File:** `src/public/anchorages.html`

Add styles:
```css
.photo-section {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.photo-thumb {
  width: 60px;
  height: 60px;
  object-fit: cover;
  border-radius: 8px;
  cursor: pointer;
  border: 1px solid #E5E5EA;
}

.photo-thumb:hover {
  opacity: 0.8;
}
```

### Files to Create/Modify (Photos Feature)

| File | Action |
|------|--------|
| `scripts/migrations/027_anchorage_photos.sql` | CREATE |
| `src/services/supplies/photo-storage.service.js` | ADD uploadAnchoragePhoto() |
| `src/routes/anchorages/anchorages.route.js` | ADD POST /:id/photo |
| `src/public/js/anchorages/anchorages.js` | ADD photo UI and upload methods |
| `src/public/anchorages.html` | ADD CSS styles |

### User Preference
- **Multiple photos per anchorage** (like supplies, not just one)

---

## Other Fixes in This Session

### Anchor Watch Input Reset Fix (Committed: bf11d0fa)
**Problem:** When editing lat/lon input boxes on anchor-watch-admin.html, auto-refresh would reset the values.
**Fix:** Skip re-rendering controls when in preview mode.
**File:** `src/public/anchor-watch-admin.html` line 1241
```javascript
if (!isPreviewMode) {
    renderControls(status);
}
```

### Current Page (Boat Now) Feature (Committed: f785c130)
Added new "Current" page showing:
- Current weather (temperature, wind, waves, precipitation)
- 5-hour historical charts (wind speed, wind direction)
- Leaflet map with position track and centroid
- Downsampled GPS data to 10-minute intervals

**Files:**
- `src/public/boat-now.html`
- `src/services/boat-now/boat-now.service.js`
- `src/routes/boat-now/boat-now.route.js`

---

## Summary

| Task | Status | Commit |
|------|--------|--------|
| Anchor watch input reset fix | DONE | bf11d0fa |
| Current page (boat-now) | DONE | f785c130 |
| Anchorage detection algorithm fix | DONE | cb4dbe66 |
| Anchorage photos feature | PLANNED | - |

**Next step after compact:** Implement anchorage photos feature following the plan above.
