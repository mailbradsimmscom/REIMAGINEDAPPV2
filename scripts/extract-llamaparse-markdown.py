#!/usr/bin/env python3
"""
Extract markdown from PDF using LlamaParse and save to file.
Usage: python scripts/extract-llamaparse-markdown.py <pdf_path> [output_path]
"""

import sys
import os
import asyncio
from pathlib import Path
from datetime import datetime

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent / "python-sidecar"))

from dotenv import load_dotenv
load_dotenv()

async def extract_markdown(pdf_path: str, output_path: str = None):
    """Extract markdown from PDF using LlamaParse."""

    from llama_parse import LlamaParse

    api_key = os.getenv('LLAMAPARSE_API_KEY')
    if not api_key:
        print("ERROR: LLAMAPARSE_API_KEY not found in environment")
        sys.exit(1)

    pdf_path = Path(pdf_path)
    if not pdf_path.exists():
        print(f"ERROR: PDF not found: {pdf_path}")
        sys.exit(1)

    # Default output path
    if not output_path:
        output_dir = Path(__file__).parent.parent / "python-sidecar" / "llamaparse_output"
        output_dir.mkdir(exist_ok=True)
        output_path = output_dir / f"{pdf_path.stem}_markdown.md"

    print(f"=" * 60)
    print(f"LlamaParse Markdown Extraction")
    print(f"=" * 60)
    print(f"Input PDF: {pdf_path}")
    print(f"PDF Size: {pdf_path.stat().st_size / 1024 / 1024:.2f} MB")
    print(f"Output: {output_path}")
    print(f"Started: {datetime.now().isoformat()}")
    print(f"-" * 60)

    # Initialize LlamaParse
    parser = LlamaParse(
        api_key=api_key,
        result_type="markdown",
        verbose=True,
        language="en",
        parsing_instruction=(
            "Extract all content preserving document structure. "
            "Maintain headings, lists, tables, and section hierarchy. "
            "For tables, preserve formatting. For lists, maintain nesting. "
            "For technical specs, keep exact formatting."
        )
    )

    print("Calling LlamaParse API (this may take a few minutes)...")
    start_time = datetime.now()

    # Parse document
    documents = await parser.aload_data(str(pdf_path))

    elapsed = (datetime.now() - start_time).total_seconds()
    print(f"LlamaParse completed in {elapsed:.1f} seconds")

    if not documents:
        print("ERROR: No content extracted")
        sys.exit(1)

    # Combine all document content
    full_markdown = "\n\n".join([doc.text for doc in documents])

    # Save to file
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(full_markdown)

    print(f"-" * 60)
    print(f"RESULTS:")
    print(f"  - Documents returned: {len(documents)}")
    print(f"  - Total characters: {len(full_markdown):,}")
    print(f"  - Estimated tokens: ~{len(full_markdown) // 4:,}")
    print(f"  - Output file size: {Path(output_path).stat().st_size / 1024:.1f} KB")
    print(f"  - Saved to: {output_path}")
    print(f"=" * 60)

    return str(output_path)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python scripts/extract-llamaparse-markdown.py <pdf_path> [output_path]")
        sys.exit(1)

    pdf_path = sys.argv[1]
    output_path = sys.argv[2] if len(sys.argv) > 2 else None

    result = asyncio.run(extract_markdown(pdf_path, output_path))
    print(f"\nDone! Markdown saved to: {result}")
