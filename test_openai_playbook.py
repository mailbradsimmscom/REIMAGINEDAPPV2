#!/usr/bin/env python3
"""
Test script for OpenAI playbook extraction
Rapid testing without Docker rebuilds
"""

import os
import json
from dotenv import load_dotenv
from openai import OpenAI

# Load environment variables
load_dotenv()

def get_pdf_file(pdf_path):
    """Get PDF file for API call"""
    try:
        with open(pdf_path, 'rb') as file:
            return file.read()
    except Exception as e:
        print(f"Error reading PDF: {e}")
        return None

def test_openai_playbook_extraction():
    """Test OpenAI playbook extraction with the PDF"""
    
    # Initialize OpenAI client
    openai_model = os.getenv('OPENAI_MODEL', 'gpt-4o-mini')
    openai_max_tokens = int(os.getenv('OPENAI_MAX_TOKENS', '8000'))
    
    print(f"Using model: {openai_model}")
    print(f"Max tokens: {openai_max_tokens}")
    
    client = OpenAI()
    
    # Get PDF file
    pdf_path = "145775-48VDC-SINGLE-ZONE-INTELLIKEN-GRILL-1-1.pdf"
    print(f"Reading PDF: {pdf_path}")
    
    pdf_file = get_pdf_file(pdf_path)
    if not pdf_file:
        print("Failed to read PDF file")
        return
    
    print(f"PDF file size: {len(pdf_file)} bytes")
    
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
        # First upload the PDF file
        print("Uploading PDF file...")
        print("10")
        with open(pdf_path, 'rb') as file:
            print("20")
            uploaded_file = client.files.create(
                file=file,
                purpose="assistants"
            )
            print("30")
        
        print(f"File uploaded with ID: {uploaded_file.id}")
        print("40")
        print(f"Using file_id: {uploaded_file.id}")
        print("50")
        
        # ✅ Make the API call with correct Responses API format
        response = client.responses.create(
            model=openai_model,
            instructions=system_prompt,   # replaces system role
            input=[
                {"type": "message", "role": "user", "content": user_prompt}
            ],
            max_output_tokens=openai_max_tokens,
            temperature=0,
            metadata={"doc_id": "test-123", "file_id": uploaded_file.id}  # optional tracking
        )

        print("✅ API call successful!")
        print(f"Response type: {type(response)}")
        print(f"Response: {response}")
        
        # Check if response has output
        if hasattr(response, 'output') and response.output:
            print(f"Output length: {len(response.output)}")
            
            # Look for the message output (not reasoning)
            message_output = None
            for output_item in response.output:
                if hasattr(output_item, 'type') and output_item.type == 'message':
                    message_output = output_item
                    break
            
            if message_output:
                print(f"Found message output: {message_output}")
                if hasattr(message_output, 'content') and message_output.content:
                    print(f"Content length: {len(message_output.content)}")
                    if len(message_output.content) > 0:
                        print(f"First content: {message_output.content[0]}")
                        if hasattr(message_output.content[0], 'text'):
                            response_content = message_output.content[0].text
                            print(f"\nRAW RESPONSE:\n{response_content[:500]}...")
                            
                            # Try to parse as JSON
                            try:
                                parsed_response = json.loads(response_content)
                                print("\n✅ PARSED JSON:")
                                print(json.dumps(parsed_response, indent=2))
                                print(f"Procedures extracted: {len(parsed_response.get('procedures', []))}")
                            except json.JSONDecodeError as e:
                                print(f"❌ JSON PARSE ERROR: {e}")
                        else:
                            print("❌ No 'text' attribute in content")
                    else:
                        print("❌ Empty content array")
                else:
                    print("❌ No 'content' attribute or empty content")
            else:
                print("❌ No message output found")
        else:
            print("❌ No 'output' attribute or empty output")
        
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
