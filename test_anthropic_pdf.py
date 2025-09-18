#!/usr/bin/env python3
"""
Test script for Anthropic Claude 3.5 PDF extraction
Tests native PDF processing vs text chunking approach
"""

import os
import json
import requests
from dotenv import load_dotenv
from anthropic import Anthropic

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

def test_anthropic_pdf_extraction():
    """Test Anthropic PDF extraction with native PDF support"""
    
    # Configuration from environment
    anthropic_api_key = os.getenv('ANTHROPIC_API_KEY')
    anthropic_model = os.getenv('ANTHROPIC_MODEL', 'claude-3-5-sonnet-20241022')
    anthropic_max_tokens = int(os.getenv('ANTHROPIC_MAX_TOKENS', '8000'))
    anthropic_temperature = float(os.getenv('ANTHROPIC_TEMPERATURE', '0'))
    
    if not anthropic_api_key:
        raise ValueError("ANTHROPIC_API_KEY not found in environment variables")
    
    print(f"Using Anthropic model: {anthropic_model}")
    print(f"Max tokens: {anthropic_max_tokens}")
    print(f"Temperature: {anthropic_temperature}")
    
    # Initialize Anthropic client with Files API beta header
    client = Anthropic(
        api_key=anthropic_api_key,
        default_headers={
            "anthropic-beta": "files-api-2025-04-14"
        }
    )
    
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
        
        import base64
        pdf_base64 = base64.b64encode(pdf_content).decode('utf-8')
        print(f"PDF encoded as base64, size: {len(pdf_base64)} characters")
        
        # Step 3: Extract procedures using native PDF
        print("\n" + "="*80)
        print("STEP 3: EXTRACTING PROCEDURES FROM PDF")
        print("="*80)
        
        # Your exact system prompt from DIP processor
        system_prompt = """CRITICAL: You MUST respond with ONLY pure JSON. No explanations, no text before or after JSON.
FORMAT REQUIREMENT: Output must start with { and end with }. Nothing else.
If you add ANY text outside the JSON brackets, the system will fail.

TASK: Extract ALL procedures, error codes, and maintenance steps from technical manuals.
INCLUDE EVERYTHING: installation, setup, operation, troubleshooting, maintenance, cleaning, error resolution, safety procedures.
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
- No markdown code blocks
- No 'Here is the JSON:' or similar phrases"""

        user_prompt = "Extract all actionable procedures from this technical manual."
        
        print("Making API call to Anthropic...")
        
        response = client.messages.create(
            model=anthropic_model,
            max_tokens=anthropic_max_tokens,
            temperature=anthropic_temperature,
            system=system_prompt,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": user_prompt},
                        {
                            "type": "document",
                            "source": {
                                "type": "base64", 
                                "media_type": "application/pdf",
                                "data": pdf_base64
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
        
        if response.content and len(response.content) > 0:
            response_content = response.content[0].text
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
                output_file = f"anthropic_pdf_extraction_{doc_id[:8]}.json"
                with open(output_file, 'w') as f:
                    json.dump(parsed_response, f, indent=2)
                print(f"\nResults saved to: {output_file}")
                
                return parsed_response
                
            except json.JSONDecodeError as e:
                print(f"JSON PARSE ERROR: {e}")
                print("Response is not valid JSON")
                return None
        else:
            print("Empty response from Anthropic")
            return None
            
    except Exception as e:
        print(f"ERROR: {e}")
        print(f"Error type: {type(e)}")
        return None

if __name__ == "__main__":
    print("Starting Anthropic PDF extraction test...")
    result = test_anthropic_pdf_extraction()
    
    if result:
        print("\nTEST COMPLETED SUCCESSFULLY!")
    else:
        print("\nTEST FAILED!")
