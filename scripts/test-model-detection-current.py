#!/usr/bin/env python3
"""
Test model detection using the EXACT current production code path.

Replicates the full pipeline:
  1. Fetches llamaparse_raw.json from Supabase Storage for a doc_id
  2. Builds markdown from pages (same as LlamaParse output)
  3. Fetches reference data from Supabase (same as Node proxy)
  4. Builds the exact same prompt as main.py:501-550
  5. Calls OpenAI with same params (model, temperature=0, max_tokens=2000, json_object)
  6. Shows raw result + what gets truncated

Usage:
  cd python-sidecar && source venv/bin/activate && cd ..
  python scripts/test-model-detection-current.py <doc_id>
  python scripts/test-model-detection-current.py 1a178ba54c77a95553a48a362166b3f09c0b24e6e0b634ba8a942d87e5b02df5
"""

import os
import sys
import json
import time
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / '.env')

from openai import OpenAI
from supabase import create_client

# Init clients
openai_client = OpenAI(api_key=os.getenv('OPENAI_API_KEY'))
supabase_key = os.getenv('PY_SUPABASE_SERVICE_KEY') or os.getenv('SUPABASE_SERVICE_KEY') or os.getenv('SUPABASE_SERVICE_ROLE_KEY')
supabase = create_client(os.getenv('SUPABASE_URL'), supabase_key)


def fetch_markdown_from_storage(doc_id: str) -> str:
    """Fetch llamaparse_raw.json and build markdown, same as production."""
    storage_path = f"manuals/{doc_id}/llamaparse_raw.json"
    print(f"   Fetching: {storage_path}")

    response = supabase.storage.from_('documents').download(storage_path)
    raw_json = json.loads(response)

    pages = raw_json.get('pages', [])
    print(f"   Pages: {len(pages)}")

    # Build markdown from pages - replicate what LlamaParse returns as text
    markdown_parts = []
    for page in pages:
        for item in page.get('items', []):
            item_type = item.get('type', '')
            value = item.get('value', '')
            if item_type in ('text', 'table'):
                markdown_parts.append(value)
            elif item_type == 'heading':
                markdown_parts.append(f"# {value}")

    markdown = '\n'.join(markdown_parts)
    print(f"   Markdown: {len(markdown):,} chars")
    return markdown


def fetch_reference_data() -> dict:
    """Fetch reference tables, same as Node proxy at app.js:166-189."""
    mfrs = supabase.table('ref_manufacturers').select('name').order('name').execute()
    types = supabase.table('ref_product_types').select('name').order('name').execute()
    systems = supabase.table('ref_system_categories').select('id, name').order('display_order').execute()
    subsystems = supabase.table('ref_subsystem_categories').select('id, name, system_id').order('display_order').execute()

    system_map = {s['id']: s['name'] for s in (systems.data or [])}
    subsystem_list = [
        {'name': sub['name'], 'system_id': sub['system_id'], 'system_name': system_map.get(sub['system_id'], 'Unknown')}
        for sub in (subsystems.data or [])
    ]

    return {
        'manufacturers': [m['name'] for m in (mfrs.data or [])],
        'product_types': [t['name'] for t in (types.data or [])],
        'system_categories': [s['name'] for s in (systems.data or [])],
        'subsystem_categories': subsystem_list
    }


def build_prompts(markdown: str, filename: str, ref_data: dict) -> tuple:
    """Build exact same prompts as main.py:501-557."""

    # Build reference section - exact copy from main.py:488-499
    ref_section = f"""
KNOWN VALUES (select from these when possible, or suggest new if no match):

MANUFACTURERS: {', '.join(ref_data['manufacturers']) if ref_data['manufacturers'] else 'None provided'}

PRODUCT TYPES: {', '.join(ref_data['product_types']) if ref_data['product_types'] else 'None provided'}

SYSTEM CATEGORIES: {', '.join(ref_data['system_categories']) if ref_data['system_categories'] else 'None provided'}

SUBSYSTEM CATEGORIES (grouped by system):
{chr(10).join([f"  - {s['name']} (under {s['system_name']})" for s in ref_data['subsystem_categories']]) if ref_data['subsystem_categories'] else 'None provided'}
"""

    # Exact system prompt from main.py:501-550
    system_prompt = f"""You are an expert at analyzing technical manuals to identify what products they cover.

Analyze the provided technical manual and identify:

1. MANUFACTURER: Who makes the primary products in this manual?
   - Select from known manufacturers if there's a match
   - If not in the list, provide the actual manufacturer name

2. PRODUCT TYPE: What type of product is this?
   - Select from known product types if there's a match (e.g., "Engine", "Chartplotter", "Autopilot Computer")
   - If not in list, suggest an appropriate type

3. SYSTEM CATEGORY: What system category does this equipment belong to?
   - Select from known system categories (e.g., "Propulsion", "Navigation", "Electrical (DC)")

4. SUBSYSTEM CATEGORY: What subsystem category does this equipment belong to?
   - Select from known subsystem categories that match the system category
   - e.g., "Engines" under "Propulsion", "Autopilot" under "Navigation"

5. PRIMARY MODELS: What specific model(s) is this manual FOR? These are the main subjects.
   - List exact model numbers (e.g., "4JH57", "Zeus 3S", "VC20")
   - If multiple models are covered, list all of them
   - Do NOT include generic references or part numbers

6. REFERENCED PRODUCTS: What other products are MENTIONED but not the main subject?
   - Compatible accessories, related systems, integration partners
   - Products in compatibility sections, wiring diagrams, etc.
{ref_section}
Return ONLY valid JSON in this exact format:
{{
  "manufacturer": "B&G",
  "product_type": "Chartplotter",
  "system_category": "Navigation",
  "subsystem_category": "Chartplotters & MFDs",
  "primary_models": ["Zeus 3S 16"],
  "is_multi_model": false,
  "referenced_products": [
    {{"model": "4JH57", "type": "Engine", "manufacturer": "Yanmar"}},
    {{"model": "ZEN15048VDC", "type": "Watermaker", "manufacturer": "Schenker"}}
  ],
  "confidence": "high",
  "evidence": "Found model name on title page and specifications section"
}}

IMPORTANT:
- Return ONLY the JSON, no explanations before or after
- Use "high", "medium", or "low" for confidence
- If no models found, return empty arrays
- Select from KNOWN VALUES when there's a match
- Distinguish between PRIMARY models (what manual is FOR) and REFERENCED products (what it mentions)"""

    # Exact user prompt from main.py:552-557 (with truncation)
    truncated_markdown = markdown[:100000]
    user_prompt = f"""Analyze this technical manual and identify the models it covers.

Filename: {filename}

Document content:
{truncated_markdown}"""

    return system_prompt, user_prompt, truncated_markdown


def run_detection(doc_id: str, filename: str = None):
    print(f"\n{'='*70}")
    print(f"  MODEL DETECTION TEST — CURRENT PRODUCTION CODE")
    print(f"{'='*70}\n")

    # Step 1: Fetch markdown
    print("1. Fetching markdown from Supabase Storage...")
    markdown = fetch_markdown_from_storage(doc_id)

    # Step 2: Fetch reference data
    print("\n2. Fetching reference data from Supabase...")
    ref_data = fetch_reference_data()
    print(f"   Manufacturers: {len(ref_data['manufacturers'])}")
    print(f"   Product types: {len(ref_data['product_types'])}")
    print(f"   System categories: {len(ref_data['system_categories'])}")
    print(f"   Subsystem categories: {len(ref_data['subsystem_categories'])}")

    # Step 3: Get filename from documents table if not provided
    if not filename:
        doc = supabase.table('documents').select('storage_path').eq('doc_id', doc_id).execute()
        if doc.data:
            filename = doc.data[0].get('storage_path', '').split('/')[-1]
        else:
            filename = 'unknown.pdf'
    print(f"\n   Filename: {filename}")

    # Step 4: Build prompts
    print("\n3. Building prompts (exact production code)...")
    system_prompt, user_prompt, truncated = build_prompts(markdown, filename, ref_data)

    chars_lost = len(markdown) - len(truncated)
    pct_lost = (chars_lost / len(markdown) * 100) if len(markdown) > 0 else 0
    print(f"   System prompt: {len(system_prompt):,} chars")
    print(f"   User prompt: {len(user_prompt):,} chars")
    print(f"   Markdown sent: {len(truncated):,} / {len(markdown):,} chars")
    if chars_lost > 0:
        print(f"   *** TRUNCATED: {chars_lost:,} chars lost ({pct_lost:.1f}%) ***")
    else:
        print(f"   No truncation needed")

    # Step 5: Check what's in the truncated portion
    if chars_lost > 0:
        lost_text = markdown[100000:]
        # Look for model-like patterns in lost text
        import re
        model_patterns = re.findall(r'\b[A-Z]{1,4}[\-\s]?\d{2,4}[A-Z]?\d?\b', lost_text)
        unique_models = sorted(set(model_patterns))[:20]
        if unique_models:
            print(f"   Model-like strings in LOST text: {', '.join(unique_models)}")

    # Step 6: Call OpenAI
    model = os.getenv('MODEL_DETECTION_MODEL', 'gpt-4.1-mini')
    print(f"\n4. Calling OpenAI ({model}, temperature=0, max_tokens=2000)...")
    start = time.time()

    response = openai_client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        temperature=0,
        max_tokens=2000,
        response_format={"type": "json_object"}
    )

    elapsed = time.time() - start
    result_text = response.choices[0].message.content
    usage = response.usage

    print(f"   Done in {elapsed:.1f}s")
    print(f"   Input tokens: {usage.prompt_tokens:,}")
    print(f"   Output tokens: {usage.completion_tokens:,}")
    print(f"   Cost: ~${(usage.prompt_tokens * 0.15 + usage.completion_tokens * 0.60) / 1_000_000:.4f}")

    # Step 7: Parse and display
    result = json.loads(result_text)

    print(f"\n{'='*70}")
    print(f"  RESULTS")
    print(f"{'='*70}")
    print(f"\n  Manufacturer:      {result.get('manufacturer')}")
    print(f"  Product Type:      {result.get('product_type')}")
    print(f"  System Category:   {result.get('system_category')}")
    print(f"  Subsystem:         {result.get('subsystem_category')}")
    print(f"  Confidence:        {result.get('confidence')}")
    print(f"  Multi-model:       {result.get('is_multi_model')}")

    print(f"\n  PRIMARY MODELS ({len(result.get('primary_models', []))}):")
    for m in result.get('primary_models', []):
        print(f"    - {m}")

    print(f"\n  REFERENCED PRODUCTS ({len(result.get('referenced_products', []))}):")
    for rp in result.get('referenced_products', []):
        print(f"    - {rp.get('model', '?'):20s}  type={rp.get('type', '?'):20s}  mfr={rp.get('manufacturer', '?')}")

    print(f"\n  Evidence: {result.get('evidence', 'N/A')}")

    # Step 8: Check for known missing models
    print(f"\n{'='*70}")
    print(f"  COVERAGE CHECK")
    print(f"{'='*70}")

    known_models = ['SD60', 'VC20', 'VC10', 'VC30', 'KM4A', 'KMH4A', 'ZF25', 'ZF30']
    all_detected = [m for m in result.get('primary_models', [])]
    all_detected += [rp.get('model', '') for rp in result.get('referenced_products', [])]
    all_detected_upper = [m.upper().replace(' ', '').replace('-', '') for m in all_detected]

    for km in known_models:
        norm = km.upper().replace(' ', '').replace('-', '')
        found = any(norm in d for d in all_detected_upper)
        status = 'FOUND' if found else 'MISSING'
        marker = '  ' if found else '**'
        print(f"  {marker} {km:10s} — {status}")

    # Save raw result
    output_path = Path(__file__).parent / f"test-detection-result-{doc_id[:12]}.json"
    with open(output_path, 'w') as f:
        json.dump({
            'doc_id': doc_id,
            'filename': filename,
            'markdown_total_chars': len(markdown),
            'markdown_sent_chars': len(truncated),
            'truncated_chars': chars_lost,
            'model': model,
            'input_tokens': usage.prompt_tokens,
            'output_tokens': usage.completion_tokens,
            'result': result
        }, f, indent=2)
    print(f"\n  Raw result saved to: {output_path}")

    print(f"\n{'='*70}\n")
    return result


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python scripts/test-model-detection-current.py <doc_id> [filename]")
        print("\nExample:")
        print("  python scripts/test-model-detection-current.py 1a178ba54c77a95553a48a362166b3f09c0b24e6e0b634ba8a942d87e5b02df5")
        sys.exit(1)

    doc_id = sys.argv[1]
    filename = sys.argv[2] if len(sys.argv) > 2 else None
    run_detection(doc_id, filename)
