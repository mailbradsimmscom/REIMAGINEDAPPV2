#!/usr/bin/env python3
"""
Crop figures with merged bboxes - includes picture + caption + parts list.
Merges from picture.y to last related listItem.y + h.
"""

import os
import sys
import json
import asyncio
from pathlib import Path
from dotenv import load_dotenv
from pdf2image import convert_from_path
from PIL import Image

# Load env
env_path = Path(__file__).parent.parent.parent / '.env'
load_dotenv(env_path, override=True)

from llama_parse import LlamaParse

OUTPUT_DIR = Path(__file__).parent / "output" / "llamaparse_crops_merged"


def find_related_elements(layout, picture_bbox):
    """
    Find elements that are spatially related to a picture:
    - Captions below the picture
    - ListItems below the picture (parts list)
    - Tables near the picture

    Returns merged bbox that encompasses all related elements.
    """
    pic_x = picture_bbox['x']
    pic_y = picture_bbox['y']
    pic_w = picture_bbox['w']
    pic_h = picture_bbox['h']
    pic_bottom = pic_y + pic_h
    pic_right = pic_x + pic_w
    pic_center_x = pic_x + pic_w / 2

    # Start with picture bbox
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

        # Skip if it's a page header/footer
        if label in ('pageHeader', 'pageFooter'):
            continue

        # Skip the picture itself
        if label == 'picture' and abs(elem_y - pic_y) < 0.01:
            continue

        # Check if element is below the picture and horizontally aligned
        is_below = elem_y >= pic_bottom - 0.05  # Allow small overlap
        is_horizontally_aligned = (
            (elem_center_x >= pic_x - 0.1 and elem_center_x <= pic_right + 0.1) or
            (elem_x >= pic_x - 0.05 and elem_x + elem_w <= pic_right + 0.05)
        )

        # For listItems and captions, check if they're below and aligned
        if label in ('caption', 'listItem', 'text') and is_below and is_horizontally_aligned:
            # Only include if it's reasonably close (within 40% of page height)
            if elem_y < pic_bottom + 0.4:
                related.append(elem)
                max_y = max(max_y, elem_y + elem_h)
                # Expand x bounds slightly for list items
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
    pages_arg = sys.argv[2] if len(sys.argv) > 2 else "16,17,18,21,22"

    api_key = os.getenv('LLAMAPARSE_API_KEY')
    if not api_key:
        print("LLAMAPARSE_API_KEY not found")
        sys.exit(1)

    page_nums = [int(p) for p in pages_arg.split(',')]
    target_pages = ','.join(str(p-1) for p in page_nums)

    print(f"PDF: {pdf_path}")
    print(f"Pages: {pages_arg} (1-indexed)")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # Step 1: Parse with LlamaParse
    print("\n=== Step 1: Getting layout from LlamaParse ===")
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
    images = convert_from_path(
        pdf_path,
        dpi=200,
        first_page=min(page_nums),
        last_page=max(page_nums)
    )

    page_images = {}
    for i, page_num in enumerate(range(min(page_nums), max(page_nums) + 1)):
        if i < len(images):
            page_images[page_num] = images[i]

    # Step 3: Find pictures and merge with related elements
    print("\n=== Step 3: Cropping with merged bboxes ===")

    crop_count = 0
    for page_data in pages_data:
        page_num = page_data.get('page', 0)
        layout = page_data.get('layout', [])

        # Find all pictures
        pictures = [
            elem for elem in layout
            if elem.get('label') == 'picture'
            and not elem.get('isLikelyNoise', False)
            and elem.get('bbox', {}).get('h', 0) > 0.1  # Skip tiny images
        ]

        if not pictures:
            print(f"  Page {page_num}: No pictures found")
            continue

        print(f"  Page {page_num}: Found {len(pictures)} pictures")

        if page_num not in page_images:
            print(f"    Warning: No rendered image for page {page_num}")
            continue

        img = page_images[page_num]
        img_width, img_height = img.size

        for i, pic in enumerate(pictures):
            pic_bbox = pic.get('bbox', {})

            # Find related elements and get merged bbox
            merged_bbox, related = find_related_elements(layout, pic_bbox)

            print(f"    Picture {i}: original h={pic_bbox.get('h',0):.3f}, merged h={merged_bbox['h']:.3f}, {len(related)} related elements")

            # Convert 0-1 bbox to pixels
            x = merged_bbox['x'] * img_width
            y = merged_bbox['y'] * img_height
            w = merged_bbox['w'] * img_width
            h = merged_bbox['h'] * img_height

            # Add padding (3%)
            pad_x = img_width * 0.03
            pad_y = img_height * 0.03

            left = max(0, x - pad_x)
            top = max(0, y - pad_y)
            right = min(img_width, x + w + pad_x)
            bottom = min(img_height, y + h + pad_y)

            # Crop
            cropped = img.crop((left, top, right, bottom))

            # Save
            filename = f"page_{page_num:02d}_figure_{i:02d}_merged.png"
            output_path = OUTPUT_DIR / filename
            cropped.save(output_path)

            print(f"    Saved: {filename} ({cropped.size[0]}x{cropped.size[1]})")
            crop_count += 1

    print(f"\n=== Done: {crop_count} merged crops saved to {OUTPUT_DIR} ===")


if __name__ == "__main__":
    asyncio.run(main())
