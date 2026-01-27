#!/usr/bin/env python3
"""
Crop figures using LlamaParse bounding boxes.
Saves cropped images for visual inspection.
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

OUTPUT_DIR = Path(__file__).parent / "output" / "llamaparse_crops"


async def main():
    pdf_path = sys.argv[1] if len(sys.argv) > 1 else "/Users/brad/Downloads/yanmar test.pdf"
    pages_arg = sys.argv[2] if len(sys.argv) > 2 else "15,16,17,18,19,20,21,22"  # 0-indexed internally

    api_key = os.getenv('LLAMAPARSE_API_KEY')
    if not api_key:
        print("LLAMAPARSE_API_KEY not found")
        sys.exit(1)

    # Convert to 0-indexed for LlamaParse
    page_nums = [int(p) for p in pages_arg.split(',')]
    target_pages = ','.join(str(p-1) for p in page_nums)  # LlamaParse is 0-indexed

    print(f"PDF: {pdf_path}")
    print(f"Pages: {pages_arg} (1-indexed)")
    print(f"Target pages for LlamaParse: {target_pages} (0-indexed)")

    # Create output directory
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # Step 1: Parse with LlamaParse to get bboxes
    print("\n=== Step 1: Getting bboxes from LlamaParse ===")
    parser = LlamaParse(
        api_key=api_key,
        result_type="markdown",
        verbose=True,
        extract_layout=True,
        target_pages=target_pages
    )

    json_results = await parser.aget_json(pdf_path)

    if not json_results or not json_results[0].get('pages'):
        print("No pages returned from LlamaParse")
        return

    pages_data = json_results[0]['pages']
    print(f"Got {len(pages_data)} pages from LlamaParse")

    # Step 2: Render PDF pages to images
    print("\n=== Step 2: Rendering PDF pages ===")
    # Render at 200 DPI for good quality
    images = convert_from_path(
        pdf_path,
        dpi=200,
        first_page=min(page_nums),
        last_page=max(page_nums)
    )
    print(f"Rendered {len(images)} page images")

    # Map page numbers to images
    page_images = {}
    for i, page_num in enumerate(range(min(page_nums), max(page_nums) + 1)):
        if i < len(images):
            page_images[page_num] = images[i]

    # Step 3: Crop using LlamaParse bboxes
    print("\n=== Step 3: Cropping figures ===")

    crop_count = 0
    for page_data in pages_data:
        page_num = page_data.get('page', 0)
        layout = page_data.get('layout', [])

        # Filter to just pictures, tables, figures
        figures = [
            elem for elem in layout
            if elem.get('label') in ('picture', 'table', 'figure', 'form', 'chart')
            and not elem.get('isLikelyNoise', False)
        ]

        if not figures:
            print(f"  Page {page_num}: No figures/tables found")
            continue

        print(f"  Page {page_num}: Found {len(figures)} elements")

        # Get the rendered image for this page
        if page_num not in page_images:
            print(f"    Warning: No rendered image for page {page_num}")
            continue

        img = page_images[page_num]
        img_width, img_height = img.size

        for i, elem in enumerate(figures):
            bbox = elem.get('bbox', {})
            label = elem.get('label', 'unknown')
            confidence = elem.get('confidence', 0)

            # Convert 0-1 bbox to pixels
            x = bbox.get('x', 0) * img_width
            y = bbox.get('y', 0) * img_height
            w = bbox.get('w', 0) * img_width
            h = bbox.get('h', 0) * img_height

            # Add small padding (2%)
            pad_x = img_width * 0.02
            pad_y = img_height * 0.02

            left = max(0, x - pad_x)
            top = max(0, y - pad_y)
            right = min(img_width, x + w + pad_x)
            bottom = min(img_height, y + h + pad_y)

            # Crop
            cropped = img.crop((left, top, right, bottom))

            # Save
            filename = f"page_{page_num:02d}_{label}_{i:02d}.png"
            output_path = OUTPUT_DIR / filename
            cropped.save(output_path)

            print(f"    Saved: {filename} ({cropped.size[0]}x{cropped.size[1]}, conf={confidence:.2f})")
            crop_count += 1

    print(f"\n=== Done: {crop_count} crops saved to {OUTPUT_DIR} ===")


if __name__ == "__main__":
    asyncio.run(main())
