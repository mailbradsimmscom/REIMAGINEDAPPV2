#!/usr/bin/env python3
"""
DIP Extraction with Prompt Caching - EXTRALARGE Document Processing WITH CHECKPOINTS

FOR DOCUMENTS >180K TOKENS ONLY (167+ chunks)
Uses sliding window approach to process documents that exceed 200K context limit.

STRATEGY:
- Splits document into overlapping windows (140K tokens each, 20 chunk overlap)
- Processes each window separately (cache write + 5 reads per window)
- Merges results from all windows (keeps duplicates)
- 2-3x cost vs regular script, but handles any document size

CHECKPOINT SYSTEM:
- Saves windows to .temp/ after creation for verification
- Saves each extraction result to temp files
- Can stop/resume at multiple points
- Detailed logging with timestamps

TRIGGER: MANUAL ONLY
Only use this script when regular batch-dip-extraction.py fails with "prompt too long" error.

Usage:
    python scripts/bulk/batch-dip-extraction_extralarge.py [options]

Options:
    --batch-size N            Process N documents at a time (default: 5)
    --dry-run                 Preview what would be processed without doing it
    --test                    Process just one document for testing
    --status                  Show current processing status from CSV
    --force                   Reprocess documents even if already completed
    --checkpoint-windows      Stop after creating windows (for verification)
    --checkpoint-after-each   Stop after each extraction window (manual continue)
    --resume-from-checkpoint  Resume from saved checkpoint files
    --verbose                 Extra detailed logging
    --help                    Show this help message

Examples:
    # Test window creation only
    python scripts/bulk/batch-dip-extraction_extralarge.py --test --checkpoint-windows

    # Full processing with checkpoints
    python scripts/bulk/batch-dip-extraction_extralarge.py --test --checkpoint-after-each

    # Resume from checkpoint
    python scripts/bulk/batch-dip-extraction_extralarge.py --resume-from-checkpoint
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
TEMP_DIR = Path(".temp/extralarge_dip")
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

PROCEDURES_INSTALL_PROMPT = """CRITICAL: You MUST respond with ONLY pure JSON. No explanations, no text before or after JSON.
FORMAT REQUIREMENT: Output must start with { and end with }. Nothing else.
If you add ANY text outside the JSON brackets, the system will fail.

TASK: Extract INSTALLATION and SETUP procedures ONLY from technical manuals.
OUTPUT FORMAT (copy exactly):
{"procedures":[{"title":"string","preconditions":["string"],"steps":["string"],"expected_outcome":"string","models":["string"],"error_codes":["string"]}]}

FOCUS ON:
- Unpacking and initial setup
- Physical installation and mounting
- Electrical connections and wiring
- Plumbing/fluid connections
- Initial configuration and commissioning
- Safety checks during installation

RULES:
- Extract ONLY installation and setup procedures
- Maximum 15 procedures total
- Merge similar installation steps (cap at 2-3 procedures total if possible)
- Each procedure must have clear title, steps, and expected outcome
- Include safety warnings and preconditions
- Start response with { character
- End response with } character
- No explanatory text before JSON
- No explanatory text after JSON
- No markdown code blocks"""

PROCEDURES_OPERATION_PROMPT = """CRITICAL: You MUST respond with ONLY pure JSON. No explanations, no text before or after JSON.
FORMAT REQUIREMENT: Output must start with { and end with }. Nothing else.
If you add ANY text outside the JSON brackets, the system will fail.

TASK: Extract OPERATION, MAINTENANCE, and TROUBLESHOOTING procedures from technical manuals.
OUTPUT FORMAT (copy exactly):
{"procedures":[{"title":"string","preconditions":["string"],"steps":["string"],"expected_outcome":"string","models":["string"],"error_codes":["string"]}]}

FOCUS ON:
- Normal operation procedures
- Maintenance and cleaning routines
- Troubleshooting and diagnostics
- Error codes and their resolution
- Safety procedures during operation
- Shutdown and standby procedures

RULES:
- Extract ALL operation, maintenance, and troubleshooting procedures
- Maximum 20 procedures total
- Each procedure must be its own entry (do not merge)
- Include all error codes with resolution steps
- Each procedure must have clear title, steps, and expected outcome
- Start response with { character
- End response with } character
- No explanatory text before JSON
- No explanatory text after JSON
- No markdown code blocks"""

# ============================================================================
# WINDOWING CONFIGURATION
# ============================================================================

WINDOW_SIZE_TOKENS = 140000  # 140K tokens per window (30% buffer from 200K limit)
OVERLAP_CHUNKS = 20  # 20 chunks overlap between windows

# ============================================================================
# CHECKPOINT MANAGEMENT
# ============================================================================

def ensure_temp_dir():
    """Create temp directory if it doesn't exist"""
    TEMP_DIR.mkdir(parents=True, exist_ok=True)
    return TEMP_DIR

def log_with_timestamp(message, verbose=False):
    """Print message with timestamp"""
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    if verbose:
        print(f"[{timestamp}] {message}")
    else:
        print(message)

def save_windows_checkpoint(doc_id, windows, chunks_data, total_tokens):
    """Save windows to checkpoint file for verification"""
    ensure_temp_dir()
    checkpoint_path = TEMP_DIR / f"{doc_id[:16]}_windows.json"

    # Don't save full window_text (too large), just metadata
    windows_metadata = []
    for w in windows:
        windows_metadata.append({
            'window_number': w['window_number'],
            'start_chunk': w['start_chunk'],
            'end_chunk': w['end_chunk'],
            'token_count': w['token_count'],
            'chunk_count': w['chunk_count']
        })

    checkpoint_data = {
        'doc_id': doc_id,
        'total_chunks': len(chunks_data),
        'total_tokens': total_tokens,
        'num_windows': len(windows),
        'windows': windows_metadata,
        'created_at': datetime.now().isoformat(),
        'window_size_tokens': WINDOW_SIZE_TOKENS,
        'overlap_chunks': OVERLAP_CHUNKS
    }

    with open(checkpoint_path, 'w') as f:
        json.dump(checkpoint_data, f, indent=2)

    return checkpoint_path

def load_windows_checkpoint(doc_id):
    """Load windows checkpoint if it exists"""
    checkpoint_path = TEMP_DIR / f"{doc_id[:16]}_windows.json"
    if checkpoint_path.exists():
        with open(checkpoint_path, 'r') as f:
            return json.load(f)
    return None

def save_extraction_checkpoint(doc_id, window_num, extraction_type, result, token_usage):
    """Save extraction result to checkpoint file"""
    ensure_temp_dir()
    checkpoint_path = TEMP_DIR / f"{doc_id[:16]}_w{window_num}_{extraction_type}.json"

    checkpoint_data = {
        'doc_id': doc_id,
        'window_number': window_num,
        'extraction_type': extraction_type,
        'result': result,
        'token_usage': token_usage,
        'created_at': datetime.now().isoformat()
    }

    with open(checkpoint_path, 'w') as f:
        json.dump(checkpoint_data, f, indent=2)

    file_size = checkpoint_path.stat().st_size
    return checkpoint_path, file_size

def load_extraction_checkpoint(doc_id, window_num, extraction_type):
    """Load extraction checkpoint if it exists"""
    checkpoint_path = TEMP_DIR / f"{doc_id[:16]}_w{window_num}_{extraction_type}.json"
    if checkpoint_path.exists():
        with open(checkpoint_path, 'r') as f:
            return json.load(f)
    return None

def cleanup_checkpoints(doc_id):
    """Remove checkpoint files for a document"""
    if not TEMP_DIR.exists():
        return

    pattern = f"{doc_id[:16]}_*"
    for checkpoint_file in TEMP_DIR.glob(pattern):
        checkpoint_file.unlink()

# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

def count_tokens(text):
    """Count tokens in text using fast character-based estimate (4 chars per token)"""
    # Note: Using fast estimate instead of tiktoken for performance
    # tiktoken is extremely slow for large documents (15+ minutes for 210K tokens)
    # Character-based estimate is accurate enough for windowing strategy
    return len(text) // 4

def create_windows(chunks_data, verbose=False):
    """
    Split chunks into overlapping windows for processing.

    Returns list of windows, each containing:
    - window_chunks: List of chunk data
    - window_text: Combined text for this window
    - window_number: 1-indexed window number
    - start_chunk: Starting chunk index (0-indexed)
    - end_chunk: Ending chunk index (0-indexed, inclusive)
    """
    if verbose:
        log_with_timestamp(f"Starting window creation with {len(chunks_data)} chunks", True)

    windows = []
    current_idx = 0
    window_num = 1

    while current_idx < len(chunks_data):
        window_chunks = []
        window_token_count = 0

        if verbose:
            log_with_timestamp(f"  Building window {window_num}, starting at chunk index {current_idx}", True)

        # Add chunks until we hit token limit
        for i in range(current_idx, len(chunks_data)):
            chunk = chunks_data[i]
            chunk_text = chunk.get('text', '')
            chunk_tokens = count_tokens(chunk_text)

            # Check if adding this chunk would exceed limit
            if window_token_count + chunk_tokens > WINDOW_SIZE_TOKENS and len(window_chunks) > 0:
                if verbose:
                    log_with_timestamp(f"    Hit token limit at chunk {i} ({window_token_count + chunk_tokens:,} tokens would exceed {WINDOW_SIZE_TOKENS:,})", True)
                break

            window_chunks.append(chunk)
            window_token_count += chunk_tokens

        if not window_chunks:
            # Safety: if single chunk exceeds limit, include it anyway
            if verbose:
                log_with_timestamp(f"    Single chunk exceeds limit, including anyway", True)
            window_chunks = [chunks_data[current_idx]]
            current_idx += 1
        else:
            # Move to next window with overlap
            next_idx = current_idx + len(window_chunks) - OVERLAP_CHUNKS

            if verbose:
                log_with_timestamp(f"    Window has {len(window_chunks)} chunks ({window_token_count:,} tokens)", True)

            # Check if we've reached the end or haven't moved forward
            if next_idx >= len(chunks_data):
                # This was the last window
                if verbose:
                    log_with_timestamp(f"    Reached end of document (next would be {next_idx} >= {len(chunks_data)})", True)
                current_idx = len(chunks_data)  # Force loop exit
            elif next_idx <= current_idx:
                # No forward progress - last window is smaller than overlap
                if verbose:
                    log_with_timestamp(f"    Last window complete (no forward progress: {next_idx} <= {current_idx})", True)
                current_idx = len(chunks_data)  # Force loop exit
            else:
                # Normal case - move forward
                if verbose:
                    log_with_timestamp(f"    Next window will start at chunk index {next_idx} (overlap: {OVERLAP_CHUNKS} chunks)", True)
                current_idx = next_idx

        # Create window
        start_chunk = window_chunks[0].get('chunk_index', 0)
        end_chunk = window_chunks[-1].get('chunk_index', len(window_chunks)-1)
        window_text = combine_chunks(window_chunks)

        windows.append({
            'window_number': window_num,
            'window_chunks': window_chunks,
            'window_text': window_text,
            'start_chunk': start_chunk,
            'end_chunk': end_chunk,
            'token_count': window_token_count,
            'chunk_count': len(window_chunks)
        })

        window_num += 1

    if verbose:
        log_with_timestamp(f"Completed window creation: {len(windows)} windows total", True)

    return windows

def merge_specifications(spec_lists):
    """Merge specifications from multiple windows (keep all, including duplicates)"""
    merged = []
    for specs in spec_lists:
        merged.extend(specs.get('specifications', []))
    return {"specifications": merged}

def merge_golden_rules(golden_lists):
    """Merge golden rules from multiple windows (keep all, including duplicates)"""
    merged = []
    for golden in golden_lists:
        merged.extend(golden.get('golden_rules', []))
    return {"golden_rules": merged}

def merge_intent_routes(intent_lists):
    """Merge intent routes from multiple windows (keep all, including duplicates)"""
    merged = []
    for intent in intent_lists:
        merged.extend(intent.get('intent_routes', []))
    return {"intent_routes": merged}

def merge_procedures(procedure_lists):
    """Merge procedures from multiple windows (keep all, including duplicates)"""
    merged = []
    for procedures in procedure_lists:
        merged.extend(procedures.get('procedures', []))
    return {"procedures": merged}

def fetch_chunks_from_supabase(doc_id, verbose=False):
    """Fetch document chunks from Supabase database"""
    if verbose:
        log_with_timestamp(f"Fetching chunks for doc_id {doc_id[:16]}...", True)

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

        if verbose:
            log_with_timestamp(f"Fetched {len(chunks_data)} chunks successfully", True)

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

def upload_to_supabase_storage(doc_id, filename, json_data, verbose=False):
    """Upload JSON file to Supabase storage"""
    if verbose:
        log_with_timestamp(f"Uploading {filename} to Supabase storage...", True)

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
            if verbose:
                log_with_timestamp(f"Upload successful: {len(json_content)} bytes", True)
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
# MAIN DIP EXTRACTION FUNCTION WITH CHECKPOINTS
# ============================================================================

def process_document_with_caching(doc_id, manufacturer, model, doc_index, total_docs,
                                  checkpoint_windows=False, checkpoint_after_each=False,
                                  resume_from_checkpoint=False, verbose=False):
    """Process one document with sliding window approach and checkpoint support"""

    print(f"\n{'='*80}")
    print(f"[{doc_index}/{total_docs}] {manufacturer} {model}")
    print(f"Doc ID: {doc_id[:16]}... (EXTRALARGE PROCESSING)")
    if checkpoint_windows:
        print(f"Mode: CHECKPOINT WINDOWS ONLY")
    elif checkpoint_after_each:
        print(f"Mode: CHECKPOINT AFTER EACH EXTRACTION")
    elif resume_from_checkpoint:
        print(f"Mode: RESUME FROM CHECKPOINT")
    print(f"{'='*80}")

    # Track global token usage
    total_cache_write = 0
    total_cache_read = 0
    total_input = 0
    total_output = 0

    try:
        # Step 1: Fetch chunks (critical - fail if this fails)
        log_with_timestamp("📥 Fetching chunks from Supabase...", verbose)
        chunks_data = fetch_chunks_from_supabase(doc_id, verbose)

        if not chunks_data:
            raise Exception("No chunks found in database")

        print(f"   ✓ Found {len(chunks_data)} chunks")
        if verbose:
            unique_indices = len(set(c.get('chunk_index') for c in chunks_data))
            log_with_timestamp(f"     Unique chunk indices: {unique_indices}", True)

        # Step 2: Calculate total tokens
        log_with_timestamp("🔢 Calculating total tokens...", verbose)
        total_text = combine_chunks(chunks_data)
        total_tokens = count_tokens(total_text)
        print(f"   ✓ Total tokens: {total_tokens:,}")
        print(f"   ✓ Total text length: {len(total_text):,} characters")

        # Step 3: Check if document actually needs windowing
        if total_tokens < 180000:
            print(f"\n⚠️  Warning: Document has only {total_tokens:,} tokens")
            print(f"   This is under the 180K threshold for extralarge processing.")
            print(f"   Consider using regular batch-dip-extraction.py instead.")
            print(f"   Continuing with windowed processing anyway...\n")

        # Step 4: Create windows
        log_with_timestamp("🪟 Creating windows...", verbose)
        windows = create_windows(chunks_data, verbose)
        num_windows = len(windows)
        print(f"   ✓ Created {num_windows} windows")
        for w in windows:
            overlap_text = ""
            if w['window_number'] > 1:
                overlap_text = f" (overlap: {OVERLAP_CHUNKS} chunks)"
            print(f"      Window {w['window_number']}: Chunks {w['start_chunk']}-{w['end_chunk']} ({w['chunk_count']} chunks, {w['token_count']:,} tokens){overlap_text}")

        # Save windows checkpoint
        log_with_timestamp("💾 Saving windows checkpoint...", verbose)
        checkpoint_path = save_windows_checkpoint(doc_id, windows, chunks_data, total_tokens)
        checkpoint_size = checkpoint_path.stat().st_size
        print(f"   ✓ Saved windows checkpoint: {checkpoint_path.name} ({checkpoint_size:,} bytes)")

        # If checkpoint_windows mode, stop here
        if checkpoint_windows:
            print(f"\n{'='*80}")
            print(f"✅ CHECKPOINT: Windows Created Successfully")
            print(f"{'='*80}")
            print(f"\nWindows have been saved to: {checkpoint_path}")
            print(f"Total windows: {num_windows}")
            print(f"Total tokens: {total_tokens:,}")
            print(f"\nTo continue processing, run without --checkpoint-windows flag")
            print()
            return {
                'success': True,
                'checkpoint_only': True,
                'num_windows': num_windows,
                'total_tokens': total_tokens
            }

        # Step 5: Process each window
        all_specs = []
        all_golden = []
        all_intent = []
        all_install_procs = []
        all_operation_procs = []

        for window in windows:
            window_num = window['window_number']
            window_text = window['window_text']

            print(f"\n{'─'*80}")
            print(f"WINDOW {window_num}/{num_windows}")
            print(f"{'─'*80}")

            # Prepare cached system for this window
            cached_system = [
                {
                    "type": "text",
                    "text": window_text,
                    "cache_control": {"type": "ephemeral"}
                }
            ]

            # Extraction 1: Specifications (CACHE WRITE)
            print(f"\n[W{window_num}] 1️⃣  Extracting specifications (cache write)...")
            try:
                start_time = time.time()
                if verbose:
                    log_with_timestamp(f"     Sending request to Anthropic API...", True)

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

                # Validate and parse
                spec_content = spec_response.content[0].text
                if verbose:
                    log_with_timestamp(f"     Response length: {len(spec_content)} characters", True)

                is_valid, result = validate_json_response(spec_content, "specifications")
                if not is_valid:
                    raise Exception(f"Validation failed: {result}")

                specs_json = result
                all_specs.append(specs_json)
                specs_count = len(specs_json.get('specifications', []))
                print(f"   ✓ Extracted {specs_count} specs in {spec_time:.1f}s")
                print(f"   ✓ Cache created: {spec_response.usage.cache_creation_input_tokens:,} tokens")

                # Save checkpoint
                token_usage = {
                    'cache_write': spec_response.usage.cache_creation_input_tokens,
                    'cache_read': 0,
                    'input': spec_response.usage.input_tokens,
                    'output': spec_response.usage.output_tokens
                }
                checkpoint_path, file_size = save_extraction_checkpoint(doc_id, window_num, 'specs', specs_json, token_usage)
                if verbose:
                    log_with_timestamp(f"     Saved checkpoint: {checkpoint_path.name} ({file_size:,} bytes)", True)

            except Exception as e:
                print(f"   ❌ Specs extraction failed: {str(e)}")
                all_specs.append({"specifications": []})

            if checkpoint_after_each:
                input(f"\n⏸️  Press Enter to continue to next extraction...")

            # Extraction 2: Golden Rules (CACHE READ)
            print(f"\n[W{window_num}] 2️⃣  Extracting golden rules (cache read)...")
            try:
                start_time = time.time()
                if verbose:
                    log_with_timestamp(f"     Sending request to Anthropic API...", True)

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
                if verbose:
                    log_with_timestamp(f"     Response length: {len(golden_content)} characters", True)

                is_valid, result = validate_json_response(golden_content, "golden_rules")
                if not is_valid:
                    raise Exception(f"Validation failed: {result}")

                golden_json = result
                all_golden.append(golden_json)
                golden_count = len(golden_json.get('golden_rules', []))
                print(f"   ✓ Extracted {golden_count} rules in {golden_time:.1f}s")
                print(f"   ✓ Cache read: {golden_response.usage.cache_read_input_tokens:,} tokens")

                # Save checkpoint
                token_usage = {
                    'cache_write': 0,
                    'cache_read': golden_response.usage.cache_read_input_tokens,
                    'input': golden_response.usage.input_tokens,
                    'output': golden_response.usage.output_tokens
                }
                checkpoint_path, file_size = save_extraction_checkpoint(doc_id, window_num, 'golden', golden_json, token_usage)
                if verbose:
                    log_with_timestamp(f"     Saved checkpoint: {checkpoint_path.name} ({file_size:,} bytes)", True)

            except Exception as e:
                print(f"   ❌ Golden rules extraction failed: {str(e)}")
                all_golden.append({"golden_rules": []})

            if checkpoint_after_each:
                input(f"\n⏸️  Press Enter to continue to next extraction...")

            # Extraction 3: Intent Router (CACHE READ)
            print(f"\n[W{window_num}] 3️⃣  Extracting intent router (cache read)...")
            try:
                start_time = time.time()
                if verbose:
                    log_with_timestamp(f"     Sending request to Anthropic API...", True)

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
                if verbose:
                    log_with_timestamp(f"     Response length: {len(intent_content)} characters", True)

                is_valid, result = validate_json_response(intent_content, "intent_routes")
                if not is_valid:
                    raise Exception(f"Validation failed: {result}")

                intent_json = result
                all_intent.append(intent_json)
                intent_count = len(intent_json.get('intent_routes', []))
                print(f"   ✓ Extracted {intent_count} Q&A pairs in {intent_time:.1f}s")
                print(f"   ✓ Cache read: {intent_response.usage.cache_read_input_tokens:,} tokens")

                # Save checkpoint
                token_usage = {
                    'cache_write': 0,
                    'cache_read': intent_response.usage.cache_read_input_tokens,
                    'input': intent_response.usage.input_tokens,
                    'output': intent_response.usage.output_tokens
                }
                checkpoint_path, file_size = save_extraction_checkpoint(doc_id, window_num, 'intent', intent_json, token_usage)
                if verbose:
                    log_with_timestamp(f"     Saved checkpoint: {checkpoint_path.name} ({file_size:,} bytes)", True)

            except Exception as e:
                print(f"   ❌ Intent router extraction failed: {str(e)}")
                all_intent.append({"intent_routes": []})

            if checkpoint_after_each:
                input(f"\n⏸️  Press Enter to continue to next extraction...")

            # Extraction 4a: Installation Procedures (CACHE READ)
            print(f"\n[W{window_num}] 4️⃣a Extracting installation procedures (cache read)...")
            try:
                start_time = time.time()
                if verbose:
                    log_with_timestamp(f"     Sending request to Anthropic API...", True)

                proc_install_response = client.messages.create(
                    model=ANTHROPIC_MODEL,
                    max_tokens=8000,
                    system=cached_system + [{"type": "text", "text": PROCEDURES_INSTALL_PROMPT}],
                    messages=[{"role": "user", "content": "Extract installation and setup procedures from the document chunks above."}],
                    extra_headers={"anthropic-beta": "prompt-caching-2024-07-31"}
                )
                proc_install_time = time.time() - start_time

                # Track tokens
                total_cache_read += proc_install_response.usage.cache_read_input_tokens
                total_input += proc_install_response.usage.input_tokens
                total_output += proc_install_response.usage.output_tokens

                # Validate and parse
                proc_install_content = proc_install_response.content[0].text
                if verbose:
                    log_with_timestamp(f"     Response length: {len(proc_install_content)} characters", True)

                is_valid, result = validate_json_response(proc_install_content, "procedures")
                if not is_valid:
                    raise Exception(f"Validation failed: {result}")

                proc_install_json = result
                all_install_procs.append(proc_install_json)
                install_count = len(proc_install_json.get('procedures', []))
                print(f"   ✓ Extracted {install_count} installation procedures in {proc_install_time:.1f}s")
                print(f"   ✓ Cache read: {proc_install_response.usage.cache_read_input_tokens:,} tokens")

                # Save checkpoint
                token_usage = {
                    'cache_write': 0,
                    'cache_read': proc_install_response.usage.cache_read_input_tokens,
                    'input': proc_install_response.usage.input_tokens,
                    'output': proc_install_response.usage.output_tokens
                }
                checkpoint_path, file_size = save_extraction_checkpoint(doc_id, window_num, 'proc_install', proc_install_json, token_usage)
                if verbose:
                    log_with_timestamp(f"     Saved checkpoint: {checkpoint_path.name} ({file_size:,} bytes)", True)

            except Exception as e:
                print(f"   ❌ Installation procedures extraction failed: {str(e)}")
                all_install_procs.append({"procedures": []})

            if checkpoint_after_each:
                input(f"\n⏸️  Press Enter to continue to next extraction...")

            # Extraction 4b: Operation/Maintenance Procedures (CACHE READ)
            print(f"\n[W{window_num}] 4️⃣b Extracting operation/maintenance procedures (cache read)...")
            try:
                start_time = time.time()
                if verbose:
                    log_with_timestamp(f"     Sending request to Anthropic API...", True)

                proc_operation_response = client.messages.create(
                    model=ANTHROPIC_MODEL,
                    max_tokens=8000,
                    system=cached_system + [{"type": "text", "text": PROCEDURES_OPERATION_PROMPT}],
                    messages=[{"role": "user", "content": "Extract operation, maintenance, and troubleshooting procedures from the document chunks above."}],
                    extra_headers={"anthropic-beta": "prompt-caching-2024-07-31"}
                )
                proc_operation_time = time.time() - start_time

                # Track tokens
                total_cache_read += proc_operation_response.usage.cache_read_input_tokens
                total_input += proc_operation_response.usage.input_tokens
                total_output += proc_operation_response.usage.output_tokens

                # Validate and parse
                proc_operation_content = proc_operation_response.content[0].text
                if verbose:
                    log_with_timestamp(f"     Response length: {len(proc_operation_content)} characters", True)

                is_valid, result = validate_json_response(proc_operation_content, "procedures")
                if not is_valid:
                    raise Exception(f"Validation failed: {result}")

                proc_operation_json = result
                all_operation_procs.append(proc_operation_json)
                operation_count = len(proc_operation_json.get('procedures', []))
                print(f"   ✓ Extracted {operation_count} operation procedures in {proc_operation_time:.1f}s")
                print(f"   ✓ Cache read: {proc_operation_response.usage.cache_read_input_tokens:,} tokens")

                # Save checkpoint
                token_usage = {
                    'cache_write': 0,
                    'cache_read': proc_operation_response.usage.cache_read_input_tokens,
                    'input': proc_operation_response.usage.input_tokens,
                    'output': proc_operation_response.usage.output_tokens
                }
                checkpoint_path, file_size = save_extraction_checkpoint(doc_id, window_num, 'proc_operation', proc_operation_json, token_usage)
                if verbose:
                    log_with_timestamp(f"     Saved checkpoint: {checkpoint_path.name} ({file_size:,} bytes)", True)

            except Exception as e:
                print(f"   ❌ Operation procedures extraction failed: {str(e)}")
                all_operation_procs.append({"procedures": []})

            if checkpoint_after_each and window_num < num_windows:
                input(f"\n⏸️  Press Enter to continue to next window...")

        # Step 6: Merge results from all windows
        print(f"\n{'='*80}")
        print(f"MERGING RESULTS FROM {num_windows} WINDOWS")
        print(f"{'='*80}")

        log_with_timestamp("🔀 Merging specifications...", verbose)
        merged_specs = merge_specifications(all_specs)

        log_with_timestamp("🔀 Merging golden rules...", verbose)
        merged_golden = merge_golden_rules(all_golden)

        log_with_timestamp("🔀 Merging intent routes...", verbose)
        merged_intent = merge_intent_routes(all_intent)

        # Merge procedures (both install and operation from all windows)
        log_with_timestamp("🔀 Merging procedures...", verbose)
        all_procedures_combined = all_install_procs + all_operation_procs
        merged_procedures = merge_procedures(all_procedures_combined)

        specs_count = len(merged_specs.get('specifications', []))
        golden_count = len(merged_golden.get('golden_rules', []))
        intent_count = len(merged_intent.get('intent_routes', []))
        procedures_count = len(merged_procedures.get('procedures', []))

        print(f"\n📊 Merged Results:")
        print(f"   Specs: {specs_count} total")
        print(f"   Golden Rules: {golden_count} total")
        print(f"   Intent Routes: {intent_count} total")
        print(f"   Procedures: {procedures_count} total")

        # Step 7: Upload merged files
        print(f"\n💾 Uploading merged results to Supabase storage...")

        success, path = upload_to_supabase_storage(doc_id, "spec_suggestions_an.json", merged_specs, verbose)
        if not success:
            raise Exception(f"Failed to upload specs: {path}")
        print(f"   ✓ Saved specs to: {path}")

        success, path = upload_to_supabase_storage(doc_id, "golden_rules_an.json", merged_golden, verbose)
        if not success:
            raise Exception(f"Failed to upload golden rules: {path}")
        print(f"   ✓ Saved golden rules to: {path}")

        success, path = upload_to_supabase_storage(doc_id, "intent_router_an.json", merged_intent, verbose)
        if not success:
            raise Exception(f"Failed to upload intent router: {path}")
        print(f"   ✓ Saved intent router to: {path}")

        success, path = upload_to_supabase_storage(doc_id, "playbook_hints_an.json", merged_procedures, verbose)
        if not success:
            raise Exception(f"Failed to upload procedures: {path}")
        print(f"   ✓ Saved procedures to: {path}")

        # Step 8: Calculate cost
        cost_input = (total_input / 1_000_000) * 3.00
        cost_cache_write = (total_cache_write / 1_000_000) * 3.75
        cost_cache_read = (total_cache_read / 1_000_000) * 0.30
        cost_output = (total_output / 1_000_000) * 15.00
        total_cost = cost_input + cost_cache_write + cost_cache_read + cost_output

        # Summary
        print(f"\n💰 Token Usage & Cost:")
        print(f"   Windows processed: {num_windows}")
        print(f"   Cache writes: {total_cache_write:,} tokens (${cost_cache_write:.4f})")
        print(f"   Cache reads:  {total_cache_read:,} tokens (${cost_cache_read:.4f})")
        print(f"   Input:        {total_input:,} tokens (${cost_input:.4f})")
        print(f"   Output:       {total_output:,} tokens (${cost_output:.4f})")
        print(f"   Total cost:   ${total_cost:.4f}")
        print(f"\n✅ Document complete! {num_windows} windows, {num_windows * 5} API calls")

        # Cleanup checkpoints on success
        if verbose:
            log_with_timestamp("🧹 Cleaning up checkpoint files...", True)
        cleanup_checkpoints(doc_id)

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
        if verbose:
            import traceback
            log_with_timestamp(f"Full traceback:\n{traceback.format_exc()}", True)
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
        description='DIP Extraction with Prompt Caching - Extralarge Processing with Checkpoints',
        formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument('--batch-size', type=int, default=5, help='Process N documents at a time (default: 5)')
    parser.add_argument('--dry-run', action='store_true', help='Preview what would be processed without doing it')
    parser.add_argument('--test', action='store_true', help='Process just one document for testing')
    parser.add_argument('--status', action='store_true', help='Show current processing status from CSV')
    parser.add_argument('--force', action='store_true', help='Reprocess documents even if already completed')
    parser.add_argument('--checkpoint-windows', action='store_true', help='Stop after creating windows (for verification)')
    parser.add_argument('--checkpoint-after-each', action='store_true', help='Stop after each extraction (manual continue)')
    parser.add_argument('--resume-from-checkpoint', action='store_true', help='Resume from saved checkpoint files')
    parser.add_argument('--verbose', action='store_true', help='Extra detailed logging with timestamps')

    args = parser.parse_args()

    # Override batch size for test mode
    if args.test:
        args.batch_size = 1

    print("🚀 DIP Extraction with Prompt Caching (EXTRALARGE)")
    print(f"   Model: {ANTHROPIC_MODEL}")
    print(f"   CSV: {CSV_PATH}")
    print(f"   Temp Dir: {TEMP_DIR}")
    if not args.status:
        print(f"   Batch size: {args.batch_size}")
    if args.checkpoint_windows:
        print(f"   Mode: CHECKPOINT WINDOWS ONLY")
    elif args.checkpoint_after_each:
        print(f"   Mode: CHECKPOINT AFTER EACH EXTRACTION")
    elif args.resume_from_checkpoint:
        print(f"   Mode: RESUME FROM CHECKPOINT")
    if args.verbose:
        print(f"   Logging: VERBOSE")
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
            if row.get('dip_status', '').strip() in ['', 'pending', 'failed', 'processing']
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
            chunks = row.get('chunks_processed', 0)
            print(f"  {i}. {manufacturer} {model} ({chunks} chunks, {row.get('filename', 'unknown')})")
        print('\nNo actual processing performed (--dry-run mode)')
        return

    # Create backup
    backup_path = CSV_PATH.replace('.csv', f'_backup_{int(time.time())}.csv')
    with open(CSV_PATH, 'r') as f:
        with open(backup_path, 'w') as b:
            b.write(f.read())
    print(f"📁 Created backup: {Path(backup_path).name}\n")

    # Ensure temp directory exists
    ensure_temp_dir()

    # Process each document
    processed_count = 0
    failed_count = 0

    for i, row in enumerate(docs_to_process, 1):
        doc_id = row['doc_id']
        manufacturer = row.get('manufacturer', 'Unknown')
        model = row.get('model', 'Unknown')

        # Mark as processing (unless checkpoint-windows only)
        if not args.checkpoint_windows:
            row['dip_status'] = 'processing'
            row['dip_started_at'] = datetime.now().isoformat()
            write_csv(rows)

        # Process document
        result = process_document_with_caching(
            doc_id, manufacturer, model, i, len(docs_to_process),
            checkpoint_windows=args.checkpoint_windows,
            checkpoint_after_each=args.checkpoint_after_each,
            resume_from_checkpoint=args.resume_from_checkpoint,
            verbose=args.verbose
        )

        # Update CSV row
        if result.get('checkpoint_only'):
            # Checkpoint-windows mode, don't update status
            print(f"✅ Windows checkpoint saved")
        elif result['success']:
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
