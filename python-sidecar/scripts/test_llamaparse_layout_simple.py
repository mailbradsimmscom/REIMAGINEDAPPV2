#!/usr/bin/env python3
"""
Simple test to check what LlamaParse returns with extract_layout=True.
Looking for pages[].items[] structure with bounding boxes.
"""

import os
import sys
import json
import asyncio
from pathlib import Path
from dotenv import load_dotenv

# Load env
env_path = Path(__file__).parent.parent.parent / '.env'
load_dotenv(env_path, override=True)

from llama_parse import LlamaParse

async def main():
    pdf_path = sys.argv[1] if len(sys.argv) > 1 else "/Users/brad/Downloads/yanmar test.pdf"

    api_key = os.getenv('LLAMAPARSE_API_KEY')
    if not api_key:
        print("LLAMAPARSE_API_KEY not found")
        sys.exit(1)

    print(f"PDF: {pdf_path}")

    # Test with extract_layout - use aget_json to get raw structure
    parser = LlamaParse(
        api_key=api_key,
        result_type="markdown",
        verbose=True,
        extract_layout=True,
        target_pages="21"  # Page 22 (0-indexed)
    )

    print("\nParsing with aget_json()...")
    try:
        json_results = await parser.aget_json(pdf_path)

        print(f"\nResult type: {type(json_results)}")

        if isinstance(json_results, list) and len(json_results) > 0:
            result = json_results[0]
            print(f"Result keys: {list(result.keys())}")

            # Check for pages
            if 'pages' in result:
                pages = result['pages']
                print(f"\nFound {len(pages)} pages")

                for page in pages[:2]:
                    print(f"\n--- Page {page.get('page', '?')} ---")
                    print(f"Page keys: {list(page.keys())}")

                    # Check for items (layout elements)
                    if 'items' in page:
                        items = page['items']
                        print(f"Found {len(items)} items")
                        for i, item in enumerate(items[:5]):
                            print(f"\n  Item {i}:")
                            print(f"    Type: {type(item)}")
                            if isinstance(item, dict):
                                print(f"    Keys: {list(item.keys())}")
                                # Look for bbox-related keys
                                for k in ['bbox', 'bounding_box', 'x', 'y', 'width', 'height', 'type', 'kind']:
                                    if k in item:
                                        print(f"    {k}: {item[k]}")
                                # Show full item if small
                                item_str = json.dumps(item, default=str)
                                if len(item_str) < 500:
                                    print(f"    Full: {item_str}")

                    # Check for images
                    if 'images' in page:
                        images = page['images']
                        print(f"\nFound {len(images)} images")
                        for img in images[:3]:
                            print(f"  Image: {img}")

                    # Check for layout
                    if 'layout' in page:
                        layout = page['layout']
                        print(f"\nLayout: {type(layout)}")
                        if isinstance(layout, dict):
                            print(f"  Keys: {list(layout.keys())}")
                        print(f"  Preview: {str(layout)[:500]}")

            # Save full result to file for inspection
            output_path = Path(__file__).parent / "output" / "llamaparse_raw.json"
            output_path.parent.mkdir(exist_ok=True)
            with open(output_path, 'w') as f:
                json.dump(json_results, f, indent=2, default=str)
            print(f"\n\nFull result saved to: {output_path}")

    except Exception as e:
        print(f"Error: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    asyncio.run(main())
