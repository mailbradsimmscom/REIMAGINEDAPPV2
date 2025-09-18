#!/usr/bin/env python3
"""
Test script for Anthropic Claude 3.5 parallel text chunk extraction
Tests golden rules/validation extraction from existing Supabase text chunks with parallel processing
"""

import os
import json
import requests
import time
import concurrent.futures
from concurrent.futures import ThreadPoolExecutor
from dotenv import load_dotenv
from anthropic import Anthropic

# Load environment variables
load_dotenv()

def fetch_chunks_from_supabase(doc_id: str) -> list:
    """Fetch document chunks from Supabase database"""
    supabase_url = os.getenv('SUPABASE_URL')
    supabase_key = os.getenv('SUPABASE_SERVICE_KEY') or os.getenv('SUPABASE_SERVICE_ROLE_KEY')
    
    if not supabase_url or not supabase_key:
        raise ValueError("Missing Supabase credentials")
    
    url = supabase_url.rstrip("/")
    headers = {
        "apikey": supabase_key,
        "Authorization": f"Bearer {supabase_key}",
        "Content-Type": "application/json"
    }
    
    # Query chunks from database
    params = {
        "doc_id": f"eq.{doc_id}",
        "content_type": "eq.text",
        "text": "not.is.null",
        "select": "chunk_id,doc_id,text,page_start,page_end,chunk_index,metadata",
        "order": "page_start,chunk_index"
    }
    
    print(f"Fetching chunks for document {doc_id[:8]}...")
    
    response = requests.get(
        f"{url}/rest/v1/document_chunks",
        headers=headers,
        params=params
    )
    
    if response.status_code != 200:
        raise Exception(f"Failed to fetch chunks: {response.status_code} - {response.text}")
    
    chunks_data = response.json()
    print(f"Found {len(chunks_data)} chunks in database")
    
    return chunks_data

def process_text_chunk(client, chunk_data, chunk_num, total_chunks, anthropic_model, anthropic_max_tokens, anthropic_temperature, system_prompt):
    """Process a single text chunk from database with timeout and error handling"""
    pages = f"{chunk_data.get('page_start', '?')}-{chunk_data.get('page_end', '?')}"
    text_content = chunk_data.get('text', '')
    
    print(f"Processing chunk {chunk_num}/{total_chunks} (Pages {pages}, {len(text_content)} chars)")
    
    user_prompt = f"Extract all validation rules and test assertions from this section of the technical manual:\n\n{text_content}"
    
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
            timeout=30  # 30 second timeout
        )
        
        print(f"  API call successful for chunk {chunk_num}")
        
        if response.content and len(response.content) > 0:
            response_content = response.content[0].text
            
            # Try to parse as JSON
            try:
                parsed_response = json.loads(response_content)
                golden_rules = parsed_response.get('golden_rules', [])
                print(f"  Extracted {len(golden_rules)} golden rules from chunk {chunk_num}")
                return parsed_response
            except json.JSONDecodeError as e:
                print(f"  JSON parse error in chunk {chunk_num}: {e}")
                print(f"  Raw response preview: {response_content[:200]}...")
                return {"golden_rules": [], "error": "JSON parse failed", "raw_response": response_content}
        else:
            print(f"  Empty response for chunk {chunk_num}")
            return {"golden_rules": [], "error": "Empty response"}
            
    except Exception as e:
        print(f"  API error for chunk {chunk_num}: {type(e).__name__}: {e}")
        return {"golden_rules": [], "error": str(e)}

def process_chunks_parallel(client, chunks_data, anthropic_model, anthropic_max_tokens, anthropic_temperature, system_prompt, max_workers=3):
    """Process chunks in parallel"""
    
    def process_single_chunk(chunk_info):
        chunk_data, chunk_num = chunk_info
        return process_text_chunk(
            client, chunk_data, chunk_num, len(chunks_data),
            anthropic_model, anthropic_max_tokens, anthropic_temperature, system_prompt
        )
    
    # Create list of (chunk_data, chunk_number) tuples
    chunk_tasks = [(chunk_data, i+1) for i, chunk_data in enumerate(chunks_data)]
    
    all_golden_rules = []
    chunk_results = []
    completed_count = 0
    
    print(f"Processing {len(chunks_data)} chunks with {max_workers} parallel workers...")
    
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
                
                if 'golden_rules' in result:
                    all_golden_rules.extend(result['golden_rules'])
                    
                print(f"Completed chunk {chunk_num} ({completed_count}/{len(chunks_data)})")
                
            except Exception as e:
                print(f"Chunk {chunk_num} failed: {e}")
                chunk_results.append({
                    'chunk_num': chunk_num,
                    'pages': f"{chunk_data.get('page_start', '?')}-{chunk_data.get('page_end', '?')}",
                    'result': {"golden_rules": [], "error": str(e)}
                })
    
    return all_golden_rules, chunk_results

def store_to_supabase_storage(doc_id, golden_rules):
    """Store golden rules to Supabase Storage"""
    try:
        from supabase import create_client
        from dotenv import load_dotenv
        
        # Load environment variables
        load_dotenv()
        
        # Prepare data for storage
        data = {
            "golden_rules": golden_rules
        }
        
        # Convert to JSON string
        json_content = json.dumps(data, indent=2)
        
        # Supabase configuration
        url = os.getenv('SUPABASE_URL')
        key = os.getenv('SUPABASE_SERVICE_KEY') or os.getenv('SUPABASE_SERVICE_ROLE_KEY')
        
        if not url or not key:
            print("❌ Supabase credentials not found")
            return False
        
        # Initialize Supabase client
        supabase = create_client(url, key)
        
        # Storage path
        file_path = f"manuals/{doc_id}/DIP/{doc_id}_golden_rules_an.json"
        
        # Upload to Supabase Storage using Python client
        result = supabase.storage.from_('documents').upload(
            file_path,
            json_content.encode('utf-8'),
            file_options={
                "content-type": "text/plain",
                "cache-control": "3600"
            }
        )
        
        # Check for errors in the response
        if hasattr(result, 'error') and result.error:
            print(f"❌ Failed to upload to storage: {result.error}")
            return False
        else:
            print(f"✅ Successfully stored golden rules to Supabase Storage: {file_path}")
            return True
            
    except Exception as e:
        print(f"❌ Error storing to Supabase Storage: {e}")
        return False

def test_anthropic_golden_rules_extraction():
    """Test Anthropic golden rules extraction with parallel processing"""
    
    # Configuration from environment
    anthropic_api_key = os.getenv('ANTHROPIC_API_KEY')
    anthropic_model = os.getenv('ANTHROPIC_MODEL', 'claude-3-5-sonnet-20240620')
    anthropic_max_tokens = int(os.getenv('ANTHROPIC_MAX_TOKENS', '8000'))
    anthropic_temperature = float(os.getenv('ANTHROPIC_TEMPERATURE', '0'))
    
    if not anthropic_api_key:
        raise ValueError("ANTHROPIC_API_KEY not found in environment variables")
    
    print(f"Using Anthropic model: {anthropic_model}")
    print(f"Max tokens: {anthropic_max_tokens}")
    print(f"Temperature: {anthropic_temperature}")
    
    # Initialize Anthropic client
    client = Anthropic(api_key=anthropic_api_key)
    
    # Document details - make configurable for any system
    doc_id = os.getenv('DOC_ID', "759ac8ff51c98c10358e2c0604c1ca73cf975023949d6e122f9af6e8cb32f061")
    
    try:
        # Step 1: Fetch chunks from Supabase database  
        print("\n" + "="*80)
        print("STEP 1: FETCHING CHUNKS FROM DATABASE")
        print("="*80)
        
        chunks_data = fetch_chunks_from_supabase(doc_id)
        
        # Step 2: Process chunks in parallel
        print("\n" + "="*80)
        print("STEP 2: PROCESSING TEXT CHUNKS FOR GOLDEN RULES")
        print("="*80)
        
        # System prompt for golden rules extraction
        system_prompt = """CRITICAL: You MUST respond with ONLY pure JSON. No explanations, no text before or after JSON.
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
        
        all_golden_rules, chunk_results = process_chunks_parallel(
            client, chunks_data, anthropic_model, anthropic_max_tokens, 
            anthropic_temperature, system_prompt, max_workers=3
        )
        
        # Step 3: Combine and analyze results
        print("\n" + "="*80)
        print("STEP 3: ANALYZING COMBINED RESULTS")
        print("="*80)
        
        print(f"Total golden rules extracted: {len(all_golden_rules)}")
        
        # Remove duplicates based on query and cap at 25
        unique_golden_rules = []
        seen_queries = set()
        for rule in all_golden_rules:
            query = rule.get('query', '').strip().lower()
            if query and query not in seen_queries and len(unique_golden_rules) < 25:
                unique_golden_rules.append(rule)
                seen_queries.add(query)
        
        print(f"Unique golden rules after deduplication (capped at 25): {len(unique_golden_rules)}")
        
        print("\n" + "="*80)
        print("EXTRACTED GOLDEN RULES:")
        print("="*80)
        
        for i, rule in enumerate(unique_golden_rules, 1):
            query = rule.get('query', 'No query')
            expected_value = rule.get('expected_value', 'No expected value')
            models = rule.get('models', [])
            related_procedures = rule.get('related_procedures', [])
            
            print(f"{i:2d}. Query: {query[:60]}{'...' if len(query) > 60 else ''}")
            print(f"    Expected: {expected_value[:50]}{'...' if len(expected_value) > 50 else ''}")
            print(f"    Models: {len(models)}, Related: {len(related_procedures)}")
        
        print(f"\n📊 EXTRACTION SUMMARY:")
        print(f"   Total golden rules found: {len(unique_golden_rules)}")
        
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
            "total_golden_rules_extracted": len(all_golden_rules),
            "unique_golden_rules": len(unique_golden_rules),
            "golden_rules": unique_golden_rules,
            "chunk_results": chunk_results
        }
        
        output_file = f"anthropic_golden_rules_{doc_id[:8]}.json"
        with open(output_file, 'w') as f:
            json.dump(final_result, f, indent=2)
        print(f"\n💾 Results saved to: {output_file}")
        
        # Step 4: Store results to Supabase Storage
        print("\n" + "="*80)
        print("STEP 4: STORING RESULTS TO SUPABASE STORAGE")
        print("="*80)
        
        try:
            storage_success = store_to_supabase_storage(doc_id, unique_golden_rules)
            if storage_success:
                print("✅ Successfully stored golden rules to Supabase Storage")
            else:
                print("❌ Failed to store golden rules to Supabase Storage")
        except Exception as e:
            print(f"❌ Error storing to Supabase Storage: {e}")
        
        return final_result
        
    except Exception as e:
        print(f"ERROR: {e}")
        print(f"Error type: {type(e)}")
        return None

if __name__ == "__main__":
    print("Starting Anthropic parallel golden rules extraction test...")
    start_time = time.time()
    
    result = test_anthropic_golden_rules_extraction()
    
    end_time = time.time()
    processing_time = end_time - start_time
    
    if result:
        print("\n✅ TEST COMPLETED SUCCESSFULLY!")
        print(f"Processing time: {processing_time:.1f} seconds")
        print(f"Extracted {result['unique_golden_rules']} unique golden rules")
        print(f"Success rate: {result['successful_chunks']}/{result['total_chunks_processed']} chunks")
    else:
        print("\n❌ TEST FAILED!")