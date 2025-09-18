#!/usr/bin/env python3
"""
Test script for Anthropic Claude 3.5 parallel text chunk extraction
Tests intent router Q&A extraction from existing Supabase text chunks with parallel processing
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
    
    user_prompt = f"Extract question-answer pairs for intent routing from this section of the technical manual:\n\n{text_content}"
    
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
                intent_routes = parsed_response.get('intent_routes', [])
                print(f"  Extracted {len(intent_routes)} intent routes from chunk {chunk_num}")
                return parsed_response
            except json.JSONDecodeError as e:
                print(f"  JSON parse error in chunk {chunk_num}: {e}")
                print(f"  Raw response preview: {response_content[:200]}...")
                return {"intent_routes": [], "error": "JSON parse failed", "raw_response": response_content}
        else:
            print(f"  Empty response for chunk {chunk_num}")
            return {"intent_routes": [], "error": "Empty response"}
            
    except Exception as e:
        print(f"  API error for chunk {chunk_num}: {type(e).__name__}: {e}")
        return {"intent_routes": [], "error": str(e)}

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
    
    all_intent_routes = []
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
                
                if 'intent_routes' in result:
                    all_intent_routes.extend(result['intent_routes'])
                    
                print(f"Completed chunk {chunk_num} ({completed_count}/{len(chunks_data)})")
                
            except Exception as e:
                print(f"Chunk {chunk_num} failed: {e}")
                chunk_results.append({
                    'chunk_num': chunk_num,
                    'pages': f"{chunk_data.get('page_start', '?')}-{chunk_data.get('page_end', '?')}",
                    'result': {"intent_routes": [], "error": str(e)}
                })
    
    return all_intent_routes, chunk_results

def test_anthropic_intent_router_extraction():
    """Test Anthropic intent router Q&A extraction with parallel processing"""
    
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
        print("STEP 2: PROCESSING TEXT CHUNKS FOR INTENT ROUTER Q&A")
        print("="*80)
        
        # System prompt for intent router Q&A extraction
        system_prompt = """CRITICAL: You MUST respond with ONLY pure JSON. No explanations, no text before or after JSON.
FORMAT REQUIREMENT: Output must start with { and end with }. Nothing else.
If you add ANY text outside the JSON brackets, the system will fail.

TASK: Extract question-answer pairs from technical manuals for natural language query routing. Create direct answers to common What/How/When/Where questions.

OUTPUT FORMAT (copy exactly):
{"intent_routes":[{"question":"string","question_variations":["string"],"answer":"string","question_type":"string","models":["string"],"references":["string"]}]}

FOCUS ON:
- Common user questions about operation
- Specification lookups  
- Installation guidance
- Troubleshooting quick answers
- Parts and maintenance questions
- Safety and compliance questions

FOR EACH Q&A PAIR PROVIDE:
- Question: Natural language question (primary version)
- Question Variations: Alternative ways to ask the same thing
- Answer: Direct, complete answer with specific details
- Question Type: What/How/When/Where/Why
- Models: Which models this applies to
- References: Page numbers, sections, or related procedures

RULES:
- Extract ALL common questions and their direct answers
- Focus on practical user queries about the system
- Provide complete, specific answers with details
- Include question variations people might use
- Maximum 25 Q&A pairs total
- Start response with { character
- End response with } character
- No explanatory text before JSON
- No explanatory text after JSON
- No markdown code blocks"""
        
        all_intent_routes, chunk_results = process_chunks_parallel(
            client, chunks_data, anthropic_model, anthropic_max_tokens, 
            anthropic_temperature, system_prompt, max_workers=3
        )
        
        # Step 3: Combine and analyze results
        print("\n" + "="*80)
        print("STEP 3: ANALYZING COMBINED RESULTS")
        print("="*80)
        
        print(f"Total intent routes extracted: {len(all_intent_routes)}")
        
        # Remove duplicates based on question and cap at 25
        unique_intent_routes = []
        seen_questions = set()
        for route in all_intent_routes:
            question = route.get('question', '').strip().lower()
            if question and question not in seen_questions and len(unique_intent_routes) < 25:
                unique_intent_routes.append(route)
                seen_questions.add(question)
        
        print(f"Unique intent routes after deduplication (capped at 25): {len(unique_intent_routes)}")
        
        # Categorize by question type
        question_types = {}
        for route in unique_intent_routes:
            q_type = route.get('question_type', 'Unknown')
            question_types[q_type] = question_types.get(q_type, 0) + 1
        
        print("\n" + "="*80)
        print("EXTRACTED INTENT ROUTES:")
        print("="*80)
        
        for i, route in enumerate(unique_intent_routes, 1):
            question = route.get('question', 'No question')
            answer = route.get('answer', 'No answer')
            question_type = route.get('question_type', 'Unknown')
            models = route.get('models', [])
            variations = route.get('question_variations', [])
            
            print(f"{i:2d}. [{question_type}] {question}")
            print(f"    Answer: {answer[:60]}{'...' if len(answer) > 60 else ''}")
            print(f"    Models: {len(models)}, Variations: {len(variations)}")
        
        print(f"\n📊 EXTRACTION SUMMARY:")
        print(f"   Total intent routes found: {len(unique_intent_routes)}")
        
        print(f"\n📋 QUESTION TYPE BREAKDOWN:")
        for q_type, count in sorted(question_types.items()):
            print(f"   {q_type}: {count}")
        
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
            "total_intent_routes_extracted": len(all_intent_routes),
            "unique_intent_routes": len(unique_intent_routes),
            "question_type_breakdown": question_types,
            "intent_routes": unique_intent_routes,
            "chunk_results": chunk_results
        }
        
        output_file = f"anthropic_intent_router_{doc_id[:8]}.json"
        with open(output_file, 'w') as f:
            json.dump(final_result, f, indent=2)
        print(f"\n💾 Results saved to: {output_file}")
        
        return final_result
        
    except Exception as e:
        print(f"ERROR: {e}")
        print(f"Error type: {type(e)}")
        return None

if __name__ == "__main__":
    print("Starting Anthropic parallel intent router extraction test...")
    start_time = time.time()
    
    result = test_anthropic_intent_router_extraction()
    
    end_time = time.time()
    processing_time = end_time - start_time
    
    if result:
        print("\n✅ TEST COMPLETED SUCCESSFULLY!")
        print(f"Processing time: {processing_time:.1f} seconds")
        print(f"Extracted {result['unique_intent_routes']} unique Q&A pairs")
        print(f"Success rate: {result['successful_chunks']}/{result['total_chunks_processed']} chunks")
    else:
        print("\n❌ TEST FAILED!")