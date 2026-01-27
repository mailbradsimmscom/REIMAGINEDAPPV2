#!/usr/bin/env python3
"""
Test Script: Vision Page Analysis

Tests whether Claude Vision can identify figures, diagrams, tables, and their
semantic meaning from a page screenshot.

This is a validation test before rebuilding the document pipeline.

Usage:
    python scripts/test_vision_page_analysis.py [--image PATH] [--page NUM]

Examples:
    # Test with default (Marco pump exploded view)
    python scripts/test_vision_page_analysis.py

    # Test with specific image
    python scripts/test_vision_page_analysis.py --image /path/to/page.jpg

    # Test multiple pages
    python scripts/test_vision_page_analysis.py --page 8
    python scripts/test_vision_page_analysis.py --page 12
"""

import os
import sys
import json
import base64
import argparse
from pathlib import Path
from datetime import datetime

import anthropic
from dotenv import load_dotenv

load_dotenv()

# Configuration
ANTHROPIC_API_KEY = os.getenv('ANTHROPIC_API_KEY')
DEFAULT_TEST_DIR = Path(__file__).parent.parent / "visual_extraction_work/ab4f40f6c7db8160bdbbbe7bdfd123d669280b403b4718ff682639cbbca957ee/images"
DEFAULT_IMAGE_PREFIX = "0533d95f-b7e5-4eed-9aa6-ef5e7706091f"

# Output directory for results
OUTPUT_DIR = Path(__file__).parent.parent / "visual_extraction_work/vision_test_results"


def encode_image_to_base64(image_path: Path) -> str:
    """Read image and encode to base64."""
    with open(image_path, "rb") as f:
        return base64.standard_b64encode(f.read()).decode("utf-8")


def get_media_type(image_path: Path) -> str:
    """Get media type from file extension."""
    suffix = image_path.suffix.lower()
    if suffix in ['.jpg', '.jpeg']:
        return "image/jpeg"
    elif suffix == '.png':
        return "image/png"
    elif suffix == '.gif':
        return "image/gif"
    elif suffix == '.webp':
        return "image/webp"
    else:
        raise ValueError(f"Unsupported image format: {suffix}")


def analyze_page_with_vision(image_path: Path, document_context: str = None) -> dict:
    """
    Send page image to Claude Vision for semantic analysis.

    Returns structured data about figures, tables, and content on the page.
    """
    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

    # Encode image
    image_data = encode_image_to_base64(image_path)
    media_type = get_media_type(image_path)

    # Build context
    context = document_context or "This is a page from a marine equipment manual."

    prompt = f"""Analyze this page from a technical manual.

Context: {context}

Identify ALL visual elements on this page and return a JSON object with:

1. **figures**: Array of diagrams, schematics, drawings, photos
   - type: "exploded_view" | "wiring_diagram" | "schematic" | "photo" | "flowchart" | "installation_diagram" | "dimensional_drawing" | "other"
   - title: Title or caption if visible
   - description: What the figure shows (1-2 sentences)
   - bbox: Bounding box as percentage of page {{x: 0-100, y: 0-100, width: 0-100, height: 0-100}} where (0,0) is top-left
   - figure_reference: Any reference number like "Figure 3.2" or "Diagram A"
   - numbered_parts: If exploded view, list the part numbers visible (e.g., [1, 2, 3...])
   - applies_to_models: Which specific PRIMARY models this figure applies to (list of model names, or ["all"] if universal)
   - referenced_systems: Other equipment/systems shown in this figure that aren't the primary product

2. **tables**: Array of tables on the page
   - type: "parts_list" | "specifications" | "comparison" | "procedure_steps" | "troubleshooting" | "other"
   - title: Table title if visible
   - description: What the table contains
   - bbox: Bounding box as percentage
   - columns: List of column headers
   - is_multi_model: Does this table have columns for different product models? (true/false)
   - model_columns: If multi-model, map column index to model name
   - applies_to_models: Which specific PRIMARY models this table applies to (list of model names, or ["all"] if universal)
   - referenced_systems: Other equipment/systems referenced in this table that aren't the primary product

3. **text_sections**: Major text sections (headers, body text areas)
   - title: Section heading
   - bbox: Bounding box as percentage
   - content_type: "heading" | "instructions" | "warning" | "specifications" | "notes"
   - applies_to_models: Which PRIMARY models this section applies to (or ["all"])
   - referenced_systems: Other equipment/systems mentioned in this section

4. **page_metadata**:
   - page_number: If visible
   - has_header: true/false
   - has_footer: true/false
   - primary_content: "diagram" | "table" | "text" | "mixed"
   - models_mentioned: List of specific PRIMARY model numbers/names mentioned on this page
   - systems_referenced: List of OTHER equipment/systems mentioned on this page (not the primary product)
   - is_model_specific_page: Is this page dedicated to a specific model? (true/false)
   - quality_notes: Any issues with the page (blank areas, cut off content, etc.)

Return ONLY valid JSON, no markdown code blocks or explanation.
"""

    print(f"\n{'='*60}")
    print(f"Analyzing: {image_path.name}")
    print(f"{'='*60}")
    print(f"Sending to Claude Vision...")

    start_time = datetime.now()

    response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=4096,
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": media_type,
                            "data": image_data,
                        },
                    },
                    {
                        "type": "text",
                        "text": prompt
                    }
                ],
            }
        ],
    )

    elapsed = (datetime.now() - start_time).total_seconds()
    print(f"Response received in {elapsed:.2f}s")

    # Extract response text
    response_text = response.content[0].text

    # Parse JSON
    try:
        # Try to extract JSON if wrapped in markdown
        if "```json" in response_text:
            json_start = response_text.find("```json") + 7
            json_end = response_text.find("```", json_start)
            response_text = response_text[json_start:json_end].strip()
        elif "```" in response_text:
            json_start = response_text.find("```") + 3
            json_end = response_text.find("```", json_start)
            response_text = response_text[json_start:json_end].strip()

        result = json.loads(response_text)
    except json.JSONDecodeError as e:
        print(f"WARNING: Failed to parse JSON response: {e}")
        print(f"Raw response:\n{response_text[:500]}...")
        result = {"raw_response": response_text, "parse_error": str(e)}

    # Add metadata
    result["_metadata"] = {
        "image_path": str(image_path),
        "analysis_time_seconds": elapsed,
        "model": "claude-sonnet-4-20250514",
        "timestamp": datetime.now().isoformat(),
        "input_tokens": response.usage.input_tokens,
        "output_tokens": response.usage.output_tokens
    }

    return result


def print_analysis_summary(result: dict):
    """Print a human-readable summary of the analysis."""
    print(f"\n{'='*60}")
    print("ANALYSIS SUMMARY")
    print(f"{'='*60}")

    # Page metadata
    if "page_metadata" in result:
        pm = result["page_metadata"]
        print(f"\nPage Type: {pm.get('primary_content', 'unknown')}")
        if pm.get('page_number'):
            print(f"Page Number: {pm['page_number']}")

    # Figures
    figures = result.get("figures", [])
    print(f"\nFigures Found: {len(figures)}")
    for i, fig in enumerate(figures, 1):
        print(f"  {i}. [{fig.get('type', 'unknown')}] {fig.get('title', 'Untitled')}")
        print(f"     {fig.get('description', 'No description')[:80]}")
        if fig.get('bbox'):
            bbox = fig['bbox']
            print(f"     BBox: x={bbox.get('x', '?')}%, y={bbox.get('y', '?')}%, w={bbox.get('width', '?')}%, h={bbox.get('height', '?')}%")
        if fig.get('numbered_parts'):
            parts = fig['numbered_parts']
            if len(parts) > 10:
                print(f"     Parts: {parts[:5]}...{parts[-5:]} ({len(parts)} total)")
            else:
                print(f"     Parts: {parts}")

    # Tables
    tables = result.get("tables", [])
    print(f"\nTables Found: {len(tables)}")
    for i, tbl in enumerate(tables, 1):
        print(f"  {i}. [{tbl.get('type', 'unknown')}] {tbl.get('title', 'Untitled')}")
        print(f"     {tbl.get('description', 'No description')[:80]}")
        if tbl.get('columns'):
            print(f"     Columns: {tbl['columns']}")
        if tbl.get('is_multi_model'):
            print(f"     Multi-model: YES - {tbl.get('model_columns', {})}")

    # Text sections
    sections = result.get("text_sections", [])
    print(f"\nText Sections: {len(sections)}")
    for i, sec in enumerate(sections, 1):
        print(f"  {i}. [{sec.get('content_type', 'unknown')}] {sec.get('title', 'Untitled')}")

    # Token usage
    if "_metadata" in result:
        meta = result["_metadata"]
        print(f"\nAPI Usage:")
        print(f"  Input tokens: {meta.get('input_tokens', '?')}")
        print(f"  Output tokens: {meta.get('output_tokens', '?')}")
        print(f"  Time: {meta.get('analysis_time_seconds', '?'):.2f}s")


def save_result(result: dict, image_path: Path):
    """Save analysis result to JSON file."""
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    output_file = OUTPUT_DIR / f"{image_path.stem}_analysis.json"
    with open(output_file, "w") as f:
        json.dump(result, f, indent=2)

    print(f"\nResult saved to: {output_file}")
    return output_file


def main():
    parser = argparse.ArgumentParser(description='Test Vision Page Analysis')
    parser.add_argument('--image', type=str, help='Path to page image')
    parser.add_argument('--page', type=int, help='Page number to test (uses default Marco pump manual)')
    parser.add_argument('--context', type=str, default="This is a page from a Marco marine pump manual (UP6/E model).",
                        help='Document context to provide to Claude')
    parser.add_argument('--all-pages', action='store_true', help='Analyze all pages in default test set')
    args = parser.parse_args()

    # Validate API key
    if not ANTHROPIC_API_KEY:
        print("ERROR: ANTHROPIC_API_KEY not set in environment")
        sys.exit(1)

    # Determine which image(s) to analyze
    images_to_analyze = []

    if args.image:
        images_to_analyze.append(Path(args.image))
    elif args.page:
        image_path = DEFAULT_TEST_DIR / f"{DEFAULT_IMAGE_PREFIX}-page_{args.page}.jpg"
        if not image_path.exists():
            print(f"ERROR: Page {args.page} not found at {image_path}")
            sys.exit(1)
        images_to_analyze.append(image_path)
    elif args.all_pages:
        # Find all page images
        for f in sorted(DEFAULT_TEST_DIR.glob(f"{DEFAULT_IMAGE_PREFIX}-page_*.jpg")):
            images_to_analyze.append(f)
    else:
        # Default: analyze page 12 (exploded view)
        image_path = DEFAULT_TEST_DIR / f"{DEFAULT_IMAGE_PREFIX}-page_12.jpg"
        if not image_path.exists():
            print(f"ERROR: Default test image not found at {image_path}")
            print("Run with --image PATH to specify a different image")
            sys.exit(1)
        images_to_analyze.append(image_path)

    print(f"\n{'#'*60}")
    print(f"VISION PAGE ANALYSIS TEST")
    print(f"{'#'*60}")
    print(f"Images to analyze: {len(images_to_analyze)}")
    print(f"Context: {args.context[:50]}...")

    # Analyze each image
    all_results = []
    for image_path in images_to_analyze:
        try:
            result = analyze_page_with_vision(image_path, args.context)
            print_analysis_summary(result)
            save_result(result, image_path)
            all_results.append(result)
        except Exception as e:
            print(f"ERROR analyzing {image_path}: {e}")
            import traceback
            traceback.print_exc()

    # Summary
    print(f"\n{'#'*60}")
    print(f"COMPLETE")
    print(f"{'#'*60}")
    print(f"Analyzed: {len(all_results)} pages")

    total_figures = sum(len(r.get('figures', [])) for r in all_results)
    total_tables = sum(len(r.get('tables', [])) for r in all_results)
    print(f"Total figures found: {total_figures}")
    print(f"Total tables found: {total_tables}")

    if all_results:
        total_input = sum(r.get('_metadata', {}).get('input_tokens', 0) for r in all_results)
        total_output = sum(r.get('_metadata', {}).get('output_tokens', 0) for r in all_results)
        print(f"Total tokens: {total_input} input, {total_output} output")

        # Rough cost estimate (Claude Sonnet pricing)
        cost = (total_input * 0.003 + total_output * 0.015) / 1000
        print(f"Estimated cost: ${cost:.4f}")


if __name__ == "__main__":
    main()
