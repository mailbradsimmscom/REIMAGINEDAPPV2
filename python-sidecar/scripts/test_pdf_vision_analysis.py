#!/usr/bin/env python3
"""
Test Script: PDF Vision Analysis

Extracts page screenshots from a PDF and runs Claude Vision analysis.
Tests multi-model detection, figure identification, and table parsing.

Usage:
    python scripts/test_pdf_vision_analysis.py --pdf PATH [--pages 1,5,10] [--context "..."]

Examples:
    # Analyze specific pages from Yanmar saildrive manual
    python scripts/test_pdf_vision_analysis.py --pdf /path/to/yanmar_sail_drive.pdf --pages 1,5,10

    # Analyze first 5 pages
    python scripts/test_pdf_vision_analysis.py --pdf /path/to/manual.pdf --pages 1-5

    # Analyze all pages (careful with large PDFs!)
    python scripts/test_pdf_vision_analysis.py --pdf /path/to/manual.pdf --all
"""

import os
import sys
import json
import base64
import argparse
import tempfile
from pathlib import Path
from datetime import datetime
from typing import List, Optional

import anthropic
from dotenv import load_dotenv

# Try to import pdf2image, fall back to PyMuPDF
try:
    from pdf2image import convert_from_path
    PDF_LIBRARY = "pdf2image"
except ImportError:
    try:
        import fitz  # PyMuPDF
        PDF_LIBRARY = "pymupdf"
    except ImportError:
        print("ERROR: Need either pdf2image or PyMuPDF installed")
        print("  pip install pdf2image  (requires poppler)")
        print("  pip install PyMuPDF")
        sys.exit(1)

load_dotenv()

ANTHROPIC_API_KEY = os.getenv('ANTHROPIC_API_KEY')
OUTPUT_DIR = Path(__file__).parent.parent / "visual_extraction_work/vision_test_results"


def extract_page_image_pdf2image(pdf_path: Path, page_num: int, output_path: Path) -> Path:
    """Extract a single page as image using pdf2image."""
    images = convert_from_path(
        pdf_path,
        first_page=page_num,
        last_page=page_num,
        dpi=150  # Good balance of quality and size
    )
    if images:
        images[0].save(output_path, 'JPEG', quality=90)
        return output_path
    raise ValueError(f"Could not extract page {page_num}")


def extract_page_image_pymupdf(pdf_path: Path, page_num: int, output_path: Path) -> Path:
    """Extract a single page as image using PyMuPDF."""
    import fitz
    doc = fitz.open(pdf_path)
    # PyMuPDF uses 0-based indexing
    page = doc[page_num - 1]
    # Render at 150 DPI (default is 72)
    mat = fitz.Matrix(150/72, 150/72)
    pix = page.get_pixmap(matrix=mat)
    pix.save(output_path)
    doc.close()
    return output_path


def extract_page_image(pdf_path: Path, page_num: int, output_path: Path) -> Path:
    """Extract a page as image using available library."""
    if PDF_LIBRARY == "pdf2image":
        return extract_page_image_pdf2image(pdf_path, page_num, output_path)
    else:
        return extract_page_image_pymupdf(pdf_path, page_num, output_path)


def get_pdf_page_count(pdf_path: Path) -> int:
    """Get total number of pages in PDF."""
    if PDF_LIBRARY == "pdf2image":
        from pdf2image import pdfinfo_from_path
        info = pdfinfo_from_path(pdf_path)
        return info['Pages']
    else:
        import fitz
        doc = fitz.open(pdf_path)
        count = len(doc)
        doc.close()
        return count


def parse_page_range(page_spec: str, max_pages: int) -> List[int]:
    """Parse page specification like '1,5,10' or '1-5' or '1-5,10,15-20'."""
    pages = set()
    for part in page_spec.split(','):
        part = part.strip()
        if '-' in part:
            start, end = part.split('-')
            start = int(start)
            end = min(int(end), max_pages)
            pages.update(range(start, end + 1))
        else:
            page = int(part)
            if page <= max_pages:
                pages.add(page)
    return sorted(pages)


def analyze_page_with_vision(image_path: Path, document_context: str, models_covered: List[str] = None) -> dict:
    """Send page image to Claude Vision for semantic analysis."""
    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

    # Encode image
    with open(image_path, "rb") as f:
        image_data = base64.standard_b64encode(f.read()).decode("utf-8")

    # Determine media type
    suffix = image_path.suffix.lower()
    media_type = "image/jpeg" if suffix in ['.jpg', '.jpeg'] else "image/png"

    # Build model context
    model_context = ""
    if models_covered:
        model_context = f"\n\nThis manual covers multiple product models: {', '.join(models_covered)}"
        model_context += "\nPay special attention to identifying which content applies to which specific model."

    prompt = f"""Analyze this page from a technical manual.

Context: {document_context}{model_context}

Identify ALL visual elements on this page and return a JSON object with:

1. **figures**: Array of diagrams, schematics, drawings, photos
   - type: "exploded_view" | "wiring_diagram" | "schematic" | "photo" | "flowchart" | "installation_diagram" | "dimensional_drawing" | "comparison_chart" | "other"
   - title: Title or caption if visible
   - description: What the figure shows (1-2 sentences)
   - bbox: Bounding box as percentage of page {{x: 0-100, y: 0-100, width: 0-100, height: 0-100}}
   - figure_reference: Any reference number like "Figure 3.2"
   - applies_to_models: Which specific PRIMARY models this figure applies to (list of model names, or ["all"] if universal)
   - referenced_systems: Other equipment/systems shown in this figure that aren't the primary product (e.g., if an engine manual shows saildrive installation, list the saildrive model here)

2. **tables**: Array of tables on the page
   - type: "parts_list" | "specifications" | "comparison" | "procedure_steps" | "troubleshooting" | "wiring" | "other"
   - title: Table title if visible
   - description: What the table contains
   - bbox: Bounding box as percentage
   - columns: List of column headers
   - is_multi_model: Does this table compare different product models? (true/false)
   - model_columns: If multi-model comparison, map which columns correspond to which models
   - applies_to_models: Which PRIMARY models this table applies to
   - referenced_systems: Other equipment/systems referenced in this table that aren't the primary product

3. **text_sections**: Major text sections
   - title: Section heading
   - bbox: Bounding box as percentage
   - content_type: "heading" | "instructions" | "warning" | "specifications" | "notes" | "model_specific"
   - applies_to_models: Which PRIMARY models this section applies to (or ["all"])
   - referenced_systems: Other equipment/systems mentioned in this section

4. **page_metadata**:
   - page_number: If visible
   - has_header: true/false
   - has_footer: true/false
   - primary_content: "diagram" | "table" | "text" | "mixed" | "specifications"
   - models_mentioned: List of specific PRIMARY model numbers/names mentioned on this page
   - systems_referenced: List of OTHER equipment/systems mentioned on this page (not the primary product)
   - is_model_specific_page: Is this page dedicated to a specific model? (true/false)
   - quality_notes: Any issues with the page

Return ONLY valid JSON, no markdown code blocks.
"""

    print(f"  Sending to Claude Vision...")
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
                    {"type": "text", "text": prompt}
                ],
            }
        ],
    )

    elapsed = (datetime.now() - start_time).total_seconds()
    print(f"  Response in {elapsed:.2f}s")

    response_text = response.content[0].text

    # Parse JSON
    try:
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
        print(f"  WARNING: JSON parse error: {e}")
        result = {"raw_response": response_text, "parse_error": str(e)}

    result["_metadata"] = {
        "image_path": str(image_path),
        "analysis_time_seconds": elapsed,
        "model": "claude-sonnet-4-20250514",
        "timestamp": datetime.now().isoformat(),
        "input_tokens": response.usage.input_tokens,
        "output_tokens": response.usage.output_tokens
    }

    return result


def print_analysis_summary(result: dict, page_num: int):
    """Print human-readable summary."""
    print(f"\n  --- Page {page_num} Summary ---")

    # Models mentioned
    pm = result.get("page_metadata", {})
    models = pm.get("models_mentioned", [])
    if models:
        print(f"  Models mentioned: {', '.join(models)}")
    if pm.get("is_model_specific_page"):
        print(f"  *** MODEL-SPECIFIC PAGE ***")

    # Figures
    figures = result.get("figures", [])
    if figures:
        print(f"  Figures: {len(figures)}")
        for fig in figures:
            applies = fig.get("applies_to_models", ["all"])
            print(f"    - [{fig.get('type')}] {fig.get('title', 'Untitled')} (models: {applies})")

    # Tables
    tables = result.get("tables", [])
    if tables:
        print(f"  Tables: {len(tables)}")
        for tbl in tables:
            multi = "MULTI-MODEL" if tbl.get("is_multi_model") else ""
            applies = tbl.get("applies_to_models", ["all"])
            print(f"    - [{tbl.get('type')}] {tbl.get('title', 'Untitled')} {multi} (models: {applies})")
            if tbl.get("model_columns"):
                print(f"      Model columns: {tbl['model_columns']}")

    # Tokens
    meta = result.get("_metadata", {})
    print(f"  Tokens: {meta.get('input_tokens', '?')} in, {meta.get('output_tokens', '?')} out")


def main():
    parser = argparse.ArgumentParser(description='PDF Vision Analysis Test')
    parser.add_argument('--pdf', type=str, required=True, help='Path to PDF file')
    parser.add_argument('--pages', type=str, help='Pages to analyze (e.g., "1,5,10" or "1-5")')
    parser.add_argument('--all', action='store_true', help='Analyze all pages')
    parser.add_argument('--context', type=str, default=None, help='Document context')
    parser.add_argument('--models', type=str, default=None, help='Comma-separated list of models covered')
    args = parser.parse_args()

    if not ANTHROPIC_API_KEY:
        print("ERROR: ANTHROPIC_API_KEY not set")
        sys.exit(1)

    pdf_path = Path(args.pdf)
    if not pdf_path.exists():
        print(f"ERROR: PDF not found: {pdf_path}")
        sys.exit(1)

    # Get page count
    total_pages = get_pdf_page_count(pdf_path)
    print(f"\n{'#'*60}")
    print(f"PDF VISION ANALYSIS TEST")
    print(f"{'#'*60}")
    print(f"PDF: {pdf_path.name}")
    print(f"Total pages: {total_pages}")
    print(f"Library: {PDF_LIBRARY}")

    # Determine which pages to analyze
    if args.all:
        pages = list(range(1, total_pages + 1))
    elif args.pages:
        pages = parse_page_range(args.pages, total_pages)
    else:
        # Default: first 3 pages
        pages = list(range(1, min(4, total_pages + 1)))

    print(f"Pages to analyze: {pages}")

    # Parse context
    context = args.context or f"This is a page from a {pdf_path.stem.replace('_', ' ')} technical manual."
    models_covered = args.models.split(',') if args.models else None

    if models_covered:
        print(f"Models covered: {models_covered}")

    # Create output directory
    output_subdir = OUTPUT_DIR / pdf_path.stem
    output_subdir.mkdir(parents=True, exist_ok=True)

    # Process pages
    all_results = []
    total_input_tokens = 0
    total_output_tokens = 0

    with tempfile.TemporaryDirectory() as tmp_dir:
        for page_num in pages:
            print(f"\n{'='*60}")
            print(f"Processing page {page_num}/{total_pages}")

            # Extract page image
            img_path = Path(tmp_dir) / f"page_{page_num}.jpg"
            try:
                extract_page_image(pdf_path, page_num, img_path)
                print(f"  Extracted: {img_path.stat().st_size / 1024:.1f} KB")
            except Exception as e:
                print(f"  ERROR extracting page: {e}")
                continue

            # Analyze with Vision
            try:
                result = analyze_page_with_vision(img_path, context, models_covered)
                result["page_number"] = page_num
                print_analysis_summary(result, page_num)

                # Save individual result
                result_path = output_subdir / f"page_{page_num:03d}_analysis.json"
                with open(result_path, 'w') as f:
                    json.dump(result, f, indent=2)

                # Also save the page image
                saved_img_path = output_subdir / f"page_{page_num:03d}.jpg"
                import shutil
                shutil.copy(img_path, saved_img_path)

                all_results.append(result)
                total_input_tokens += result.get("_metadata", {}).get("input_tokens", 0)
                total_output_tokens += result.get("_metadata", {}).get("output_tokens", 0)

            except Exception as e:
                print(f"  ERROR analyzing: {e}")
                import traceback
                traceback.print_exc()

    # Summary
    print(f"\n{'#'*60}")
    print(f"ANALYSIS COMPLETE")
    print(f"{'#'*60}")
    print(f"Pages analyzed: {len(all_results)}")
    print(f"Results saved to: {output_subdir}")

    # Aggregate stats
    all_models_mentioned = set()
    multi_model_tables = 0
    model_specific_pages = 0

    for r in all_results:
        pm = r.get("page_metadata", {})
        all_models_mentioned.update(pm.get("models_mentioned", []))
        if pm.get("is_model_specific_page"):
            model_specific_pages += 1
        for tbl in r.get("tables", []):
            if tbl.get("is_multi_model"):
                multi_model_tables += 1

    print(f"\nModels found across all pages: {sorted(all_models_mentioned)}")
    print(f"Multi-model comparison tables: {multi_model_tables}")
    print(f"Model-specific pages: {model_specific_pages}")

    print(f"\nToken usage: {total_input_tokens} input, {total_output_tokens} output")
    cost = (total_input_tokens * 0.003 + total_output_tokens * 0.015) / 1000
    print(f"Estimated cost: ${cost:.4f}")

    # Save aggregate results
    aggregate_path = output_subdir / "aggregate_analysis.json"
    with open(aggregate_path, 'w') as f:
        json.dump({
            "pdf": str(pdf_path),
            "pages_analyzed": len(all_results),
            "models_mentioned": sorted(all_models_mentioned),
            "multi_model_tables": multi_model_tables,
            "model_specific_pages": model_specific_pages,
            "total_input_tokens": total_input_tokens,
            "total_output_tokens": total_output_tokens,
            "estimated_cost": cost,
            "results": all_results
        }, f, indent=2)
    print(f"Aggregate results: {aggregate_path}")


if __name__ == "__main__":
    main()
