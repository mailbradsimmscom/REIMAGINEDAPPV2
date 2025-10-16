#!/usr/bin/env python3
"""
DIP Extraction with Prompt Caching - Batch Processing Script

Processes documents one at a time using Anthropic's prompt caching feature.
Reads from CSV, updates status after each document.

Usage:
    python scripts/bulk/batch-dip-extraction.py [options]

Options:
    --batch-size N   Process N documents at a time (default: 5)
    --dry-run        Preview what would be processed without doing it
    --test           Process just one document for testing
    --status         Show current processing status from CSV
    --force          Reprocess documents even if already completed
    --help           Show this help message

Examples:
    python scripts/bulk/batch-dip-extraction.py --batch-size 10
    python scripts/bulk/batch-dip-extraction.py --test
    python scripts/bulk/batch-dip-extraction.py --dry-run
    python scripts/bulk/batch-dip-extraction.py --status
"""

import os
import sys
import json
import time
import csv
import argparse
from datetime import datetime
from pathlib import Path
import requests
from dotenv import load_dotenv
from anthropic import Anthropic

# Load environment variables
load_dotenv()

# Configuration
CSV_PATH = "Rename/uploaded/uploaded_documents.csv"
SUPABASE_URL = os.getenv('SUPABASE_URL')
SUPABASE_SERVICE_KEY = os.getenv('SUPABASE_SERVICE_KEY') or os.getenv('SUPABASE_SERVICE_ROLE_KEY')
ANTHROPIC_API_KEY = os.getenv('ANTHROPIC_API_KEY')
ANTHROPIC_MODEL = os.getenv('ANTHROPIC_MODEL', 'claude-sonnet-4-20250514')

# Validate environment
if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
    print("❌ Missing Supabase credentials (SUPABASE_URL, SUPABASE_SERVICE_KEY)")
    sys.exit(1)

if not ANTHROPIC_API_KEY:
    print("❌ Missing ANTHROPIC_API_KEY")
    sys.exit(1)

# Initialize Anthropic client
client = Anthropic(api_key=ANTHROPIC_API_KEY)

# ============================================================================
# EXACT PROMPTS FROM EXISTING SCRIPTS
# ============================================================================

SPEC_PROMPT = """CRITICAL: You MUST respond with ONLY pure JSON. No explanations, no text before or after JSON.
FORMAT REQUIREMENT: Output must start with { and end with }. Nothing else.
If you add ANY text outside the JSON brackets, the system will fail.

TASK: Extract normalized technical specifications with semantic equivalence mapping and unit conversion.
OUTPUT FORMAT (copy exactly):
{"specifications":[{"parameter":"string","value":"string","unit":"string","confidence":0.0,"page":0,"normalized_parameter":"string","normalized_units":"string","converted_value":"string","parameter_aliases":["string"],"search_terms":["string"]}]}

FOCUS ON:
- Technical specifications with measurable values
- Dimensions, weights, capacities, pressures, temperatures, voltages
- Operating ranges and limits
- Performance characteristics

FOR EACH SPECIFICATION PROVIDE:
- Parameter: Original parameter name as written
- Value: Numeric or text value
- Unit: Original unit of measurement
- Confidence: 0.0-1.0 score
- Page: Page number where found
- Normalized Parameter: Standardized parameter name (lowercase, underscores)
- Normalized Units: SI or standard units
- Converted Value: Value in normalized units
- Parameter Aliases: Other names this parameter might be called
- Search Terms: Terms users might search for

EXAMPLES:
- "Max Pressure: 2.5 bar" becomes parameter: "Max Pressure", normalized_parameter: "operating_pressure", normalized_units: "psi", converted_value: "36.3"
- "Routes/Waypoints" becomes parameter_aliases: ["routes", "waypoints", "tracks", "navigation paths"]
- Search terms should include all variations users might ask

RULES:
- Extract ALL technical specifications found
- Focus on measurable, factual data
- Normalize for exact retrieval and unit conversion
- Include semantic equivalence mapping
- Maximum 30 specifications total
- Start response with { character
- End response with } character
- No explanatory text before JSON
- No explanatory text after JSON
- No markdown code blocks"""

GOLDEN_PROMPT = """CRITICAL: You MUST respond with ONLY pure JSON. No explanations, no text before or after JSON.
FORMAT REQUIREMENT: Output must start with { and end with }. Nothing else.
If you add ANY text outside the JSON brackets, the system will fail.

TASK: Extract validation rules and test assertions from technical manuals. These are ground-truth statements that verify correct operation or diagnose problems.

OUTPUT FORMAT (copy exactly):
{"golden_rules":[{"query":"string","expected_value":"string","test_method":"string","failure_indication":"string","models":["string"],"related_procedures":["string"]}]}

FOCUS ON:
- Safety interlocks and their expected behavior
- Normal operating indicators (lights, sounds, displays)
- Automatic shutoff conditions and timing
- Temperature/pressure limits and responses
- Error code meanings and triggers
- Quality checks during installation/maintenance

FOR EACH RULE PROVIDE:
- Query: The question or condition to check
- Expected Value: What should be true in normal operation
- Test Method: How to verify this
- Failure Indication: What it means if this fails
- Models: Which models this applies to
- Related Procedures: Connected procedures or specs

RULES:
- Extract ALL validation rules and test assertions found
- Focus on verifiable conditions and their expected behaviors
- Include safety checks, operational limits, and diagnostic conditions
- Maximum 25 rules total
- Start response with { character
- End response with } character
- No explanatory text before JSON
- No explanatory text after JSON
- No markdown code blocks"""

INTENT_PROMPT = """CRITICAL: You MUST respond with ONLY pure JSON. No explanations, no text before or after JSON.
FORMAT REQUIREMENT: Output must start with { and end with }. Nothing else.
If you add ANY text outside the JSON brackets, the system will fail.

TASK: Extract question-answer pairs from technical manuals for natural language query routing. Create direct answers to common What/How/When/Where questions.

OUTPUT FORMAT (copy exactly):
{"intent_routes":[{"question":"string","question_variations":["string"],"answer":"string","question_type":"string","models":["string"],"references":["string"]}]}

FOCUS ON:
- Common user questions about operation, installation, troubleshooting
- Clear, direct answers that can be used as query responses
- Multiple ways users might phrase the same question
- Specific procedural answers (not generic guidance)

FOR EACH Q&A PAIR PROVIDE:
- Question: The main question as it appears or implied in manual
- Question Variations: 2-4 different ways users might ask this
- Answer: Direct, specific answer (1-3 sentences max)
- Question Type: What/How/When/Where/Why
- Models: Which models this applies to
- References: Page numbers or section names

EXAMPLES:
- Question: "How do I reset the system?"
- Variations: ["What's the reset procedure?", "How to factory reset?", "Reset instructions?"]
- Answer: "Press and hold the reset button for 10 seconds until LED flashes green."
- Type: "How"

RULES:
- Extract ALL clear question-answer pairs found
- Focus on actionable, specific information
- Include multiple question phrasings
- Keep answers concise and direct
- Maximum 50 Q&A pairs total
- Start response with { character
- End response with } character
- No explanatory text before JSON
- No explanatory text after JSON
- No markdown code blocks"""

PROCEDURES_PROMPT = """CRITICAL: You MUST respond with ONLY pure JSON. No explanations, no text before or after JSON.
FORMAT REQUIREMENT: Output must start with { and end with }. Nothing else.
If you add ANY text outside the JSON brackets, the system will fail.

TASK: Extract ALL procedures, error codes, and maintenance steps from technical manuals.
INCLUDE EVERYTHING: setup, operation, troubleshooting, maintenance, cleaning, error resolution, safety procedures.
OUTPUT FORMAT (copy exactly):
{"procedures":[{"title":"string","preconditions":["string"],"steps":["string"],"expected_outcome":"string","models":["string"],"error_codes":["string"]}]}

RULES:
- Extract ALL procedures found in the manual
- Include installation, operation, maintenance, troubleshooting, cleaning procedures
- Include all error codes and their resolution steps
- Extract every procedure or sub-procedure as its own entry
- If a section has multiple modes or features (such as cooking modes), create separate procedures for each. Do not merge them
- Safety and lock features must always be their own procedure
- Cleaning and maintenance routines must always be their own procedure
- Error codes and their resolutions must be included as their own procedure
- For installation content: merge and cap at 2 procedures total (Unpacking/Setup and Countertop/Connections)
- Exclude recipes or non-technical content
- Start response with { character
- End response with } character
- No explanatory text before JSON
- No explanatory text after JSON
- No markdown code blocks"""

# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

def fetch_chunks_from_supabase(doc_id):
    """Fetch document chunks from Supabase database"""
    url = SUPABASE_URL.rstrip("/")
    headers = {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "Content-Type": "application/json"
    }

    params = {
        "doc_id": f"eq.{doc_id}",
        "content_type": "eq.text",
        "text": "not.is.null",
        "select": "chunk_id,doc_id,text,page_start,page_end,chunk_index,metadata",
        "order": "page_start,chunk_index"
    }

    try:
        response = requests.get(
            f"{url}/rest/v1/document_chunks",
            headers=headers,
            params=params,
            timeout=30
        )

        if response.status_code != 200:
            raise Exception(f"Supabase API error: {response.status_code} - {response.text}")

        chunks_data = response.json()
        return chunks_data
    except requests.exceptions.Timeout:
        raise Exception("Supabase request timed out after 30 seconds")
    except requests.exceptions.RequestException as e:
        raise Exception(f"Supabase request failed: {str(e)}")

def combine_chunks(chunks_data):
    """Combine all chunks into one text block for caching"""
    combined = []
    for i, chunk in enumerate(chunks_data):
        pages = f"{chunk.get('page_start', '?')}-{chunk.get('page_end', '?')}"
        text = chunk.get('text', '')
        combined.append(f"CHUNK {i+1} (Pages {pages}):\n{text}")

    return "\n\n---CHUNK SEPARATOR---\n\n".join(combined)

def validate_json_response(content, expected_key):
    """Validate that response is valid JSON with expected structure"""
    try:
        # Try to parse JSON
        data = json.loads(content)

        # Check if expected key exists
        if expected_key not in data:
            raise ValueError(f"Missing expected key '{expected_key}' in response")

        # Check if value is a list
        if not isinstance(data[expected_key], list):
            raise ValueError(f"Expected '{expected_key}' to be a list, got {type(data[expected_key])}")

        return True, data
    except json.JSONDecodeError as e:
        return False, f"Invalid JSON: {str(e)}"
    except Exception as e:
        return False, str(e)

def upload_to_supabase_storage(doc_id, filename, json_data):
    """Upload JSON file to Supabase storage"""
    url = SUPABASE_URL.rstrip("/")
    headers = {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': f'Bearer {SUPABASE_SERVICE_KEY}',
        'Content-Type': 'text/plain'
    }

    file_path = f"manuals/{doc_id}/DIP/{doc_id}_{filename}"
    storage_url = f"{url}/storage/v1/object/documents/{file_path}"

    json_content = json.dumps(json_data, indent=2, ensure_ascii=False)

    try:
        response = requests.post(
            storage_url,
            headers=headers,
            data=json_content.encode('utf-8'),
            timeout=30
        )

        if response.status_code in [200, 201]:
            return True, file_path
        else:
            return False, f"Upload failed: {response.status_code} - {response.text}"
    except requests.exceptions.Timeout:
        return False, "Upload timed out after 30 seconds"
    except Exception as e:
        return False, f"Upload error: {str(e)}"

def read_csv():
    """Read CSV file and return rows"""
    csv_path = Path(CSV_PATH)
    if not csv_path.exists():
        print(f"❌ CSV file not found: {CSV_PATH}")
        sys.exit(1)

    with open(csv_path, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        rows = list(reader)

    return rows

def write_csv(rows):
    """Write updated rows back to CSV"""
    if not rows:
        return

    fieldnames = list(rows[0].keys())

    with open(CSV_PATH, 'w', encoding='utf-8', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

def ensure_dip_columns(rows):
    """Ensure CSV has DIP status columns (matching llamaparse pattern)"""
    if not rows:
        return rows

    # Define all required columns
    required_columns = [
        'dip_status',
        'dip_started_at',
        'dip_completed_at',
        'specs_count',
        'golden_count',
        'intent_count',
        'procedures_count',
        'cache_tokens_written',
        'cache_tokens_read',
        'total_input_tokens',
        'total_output_tokens',
        'estimated_cost_usd',
        'dip_error_message'
    ]

    # Add missing columns
    for row in rows:
        for col in required_columns:
            if col not in row:
                row[col] = ''

    return rows

def show_status(rows):
    """Show DIP processing status"""
    stats = {
        'total': len(rows),
        'pending': len([r for r in rows if not r.get('dip_status') or r.get('dip_status') == 'pending']),
        'processing': len([r for r in rows if r.get('dip_status') == 'processing']),
        'completed': len([r for r in rows if r.get('dip_status') == 'completed']),
        'failed': len([r for r in rows if r.get('dip_status') == 'failed'])
    }

    print('\n📊 DIP PROCESSING STATUS\n')
    print(f"Total documents:     {stats['total']}")
    print(f"✅ Completed:        {stats['completed']} ({(stats['completed']/stats['total']*100):.1f}%)")
    print(f"⏳ Processing:       {stats['processing']}")
    print(f"⏸️  Pending:          {stats['pending']}")
    print(f"❌ Failed:           {stats['failed']}")

    if stats['completed'] > 0:
        completed_rows = [r for r in rows if r.get('dip_status') == 'completed']
        total_specs = sum(int(r.get('specs_count', 0) or 0) for r in completed_rows)
        total_golden = sum(int(r.get('golden_count', 0) or 0) for r in completed_rows)
        total_intent = sum(int(r.get('intent_count', 0) or 0) for r in completed_rows)
        total_procedures = sum(int(r.get('procedures_count', 0) or 0) for r in completed_rows)
        total_cost = sum(float(r.get('estimated_cost_usd', 0) or 0) for r in completed_rows)

        print(f"\n📦 Extraction Totals:")
        print(f"Total specs:         {total_specs}")
        print(f"Total golden rules:  {total_golden}")
        print(f"Total Q&A pairs:     {total_intent}")
        print(f"Total procedures:    {total_procedures}")
        print(f"Total cost:          ${total_cost:.2f}")

    if stats['failed'] > 0:
        print('\n❌ Failed Documents:')
        failed_rows = [r for r in rows if r.get('dip_status') == 'failed']
        for r in failed_rows:
            error_msg = r.get('dip_error_message', 'Unknown error')[:100]
            print(f"  - {r.get('filename', 'unknown')}: {error_msg}")

    return stats

# ============================================================================
# MAIN DIP EXTRACTION FUNCTION
# ============================================================================

def process_document_with_caching(doc_id, manufacturer, model, doc_index, total_docs):
    """Process one document with prompt caching"""

    print(f"\n{'='*80}")
    print(f"[{doc_index}/{total_docs}] {manufacturer} {model}")
    print(f"Doc ID: {doc_id[:16]}...")
    print(f"{'='*80}")

    # Track token usage
    total_cache_write = 0
    total_cache_read = 0
    total_input = 0
    total_output = 0

    try:
        # Step 1: Fetch chunks
        print("📥 Fetching chunks from Supabase...")
        chunks_data = fetch_chunks_from_supabase(doc_id)

        if not chunks_data:
            raise Exception("No chunks found in database")

        print(f"   ✓ Found {len(chunks_data)} chunks")

        # Step 2: Combine chunks for caching
        print("🔗 Combining chunks...")
        combined_text = combine_chunks(chunks_data)
        print(f"   ✓ Combined text: {len(combined_text):,} characters")

        # Prepare cached system content
        cached_system = [
            {
                "type": "text",
                "text": combined_text,
                "cache_control": {"type": "ephemeral"}
            }
        ]

        # Step 3: Extraction 1 - Specifications (CACHE WRITE)
        print("\n1️⃣  Extracting specifications (cache write)...")
        start_time = time.time()

        spec_response = client.messages.create(
            model=ANTHROPIC_MODEL,
            max_tokens=8000,
            system=cached_system + [{"type": "text", "text": SPEC_PROMPT}],
            messages=[{"role": "user", "content": "Extract all specifications from the document chunks above."}],
            extra_headers={"anthropic-beta": "prompt-caching-2024-07-31"}
        )

        spec_time = time.time() - start_time

        # Track tokens
        total_cache_write += spec_response.usage.cache_creation_input_tokens
        total_input += spec_response.usage.input_tokens
        total_output += spec_response.usage.output_tokens

        # Validate and parse response
        spec_content = spec_response.content[0].text
        is_valid, result = validate_json_response(spec_content, "specifications")
        if not is_valid:
            raise Exception(f"Specs validation failed: {result}")
        specs_json = result

        # Upload to storage
        success, path = upload_to_supabase_storage(doc_id, "spec_suggestions_an.json", specs_json)
        if not success:
            raise Exception(f"Failed to upload specs: {path}")

        specs_count = len(specs_json.get('specifications', []))
        print(f"   ✓ Extracted {specs_count} specs")
        print(f"   ✓ Time: {spec_time:.1f}s")
        print(f"   ✓ Cache created: {spec_response.usage.cache_creation_input_tokens:,} tokens")
        print(f"   ✓ Saved to: {path}")

        # Step 4: Extraction 2 - Golden Rules (CACHE READ)
        print("\n2️⃣  Extracting golden rules (cache read)...")
        start_time = time.time()

        golden_response = client.messages.create(
            model=ANTHROPIC_MODEL,
            max_tokens=8000,
            system=cached_system + [{"type": "text", "text": GOLDEN_PROMPT}],
            messages=[{"role": "user", "content": "Extract all golden rules from the document chunks above."}],
            extra_headers={"anthropic-beta": "prompt-caching-2024-07-31"}
        )

        golden_time = time.time() - start_time

        # Track tokens
        total_cache_read += golden_response.usage.cache_read_input_tokens
        total_input += golden_response.usage.input_tokens
        total_output += golden_response.usage.output_tokens

        # Validate and parse
        golden_content = golden_response.content[0].text
        is_valid, result = validate_json_response(golden_content, "golden_rules")
        if not is_valid:
            raise Exception(f"Golden rules validation failed: {result}")
        golden_json = result

        success, path = upload_to_supabase_storage(doc_id, "golden_rules_an.json", golden_json)
        if not success:
            raise Exception(f"Failed to upload golden rules: {path}")

        golden_count = len(golden_json.get('golden_rules', []))
        print(f"   ✓ Extracted {golden_count} rules")
        print(f"   ✓ Time: {golden_time:.1f}s")
        print(f"   ✓ Cache read: {golden_response.usage.cache_read_input_tokens:,} tokens")
        print(f"   ✓ Saved to: {path}")

        # Step 5: Extraction 3 - Intent Router (CACHE READ)
        print("\n3️⃣  Extracting intent router (cache read)...")
        start_time = time.time()

        intent_response = client.messages.create(
            model=ANTHROPIC_MODEL,
            max_tokens=8000,
            system=cached_system + [{"type": "text", "text": INTENT_PROMPT}],
            messages=[{"role": "user", "content": "Extract all Q&A pairs from the document chunks above."}],
            extra_headers={"anthropic-beta": "prompt-caching-2024-07-31"}
        )

        intent_time = time.time() - start_time

        # Track tokens
        total_cache_read += intent_response.usage.cache_read_input_tokens
        total_input += intent_response.usage.input_tokens
        total_output += intent_response.usage.output_tokens

        # Validate and parse
        intent_content = intent_response.content[0].text
        is_valid, result = validate_json_response(intent_content, "intent_routes")
        if not is_valid:
            raise Exception(f"Intent router validation failed: {result}")
        intent_json = result

        success, path = upload_to_supabase_storage(doc_id, "intent_router_an.json", intent_json)
        if not success:
            raise Exception(f"Failed to upload intent router: {path}")

        intent_count = len(intent_json.get('intent_routes', []))
        print(f"   ✓ Extracted {intent_count} Q&A pairs")
        print(f"   ✓ Time: {intent_time:.1f}s")
        print(f"   ✓ Cache read: {intent_response.usage.cache_read_input_tokens:,} tokens")
        print(f"   ✓ Saved to: {path}")

        # Step 6: Extraction 4 - Procedures (CACHE READ)
        print("\n4️⃣  Extracting procedures (cache read)...")
        start_time = time.time()

        proc_response = client.messages.create(
            model=ANTHROPIC_MODEL,
            max_tokens=8000,
            system=cached_system + [{"type": "text", "text": PROCEDURES_PROMPT}],
            messages=[{"role": "user", "content": "Extract all procedures from the document chunks above."}],
            extra_headers={"anthropic-beta": "prompt-caching-2024-07-31"}
        )

        proc_time = time.time() - start_time

        # Track tokens
        total_cache_read += proc_response.usage.cache_read_input_tokens
        total_input += proc_response.usage.input_tokens
        total_output += proc_response.usage.output_tokens

        # Validate and parse
        proc_content = proc_response.content[0].text
        is_valid, result = validate_json_response(proc_content, "procedures")
        if not is_valid:
            raise Exception(f"Procedures validation failed: {result}")
        proc_json = result

        success, path = upload_to_supabase_storage(doc_id, "playbook_hints_an.json", proc_json)
        if not success:
            raise Exception(f"Failed to upload procedures: {path}")

        procedures_count = len(proc_json.get('procedures', []))
        print(f"   ✓ Extracted {procedures_count} procedures")
        print(f"   ✓ Time: {proc_time:.1f}s")
        print(f"   ✓ Cache read: {proc_response.usage.cache_read_input_tokens:,} tokens")
        print(f"   ✓ Saved to: {path}")

        # Calculate cost (Claude Sonnet 4 pricing with caching)
        # Input: $3 per 1M tokens, Cache write: $3.75 per 1M, Cache read: $0.30 per 1M, Output: $15 per 1M
        cost_input = (total_input / 1_000_000) * 3.00
        cost_cache_write = (total_cache_write / 1_000_000) * 3.75
        cost_cache_read = (total_cache_read / 1_000_000) * 0.30
        cost_output = (total_output / 1_000_000) * 15.00
        total_cost = cost_input + cost_cache_write + cost_cache_read + cost_output

        # Summary
        total_time = spec_time + golden_time + intent_time + proc_time
        print(f"\n💰 Token Usage & Cost:")
        print(f"   Cache write: {total_cache_write:,} tokens (${cost_cache_write:.4f})")
        print(f"   Cache read:  {total_cache_read:,} tokens (${cost_cache_read:.4f})")
        print(f"   Input:       {total_input:,} tokens (${cost_input:.4f})")
        print(f"   Output:      {total_output:,} tokens (${cost_output:.4f})")
        print(f"   Total cost:  ${total_cost:.4f}")
        print(f"\n✅ Document complete! Total time: {total_time:.1f}s")

        return {
            'success': True,
            'completed_at': datetime.now().isoformat(),
            'specs_count': specs_count,
            'golden_count': golden_count,
            'intent_count': intent_count,
            'procedures_count': procedures_count,
            'cache_tokens_written': total_cache_write,
            'cache_tokens_read': total_cache_read,
            'total_input_tokens': total_input,
            'total_output_tokens': total_output,
            'estimated_cost_usd': round(total_cost, 4)
        }

    except Exception as e:
        error_type = type(e).__name__
        error_msg = str(e)
        print(f"\n❌ {error_type}: {error_msg}")
        return {
            'success': False,
            'error': f"{error_type}: {error_msg}"
        }

# ============================================================================
# MAIN SCRIPT
# ============================================================================

def main():
    """Main execution"""

    # Parse command line arguments
    parser = argparse.ArgumentParser(
        description='DIP Extraction with Prompt Caching - Batch Processing Script',
        formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument('--batch-size', type=int, default=5, help='Process N documents at a time (default: 5)')
    parser.add_argument('--dry-run', action='store_true', help='Preview what would be processed without doing it')
    parser.add_argument('--test', action='store_true', help='Process just one document for testing')
    parser.add_argument('--status', action='store_true', help='Show current processing status from CSV')
    parser.add_argument('--force', action='store_true', help='Reprocess documents even if already completed')

    args = parser.parse_args()

    # Override batch size for test mode
    if args.test:
        args.batch_size = 1

    print("🚀 DIP Extraction with Prompt Caching")
    print(f"   Model: {ANTHROPIC_MODEL}")
    print(f"   CSV: {CSV_PATH}")
    if not args.status:
        print(f"   Batch size: {args.batch_size}")
    print()

    # Read CSV
    print("📖 Reading CSV...")
    rows = read_csv()
    rows = ensure_dip_columns(rows)

    # If --status flag, just show status and exit
    if args.status:
        show_status(rows)
        return

    # Filter docs that need processing
    if args.force:
        docs_to_process = rows
    else:
        docs_to_process = [
            row for row in rows
            if row.get('dip_status', '').strip() in ['', 'pending', 'failed']
        ]

    if not docs_to_process:
        print("✅ No documents need processing (all complete)")
        show_status(rows)
        return

    # Sort by chunk count (smallest first) to warm up rate limits gradually
    docs_to_process.sort(key=lambda r: int(r.get('chunks_processed', 0) or 0))

    # Apply batch size limit
    docs_to_process = docs_to_process[:args.batch_size]

    print(f"📋 Found {len(docs_to_process)} documents to process")
    print()

    # Dry run - just show what would be processed
    if args.dry_run:
        print("DRY RUN - Would process these documents:")
        for i, row in enumerate(docs_to_process, 1):
            manufacturer = row.get('manufacturer', 'Unknown')
            model = row.get('model', 'Unknown')
            print(f"  {i}. {manufacturer} {model} ({row.get('filename', 'unknown')})")
        print('\nNo actual processing performed (--dry-run mode)')
        return

    # Create backup
    backup_path = CSV_PATH.replace('.csv', f'_backup_{int(time.time())}.csv')
    with open(CSV_PATH, 'r') as f:
        with open(backup_path, 'w') as b:
            b.write(f.read())
    print(f"📁 Created backup: {Path(backup_path).name}\n")

    # Process each document
    processed_count = 0
    failed_count = 0

    for i, row in enumerate(docs_to_process, 1):
        doc_id = row['doc_id']
        manufacturer = row.get('manufacturer', 'Unknown')
        model = row.get('model', 'Unknown')

        # Mark as processing
        row['dip_status'] = 'processing'
        row['dip_started_at'] = datetime.now().isoformat()
        write_csv(rows)

        # Process document
        result = process_document_with_caching(doc_id, manufacturer, model, i, len(docs_to_process))

        # Update CSV row
        if result['success']:
            row['dip_status'] = 'completed'
            row['dip_completed_at'] = result['completed_at']
            row['specs_count'] = result['specs_count']
            row['golden_count'] = result['golden_count']
            row['intent_count'] = result['intent_count']
            row['procedures_count'] = result['procedures_count']
            row['cache_tokens_written'] = result['cache_tokens_written']
            row['cache_tokens_read'] = result['cache_tokens_read']
            row['total_input_tokens'] = result['total_input_tokens']
            row['total_output_tokens'] = result['total_output_tokens']
            row['estimated_cost_usd'] = result['estimated_cost_usd']
            row['dip_error_message'] = ''
            processed_count += 1
        else:
            row['dip_status'] = 'failed'
            row['dip_completed_at'] = datetime.now().isoformat()
            row['dip_error_message'] = result['error'][:500]  # Truncate long errors
            failed_count += 1

        # Save CSV after each document
        write_csv(rows)
        print(f"💾 CSV updated")

        # Small delay between documents
        if i < len(docs_to_process):
            print(f"⏸️  Waiting 2 seconds before next document...")
            time.sleep(2)

    # Final summary
    print(f"\n{'='*80}")
    print("🎉 BATCH COMPLETE")
    print(f"{'='*80}")
    print(f"✅ Processed: {processed_count}")
    print(f"❌ Failed: {failed_count}")
    print(f"📄 CSV updated: {CSV_PATH}")

    # Show final status
    show_status(rows)

    # Suggest next steps
    remaining = len([r for r in rows if not r.get('dip_status') or r.get('dip_status') == 'pending'])
    if remaining > 0:
        print(f"\n💡 Run again to process remaining {remaining} documents")
    elif processed_count > 0:
        print('\n🎉 All documents processed!')
        print('Next steps:')
        print('  1. Review extraction results in Supabase storage')
        print('  2. Verify JSON files uploaded correctly')
        print('  3. Check cost totals in CSV')
    print()

if __name__ == "__main__":
    main()
