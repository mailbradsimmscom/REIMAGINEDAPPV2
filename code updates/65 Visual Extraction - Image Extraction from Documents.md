# 65 Visual Extraction - Image Extraction from Documents

**Date:** 2025-12-14
**Updated:** 2025-01-10
**Status:** 🚧 Phase 1 Complete - Need Figure Cropping
**Priority:** High

---

## Executive Summary

We discovered that 81 documents processed through LlamaParse are missing images (diagrams, schematics, exploded views). Tables are fine - they're stored as markdown inline in chunks. But images were completely lost because we used `result_type="markdown"` which extracts text only.

**What works now:**
- Batch script extracts page screenshots with `take_screenshot=True`
- Single doc test successful: 26 images (16 page screenshots + 10 embedded logos)
- Images stored in Supabase Storage, metadata in `doc_assets` table

**The problem:**
- Page screenshots capture the full page (headers, footers, tables, logos)
- Embedded images are only raster graphics (logos, CE marks) - not the vector diagrams
- **We need cropped figures** - just the diagram, not the whole page
- For good UX in chat, users need to see "the exploded view" not "page 12 with everything"

**Next step:** Add figure detection/cropping using Vision LLM or layout model.

---

## Current State (2025-01-10)

### What's Working

**Script:** `python-sidecar/scripts/batch_visual_extraction.py`
```bash
# Single doc extraction
python scripts/batch_visual_extraction.py --doc-id ab4f40f6c7db...

# Status check
python scripts/batch_visual_extraction.py --status
```

**Key settings:**
```python
self.parser = LlamaParse(
    api_key=LLAMAPARSE_API_KEY,
    result_type="markdown",
    take_screenshot=True,  # CRITICAL - renders full pages as images
)
```

**Test results (Marco pump manual):**
- 16 page screenshots (1131x1600 pixels each)
- 10 embedded images (all logos/CE marks - not the diagrams)
- Total: 26 images stored in `doc_assets` table

### The Problem

**Vector diagrams are NOT extractable as separate images.** LlamaParse's `get_images()` only returns:
1. Page screenshots (full page renders)
2. Embedded raster images (logos, photos)

The actual diagrams (exploded views, wiring diagrams, schematics) are **vector graphics** in the PDF. They're rendered in the page screenshots but can't be extracted individually.

**User experience problem:**
- User asks "show me the exploded view of my Marco pump"
- We return a full page with header, footer, table, and the diagram
- User wants JUST the diagram, cropped

### Options for Figure Cropping

| Option | Approach | Pros | Cons |
|--------|----------|------|------|
| **1. Vision LLM** | Send page screenshot to GPT-4V/Claude, ask for figure bounding boxes | Accurate, understands semantics | Cost per page, slower |
| **2. Layout model** | LayoutLM, Detectron2, DocLayout | Fast, free after setup | Needs training/tuning |
| **3. Heuristics** | Edge detection + contour finding | Free, fast | May miss complex layouts |
| **4. Manual** | Admin tool to draw bounding boxes | Perfect accuracy | Labor intensive |

**Recommendation:** Option 1 (Vision LLM) for initial implementation - most accurate, quickest to implement.

---

## Background & Discovery

### What We Have (Working)
- **81 documents** uploaded and processed through LlamaParse
- **Text chunks** stored in `document_chunks` table with markdown content
- **Tables** embedded as markdown in chunks (searchable via vector similarity)
- **Vectors** in Pinecone for semantic search
- **DIP data** (specs, procedures, golden rules, Q&A) in staging tables

### What We're Missing
- **Images** - diagrams, schematics, wiring diagrams, exploded views
- Users see "see diagram on page 12" in responses but can't view the actual diagram

### Root Cause
```python
# python-sidecar/app/chunking/parser.py line 29-31
self.parser = LlamaParse(
    result_type="markdown",  # TEXT ONLY - no images extracted
    ...
)
```

### Why Tables Are Fine
Tables come through as markdown text in chunks:
```markdown
| Description                    | Page |
|-------------------------------|------|
| NMEA 2000® remote button support | 15   |
| Sailing processor integration   | 24   |
```

These are searchable via vector similarity - no separate extraction needed.

---

## LlamaParse Image Extraction - What We Learned

### Credit Cost
- **+3 credits per page** for layout extraction (not per image)
- Starter plan: 50k credits/month
- Estimate: 81 docs × ~50 pages avg × 3 credits = ~12,150 credits

### What LlamaParse Returns for Images

**Reliable metadata:**
| Metadata | Available | Notes |
|----------|-----------|-------|
| Image artifact name | ✓ Always | String like `page_23.png` or `img_0042.png` |
| Page number | ✓ Usually | From page object or array index |
| Bounding box | ✓ With `extract_layout=true` | Normalized 0-1 coordinates |
| Caption/nearby text | Sometimes | Gold when present |

**NOT available:**
- Image dimensions (measure after download)
- DPI / EXIF
- Semantic labels ("wiring diagram")

### Typical JSON Shapes

**Page screenshot:**
```json
{
  "page": 12,
  "screenshot": "page_12.png"
}
```

**Figure with bbox:**
```json
{
  "type": "figure",
  "image_name": "img_0042.png",
  "bbox": { "x": 0.08, "y": 0.22, "w": 0.76, "h": 0.41 },
  "caption": "Exploded view of pump assembly"
}
```

**Figure without image (bbox only):**
```json
{
  "type": "figure",
  "bbox": { "x": 0.10, "y": 0.18, "w": 0.70, "h": 0.48 }
}
```
This is fine - crop from page screenshot using bbox.

---

## Implementation Plan

### Phase 1: Database Schema

#### 1.1 Add Column to `documents` Table

```sql
-- Migration: add visual_processed tracking to documents
ALTER TABLE documents
ADD COLUMN visual_processed boolean DEFAULT false,
ADD COLUMN visual_processed_at timestamptz,
ADD COLUMN visual_job_id text,
ADD COLUMN images_count integer DEFAULT 0,
ADD COLUMN pages_count integer DEFAULT 0;

COMMENT ON COLUMN documents.visual_processed IS 'Has image/visual extraction been run?';
COMMENT ON COLUMN documents.visual_job_id IS 'LlamaParse job ID for visual extraction';
```

#### 1.2 Create `doc_assets` Table

```sql
-- Migration: create doc_assets table for images
CREATE TABLE doc_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id text NOT NULL REFERENCES documents(doc_id) ON DELETE CASCADE,
  page_number integer,
  asset_type text NOT NULL,           -- 'page_screenshot' | 'figure_image'
  storage_url text NOT NULL,          -- Supabase Storage path
  bbox jsonb,                         -- {"x": 0.1, "y": 0.2, "w": 0.5, "h": 0.3} normalized 0-1
  source_job_id text,                 -- LlamaParse job ID
  image_name text,                    -- Original artifact name from LlamaParse
  pixel_width integer,                -- Measured after download
  pixel_height integer,               -- Measured after download
  hash_sha1 text,                     -- For deduplication
  caption text,                       -- If LlamaParse found nearby text
  created_at timestamptz DEFAULT now()
);

-- Indexes for common queries
CREATE INDEX idx_doc_assets_doc_id ON doc_assets(doc_id);
CREATE INDEX idx_doc_assets_page ON doc_assets(doc_id, page_number);
CREATE INDEX idx_doc_assets_type ON doc_assets(asset_type);

COMMENT ON TABLE doc_assets IS 'Stores extracted images/screenshots from documents';
```

#### 1.3 Zod Schema (for Node.js validation)

```javascript
// src/schemas/doc-assets.schema.js
import { z } from 'zod';

export const DocAssetSchema = z.object({
  id: z.string().uuid(),
  doc_id: z.string(),
  page_number: z.number().int().positive().nullable(),
  asset_type: z.enum(['page_screenshot', 'figure_image']),
  storage_url: z.string(),
  bbox: z.object({
    x: z.number(),
    y: z.number(),
    w: z.number(),
    h: z.number()
  }).nullable(),
  source_job_id: z.string().nullable(),
  image_name: z.string().nullable(),
  pixel_width: z.number().int().positive().nullable(),
  pixel_height: z.number().int().positive().nullable(),
  hash_sha1: z.string().nullable(),
  caption: z.string().nullable(),
  created_at: z.string().datetime()
});

export const DocAssetInsertSchema = DocAssetSchema.omit({
  id: true,
  created_at: true
});
```

---

### Phase 2: Batch Extraction Script

#### 2.1 Script Location & Pattern

**File:** `python-sidecar/scripts/batch_visual_extraction.py`

**CLI Interface:**
```bash
# Single document
python scripts/batch_visual_extraction.py --doc-id 315e3f0f218f2e2a...

# All unprocessed documents
python scripts/batch_visual_extraction.py

# Limit batch size
python scripts/batch_visual_extraction.py --batch-size 10

# Dry run (preview only)
python scripts/batch_visual_extraction.py --dry-run

# Force reprocess already-processed docs
python scripts/batch_visual_extraction.py --force

# Show status
python scripts/batch_visual_extraction.py --status
```

#### 2.2 Script Flow

```
1. Parse CLI arguments
2. Connect to Supabase
3. Query documents table:
   - If --doc-id: get that single doc
   - Else: get all where visual_processed IS NULL OR visual_processed = false
   - Apply --batch-size limit
4. For each document:
   a. Download PDF from Supabase Storage (storage_path)
   b. Submit to LlamaParse with result_type="json", extract_layout=true
   c. Wait for job completion
   d. Save raw JSON result to local file (for debugging)
   e. Extract page screenshots:
      - Download each page image
      - Measure dimensions with Pillow
      - Calculate SHA1 hash
      - Upload to Supabase Storage: manuals/{doc_id}/assets/pages/page_{N}.png
      - Create AssetRow
   f. Extract figure images (if present):
      - Download figure image OR note bbox for cropping
      - Measure dimensions
      - Upload to Supabase Storage: manuals/{doc_id}/assets/figures/fig_{N}.png
      - Create AssetRow with bbox and caption
   g. Insert all AssetRows into doc_assets table
   h. Update documents table:
      - visual_processed = true
      - visual_processed_at = now()
      - visual_job_id = job_id
      - images_count = count of assets
      - pages_count = count of page screenshots
5. Print summary
```

#### 2.3 Core Script Structure

```python
#!/usr/bin/env python3
"""
Batch Visual Extraction - Extract images from documents via LlamaParse

Queries Supabase documents table, re-processes PDFs with JSON + layout mode,
downloads page screenshots and figure images, stores in Supabase Storage,
inserts metadata into doc_assets table.

Usage:
    python scripts/batch_visual_extraction.py [options]

Options:
    --doc-id ID      Process single document
    --batch-size N   Limit to N documents (default: all)
    --dry-run        Preview without processing
    --force          Reprocess already-processed docs
    --status         Show processing status
"""

import os
import sys
import json
import hashlib
import argparse
from datetime import datetime
from pathlib import Path
from typing import List, Dict, Any, Optional
from dataclasses import dataclass, asdict

import requests
from PIL import Image
from io import BytesIO
from dotenv import load_dotenv
from supabase import create_client, Client
from llama_parse import LlamaParse

load_dotenv()

# Configuration
SUPABASE_URL = os.getenv('SUPABASE_URL')
SUPABASE_SERVICE_KEY = os.getenv('SUPABASE_SERVICE_KEY')
LLAMA_CLOUD_API_KEY = os.getenv('LLAMAPARSE_API_KEY') or os.getenv('LLAMA_CLOUD_API_KEY')
LLAMAPARSE_API_BASE = os.getenv('LLAMAPARSE_API_BASE', 'https://api.cloud.llamaindex.ai')

# Storage paths
STORAGE_BUCKET = 'documents'
ASSETS_PREFIX = 'manuals/{doc_id}/assets'


@dataclass
class AssetRow:
    """Row to insert into doc_assets table"""
    doc_id: str
    page_number: Optional[int]
    asset_type: str  # 'page_screenshot' | 'figure_image'
    storage_url: str
    bbox: Optional[Dict[str, float]] = None
    source_job_id: Optional[str] = None
    image_name: Optional[str] = None
    pixel_width: Optional[int] = None
    pixel_height: Optional[int] = None
    hash_sha1: Optional[str] = None
    caption: Optional[str] = None


class VisualExtractor:
    def __init__(self, supabase: Client, dry_run: bool = False):
        self.supabase = supabase
        self.dry_run = dry_run
        self.parser = LlamaParse(
            api_key=LLAMA_CLOUD_API_KEY,
            result_type="json",
            extract_layout=True,
        )
        self.auth_headers = {"Authorization": f"Bearer {LLAMA_CLOUD_API_KEY}"}

    def get_unprocessed_docs(self, limit: Optional[int] = None, force: bool = False) -> List[Dict]:
        """Get documents that need visual processing"""
        query = self.supabase.table('documents').select(
            'doc_id, storage_path, manufacturer_norm, model_norm'
        )

        if not force:
            query = query.or_('visual_processed.is.null,visual_processed.eq.false')

        if limit:
            query = query.limit(limit)

        result = query.execute()
        return result.data or []

    def get_single_doc(self, doc_id: str) -> Optional[Dict]:
        """Get a single document by ID"""
        result = self.supabase.table('documents').select(
            'doc_id, storage_path, manufacturer_norm, model_norm'
        ).eq('doc_id', doc_id).single().execute()
        return result.data

    def download_pdf(self, storage_path: str, local_path: Path) -> None:
        """Download PDF from Supabase Storage"""
        local_path.parent.mkdir(parents=True, exist_ok=True)

        response = self.supabase.storage.from_(STORAGE_BUCKET).download(storage_path)
        with open(local_path, 'wb') as f:
            f.write(response)

    def parse_document(self, pdf_path: Path) -> tuple[str, Dict[str, Any]]:
        """Parse document with LlamaParse, return (job_id, json_result)"""
        result = self.parser.load_data(str(pdf_path))
        json_result = self._normalize_result(result)

        job_id = json_result.get('job_id') or json_result.get('id') or f"job_{hashlib.sha1(str(pdf_path).encode()).hexdigest()[:12]}"
        return job_id, json_result

    def download_job_image(self, job_id: str, image_name: str) -> bytes:
        """Download image from LlamaParse job"""
        url = f"{LLAMAPARSE_API_BASE}/api/parsing/job/{job_id}/result/image/{image_name}"
        response = requests.get(url, headers=self.auth_headers, timeout=120)
        response.raise_for_status()
        return response.content

    def measure_image(self, image_bytes: bytes) -> tuple[int, int, str]:
        """Get width, height, sha1 from image bytes"""
        img = Image.open(BytesIO(image_bytes))
        width, height = img.size
        sha1 = hashlib.sha1(image_bytes).hexdigest()
        return width, height, sha1

    def upload_to_storage(self, doc_id: str, filename: str, content: bytes, subfolder: str = 'pages') -> str:
        """Upload image to Supabase Storage, return storage URL"""
        path = f"manuals/{doc_id}/assets/{subfolder}/{filename}"

        if not self.dry_run:
            self.supabase.storage.from_(STORAGE_BUCKET).upload(
                path, content, {'content-type': 'image/png', 'upsert': 'true'}
            )

        return path

    def extract_assets(self, doc_id: str, job_id: str, json_result: Dict) -> List[AssetRow]:
        """Extract all image assets from parse result"""
        assets = []
        pages = self._find_pages(json_result)

        for idx, page in enumerate(pages, start=1):
            page_num = self._get_page_number(page, idx)

            # Page screenshot
            screenshot_name = self._find_screenshot_name(page)
            if screenshot_name:
                try:
                    image_bytes = self.download_job_image(job_id, screenshot_name)
                    width, height, sha1 = self.measure_image(image_bytes)

                    filename = f"page_{page_num:04d}.png"
                    storage_url = self.upload_to_storage(doc_id, filename, image_bytes, 'pages')

                    assets.append(AssetRow(
                        doc_id=doc_id,
                        page_number=page_num,
                        asset_type='page_screenshot',
                        storage_url=storage_url,
                        source_job_id=job_id,
                        image_name=screenshot_name,
                        pixel_width=width,
                        pixel_height=height,
                        hash_sha1=sha1,
                    ))
                except Exception as e:
                    print(f"  [WARN] Failed to download page {page_num} screenshot: {e}")

            # Figure images
            for img_name, bbox, caption in self._find_figure_refs(page):
                try:
                    image_bytes = self.download_job_image(job_id, img_name)
                    width, height, sha1 = self.measure_image(image_bytes)

                    filename = f"p{page_num:04d}_{img_name}"
                    storage_url = self.upload_to_storage(doc_id, filename, image_bytes, 'figures')

                    assets.append(AssetRow(
                        doc_id=doc_id,
                        page_number=page_num,
                        asset_type='figure_image',
                        storage_url=storage_url,
                        bbox=bbox,
                        source_job_id=job_id,
                        image_name=img_name,
                        pixel_width=width,
                        pixel_height=height,
                        hash_sha1=sha1,
                        caption=caption,
                    ))
                except Exception as e:
                    print(f"  [WARN] Failed to download figure {img_name} on page {page_num}: {e}")

        return assets

    def save_assets(self, assets: List[AssetRow]) -> None:
        """Insert assets into doc_assets table"""
        if self.dry_run or not assets:
            return

        rows = [asdict(a) for a in assets]
        self.supabase.table('doc_assets').insert(rows).execute()

    def update_document_status(self, doc_id: str, job_id: str, images_count: int, pages_count: int) -> None:
        """Mark document as visually processed"""
        if self.dry_run:
            return

        self.supabase.table('documents').update({
            'visual_processed': True,
            'visual_processed_at': datetime.utcnow().isoformat(),
            'visual_job_id': job_id,
            'images_count': images_count,
            'pages_count': pages_count,
        }).eq('doc_id', doc_id).execute()

    def process_document(self, doc: Dict, work_dir: Path) -> Dict[str, Any]:
        """Process a single document, return stats"""
        doc_id = doc['doc_id']
        storage_path = doc['storage_path']

        print(f"\n{'='*60}")
        print(f"Processing: {doc.get('manufacturer_norm', '?')} - {doc.get('model_norm', '?')}")
        print(f"Doc ID: {doc_id[:20]}...")
        print(f"{'='*60}")

        # Download PDF
        pdf_path = work_dir / f"{doc_id[:12]}.pdf"
        print(f"  Downloading PDF from {storage_path}...")
        self.download_pdf(storage_path, pdf_path)

        # Parse with LlamaParse
        print(f"  Parsing with LlamaParse (json + layout)...")
        job_id, json_result = self.parse_document(pdf_path)
        print(f"  Job ID: {job_id}")

        # Save raw JSON for debugging
        json_path = work_dir / f"{doc_id[:12]}_result.json"
        json_path.write_text(json.dumps(json_result, indent=2))

        # Extract assets
        print(f"  Extracting images...")
        assets = self.extract_assets(doc_id, job_id, json_result)

        page_screenshots = [a for a in assets if a.asset_type == 'page_screenshot']
        figure_images = [a for a in assets if a.asset_type == 'figure_image']

        print(f"  Found: {len(page_screenshots)} page screenshots, {len(figure_images)} figure images")

        # Save to database
        if not self.dry_run:
            print(f"  Saving to database...")
            self.save_assets(assets)
            self.update_document_status(doc_id, job_id, len(assets), len(page_screenshots))
        else:
            print(f"  [DRY RUN] Would save {len(assets)} assets")

        # Cleanup
        pdf_path.unlink(missing_ok=True)

        return {
            'doc_id': doc_id,
            'job_id': job_id,
            'pages': len(page_screenshots),
            'figures': len(figure_images),
            'total_assets': len(assets),
        }

    # --- Helper methods (tune these based on actual JSON structure) ---

    def _normalize_result(self, result: Any) -> Dict:
        if isinstance(result, dict):
            return result
        if isinstance(result, list):
            if len(result) == 1 and isinstance(result[0], dict):
                return result[0]
            return {'pages': result}
        return {'raw': str(result)}

    def _find_pages(self, json_result: Dict) -> List[Dict]:
        for key in ('pages', 'document.pages', 'result.pages'):
            parts = key.split('.')
            cur = json_result
            for p in parts:
                if isinstance(cur, dict) and p in cur:
                    cur = cur[p]
                else:
                    cur = None
                    break
            if isinstance(cur, list):
                return cur
        return []

    def _get_page_number(self, page: Dict, fallback: int) -> int:
        for key in ('page', 'page_number', 'pageIndex'):
            if key in page:
                try:
                    return int(page[key])
                except:
                    pass
        return fallback

    def _find_screenshot_name(self, page: Dict) -> Optional[str]:
        for key in ('screenshot', 'screenshot_name', 'page_screenshot', 'page_image'):
            if key in page and isinstance(page[key], str):
                return page[key]
        return None

    def _find_figure_refs(self, page: Dict) -> List[tuple[str, Optional[Dict], Optional[str]]]:
        """Returns list of (image_name, bbox, caption)"""
        results = []
        blocks = page.get('blocks', [])
        if not blocks and 'layout' in page:
            blocks = page['layout'].get('blocks', [])

        for block in blocks:
            if not isinstance(block, dict):
                continue
            btype = (block.get('type') or block.get('block_type') or '').lower()
            if btype in ('figure', 'image'):
                img_name = block.get('image_name') or block.get('image') or block.get('img')
                if img_name:
                    bbox = self._extract_bbox(block)
                    caption = block.get('caption') if isinstance(block.get('caption'), str) else None
                    results.append((img_name, bbox, caption))

        return results

    def _extract_bbox(self, block: Dict) -> Optional[Dict[str, float]]:
        bb = block.get('bbox') or block.get('bounding_box')
        if isinstance(bb, dict):
            if all(k in bb for k in ('x', 'y', 'w', 'h')):
                return {k: float(bb[k]) for k in ('x', 'y', 'w', 'h')}
        return None


def show_status(supabase: Client) -> None:
    """Show visual processing status"""
    total = supabase.table('documents').select('doc_id', count='exact').execute()
    processed = supabase.table('documents').select('doc_id', count='exact').eq('visual_processed', True).execute()

    total_count = total.count or 0
    processed_count = processed.count or 0
    pending_count = total_count - processed_count

    print(f"\n{'='*50}")
    print("VISUAL EXTRACTION STATUS")
    print(f"{'='*50}")
    print(f"Total documents:      {total_count}")
    print(f"Visually processed:   {processed_count}")
    print(f"Pending:              {pending_count}")
    print(f"{'='*50}")


def main():
    parser = argparse.ArgumentParser(description='Batch Visual Extraction')
    parser.add_argument('--doc-id', help='Process single document by ID')
    parser.add_argument('--batch-size', type=int, help='Limit number of documents')
    parser.add_argument('--dry-run', action='store_true', help='Preview without processing')
    parser.add_argument('--force', action='store_true', help='Reprocess already-processed docs')
    parser.add_argument('--status', action='store_true', help='Show processing status')
    args = parser.parse_args()

    # Validate environment
    if not all([SUPABASE_URL, SUPABASE_SERVICE_KEY, LLAMA_CLOUD_API_KEY]):
        print("ERROR: Missing required environment variables")
        print("  SUPABASE_URL, SUPABASE_SERVICE_KEY, LLAMAPARSE_API_KEY")
        sys.exit(1)

    # Connect to Supabase
    supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    # Status mode
    if args.status:
        show_status(supabase)
        return

    # Initialize extractor
    extractor = VisualExtractor(supabase, dry_run=args.dry_run)

    # Get documents to process
    if args.doc_id:
        doc = extractor.get_single_doc(args.doc_id)
        if not doc:
            print(f"ERROR: Document not found: {args.doc_id}")
            sys.exit(1)
        docs = [doc]
    else:
        docs = extractor.get_unprocessed_docs(limit=args.batch_size, force=args.force)

    if not docs:
        print("No documents to process")
        return

    print(f"\n{'='*50}")
    print(f"BATCH VISUAL EXTRACTION")
    print(f"{'='*50}")
    print(f"Documents to process: {len(docs)}")
    print(f"Mode: {'DRY RUN' if args.dry_run else 'LIVE'}")
    print(f"{'='*50}")

    # Process documents
    work_dir = Path('./visual_extraction_work')
    work_dir.mkdir(exist_ok=True)

    results = []
    errors = []

    for doc in docs:
        try:
            result = extractor.process_document(doc, work_dir)
            results.append(result)
        except Exception as e:
            print(f"  [ERROR] {e}")
            errors.append({'doc_id': doc['doc_id'], 'error': str(e)})

    # Summary
    print(f"\n{'='*50}")
    print("SUMMARY")
    print(f"{'='*50}")
    print(f"Processed:  {len(results)}")
    print(f"Errors:     {len(errors)}")

    total_pages = sum(r['pages'] for r in results)
    total_figures = sum(r['figures'] for r in results)
    print(f"Total page screenshots: {total_pages}")
    print(f"Total figure images:    {total_figures}")

    if errors:
        print(f"\nErrors:")
        for e in errors:
            print(f"  - {e['doc_id'][:20]}...: {e['error']}")


if __name__ == '__main__':
    main()
```

---

### Phase 3: Storage Structure

```
Supabase Storage: documents bucket
└── manuals/
    └── {doc_id}/
        ├── {filename}.pdf           # Original PDF (existing)
        ├── DIP/                      # DIP JSON files (existing)
        │   ├── {doc_id}_spec_suggestions_an.json
        │   └── ...
        └── assets/                   # NEW: extracted images
            ├── pages/
            │   ├── page_0001.png
            │   ├── page_0002.png
            │   └── ...
            └── figures/
                ├── p0012_img_0042.png
                └── ...
```

---

### Phase 4: Integration with Chat (Future)

Once images are extracted and stored, integrate with chat:

#### 4.1 Simple "View Page X" Button

When chat response mentions a page:
1. Parse response for page references ("see page 12", "page 12 shows")
2. Look up `doc_assets` for that page_number
3. Return storage_url in response metadata
4. Frontend renders "View Page" button

#### 4.2 Figure Retrieval by Caption

When chat mentions a figure:
1. Search `doc_assets.caption` for matches
2. Or use bbox to crop from page screenshot
3. Return cropped image or full figure

#### 4.3 API Endpoint

```javascript
// GET /api/documents/:docId/assets?page=12
// GET /api/documents/:docId/assets?type=figure_image
// Returns list of matching assets with storage URLs
```

---

## Files to Create/Modify

### New Files
| File | Purpose |
|------|---------|
| `sql/migrations/xxx_add_visual_extraction.sql` | Database migration |
| `python-sidecar/scripts/batch_visual_extraction.py` | Batch extraction script |
| `src/schemas/doc-assets.schema.js` | Zod schema for validation |
| `src/repositories/doc-assets.repository.js` | Database operations |
| `src/routes/admin/assets.route.js` | API endpoint (Phase 4) |

### Modified Files
| File | Change |
|------|--------|
| `python-sidecar/requirements.txt` | Add `Pillow` for image measurement |
| `docs/30-backend/batch-scripts.md` | Document new script |

---

## Testing Plan

### 1. Single Document Test
```bash
# Test on one document
python scripts/batch_visual_extraction.py --doc-id 315e3f0f218f2e2a... --dry-run

# If dry run looks good, run for real
python scripts/batch_visual_extraction.py --doc-id 315e3f0f218f2e2a...
```

### 2. Verify Results
```sql
-- Check doc_assets table
SELECT doc_id, page_number, asset_type, storage_url
FROM doc_assets
WHERE doc_id = '315e3f0f218f2e2a...'
ORDER BY page_number;

-- Check documents table
SELECT doc_id, visual_processed, images_count, pages_count
FROM documents
WHERE doc_id = '315e3f0f218f2e2a...';
```

### 3. Verify Storage
Check Supabase Storage dashboard for:
- `manuals/{doc_id}/assets/pages/` contains page screenshots
- `manuals/{doc_id}/assets/figures/` contains figure images (if any)

### 4. Full Batch Run
```bash
# Process all 81 documents
python scripts/batch_visual_extraction.py --batch-size 10  # Start small
python scripts/batch_visual_extraction.py                   # All remaining
```

---

## Rollback Plan

If something goes wrong:

```sql
-- Delete all assets for a document
DELETE FROM doc_assets WHERE doc_id = 'xxx';

-- Reset document status
UPDATE documents SET
  visual_processed = false,
  visual_processed_at = NULL,
  visual_job_id = NULL,
  images_count = 0,
  pages_count = 0
WHERE doc_id = 'xxx';
```

Storage files can be deleted via Supabase dashboard or CLI.

---

## Cost Estimate

- 81 documents
- ~50 pages average per doc
- 3 credits per page for layout extraction
- **Total: ~12,150 credits** (well within 50k/month Starter plan)

---

## Dependencies

### Python Packages (add to requirements.txt)
```
Pillow>=10.0.0
```

### Environment Variables (already exist)
```
SUPABASE_URL
SUPABASE_SERVICE_KEY
LLAMAPARSE_API_KEY (or LLAMA_CLOUD_API_KEY)
```

---

## Open Questions / Decisions Needed

1. **JSON structure tuning**: Run one doc first, inspect `result.json`, tune `_find_screenshot_name()` and `_find_figure_refs()` to match actual output

2. **Caption extraction**: If LlamaParse doesn't provide captions, consider extracting nearby text from blocks

3. **Image format**: Store as PNG (lossless) or convert to JPEG (smaller)?

4. **Chat integration priority**: When to implement "View Page X" feature?

---

## References

- [LlamaParse Output Modes](https://developers.llamaindex.ai/typescript/cloud/llamaparse/presets_and_modes/output_modes/)
- [LlamaParse GitHub Discussion #445](https://github.com/run-llama/llama_parse/discussions/445)
- [Analytics Vidhya - Document Parsing with LlamaParse](https://www.analyticsvidhya.com/blog/2024/05/document-parsing-with-llamaparse/)
- Existing batch scripts: `/docs/30-backend/batch-scripts.md`
