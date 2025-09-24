#!/usr/bin/env python3
"""
Test script for OpenAI using document chunks
"""

import os
import json
import requests
from dotenv import load_dotenv
from openai import OpenAI

# Load environment variables
load_dotenv()

def get_document_chunks(doc_id: str, limit: int = 10) -> list:
    """Get document chunks from Supabase"""
    supabase_url = os.getenv('SUPABASE_URL')
    supabase_key = os.getenv('SUPABASE_SERVICE_KEY') or os.getenv('SUPABASE_SERVICE_ROLE_KEY')
    
    if not supabase_url or not supabase_key:
        raise ValueError("Missing Supabase credentials")
    
    url = supabase_url.rstrip("/")
    headers = {
        "apikey": supabase_key,
        "Authorization": f"Bearer {supabase_key}"
    }
    
    response = requests.get(
        f"{url}/rest/v1/document_chunks",
        headers=headers,
        params={
            "doc_id": f"eq.{doc_id}",
            "select": "chunk_id,text,page_start,page_end",
            "limit": str(limit),
            "order": "chunk_index"
        }
    )
    
    if response.status_code != 200:
        raise Exception(f"Failed to get chunks: {response.status_code} - {response.text}")
    
    return response.json()

def test_openai_chunks():
    """Test OpenAI with document chunks"""
    
    # Configuration from environment
    openai_api_key = os.getenv('OPENAI_API_KEY')
    openai_model = os.getenv('OPENAI_MODEL', 'gpt-4o')
    openai_max_tokens = int(os.getenv('OPENAI_MAX_TOKENS', '20000'))
    openai_temperature = float(os.getenv('OPENAI_TEMPERATURE', '0'))
    
    if not openai_api_key:
        raise ValueError("OPENAI_API_KEY not found in environment variables")
    
    print(f"Using OpenAI model: {openai_model}")
    print(f"Max tokens: {openai_max_tokens}")
    print(f"Temperature: {openai_temperature}")
    
    # Initialize OpenAI client
    client = OpenAI(api_key=openai_api_key)
    
    # Document details
    doc_id = "759ac8ff51c98c10358e2c0604c1ca73cf975023949d6e122f9af6e8cb32f061"
    
    try:
        # Step 1: Get document chunks
        print("\n" + "="*80)
        print("STEP 1: GETTING DOCUMENT CHUNKS")
        print("="*80)
        
        chunks = get_document_chunks(doc_id, limit=1)  # Test with just 1 chunk
        print(f"Retrieved {len(chunks)} chunks")
        
        # Process chunks in sequence with 2-chunk overlap
        all_procedures = []
        overlap_size = 2
        
        for i in range(0, len(chunks), 5):  # Process every 5th chunk with smaller overlap
            # Get current chunk + 1 chunk before + 1 chunk after for context
            start_idx = max(0, i - 1)
            end_idx = min(len(chunks), i + 2)
            
            context_chunks = chunks[start_idx:end_idx]
            current_chunk = chunks[i] if i < len(chunks) else None
            
            if not current_chunk:
                break
                
            print(f"\nProcessing chunk {i+1}/{len(chunks)} (pages {current_chunk.get('page_start', '?')}-{current_chunk.get('page_end', '?')})")
            print(f"Context: chunks {start_idx+1}-{end_idx} ({len(context_chunks)} chunks)")
            
            # Combine context chunks
            context_text = "\n\n".join([chunk['text'] for chunk in context_chunks])
            print(f"Context text length: {len(context_text)} characters")
        
            # Step 2: Extract procedures from this chunk batch
            print("Making API call to OpenAI...")
            
            # System prompt
            system_prompt = """You are an information extractor. Output only valid JSON.

TASK: Extract all procedures, error codes, and maintenance steps from this technical manual.

RULES:
- Every procedure or sub-procedure must be a separate entry.
- If a section has multiple modes or features, output one procedure per mode/feature (never merge them).
- Safety/lock features must always be their own procedure.
- Cleaning and maintenance routines must always be their own procedure.
- Error codes and resolutions must always be their own procedure.
- Installation content must be capped at 2 consolidated procedures (Unpacking/Setup and Countertop/Connections).
- Exclude recipes or non-technical content.
- The output must be a JSON object with one key: "procedures".
- Each procedure object must include: title, preconditions, steps, expected_outcome, models, error_codes."""

            user_prompt = f"Extract all actionable procedures from this technical manual:\n\n{context_text}"
            
            try:
                response = client.responses.create(
                    model=openai_model,
                    instructions=system_prompt,   # replaces system role
                    input=[
                        {"type": "message", "role": "user", "content": user_prompt}
                    ],
                    max_output_tokens=openai_max_tokens,
                    temperature=openai_temperature,
                    metadata={"doc_id": doc_id}
                )
                
                print("API call successful!")
                
                # Parse response for this batch
                if response.output and len(response.output) > 0:
                    response_content = response.output[0].content[0].text
                    print(f"Response length: {len(response_content)} characters")
                    
                    try:
                        parsed_response = json.loads(response_content)
                        batch_procedures = parsed_response.get('procedures', [])
                        all_procedures.extend(batch_procedures)
                        print(f"Extracted {len(batch_procedures)} procedures from this batch")
                    except json.JSONDecodeError as e:
                        print(f"JSON parse error for batch: {e}")
                else:
                    print("Empty response from OpenAI")
                    
            except Exception as e:
                print(f"Error processing batch: {e}")
                continue
        
        # Step 3: Display final results
        print("\n" + "="*80)
        print("STEP 3: FINAL RESULTS")
        print("="*80)
        
        print(f"\nTOTAL PROCEDURES EXTRACTED: {len(all_procedures)}")
        
        if all_procedures:
            print("\n" + "="*80)
            print("EXTRACTED PROCEDURES SUMMARY:")
            print("="*80)
            
            for i, procedure in enumerate(all_procedures, 1):
                title = procedure.get('title', 'No title')
                steps_count = len(procedure.get('steps', []))
                models = procedure.get('models', [])
                error_codes = procedure.get('error_codes', [])
                
                print(f"{i:2d}. {title}")
                print(f"     Steps: {steps_count}, Models: {len(models)}, Error codes: {len(error_codes)}")
            
            # Check for watermaker-specific content
            watermaker_keywords = [
                'watermaker', 'seawater', 'membrane', 'flush', 'pressure',
                'salinity', 'tds', 'intake', 'discharge', 'brine'
            ]
            
            watermaker_specific = 0
            for procedure in all_procedures:
                title_lower = procedure.get('title', '').lower()
                if any(keyword in title_lower for keyword in watermaker_keywords):
                    watermaker_specific += 1
            
            print(f"\nWATERMAKER-SPECIFIC PROCEDURES: {watermaker_specific}/{len(all_procedures)}")
            
            # Save results to file
            output_file = f"openai_chunks_overlap_{doc_id[:8]}.json"
            with open(output_file, 'w') as f:
                json.dump({"procedures": all_procedures}, f, indent=2)
            print(f"\nResults saved to: {output_file}")
            
            return {"procedures": all_procedures}
        else:
            print("No procedures extracted")
            return None
            
    except Exception as e:
        print(f"ERROR: {e}")
        print(f"Error type: {type(e)}")
        return None

if __name__ == "__main__":
    print("Starting OpenAI chunks extraction test...")
    result = test_openai_chunks()
    
    if result:
        print("\nTEST COMPLETED SUCCESSFULLY!")
    else:
        print("\nTEST FAILED!")
