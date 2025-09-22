#!/usr/bin/env python3
"""
Test script for Anthropic Claude 3.5 parallel text chunk extraction
Tests normalized specification extraction from existing Supabase text chunks with parallel processing
"""

print("DEBUG: Line 1 - Script starting")

import os
import json
import requests
import time

print("DEBUG: Line 20 - Imports completed")

# Global configuration from environment
anthropic_api_delay = float(os.getenv('ANTHROPIC_API_DELAY', '2'))
import concurrent.futures
from concurrent.futures import ThreadPoolExecutor
from dotenv import load_dotenv
from anthropic import Anthropic

print("DEBUG: Line 40 - Additional imports completed")

# Load environment variables
load_dotenv()

print("DEBUG: Line 50 - Environment variables loaded")

def fetch_chunks_from_supabase(doc_id: str) -> list:
    """Fetch document chunks from Supabase database"""
    print(f"🔍 DEBUG: Starting fetch_chunks_from_supabase for doc_id: {doc_id[:8]}")
    
    supabase_url = os.getenv('SUPABASE_URL')
    supabase_key = os.getenv('SUPABASE_SERVICE_KEY') or os.getenv('SUPABASE_SERVICE_ROLE_KEY')
    
    print(f"🌐 DEBUG: Supabase URL exists: {bool(supabase_url)}")
    print(f"🔑 DEBUG: Supabase key exists: {bool(supabase_key)}")
    
    if not supabase_url or not supabase_key:
        raise ValueError("Missing Supabase credentials")
    
    url = supabase_url.rstrip("/")
    headers = {
        "apikey": supabase_key,
        "Authorization": f"Bearer {supabase_key}",
        "Content-Type": "application/json"
    }
    
    print("DEBUG: Line 80 - Headers configured")
    
    # Query chunks from database
    params = {
        "doc_id": f"eq.{doc_id}",
        "content_type": "eq.text",
        "text": "not.is.null",
        "select": "chunk_id,doc_id,text,page_start,page_end,chunk_index,metadata",
        "order": "page_start,chunk_index"
    }
    
    print(f"Fetching chunks for document {doc_id[:8]}...")
    
    print(f"📡 DEBUG: About to make request to: {url}/rest/v1/document_chunks")
    response = requests.get(
        f"{url}/rest/v1/document_chunks",
        headers=headers,
        params=params
    )
    
    print(f"📊 DEBUG: Request completed with status: {response.status_code}")
    
    if response.status_code != 200:
        raise Exception(f"Failed to fetch chunks: {response.status_code} - {response.text}")
    
    chunks_data = response.json()
    print(f"Found {len(chunks_data)} chunks in database")
    
    return chunks_data

def process_text_chunk(client, chunk_data, chunk_num, total_chunks, anthropic_model, anthropic_max_tokens, anthropic_temperature, system_prompt):
    """Process a single text chunk from database with timeout and error handling"""
    print("DEBUG: Line 120 - process_text_chunk function started")
    pages = f"{chunk_data.get('page_start', '?')}-{chunk_data.get('page_end', '?')}"
    text_content = chunk_data.get('text', '')
    
    print(f"Processing chunk {chunk_num}/{total_chunks} (Pages {pages}, {len(text_content)} chars)")
    
    user_prompt = f"Extract all normalized technical specifications from this section of the technical manual:\n\n{text_content}"
    
    try:
        print(f"  Making API call for chunk {chunk_num}...")
        
        response = client.messages.create(
            model=anthropic_model,
            max_tokens=anthropic_max_tokens,
            temperature=anthropic_temperature,
            system=system_prompt,
            messages=[
                {
                    "role": "user",
                    "content": user_prompt
                }
            ],
            timeout=300  # 300 second timeout for complex API calls
        )
        
        print("DEBUG: Line 140 - API call completed")
        
        # Add delay between API calls to avoid rate limits
        time.sleep(anthropic_api_delay)
        
        print(f"  API call successful for chunk {chunk_num}")
        
        if response.content and len(response.content) > 0:
            response_content = response.content[0].text
            
            # Try to parse as JSON
            try:
                parsed_response = json.loads(response_content)
                specifications = parsed_response.get('specifications', [])
                print(f"  Extracted {len(specifications)} specifications from chunk {chunk_num}")
                return parsed_response
            except json.JSONDecodeError as e:
                print(f"  JSON parse error in chunk {chunk_num}: {e}")
                print(f"  Raw response preview: {response_content[:200]}...")
                return {"specifications": [], "error": "JSON parse failed", "raw_response": response_content}
        else:
            print(f"  Empty response for chunk {chunk_num}")
            return {"specifications": [], "error": "Empty response"}
            
    except Exception as e:
        print(f"  API error for chunk {chunk_num}: {type(e).__name__}: {e}")
        return {"specifications": [], "error": str(e)}

def process_chunks_parallel(client, chunks_data, anthropic_model, anthropic_max_tokens, anthropic_temperature, system_prompt, max_workers=3):
    """Process chunks in parallel"""
    print("DEBUG: Line 160 - process_chunks_parallel function started")
    
    def process_single_chunk(chunk_info):
        chunk_data, chunk_num = chunk_info
        return process_text_chunk(
            client, chunk_data, chunk_num, len(chunks_data),
            anthropic_model, anthropic_max_tokens, anthropic_temperature, system_prompt
        )
    
    # Create list of (chunk_data, chunk_number) tuples
    chunk_tasks = [(chunk_data, i+1) for i, chunk_data in enumerate(chunks_data)]
    
    all_specifications = []
    chunk_results = []
    completed_count = 0
    
    print(f"Processing {len(chunks_data)} chunks with {max_workers} parallel workers...")
    
    print("DEBUG: Line 180 - Starting ThreadPoolExecutor")
    
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        # Submit all tasks
        future_to_chunk = {executor.submit(process_single_chunk, chunk_info): chunk_info 
                          for chunk_info in chunk_tasks}
        
        # Collect results as they complete
        for future in concurrent.futures.as_completed(future_to_chunk):
            chunk_data, chunk_num = future_to_chunk[future]
            completed_count += 1
            
            try:
                result = future.result()
                
                chunk_results.append({
                    'chunk_num': chunk_num,
                    'pages': f"{chunk_data.get('page_start', '?')}-{chunk_data.get('page_end', '?')}",
                    'result': result
                })
                
                if 'specifications' in result:
                    all_specifications.extend(result['specifications'])
                    
                print(f"Completed chunk {chunk_num} ({completed_count}/{len(chunks_data)})")
                
            except Exception as e:
                print(f"Chunk {chunk_num} failed: {e}")
                chunk_results.append({
                    'chunk_num': chunk_num,
                    'pages': f"{chunk_data.get('page_start', '?')}-{chunk_data.get('page_end', '?')}",
                    'result': {"specifications": [], "error": str(e)}
                })
    
    print("DEBUG: Line 200 - ThreadPoolExecutor completed")
    return all_specifications, chunk_results

def store_to_supabase_storage(doc_id, specifications):
    """Store specifications to Supabase Storage using REST API"""
    print("DEBUG: Line 220 - store_to_supabase_storage function started")
    try:
        import requests
        from dotenv import load_dotenv
        
        # Load environment variables
        load_dotenv()
        
        print("DEBUG: Line 240 - Environment variables loaded in storage function")
        
        # Prepare data for storage
        data = {
            "specifications": specifications
        }
        
        # Convert to JSON string
        json_content = json.dumps(data, indent=2)
        
        # Supabase configuration
        url = os.getenv('SUPABASE_URL')
        key = os.getenv('PY_SUPABASE_SERVICE_KEY') or os.getenv('SUPABASE_SERVICE_KEY') or os.getenv('SUPABASE_SERVICE_ROLE_KEY')
        
        print("DEBUG: Line 260 - Supabase credentials retrieved")
        
        if not url or not key:
            print("❌ Supabase credentials not found")
            return False
        
        # Storage path
        file_path = f"manuals/{doc_id}/DIP/{doc_id}_spec_suggestions_an.json"
        
        print("DEBUG: Line 280 - About to upload to Supabase Storage via REST API")
        
        # Upload to Supabase Storage using REST API
        headers = {
            'Authorization': f'Bearer {key}',
            'Content-Type': 'text/plain'
        }
        
        storage_url = f"{url}/storage/v1/object/documents/{file_path}"
        
        response = requests.post(storage_url, headers=headers, data=json_content)
        
        print("DEBUG: Line 300 - Upload completed")
        
        # Check for errors in the response
        if response.status_code in [200, 201]:
            print(f"✅ Successfully stored specifications to Supabase Storage: {file_path}")
            return True
        else:
            print(f"❌ Failed to upload to storage: {response.status_code} - {response.text}")
            return False
            
    except Exception as e:
        print(f"❌ Error storing to Supabase Storage: {e}")
        return False

def test_anthropic_spec_extraction():
    """Test Anthropic normalized specification extraction with parallel processing"""
    print("DEBUG: Line 320 - test_anthropic_spec_extraction function started")
    
    # Configuration from environment
    anthropic_api_key = os.getenv('ANTHROPIC_API_KEY')
    anthropic_model = os.getenv('ANTHROPIC_MODEL', 'claude-3-5-sonnet-latest')
    anthropic_max_tokens = int(os.getenv('ANTHROPIC_MAX_TOKENS', '8000'))
    anthropic_temperature = float(os.getenv('ANTHROPIC_TEMPERATURE', '0'))
    
    if not anthropic_api_key:
        raise ValueError("ANTHROPIC_API_KEY not found in environment variables")
    
    print(f"Using Anthropic model: {anthropic_model}")
    print(f"Max tokens: {anthropic_max_tokens}")
    print(f"Temperature: {anthropic_temperature}")
    
    # Initialize Anthropic client
    client = Anthropic(api_key=anthropic_api_key)
    
    print("DEBUG: Line 340 - Anthropic client initialized")
    
    # ADD THIS DEBUG:
    print("DEBUG: Line 342 - About to set doc_id")
    print("DEBUG: Line 343 - Testing basic string assignment")
    test_string = "basic_test"
    print(f"DEBUG: Line 344 - Basic string works: {test_string}")

    print("DEBUG: Line 345 - Testing os module access")
    print("DEBUG: Line 346 - os module already imported at top of file")

    print("DEBUG: Line 347 - Testing simple getenv")
    simple_test = os.getenv('NONEXISTENT_VAR', 'default_value')
    print(f"DEBUG: Line 348 - Simple getenv works: {simple_test}")

    print("DEBUG: Line 349 - Testing DOC_ID getenv without default")
    doc_id_raw = os.getenv('DOC_ID')
    print(f"DEBUG: Line 350 - DOC_ID raw value: {doc_id_raw}")

    print("DEBUG: Line 351 - About to set the long default string")
    default_doc_id = "759ac8ff51c98c10358e2c0604c1ca73cf975023949d6e122f9af6e8cb32f061"
    print(f"DEBUG: Line 352 - Default string set: {default_doc_id[:8]}...")

    print("DEBUG: Line 353 - Final assignment")
    doc_id = doc_id_raw if doc_id_raw else default_doc_id
    print(f"DEBUG: Line 354 - Final doc_id: {doc_id[:8]}")
    
    print("DEBUG: Line 346 - About to start try block")
    try:
        print("DEBUG: Line 348 - Inside try block")
        # Step 1: Fetch chunks from Supabase database  
        print("\n" + "="*80)
        print("STEP 1: FETCHING CHUNKS FROM DATABASE")
        print("="*80)
        print("DEBUG: Line 354 - About to call fetch_chunks_from_supabase")
        
        chunks_data = fetch_chunks_from_supabase(doc_id)
        
        # Step 2: Process chunks in parallel
        print("\n" + "="*80)
        print("STEP 2: PROCESSING TEXT CHUNKS FOR NORMALIZED SPECIFICATIONS")
        print("="*80)
        
        print("DEBUG: Line 380 - About to process chunks in parallel")
        
        # System prompt for normalized specification extraction
        system_prompt = """CRITICAL: You MUST respond with ONLY pure JSON. No explanations, no text before or after JSON.
FORMAT REQUIREMENT: Output must start with { and end with }. Nothing else.
If you add ANY text outside the JSON brackets, the system will fail.

TASK: Extract canonical technical specifications from a manual with normalization for searchability. Extract all measurable parameters, limits, and technical data.

OUTPUT FORMAT (copy exactly):
{"specifications":[{"parameter":"string","normalized_parameter":"string","parameter_aliases":["string"],"value":"string","range":"string","units":"string","normalized_units":"string","converted_value":"string","models":["string"],"category":"string","search_terms":["string"],"concept_group":"string","references":["string"]}]}

FOR EACH SPECIFICATION PROVIDE:
- Parameter: What is being measured (as written in manual)
- Normalized Parameter: Standardized parameter name (lowercase, underscores)
- Parameter Aliases: Alternative names/terms for same concept
- Value: Numeric value or text as stated
- Range: Min/max if applicable (e.g., "10V - 15V")
- Units: Original units from document
- Normalized Units: Standard SI or common units
- Converted Value: Value in normalized units if conversion needed
- Models: Which model(s) this applies to
- Category: Power/Electrical/Dimensions/Performance/Environmental/Installation
- Search Terms: All possible ways users might ask about this
- Concept Group: Related specifications group
- References: Page numbers or section names

INCLUDE:
- Electrical requirements (voltage, amperage, wattage, frequency)
- Physical dimensions (width, depth, height, weight, cutouts)
- Operating ranges (temperature, pressure, humidity, altitude)
- Performance specs (speed, capacity, efficiency, output)
- Installation requirements (clearances, mounting, torque)
- Environmental limits (IP rating, operating conditions)
- Part numbers and model specifications
- Network/communication specs (protocols, ports, addresses)

NORMALIZATION EXAMPLES:
- "Operating Pressure: 2.5 bar" becomes normalized_parameter: "operating_pressure", normalized_units: "psi", converted_value: "36.3"
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
        
        all_specifications, chunk_results = process_chunks_parallel(
            client, chunks_data, anthropic_model, anthropic_max_tokens, 
            anthropic_temperature, system_prompt, max_workers=3
        )
        
        print("DEBUG: Line 295 - Parallel processing returned successfully")
        print(f"DEBUG: Line 296 - Got {len(all_specifications)} total specifications")
        print(f"DEBUG: Line 297 - Got {len(chunk_results)} chunk results")
        
        print("DEBUG: Line 400 - Parallel processing completed")
        
        # Step 3: Combine and analyze results
        print("\n" + "="*80)
        print("STEP 3: ANALYZING COMBINED RESULTS")
        print("="*80)
        
        print(f"Total specifications extracted: {len(all_specifications)}")
        
        print("DEBUG: Line 420 - Starting analysis of results")
        
        # Remove duplicates based on normalized parameter and cap at 30
        print("DEBUG: Line 300 - About to start deduplication")
        unique_specifications = []
        seen_params = set()
        print("DEBUG: Line 303 - Starting deduplication loop")
        for spec in all_specifications:
            norm_param = spec.get('normalized_parameter') or ''
            if isinstance(norm_param, str):
                norm_param = norm_param.strip().lower()
            else:
                norm_param = ''
            
            value = spec.get('value') or ''
            if isinstance(value, str):
                value = value.strip()
            else:
                value = str(value) if value is not None else ''
            
            key = f"{norm_param}:{value}"
            if norm_param and key not in seen_params and len(unique_specifications) < 30:
                unique_specifications.append(spec)
                seen_params.add(key)
        
        print(f"Unique specifications after deduplication (capped at 30): {len(unique_specifications)}")
        
        # Categorize by category
        categories = {}
        for spec in unique_specifications:
            category = spec.get('category', 'Unknown')
            categories[category] = categories.get(category, 0) + 1
        
        print("\n" + "="*80)
        print("EXTRACTED SPECIFICATIONS:")
        print("="*80)
        
        for i, spec in enumerate(unique_specifications, 1):
            parameter = spec.get('parameter', 'No parameter')
            value = spec.get('value', 'No value')
            units = spec.get('units', '')
            range_val = spec.get('range', '')
            category = spec.get('category', 'Unknown')
            aliases = spec.get('parameter_aliases', [])
            
            print(f"{i:2d}. [{category}] {parameter}: {value} {units}")
            if range_val:
                print(f"    Range: {range_val}")
            if aliases:
                print(f"    Aliases: {', '.join(aliases[:3])}{'...' if len(aliases) > 3 else ''}")
        
        print(f"\n📊 EXTRACTION SUMMARY:")
        print(f"   Total specifications found: {len(unique_specifications)}")
        
        print(f"\n📋 CATEGORY BREAKDOWN:")
        for category, count in sorted(categories.items()):
            print(f"   {category}: {count}")
        
        # Count successful vs failed chunks
        successful_chunks = sum(1 for result in chunk_results if not result['result'].get('error'))
        failed_chunks = len(chunk_results) - successful_chunks
        
        print(f"\n📋 PROCESSING STATS:")
        print(f"   Total chunks processed: {len(chunk_results)}")
        print(f"   Successful chunks: {successful_chunks}")
        print(f"   Failed chunks: {failed_chunks}")
        
        # Save results
        final_result = {
            "total_chunks_processed": len(chunk_results),
            "successful_chunks": successful_chunks,
            "failed_chunks": failed_chunks,
            "total_specifications_extracted": len(all_specifications),
            "unique_specifications": len(unique_specifications),
            "category_breakdown": categories,
            "specifications": unique_specifications,
            "chunk_results": chunk_results
        }
        
        output_file = f"anthropic_specifications_{doc_id[:8]}.json"
        with open(output_file, 'w') as f:
            json.dump(final_result, f, indent=2)
        print(f"\n💾 Results saved to: {output_file}")
        
        # Step 4: Store results to Supabase Storage
        print("\n" + "="*80)
        print("STEP 4: STORING RESULTS TO SUPABASE STORAGE")
        print("="*80)
        
        print("DEBUG: Line 440 - About to store results to Supabase Storage")
        
        try:
            print(f"DEBUG: About to call store_to_supabase_storage with doc_id: {doc_id}")
            print(f"DEBUG: SUPABASE_URL exists: {bool(os.getenv('SUPABASE_URL'))}")
            print(f"DEBUG: SUPABASE_SERVICE_KEY exists: {bool(os.getenv('SUPABASE_SERVICE_KEY'))}")
            storage_success = store_to_supabase_storage(doc_id, unique_specifications)
            if storage_success:
                print("✅ Successfully stored specifications to Supabase Storage")
            else:
                print("❌ Failed to store specifications to Supabase Storage")
        except Exception as e:
            print(f"❌ Error storing to Supabase Storage: {e}")
        
        print("DEBUG: Line 460 - Storage attempt completed")
        return final_result
        
    except Exception as e:
        print(f"ERROR: {e}")
        print(f"Error type: {type(e)}")
        return None

if __name__ == "__main__":
    print("Starting Anthropic parallel normalized specification extraction test...")
    print("DEBUG: Line 480 - Main execution started")
    start_time = time.time()
    
    result = test_anthropic_spec_extraction()
    
    end_time = time.time()
    processing_time = end_time - start_time
    
    print("DEBUG: Line 500 - Main execution completed")
    
    if result:
        print("\n✅ TEST COMPLETED SUCCESSFULLY!")
        print(f"Processing time: {processing_time:.1f} seconds")
        print(f"Extracted {result['unique_specifications']} unique specifications")
        print(f"Success rate: {result['successful_chunks']}/{result['total_chunks_processed']} chunks")
    else:
        print("\n❌ TEST FAILED!")