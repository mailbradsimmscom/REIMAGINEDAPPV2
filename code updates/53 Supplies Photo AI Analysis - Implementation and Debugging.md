# Supplies Photo AI Analysis - Implementation and Debugging

**Date:** 2025-11-26
**Status:** Phase 1 In Progress (Debugging)
**Branch:** Stable-v4-Working

---

## Overview

Implementing a photo-first workflow for adding supply items:
1. User takes photo on mobile
2. AI (GPT-4V) analyzes photo to extract item details
3. Form pre-fills with AI suggestions
4. User saves item (with photo stored permanently)

---

## Architecture

### Phase 1: Real-Time AI Analysis (Current)
```
Mobile Device                    Server                         OpenAI
     |                              |                              |
     | Take Photo                   |                              |
     | Convert to Base64            |                              |
     |------ POST /analyze-photo -->|                              |
     |       { imageBase64: ... }   |                              |
     |                              |------ GPT-4V Vision -------->|
     |                              |<----- Item Details ----------|
     |<----- { item_name, brand,    |                              |
     |         part_number, ... }   |                              |
```

### Phase 2: Permanent Photo Storage (TODO)
```
On Save:
Browser (base64) --> Supabase Storage --> URL stored in supplies table
```

---

## Issues Encountered & Resolutions

### Issue 1: Type Counts Not Showing
**Symptom:** The tabs (All, Supplies, Tools, Items) showed "-" instead of numbers

**Root Cause:** `supplies-list.js` tried to set `totalItems` and `lowStockItems` elements that don't exist in the HTML. This threw an error before the type counts could be updated.

**Resolution:** Removed the non-existent element references from `loadStats()` function.

**Commit:** `ca52f4a` - Fix supplies type counts not showing

---

### Issue 2: Error Message Showing [object Object]
**Symptom:** Toast showed "Failed to process photo: [object Object]"

**Root Cause:** Error objects weren't being properly converted to strings when the upload/analysis failed.

**Resolution:** Added proper error message extraction:
```javascript
const errorMsg = typeof error === 'string'
  ? error
  : (error?.message || JSON.stringify(error) || 'Unknown error');
```

**Commit:** `ad42cf3` - Fix photo upload error message showing [object Object]

---

### Issue 3: Photo Analysis Failing on Render (Ephemeral Storage)
**Symptom:** Photo uploaded successfully (preview shown) but AI analysis failed

**Root Cause:** Original flow:
1. Upload photo to disk (`/uploads/supplies/filename.jpg`)
2. Call analyze endpoint with file URL
3. Server reads file from disk
4. **File not found** - Render has ephemeral storage

**Resolution:** Changed to send base64 directly:
1. Browser reads photo as base64 (already done for preview)
2. Send base64 directly to analyze endpoint
3. Server passes base64 directly to OpenAI GPT-4V
4. No disk storage needed for AI analysis

**Files Changed:**
- `src/public/js/supplies/supplies-wizard.js` - New `analyzePhotoWithAI()` function
- `src/routes/supplies/supplies.route.js` - Accept `imageBase64` parameter
- `src/services/supplies/ai-analysis.service.js` - New `analyzeSupplyPhotoBase64()` function

**Commit:** `4d2462f` - Fix photo AI analysis - send base64 directly instead of file path

---

### Issue 4: Request Not Reaching Server (CURRENT)
**Symptom:** POST to `/api/supplies/analyze-photo` not appearing in server logs

**Root Cause:** Express JSON body limit was 2MB. Phone photos in base64 can be 5-10MB (base64 adds ~33% overhead).

**Resolution:** Increased body limit from 2MB to 10MB:
```javascript
app.use(express.json({
  limit: '10mb' // Needed for base64 images
}));
```

**Commit:** `6a6d6d3` - Increase JSON body limit to 10MB for base64 image uploads

**Status:** Waiting for Render redeploy to test

---

## Current State

### What's Working
- Supplies wizard opens on mobile (+ button in header)
- Photo capture and preview display
- Type filter tabs (after fix)

### What's Being Debugged
- AI photo analysis - waiting to confirm the 10MB limit fix works

### What's Pending
- Verify AI analysis works end-to-end
- Pre-fill form fields from AI response
- System recommendations (Step 3 of wizard)

---

## Phase 2: Permanent Photo Storage (TODO)

### Requirements
- Photos need to persist with the supply item
- Must work on Render (no local disk storage)
- Photos should be viewable in the supply list/detail views

### Recommended Solution: Supabase Storage

**Why Supabase Storage:**
- Already using Supabase for database
- Included in existing plan
- Simple API, works well with existing auth
- CDN-backed for fast delivery

**Implementation Plan:**

1. **Create Storage Bucket**
   ```sql
   -- In Supabase dashboard or migration
   INSERT INTO storage.buckets (id, name, public)
   VALUES ('supply-photos', 'supply-photos', true);
   ```

2. **Upload Service** (`src/services/supplies/photo-storage.service.js`)
   ```javascript
   import { supabase } from '../../repositories/supabaseClient.js';

   export async function uploadSupplyPhoto(base64Data, filename) {
     // Convert base64 to buffer
     const base64Content = base64Data.split(',')[1];
     const buffer = Buffer.from(base64Content, 'base64');

     // Upload to Supabase Storage
     const { data, error } = await supabase.storage
       .from('supply-photos')
       .upload(`photos/${filename}`, buffer, {
         contentType: 'image/jpeg',
         upsert: false
       });

     if (error) throw error;

     // Get public URL
     const { data: { publicUrl } } = supabase.storage
       .from('supply-photos')
       .getPublicUrl(data.path);

     return publicUrl;
   }
   ```

3. **Modify Save Flow**
   - When user clicks "Save Supply" in wizard
   - Upload photo to Supabase Storage (if photo exists)
   - Get permanent URL
   - Save supply with photo URL in `photos` array

4. **Database Schema**
   - `supplies.photos` column already exists as `text[]`
   - Store Supabase Storage URLs

### Alternative: Client-Side Image Compression

To reduce upload size and improve performance:
```javascript
// Before sending to server
async function compressImage(base64, maxWidth = 1200) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ratio = Math.min(maxWidth / img.width, 1);
      canvas.width = img.width * ratio;
      canvas.height = img.height * ratio;

      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      resolve(canvas.toDataURL('image/jpeg', 0.8));
    };
    img.src = base64;
  });
}
```

---

## Files Modified

### Frontend
- `src/public/js/supplies/supplies-wizard.js`
- `src/public/js/supplies/supplies-list.js`

### Backend
- `src/app.js` (body limit)
- `src/routes/supplies/supplies.route.js`
- `src/services/supplies/ai-analysis.service.js`

---

## Commits (Chronological)

1. `ca52f4a` - Fix supplies type counts not showing
2. `ad42cf3` - Fix photo upload error message showing [object Object]
3. `4d2462f` - Fix photo AI analysis - send base64 directly instead of file path
4. `6a6d6d3` - Increase JSON body limit to 10MB for base64 image uploads

---

## Next Steps

1. **Immediate:** Verify AI analysis works after Render redeploy
2. **If working:** Test full wizard flow (photo → details → systems → save)
3. **Phase 2:** Implement Supabase Storage for permanent photo storage
4. **Optional:** Add client-side image compression for faster uploads

---

## Testing Checklist

- [ ] Photo capture works on mobile
- [ ] AI analysis request reaches server (check logs)
- [ ] GPT-4V returns item details
- [ ] Form pre-fills with AI suggestions
- [ ] Can proceed through wizard without photo (skip)
- [ ] Supply saves successfully
- [ ] Photo persists with supply (Phase 2)
