#!/usr/bin/env python3
"""
Compare LlamaParse layout extraction vs Vision pipeline bounding boxes.

Usage:
    cd python-sidecar
    source venv/bin/activate
    python scripts/test_llamaparse_vs_vision.py /path/to/document.pdf [--pages 1-25]

This script:
1. Parses PDF with LlamaParse (extract_layout=True, result_type="json")
2. Extracts bounding boxes for figures/tables
3. Compares to existing Vision analysis (if doc_id provided)
4. Outputs comparison report
"""

import os
import sys
import json
import asyncio
import argparse
from pathlib import Path
from datetime import datetime
from typing import Dict, Any, List, Optional

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from dotenv import load_dotenv
# Load from project root .env
env_path = Path(__file__).parent.parent.parent / '.env'
print(f"Loading env from: {env_path}")
load_dotenv(env_path, override=True)

from llama_parse import LlamaParse
from supabase import create_client
import httpx


def get_supabase():
    """Get Supabase client."""
    url = os.getenv('SUPABASE_URL')
    key = os.getenv('SUPABASE_SERVICE_KEY')
    if not url or not key:
        print("Warning: Supabase credentials not found, Vision comparison disabled")
        return None
    try:
        return create_client(url, key)
    except Exception as e:
        print(f"Warning: Failed to create Supabase client: {e}")
        return None


async def get_raw_layout_from_api(job_id: str, api_key: str) -> Optional[Dict]:
    """
    Fetch raw layout data from LlamaParse API using job ID.
    """
    try:
        base_url = "https://api.cloud.llamaindex.ai/api/parsing"

        async with httpx.AsyncClient() as client:
            # Get job result with layout
            result_url = f"{base_url}/job/{job_id}/result/json"
            headers = {"Authorization": f"Bearer {api_key}"}

            response = await client.get(result_url, headers=headers, timeout=30.0)

            if response.status_code == 200:
                return response.json()
            else:
                print(f"API response: {response.status_code} - {response.text[:200]}")
                return None

    except Exception as e:
        print(f"Error fetching raw layout: {e}")
        return None


async def parse_with_llamaparse(pdf_path: str, pages: Optional[str] = None) -> Dict[str, Any]:
    """
    Parse PDF with LlamaParse using layout extraction.

    Args:
        pdf_path: Path to PDF file
        pages: Optional page range (e.g., "1-25" or "1,5,10")

    Returns:
        Dict with layout data including bounding boxes
    """
    api_key = os.getenv('LLAMAPARSE_API_KEY')
    if not api_key:
        raise ValueError("LLAMAPARSE_API_KEY not found in environment")

    print(f"\n{'='*60}")
    print("LLAMAPARSE LAYOUT EXTRACTION")
    print(f"{'='*60}")
    print(f"PDF: {pdf_path}")
    print(f"Pages: {pages or 'all'}")

    # Configure LlamaParse with layout extraction
    # Note: result_type can be "markdown" or "text"
    # extract_layout=True adds layout data to the result
    parser_kwargs = {
        "api_key": api_key,
        "result_type": "markdown",
        "verbose": True,
        "language": "en",
        # Layout extraction - this is the key param
        "extract_layout": True,
    }

    # Add page range if specified
    if pages:
        # Convert "1-25" to "0-24" (0-indexed)
        if '-' in pages:
            start, end = pages.split('-')
            parser_kwargs["target_pages"] = f"{int(start)-1}-{int(end)-1}"
        else:
            # Comma-separated pages
            page_list = [str(int(p)-1) for p in pages.split(',')]
            parser_kwargs["target_pages"] = ",".join(page_list)

    print(f"Parser config: {json.dumps({k:v for k,v in parser_kwargs.items() if k != 'api_key'}, indent=2)}")

    parser = LlamaParse(**parser_kwargs)

    start_time = datetime.now()

    # Parse the document
    try:
        # Use load_data for sync, aload_data for async
        result = await parser.aload_data(pdf_path)

        elapsed = (datetime.now() - start_time).total_seconds()
        print(f"\nParsing completed in {elapsed:.1f}s")

        # Try to get raw JSON result with layout data
        # The SDK wraps results in Document objects, but layout data may be in raw response
        raw_json = None

        # Check parser for job tracking
        print(f"\nParser attributes: {[a for a in dir(parser) if not a.startswith('_')][:20]}")

        # Try to get the job_id from parser internals
        job_id = None
        if hasattr(parser, '_job_id'):
            job_id = parser._job_id
        elif hasattr(parser, 'job_id'):
            job_id = parser.job_id

        # Look for job_id in the output (it was printed during parsing)
        # We'll need to capture it differently

        # Try get_json_result if available
        try:
            if hasattr(parser, 'get_json_result'):
                json_result = await parser.get_json_result(pdf_path)
                print(f"get_json_result: {type(json_result)}")
                if json_result:
                    raw_json = json_result
        except Exception as e:
            print(f"get_json_result failed: {e}")

        # Try get_images if available
        try:
            if hasattr(parser, 'get_images'):
                images = await parser.get_images([{"job_id": job_id}] if job_id else [])
                print(f"get_images: {images}")
        except Exception as e:
            print(f"get_images failed: {e}")

        return {
            "success": True,
            "documents": result,
            "raw_json": raw_json,
            "processing_time": elapsed
        }

    except Exception as e:
        print(f"Error parsing: {e}")
        return {
            "success": False,
            "error": str(e)
        }


def extract_layout_elements(parse_result: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Extract figures and tables with bounding boxes from LlamaParse result.

    Returns list of elements with:
        - page_number
        - element_type (figure/table/image)
        - bbox (x, y, width, height as percentages)
        - raw_bbox (original coordinates)
        - content/text
    """
    elements = []

    if not parse_result.get("success"):
        return elements

    documents = parse_result.get("documents", [])
    raw_json = parse_result.get("raw_json")

    print(f"\n{'='*60}")
    print("EXAMINING LLAMAPARSE OUTPUT")
    print(f"{'='*60}")
    print(f"Number of documents: {len(documents)}")

    if raw_json:
        print(f"\nRaw JSON type: {type(raw_json)}")
        if isinstance(raw_json, dict):
            print(f"Raw JSON keys: {raw_json.keys()}")
            print(f"Raw JSON preview: {json.dumps(raw_json, indent=2, default=str)[:2000]}")
        elif isinstance(raw_json, list):
            print(f"Raw JSON is list of {len(raw_json)} items")
            if raw_json:
                print(f"First item type: {type(raw_json[0])}")
                print(f"First item: {json.dumps(raw_json[0], indent=2, default=str)[:1000]}")

    for i, doc in enumerate(documents):
        print(f"\n--- Document {i+1} ---")
        print(f"Type: {type(doc).__name__}")

        # Try model_dump for Pydantic objects
        if hasattr(doc, 'model_dump'):
            try:
                dumped = doc.model_dump()
                print(f"model_dump keys: {dumped.keys()}")
                # Look for layout-related keys
                for key in ['layout', 'elements', 'images', 'figures', 'tables', 'pages', 'nodes']:
                    if key in dumped:
                        print(f"  {key}: {type(dumped[key])} - {str(dumped[key])[:200]}")
            except Exception as e:
                print(f"model_dump failed: {e}")

        # Check metadata
        if hasattr(doc, 'metadata') and doc.metadata:
            print(f"Metadata: {json.dumps(doc.metadata, indent=2, default=str)[:500]}")

        # Check for extra_info (LlamaIndex sometimes uses this)
        if hasattr(doc, 'extra_info') and doc.extra_info:
            print(f"extra_info: {json.dumps(doc.extra_info, indent=2, default=str)[:500]}")

        # Check text length
        if hasattr(doc, 'text'):
            print(f"Text length: {len(doc.text)} chars")

    return elements


def fetch_vision_results(doc_id: str) -> List[Dict[str, Any]]:
    """
    Fetch existing Vision pipeline results from doc_assets table.
    """
    supabase = get_supabase()
    if not supabase:
        return []

    print(f"\n{'='*60}")
    print("VISION PIPELINE RESULTS")
    print(f"{'='*60}")
    print(f"Doc ID: {doc_id}")

    try:
        result = supabase.table('doc_assets').select('*').eq('doc_id', doc_id).execute()
        assets = result.data or []
        print(f"Found {len(assets)} assets")

        return assets

    except Exception as e:
        print(f"Error fetching Vision results: {e}")
        return []


def compare_bboxes(llamaparse_elements: List[Dict], vision_assets: List[Dict]) -> Dict[str, Any]:
    """
    Compare bounding boxes from LlamaParse vs Vision.

    Analyzes:
    - Coverage: Does LlamaParse find more/fewer elements?
    - Accuracy: How different are the bboxes for matching elements?
    - Types: What element types does each find?
    """
    print(f"\n{'='*60}")
    print("COMPARISON")
    print(f"{'='*60}")

    comparison = {
        "llamaparse_count": len(llamaparse_elements),
        "vision_count": len(vision_assets),
        "llamaparse_by_type": {},
        "vision_by_type": {},
        "matches": [],
        "llamaparse_only": [],
        "vision_only": []
    }

    # Count by type
    for elem in llamaparse_elements:
        etype = elem.get("element_type", "unknown")
        comparison["llamaparse_by_type"][etype] = comparison["llamaparse_by_type"].get(etype, 0) + 1

    for asset in vision_assets:
        atype = asset.get("asset_kind", "unknown")
        comparison["vision_by_type"][atype] = comparison["vision_by_type"].get(atype, 0) + 1

    print(f"\nLlamaParse found: {len(llamaparse_elements)} elements")
    print(f"  By type: {comparison['llamaparse_by_type']}")

    print(f"\nVision found: {len(vision_assets)} assets")
    print(f"  By type: {comparison['vision_by_type']}")

    # Group by page for matching
    lp_by_page = {}
    for elem in llamaparse_elements:
        page = elem.get("page_number", 0)
        if page not in lp_by_page:
            lp_by_page[page] = []
        lp_by_page[page].append(elem)

    vision_by_page = {}
    for asset in vision_assets:
        page = asset.get("page_number", 0)
        if page not in vision_by_page:
            vision_by_page[page] = []
        vision_by_page[page].append(asset)

    # Show per-page comparison
    all_pages = sorted(set(lp_by_page.keys()) | set(vision_by_page.keys()))

    print(f"\nPer-page breakdown:")
    for page in all_pages[:10]:  # First 10 pages
        lp_count = len(lp_by_page.get(page, []))
        v_count = len(vision_by_page.get(page, []))
        status = "✓" if lp_count == v_count else "≠"
        print(f"  Page {page:2d}: LlamaParse={lp_count}, Vision={v_count} {status}")

    return comparison


def save_results(
    pdf_path: str,
    llamaparse_result: Dict,
    llamaparse_elements: List[Dict],
    vision_assets: List[Dict],
    comparison: Dict
):
    """Save comparison results to JSON file."""
    output_dir = Path(__file__).parent / "output"
    output_dir.mkdir(exist_ok=True)

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    output_file = output_dir / f"bbox_comparison_{timestamp}.json"

    results = {
        "pdf_path": str(pdf_path),
        "timestamp": timestamp,
        "llamaparse": {
            "success": llamaparse_result.get("success"),
            "processing_time": llamaparse_result.get("processing_time"),
            "elements": llamaparse_elements
        },
        "vision": {
            "assets": vision_assets
        },
        "comparison": comparison
    }

    with open(output_file, 'w') as f:
        json.dump(results, f, indent=2, default=str)

    print(f"\nResults saved to: {output_file}")


async def main():
    parser = argparse.ArgumentParser(description='Compare LlamaParse vs Vision bounding boxes')
    parser.add_argument('pdf_path', help='Path to PDF file')
    parser.add_argument('--pages', default='1-25', help='Page range (e.g., "1-25" or "1,5,10")')
    parser.add_argument('--doc-id', help='Document ID for Vision comparison')

    args = parser.parse_args()

    # Validate PDF exists
    pdf_path = Path(args.pdf_path)
    if not pdf_path.exists():
        print(f"Error: PDF not found: {pdf_path}")
        sys.exit(1)

    print(f"\n{'#'*60}")
    print("LLAMAPARSE vs VISION BBOX COMPARISON")
    print(f"{'#'*60}")
    print(f"PDF: {pdf_path}")
    print(f"Pages: {args.pages}")
    print(f"Doc ID: {args.doc_id or '(not provided)'}")

    # Step 1: Parse with LlamaParse
    llamaparse_result = await parse_with_llamaparse(str(pdf_path), args.pages)

    # Step 2: Extract layout elements
    llamaparse_elements = extract_layout_elements(llamaparse_result)

    # Step 3: Fetch Vision results (if doc_id provided)
    vision_assets = []
    if args.doc_id:
        vision_assets = fetch_vision_results(args.doc_id)

    # Step 4: Compare
    comparison = compare_bboxes(llamaparse_elements, vision_assets)

    # Step 5: Save results
    save_results(pdf_path, llamaparse_result, llamaparse_elements, vision_assets, comparison)

    print(f"\n{'#'*60}")
    print("DONE")
    print(f"{'#'*60}")


if __name__ == "__main__":
    asyncio.run(main())
