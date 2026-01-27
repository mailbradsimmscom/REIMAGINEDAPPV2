#!/usr/bin/env python3
"""
Full LlamaParse pipeline:
1. Extract layout bboxes
2. Merge figures with related elements (caption, parts list)
3. Analyze text for model mentions
4. Tag as universal or model-specific
5. Crop and save with metadata
"""

import os
import sys
import json
import asyncio
import re
from pathlib import Path
from datetime import datetime
from dotenv import load_dotenv
from pdf2image import convert_from_path
from PIL import Image

env_path = Path(__file__).parent.parent.parent / '.env'
load_dotenv(env_path, override=True)

from llama_parse import LlamaParse

OUTPUT_DIR = Path(__file__).parent / "output" / "llamaparse_full"

# All models in this document (for universal detection)
ALL_DOCUMENT_MODELS = ['3JH40', '4JH45', '4JH57', '4JH80', '4JH110']
ALL_REFERENCED_SYSTEMS = ['VC10', 'VC20', 'SD605', 'KMH4A', 'KM4A']

# USER'S SELECTION - only keep figures relevant to these
USER_PRIMARY_MODEL = '4JH57'
USER_REFERENCED = ['VC20', 'SD605']

# Sections that indicate universal content (only truly universal ones)
UNIVERSAL_SECTIONS = [
    'SAFETY', 'TABLE OF CONTENTS', 'RECORD OF OWNERSHIP',
    'WARRANTY', 'DISCLAIMER', 'PRECAUTION', 'NOTICE'
]


def find_models_in_text(text):
    """Find model numbers mentioned in text."""
    if not text:
        return [], []

    found_primary = []
    found_referenced = []

    text_upper = text.upper()

    for model in ALL_DOCUMENT_MODELS:
        # Look for exact model or with common suffixes
        if re.search(rf'\b{model.upper()}\b', text_upper):
            found_primary.append(model)

    for model in ALL_REFERENCED_SYSTEMS:
        if re.search(rf'\b{model.upper()}\b', text_upper):
            found_referenced.append(model)

    return found_primary, found_referenced


def should_keep_for_user(model_info):
    """
    Decide if this figure is relevant to user's selection.

    Keep if:
    - is_universal = True, OR
    - user's primary model in applies_to_models, OR
    - any user's referenced system in referenced_systems
    """
    # Universal = keep
    if model_info['is_universal']:
        return True, "universal"

    # User's primary model matches
    if USER_PRIMARY_MODEL in model_info['applies_to_models']:
        return True, f"matches primary ({USER_PRIMARY_MODEL})"

    # User's referenced systems match
    matching_refs = set(USER_REFERENCED) & set(model_info['referenced_systems'])
    if matching_refs:
        return True, f"matches referenced ({list(matching_refs)})"

    # Not relevant to user
    return False, f"not relevant (page has {model_info['applies_to_models']})"


def is_universal_section(text):
    """Check if text indicates a universal section."""
    if not text:
        return False
    text_upper = text.upper()
    return any(section in text_upper for section in UNIVERSAL_SECTIONS)


def analyze_page_for_models(page_data):
    """
    Analyze a page to determine model applicability.

    Returns:
        dict with:
            - is_universal: bool
            - applies_to_models: list of model strings
            - referenced_systems: list of referenced system strings
            - confidence: 'high', 'medium', 'low'
            - evidence: explanation string
    """
    items = page_data.get('items', [])

    all_primary = set()
    all_referenced = set()
    headings = []

    # Collect all model mentions and headings
    for item in items:
        item_type = item.get('type', '')
        value = item.get('value', item.get('md', ''))

        primary, referenced = find_models_in_text(value)
        all_primary.update(primary)
        all_referenced.update(referenced)

        if item_type == 'heading':
            headings.append(value)

    # Decision logic
    all_primary = list(all_primary)
    all_referenced = list(all_referenced)

    # Check if this is a universal section
    is_universal_by_section = any(is_universal_section(h) for h in headings)

    # Check if ALL models are mentioned (explicit universal)
    mentions_all_models = len(all_primary) >= len(ALL_DOCUMENT_MODELS) - 1  # Allow 1 missing

    # Some but not all models mentioned = model-specific
    mentions_some_models = 0 < len(all_primary) < len(ALL_DOCUMENT_MODELS) - 1

    # No models mentioned at all
    no_models_mentioned = len(all_primary) == 0

    # PRIORITY: Model mentions take precedence over section headers
    if mentions_some_models:
        # Specific models mentioned - this is model-specific content
        return {
            'is_universal': False,
            'applies_to_models': all_primary,
            'referenced_systems': all_referenced,
            'confidence': 'high',
            'evidence': f"Specific models mentioned: {all_primary}"
        }
    elif mentions_all_models:
        return {
            'is_universal': True,
            'applies_to_models': ALL_DOCUMENT_MODELS.copy(),
            'referenced_systems': all_referenced,
            'confidence': 'high',
            'evidence': f"All models mentioned: {all_primary}"
        }
    elif is_universal_by_section:
        return {
            'is_universal': True,
            'applies_to_models': ALL_DOCUMENT_MODELS.copy(),
            'referenced_systems': all_referenced,
            'confidence': 'high',
            'evidence': f"Universal section detected: {headings[0] if headings else 'unknown'}"
        }
    elif no_models_mentioned:
        # Ambiguous - might be universal or might need context
        return {
            'is_universal': True,  # Default to universal if no specific models
            'applies_to_models': ALL_DOCUMENT_MODELS.copy(),
            'referenced_systems': all_referenced,
            'confidence': 'low',
            'evidence': "No specific models mentioned - defaulting to universal"
        }
    else:
        # Fallback
        return {
            'is_universal': True,
            'applies_to_models': ALL_DOCUMENT_MODELS.copy(),
            'referenced_systems': all_referenced,
            'confidence': 'low',
            'evidence': "Fallback to universal"
        }


def find_related_elements(layout, picture_bbox):
    """Find elements spatially related to a picture."""
    pic_x = picture_bbox['x']
    pic_y = picture_bbox['y']
    pic_w = picture_bbox['w']
    pic_h = picture_bbox['h']
    pic_bottom = pic_y + pic_h
    pic_right = pic_x + pic_w

    min_x = pic_x
    min_y = pic_y
    max_x = pic_right
    max_y = pic_bottom

    related = []

    for elem in layout:
        label = elem.get('label', '')
        bbox = elem.get('bbox', {})
        elem_x = bbox.get('x', 0)
        elem_y = bbox.get('y', 0)
        elem_w = bbox.get('w', 0)
        elem_h = bbox.get('h', 0)
        elem_center_x = elem_x + elem_w / 2

        if label in ('pageHeader', 'pageFooter'):
            continue

        if label == 'picture' and abs(elem_y - pic_y) < 0.01:
            continue

        is_below = elem_y >= pic_bottom - 0.05
        is_horizontally_aligned = (
            (elem_center_x >= pic_x - 0.1 and elem_center_x <= pic_right + 0.1) or
            (elem_x >= pic_x - 0.05 and elem_x + elem_w <= pic_right + 0.05)
        )

        if label in ('caption', 'listItem', 'text') and is_below and is_horizontally_aligned:
            if elem_y < pic_bottom + 0.4:
                related.append(elem)
                max_y = max(max_y, elem_y + elem_h)
                min_x = min(min_x, elem_x)
                max_x = max(max_x, elem_x + elem_w)

    return {
        'x': min_x,
        'y': min_y,
        'w': max_x - min_x,
        'h': max_y - min_y
    }, related


async def main():
    pdf_path = sys.argv[1] if len(sys.argv) > 1 else "/Users/brad/Downloads/yanmar test.pdf"
    num_pages = int(sys.argv[2]) if len(sys.argv) > 2 else 30

    api_key = os.getenv('LLAMAPARSE_API_KEY')
    if not api_key:
        print("LLAMAPARSE_API_KEY not found")
        sys.exit(1)

    # 0-indexed page range
    target_pages = ','.join(str(i) for i in range(num_pages))

    print(f"PDF: {pdf_path}")
    print(f"Pages: 1-{num_pages}")
    print(f"Primary models: {ALL_DOCUMENT_MODELS}")
    print(f"Referenced systems: {ALL_REFERENCED_SYSTEMS}")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # Step 1: Parse with LlamaParse
    print("\n=== Step 1: Parsing with LlamaParse ===")
    parser = LlamaParse(
        api_key=api_key,
        result_type="markdown",
        verbose=True,
        extract_layout=True,
        target_pages=target_pages
    )

    json_results = await parser.aget_json(pdf_path)
    pages_data = json_results[0]['pages']
    print(f"Got {len(pages_data)} pages")

    # Step 2: Render PDF pages
    print("\n=== Step 2: Rendering PDF pages ===")
    images = convert_from_path(pdf_path, dpi=200, first_page=1, last_page=num_pages)
    page_images = {i+1: img for i, img in enumerate(images)}
    print(f"Rendered {len(images)} page images")

    # Step 3: Process each page
    print("\n=== Step 3: Processing pages ===")

    all_assets = []
    crop_count = 0

    for page_data in pages_data:
        page_num = page_data.get('page', 0)
        layout = page_data.get('layout', [])

        # Analyze page for model applicability
        model_info = analyze_page_for_models(page_data)

        # Find pictures worth cropping
        pictures = [
            elem for elem in layout
            if elem.get('label') == 'picture'
            and not elem.get('isLikelyNoise', False)
            and elem.get('bbox', {}).get('h', 0) > 0.08  # Skip tiny images
        ]

        # Also find tables
        tables = [
            elem for elem in layout
            if elem.get('label') in ('table', 'form')
            and not elem.get('isLikelyNoise', False)
            and elem.get('bbox', {}).get('h', 0) > 0.05
        ]

        elements_to_crop = pictures + tables

        # Check if this page is relevant to user
        keep, reason = should_keep_for_user(model_info)

        if not elements_to_crop:
            status = "UNIVERSAL" if model_info['is_universal'] else f"MODELS: {model_info['applies_to_models']}"
            print(f"  Page {page_num:2d}: No figures/tables | {status}")
            continue

        status = "UNIVERSAL" if model_info['is_universal'] else f"MODELS: {model_info['applies_to_models']}"

        if not keep:
            print(f"  Page {page_num:2d}: {len(pictures)} pictures, {len(tables)} tables | {status} | ❌ SKIP ({reason})")
            continue

        print(f"  Page {page_num:2d}: {len(pictures)} pictures, {len(tables)} tables | {status} | ✅ KEEP ({reason})")

        if page_num not in page_images:
            continue

        img = page_images[page_num]
        img_width, img_height = img.size

        for i, elem in enumerate(elements_to_crop):
            elem_type = elem.get('label', 'unknown')
            elem_bbox = elem.get('bbox', {})

            # For pictures, try to merge with related elements
            if elem_type == 'picture':
                merged_bbox, related = find_related_elements(layout, elem_bbox)
            else:
                merged_bbox = elem_bbox
                related = []

            # Convert to pixels
            x = merged_bbox['x'] * img_width
            y = merged_bbox['y'] * img_height
            w = merged_bbox['w'] * img_width
            h = merged_bbox['h'] * img_height

            # Add padding
            pad_x = img_width * 0.02
            pad_y = img_height * 0.02

            left = max(0, x - pad_x)
            top = max(0, y - pad_y)
            right = min(img_width, x + w + pad_x)
            bottom = min(img_height, y + h + pad_y)

            # Crop
            cropped = img.crop((left, top, right, bottom))

            # Build asset record
            asset = {
                'page_number': page_num,
                'asset_index': i,
                'asset_kind': 'figure' if elem_type == 'picture' else 'table',
                'bbox': {
                    'x': merged_bbox['x'] * 100,
                    'y': merged_bbox['y'] * 100,
                    'width': merged_bbox['w'] * 100,
                    'height': merged_bbox['h'] * 100
                },
                'is_universal': model_info['is_universal'],
                'applies_to_models': model_info['applies_to_models'],
                'referenced_systems': model_info['referenced_systems'],
                'confidence': model_info['confidence'],
                'evidence': model_info['evidence'],
                'related_elements': len(related),
                'crop_size': {'width': cropped.size[0], 'height': cropped.size[1]}
            }
            all_assets.append(asset)

            # Save crop
            kind = 'figure' if elem_type == 'picture' else 'table'
            univ = '_universal' if model_info['is_universal'] else ''
            filename = f"page_{page_num:02d}_{kind}_{i:02d}{univ}.png"
            output_path = OUTPUT_DIR / filename
            cropped.save(output_path)
            crop_count += 1

    # Save manifest
    manifest = {
        'pdf_path': str(pdf_path),
        'pages_processed': num_pages,
        'total_assets': len(all_assets),
        'primary_models': ALL_DOCUMENT_MODELS,
        'referenced_systems': ALL_REFERENCED_SYSTEMS,
        'timestamp': datetime.now().isoformat(),
        'assets': all_assets
    }

    manifest_path = OUTPUT_DIR / 'manifest.json'
    with open(manifest_path, 'w') as f:
        json.dump(manifest, f, indent=2)

    # Summary
    print(f"\n=== Summary ===")
    print(f"Total assets: {len(all_assets)}")
    print(f"Crops saved: {crop_count}")

    universal_count = sum(1 for a in all_assets if a['is_universal'])
    specific_count = len(all_assets) - universal_count
    print(f"Universal: {universal_count}")
    print(f"Model-specific: {specific_count}")

    print(f"\nOutput: {OUTPUT_DIR}")
    print(f"Manifest: {manifest_path}")


if __name__ == "__main__":
    asyncio.run(main())
