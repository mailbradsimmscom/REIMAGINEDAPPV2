#!/usr/bin/env python3
"""
Test Script: Figure Cropping

Tests whether we can crop figures from page screenshots using bounding boxes
from the Vision analysis.

Usage:
    python scripts/test_figure_cropping.py --analysis PATH [--output DIR]

Example:
    python scripts/test_figure_cropping.py --analysis vision_test_results/page_12_analysis.json
"""

import os
import sys
import json
import argparse
from pathlib import Path

from PIL import Image

# Output directory for cropped figures
DEFAULT_OUTPUT_DIR = Path(__file__).parent.parent / "visual_extraction_work/vision_test_results/cropped"


def crop_figure(image_path: Path, bbox: dict, output_path: Path) -> dict:
    """
    Crop a figure from an image using percentage-based bounding box.

    Args:
        image_path: Path to the source image
        bbox: Dict with x, y, width, height as percentages (0-100)
        output_path: Path to save cropped image

    Returns:
        Dict with crop metadata
    """
    # Load image
    img = Image.open(image_path)
    img_width, img_height = img.size

    # Convert percentage bbox to pixels
    x = int(bbox['x'] / 100 * img_width)
    y = int(bbox['y'] / 100 * img_height)
    width = int(bbox['width'] / 100 * img_width)
    height = int(bbox['height'] / 100 * img_height)

    # Ensure bounds are within image
    x = max(0, min(x, img_width))
    y = max(0, min(y, img_height))
    right = min(x + width, img_width)
    bottom = min(y + height, img_height)

    # Crop
    cropped = img.crop((x, y, right, bottom))

    # Save
    output_path.parent.mkdir(parents=True, exist_ok=True)
    cropped.save(output_path, quality=95)

    return {
        "source_image": str(image_path),
        "output_image": str(output_path),
        "source_size": {"width": img_width, "height": img_height},
        "bbox_percent": bbox,
        "bbox_pixels": {"x": x, "y": y, "width": right - x, "height": bottom - y},
        "cropped_size": {"width": cropped.width, "height": cropped.height}
    }


def process_analysis(analysis_path: Path, output_dir: Path) -> list:
    """
    Process a Vision analysis JSON and crop all figures.

    Returns list of crop results.
    """
    # Load analysis
    with open(analysis_path) as f:
        analysis = json.load(f)

    # Get source image path
    source_image = Path(analysis['_metadata']['image_path'])
    if not source_image.exists():
        print(f"ERROR: Source image not found: {source_image}")
        return []

    results = []

    # Process figures
    figures = analysis.get('figures', [])
    print(f"\nProcessing {len(figures)} figures from {analysis_path.name}")

    for i, figure in enumerate(figures):
        bbox = figure.get('bbox')
        if not bbox:
            print(f"  Figure {i+1}: No bounding box, skipping")
            continue

        fig_type = figure.get('type', 'unknown')
        fig_title = figure.get('title', f'figure_{i+1}')

        # Clean title for filename
        safe_title = "".join(c if c.isalnum() or c in "._- " else "_" for c in fig_title)
        safe_title = safe_title.replace(" ", "_")[:50]

        output_path = output_dir / f"{source_image.stem}_{i+1}_{fig_type}_{safe_title}.jpg"

        print(f"  Figure {i+1}: [{fig_type}] {fig_title}")
        print(f"    BBox: x={bbox['x']}%, y={bbox['y']}%, w={bbox['width']}%, h={bbox['height']}%")

        try:
            result = crop_figure(source_image, bbox, output_path)
            result['figure_metadata'] = figure
            results.append(result)
            print(f"    Cropped: {result['cropped_size']['width']}x{result['cropped_size']['height']}px")
            print(f"    Saved: {output_path.name}")
        except Exception as e:
            print(f"    ERROR: {e}")

    # Process tables (crop them too)
    tables = analysis.get('tables', [])
    print(f"\nProcessing {len(tables)} tables")

    for i, table in enumerate(tables):
        bbox = table.get('bbox')
        if not bbox:
            print(f"  Table {i+1}: No bounding box, skipping")
            continue

        tbl_type = table.get('type', 'unknown')
        tbl_title = table.get('title', f'table_{i+1}')

        # Clean title for filename
        safe_title = "".join(c if c.isalnum() or c in "._- " else "_" for c in tbl_title)
        safe_title = safe_title.replace(" ", "_")[:50]

        output_path = output_dir / f"{source_image.stem}_{i+1}_table_{tbl_type}_{safe_title}.jpg"

        print(f"  Table {i+1}: [{tbl_type}] {tbl_title}")
        print(f"    BBox: x={bbox['x']}%, y={bbox['y']}%, w={bbox['width']}%, h={bbox['height']}%")

        try:
            result = crop_figure(source_image, bbox, output_path)
            result['table_metadata'] = table
            results.append(result)
            print(f"    Cropped: {result['cropped_size']['width']}x{result['cropped_size']['height']}px")
            print(f"    Saved: {output_path.name}")
        except Exception as e:
            print(f"    ERROR: {e}")

    return results


def main():
    parser = argparse.ArgumentParser(description='Test Figure Cropping')
    parser.add_argument('--analysis', type=str, required=True, help='Path to Vision analysis JSON')
    parser.add_argument('--output', type=str, default=None, help='Output directory for cropped images')
    args = parser.parse_args()

    analysis_path = Path(args.analysis)
    if not analysis_path.exists():
        # Try relative to vision_test_results
        alt_path = Path(__file__).parent.parent / "visual_extraction_work/vision_test_results" / args.analysis
        if alt_path.exists():
            analysis_path = alt_path
        else:
            print(f"ERROR: Analysis file not found: {args.analysis}")
            sys.exit(1)

    output_dir = Path(args.output) if args.output else DEFAULT_OUTPUT_DIR

    print(f"\n{'#'*60}")
    print(f"FIGURE CROPPING TEST")
    print(f"{'#'*60}")
    print(f"Analysis: {analysis_path}")
    print(f"Output: {output_dir}")

    results = process_analysis(analysis_path, output_dir)

    # Save results
    if results:
        results_file = output_dir / f"{analysis_path.stem}_crop_results.json"
        with open(results_file, 'w') as f:
            json.dump(results, f, indent=2)
        print(f"\nResults saved to: {results_file}")

    print(f"\n{'#'*60}")
    print(f"COMPLETE")
    print(f"{'#'*60}")
    print(f"Cropped {len(results)} elements")


if __name__ == "__main__":
    main()
