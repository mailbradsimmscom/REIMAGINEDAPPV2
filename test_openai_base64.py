#!/usr/bin/env python3
"""
Test script for OpenAI base64 PDF extraction
"""

import os
import json
import requests
import base64
from dotenv import load_dotenv
from openai import OpenAI

# Load environment variables
load_dotenv()

def download_pdf_from_supabase(doc_id: str, filename: str) -> bytes:
    """Download PDF from Supabase storage"""
    supabase_url = os.getenv('SUPABASE_URL')
    supabase_key = os.getenv('SUPABASE_SERVICE_KEY') or os.getenv('SUPABASE_SERVICE_ROLE_KEY')
    
    if not supabase_url or not supabase_key:
        raise ValueError("Missing Supabase credentials")
    
    url = supabase_url.rstrip("/")
    headers = {
        "apikey": supabase_key,
        "Authorization": f"Bearer {supabase_key}"
    }
    
    # Download PDF from storage
    pdf_path = f"documents/manuals/{doc_id}/{filename}"
    pdf_url = f"{url}/storage/v1/object/{pdf_path}"
    
    print(f"Downloading PDF from: {pdf_url}")
    
    response = requests.get(pdf_url, headers=headers)
    
    if response.status_code != 200:
        raise Exception(f"Failed to download PDF: {response.status_code} - {response.text}")
    
    print(f"PDF downloaded successfully, size: {len(response.content)} bytes")
    return response.content

def test_openai_base64_pdf():
    """Test OpenAI PDF extraction with base64 approach"""
    
    # Configuration from environment
    openai_api_key = os.getenv('OPENAI_API_KEY')
    openai_model = os.getenv('OPENAI_MODEL', 'gpt-4o')
    openai_max_tokens = int(os.getenv('OPENAI_MAX_TOKENS', '4000'))
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
    filename = "Schenker_Watermaker_ZEN_150_48V_Touch_Manual_ENGLISH_2024.pdf"
    
    try:
        # Step 1: Download PDF from Supabase
        print("\n" + "="*80)
        print("STEP 1: DOWNLOADING PDF FROM SUPABASE")
        print("="*80)
        
        pdf_content = download_pdf_from_supabase(doc_id, filename)
        
        # Step 2: Encode PDF as base64
        print("\n" + "="*80)
        print("STEP 2: ENCODING PDF AS BASE64")
        print("="*80)
        
        pdf_base64 = base64.b64encode(pdf_content).decode('utf-8')
        print(f"PDF encoded as base64, size: {len(pdf_base64)} characters")
        
        # Step 3: Extract procedures using base64 PDF
        print("\n" + "="*80)
        print("STEP 3: EXTRACTING PROCEDURES FROM PDF")
        print("="*80)
        
        # System prompt
        system_prompt = """You are an information extractor. Output only valid JSON.

TASK: Extract all procedures, error codes, and maintenance steps from this manual.

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

        user_prompt = "Extract all actionable procedures from this technical manual."
        
        print("Making API call to OpenAI...")
        
        response = client.chat.completions.create(
            model=openai_model,
            max_tokens=openai_max_tokens,
            temperature=openai_temperature,
            messages=[
                {"role": "system", "content": system_prompt},
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": user_prompt},
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:application/pdf;base64,{pdf_base64}"
                            }
                        }
                    ]
                }
            ]
        )
        
        print("API call successful!")
        
        # Step 4: Parse and display results
        print("\n" + "="*80)
        print("STEP 4: PARSING RESPONSE")
        print("="*80)
        
        if response.choices and len(response.choices) > 0:
            response_content = response.choices[0].message.content
            print(f"Response length: {len(response_content)} characters")
            
            print("\n" + "="*80)
            print("RAW RESPONSE:")
            print("="*80)
            print(response_content)
            print("="*80)
            
            # Try to parse as JSON
            try:
                parsed_response = json.loads(response_content)
                procedures = parsed_response.get('procedures', [])
                
                print(f"\nSUCCESS: Extracted {len(procedures)} procedures")
                
                print("\n" + "="*80)
                print("EXTRACTED PROCEDURES SUMMARY:")
                print("="*80)
                
                for i, procedure in enumerate(procedures, 1):
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
                for procedure in procedures:
                    title_lower = procedure.get('title', '').lower()
                    if any(keyword in title_lower for keyword in watermaker_keywords):
                        watermaker_specific += 1
                
                print(f"\nWATERMAKER-SPECIFIC PROCEDURES: {watermaker_specific}/{len(procedures)}")
                
                # Save results to file
                output_file = f"openai_base64_extraction_{doc_id[:8]}.json"
                with open(output_file, 'w') as f:
                    json.dump(parsed_response, f, indent=2)
                print(f"\nResults saved to: {output_file}")
                
                return parsed_response
                
            except json.JSONDecodeError as e:
                print(f"JSON PARSE ERROR: {e}")
                print("Response is not valid JSON")
                return None
        else:
            print("Empty response from OpenAI")
            return None
            
    except Exception as e:
        print(f"ERROR: {e}")
        print(f"Error type: {type(e)}")
        return None

if __name__ == "__main__":
    print("Starting OpenAI base64 PDF extraction test...")
    result = test_openai_base64_pdf()
    
    if result:
        print("\nTEST COMPLETED SUCCESSFULLY!")
    else:
        print("\nTEST FAILED!")
