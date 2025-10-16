#!/usr/bin/env python3
"""
DIP Extraction with Prompt Caching - Single Document Processing

Processes a single document using Anthropic's prompt caching feature.
Replaces 4 separate scripts with 1 cached call for 67% cost savings.

Usage:
    DOC_ID=abc123... venv/bin/python3 scripts/dip_extraction_cached.py

Environment Variables:
    DOC_ID                  - Document ID to process (required)
    SUPABASE_URL           - Supabase project URL
    SUPABASE_SERVICE_KEY   - Supabase service role key
    ANTHROPIC_API_KEY      - Anthropic API key
    ANTHROPIC_MODEL        - Model to use (default: claude-sonnet-4-20250514)
"""

import os
import sys
import json
import time
import requests
from dotenv import load_dotenv
from anthropic import Anthropic

# Load environment variables
load_dotenv()

# Configuration
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
# PROMPTS (Same as existing scripts)
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
    """Upload JSON file to Supabase storage (upsert if exists)"""
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
        # Try POST first (create new)
        response = requests.post(
            storage_url,
            headers=headers,
            data=json_content.encode('utf-8'),
            timeout=30
        )

        # If file exists (400 with "Duplicate" error), use PUT to update
        if response.status_code == 400 and 'Duplicate' in response.text:
            response = requests.put(
                storage_url,
                headers=headers,
                data=json_content.encode('utf-8'),
                timeout=30
            )
        # Also check for 409 status code
        elif response.status_code == 409:
            response = requests.put(
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

# ============================================================================
# MAIN DIP EXTRACTION FUNCTION
# ============================================================================

def process_document_with_caching(doc_id):
    """Process one document with prompt caching"""

    print(f"\n{'='*80}")
    print(f"DIP Extraction with Prompt Caching")
    print(f"Doc ID: {doc_id[:16]}...")
    print(f"{'='*80}")

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
        print(f"   ✓ Extracted {specs_count} specs in {spec_time:.1f}s")
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
        print(f"   ✓ Extracted {golden_count} rules in {golden_time:.1f}s")
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
        print(f"   ✓ Extracted {intent_count} Q&A pairs in {intent_time:.1f}s")
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
        print(f"   ✓ Extracted {procedures_count} procedures in {proc_time:.1f}s")
        print(f"   ✓ Saved to: {path}")

        # Collect token usage from all responses
        cache_tokens_written = getattr(spec_response.usage, 'cache_creation_input_tokens', 0)
        cache_tokens_read = (
            getattr(golden_response.usage, 'cache_read_input_tokens', 0) +
            getattr(intent_response.usage, 'cache_read_input_tokens', 0) +
            getattr(proc_response.usage, 'cache_read_input_tokens', 0)
        )
        total_input_tokens = (
            spec_response.usage.input_tokens +
            golden_response.usage.input_tokens +
            intent_response.usage.input_tokens +
            proc_response.usage.input_tokens
        )
        total_output_tokens = (
            spec_response.usage.output_tokens +
            golden_response.usage.output_tokens +
            intent_response.usage.output_tokens +
            proc_response.usage.output_tokens
        )

        # Calculate cost (Sonnet 4.5 pricing)
        input_cost = (total_input_tokens / 1_000_000) * 3.0  # $3 per 1M tokens
        output_cost = (total_output_tokens / 1_000_000) * 15.0  # $15 per 1M tokens
        cache_write_cost = (cache_tokens_written / 1_000_000) * 3.75  # $3.75 per 1M tokens
        cache_read_cost = (cache_tokens_read / 1_000_000) * 0.30  # $0.30 per 1M tokens
        total_cost = input_cost + output_cost + cache_write_cost + cache_read_cost

        # Summary
        total_time = spec_time + golden_time + intent_time + proc_time
        print(f"\n✅ Document extraction complete!")
        print(f"   Total time: {total_time:.1f}s")
        print(f"   Specs: {specs_count} | Golden: {golden_count} | Q&A: {intent_count} | Procedures: {procedures_count}")
        print(f"   Cost: ${total_cost:.2f}")

        # Output JSON stats for Node.js to parse
        try:
            stats_json = json.dumps({
                "specs_count": specs_count,
                "golden_count": golden_count,
                "intent_count": intent_count,
                "procedures_count": procedures_count,
                "cache_tokens_written": cache_tokens_written,
                "cache_tokens_read": cache_tokens_read,
                "total_input_tokens": total_input_tokens,
                "total_output_tokens": total_output_tokens,
                "estimated_cost_usd": round(total_cost, 2)
            })
            print(f"\n__DIP_STATS__{stats_json}__END_STATS__")
        except Exception as json_error:
            print(f"\n⚠️  Warning: Failed to generate stats JSON: {json_error}", file=sys.stderr)

        # Exit successfully
        sys.exit(0)

    except Exception as e:
        error_type = type(e).__name__
        error_msg = str(e)
        print(f"\n❌ {error_type}: {error_msg}", file=sys.stderr)
        sys.exit(1)

# ============================================================================
# MAIN EXECUTION
# ============================================================================

if __name__ == "__main__":
    # Get DOC_ID from environment
    doc_id = os.getenv('DOC_ID')

    if not doc_id:
        print("❌ DOC_ID environment variable is required", file=sys.stderr)
        print("Usage: DOC_ID=abc123... python scripts/dip_extraction_cached.py", file=sys.stderr)
        sys.exit(1)

    print(f"🚀 Starting DIP extraction with prompt caching")
    print(f"   Model: {ANTHROPIC_MODEL}")
    print(f"   Doc ID: {doc_id[:16]}...")

    # Process the document
    process_document_with_caching(doc_id)
