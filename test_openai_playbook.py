#!/usr/bin/env python3
"""
Test script for OpenAI playbook extraction
Rapid testing without Docker rebuilds
"""

import os
import json
import requests
import io
import base64
from dotenv import load_dotenv
from openai import OpenAI

# Load environment variables
load_dotenv()

def download_pdf_from_supabase(doc_id):
    """Download PDF from Supabase storage"""
    supabase_url = os.getenv('SUPABASE_URL')
    supabase_key = os.getenv('SUPABASE_SERVICE_KEY') or os.getenv('SUPABASE_SERVICE_ROLE_KEY')
    
    if not supabase_url or not supabase_key:
        print("Supabase configuration missing")
        return None
    
    # First, get the storage path from documents table
    url = supabase_url.rstrip("/")
    headers = {
        "apikey": supabase_key,
        "Authorization": f"Bearer {supabase_key}"
    }
    
    doc_response = requests.get(
        f"{url}/rest/v1/documents",
        headers=headers,
        params={"doc_id": f"eq.{doc_id}", "select": "storage_path"}
    )
    
    if doc_response.status_code != 200:
        print(f"Failed to get document info: {doc_response.status_code}")
        return None
    
    doc_data = doc_response.json()
    if not doc_data or len(doc_data) == 0:
        print(f"No document found for doc_id {doc_id}")
        return None
    
    storage_path = doc_data[0].get('storage_path')
    print(f"Storage path: {storage_path}")
    
    # Download PDF from storage - append bucket name to storage path
    full_storage_path = f"documents/{storage_path}"
    pdf_response = requests.get(
        f"{url}/storage/v1/object/{full_storage_path}",
        headers=headers
    )
    
    if pdf_response.status_code != 200:
        print(f"Failed to download PDF: {pdf_response.status_code}")
        return None
    
    print(f"PDF downloaded successfully, size: {len(pdf_response.content)} bytes")
    return pdf_response.content

def test_openai_playbook_extraction():
    """Test OpenAI playbook extraction with the PDF"""
    
    # Initialize OpenAI client
    openai_model = 'gpt-5'  # Try gpt-5
    openai_max_tokens = int(os.getenv('OPENAI_MAX_TOKENS', '2000'))
    
    print(f"Using model: {openai_model}")
    print(f"Max tokens: {openai_max_tokens}")
    print("10")
    
    client = OpenAI()
    print("20")
    
    # Download PDF from Supabase
    doc_id = "759ac8ff51c98c10358e2c0604c1ca73cf975023949d6e122f9af6e8cb32f061"
    print(f"Downloading PDF for document: {doc_id}")
    print("30")
    
    pdf_content = download_pdf_from_supabase(doc_id)
    print("40")
    if not pdf_content:
        print("Failed to download PDF from Supabase")
        return
    
    # System prompt (same as in the main code)
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
- Each procedure object must include: title, preconditions, steps, expected_outcome, models, error_codes.
"""

    # User prompt
    user_prompt = "Extract all actionable procedures from this technical manual."

    print("\n" + "="*80)
    print("MAKING OPENAI API CALL")
    print("="*80)
    
    try:
        # Upload PDF file to OpenAI
        print("50")
        print("Uploading PDF file to OpenAI...")
        print("60")
        pdf_file = io.BytesIO(pdf_content)
        pdf_file.name = f"{doc_id}.pdf"
        print("70")
        
        uploaded_file = client.files.create(
            file=pdf_file,
            purpose="assistants"
        )
        print("80")
        
        print(f"File uploaded with ID: {uploaded_file.id}")
        print("90")
        
        # Now test the actual API call
        print("100")
        print("About to call responses.create()...")
        print("110")
        
        response = client.responses.create(
            model="gpt-5",
            instructions="You are an information extractor. Output only valid JSON ...",
            input=[
                {
                    "role": "user",
                    "content": "Please extract all procedures from the attached PDF.",
                    "attachments": [
                        {"file_id": uploaded_file.id}
                    ]
                }
            ],
            max_output_tokens=4000
        )
        print("120")
        
        # Parse the response
        if response.output and len(response.output) > 0:
            message_output = None
            for output_item in response.output:
                if hasattr(output_item, 'type') and output_item.type == 'message':
                    message_output = output_item
                    break
            
            if message_output and hasattr(message_output, 'content') and message_output.content:
                response_content = message_output.content[0].text
            else:
                print("❌ No message output found")
                return
        else:
            print("❌ Empty response from OpenAI API")
            return

        print("✅ API call successful!")
        print(f"\nRAW RESPONSE:\n{response_content[:500]}...")
        
        # Try to parse as JSON
        try:
            # Remove markdown code blocks if present
            if response_content.startswith('```json'):
                response_content = response_content[7:]  # Remove ```json
            if response_content.endswith('```'):
                response_content = response_content[:-3]  # Remove ```
            response_content = response_content.strip()
            
            parsed_response = json.loads(response_content)
            print("\n✅ PARSED JSON:")
            print(json.dumps(parsed_response, indent=2))
            print(f"Procedures extracted: {len(parsed_response.get('procedures', []))}")
        except json.JSONDecodeError as e:
            print(f"❌ JSON PARSE ERROR: {e}")
            print(f"Raw response: {response_content}")
        
        # # Extract response content
        # if response.output and len(response.output) > 0:
        #     response_content = response.output[0].content[0].text
        #     print(f"Response length: {len(response_content)} characters")
            
        #     print("\n" + "="*80)
        #     print("RAW RESPONSE:")
        #     print("="*80)
        #     print(response_content)
            
        #     # Try to parse as JSON
        #     try:
        #         parsed_response = json.loads(response_content)
        #         print("\n" + "="*80)
        #         print("PARSED JSON:")
        #         print("="*80)
        #         print(json.dumps(parsed_response, indent=2))
                
        #         # Count procedures
        #         if "procedures" in parsed_response:
        #             procedure_count = len(parsed_response["procedures"])
        #             print(f"\n✅ SUCCESS: Found {procedure_count} procedures")
        #         else:
        #             print("\n❌ ERROR: No 'procedures' key in response")
                    
        #     except json.JSONDecodeError as e:
        #         print(f"\n❌ JSON PARSE ERROR: {e}")
        #         print("Response is not valid JSON")
        # else:
        #     print("❌ ERROR: Empty response from OpenAI")
            
    except Exception as e:
        print(f"❌ FILE UPLOAD FAILED: {e}")
        print(f"Error type: {type(e)}")

if __name__ == "__main__":
    test_openai_playbook_extraction()
