#!/usr/bin/env python3
"""
Test passing file_id directly as content
"""

import os
from dotenv import load_dotenv
from openai import OpenAI

# Load environment variables
load_dotenv()

def test_file_id_as_content():
    """Test passing file_id directly as content"""
    
    client = OpenAI()
    
    print("Testing file_id as content...")
    
    # First upload a test file
    print("1. Uploading test file...")
    try:
        # Create a simple text file
        import io
        test_content = "This is a test file for API testing."
        test_file = io.BytesIO(test_content.encode())
        test_file.name = "test.txt"
        
        uploaded_file = client.files.create(
            file=test_file,
            purpose="assistants"
        )
        print(f"✅ File uploaded with ID: {uploaded_file.id}")
        
        # Test different ways to pass file_id
        test_cases = [
            {
                "name": "File ID as simple content",
                "input": [{"role": "user", "content": uploaded_file.id}]
            },
            {
                "name": "File ID with input_file type",
                "input": [{"role": "user", "content": [{"type": "input_file", "file_id": uploaded_file.id}]}]
            },
            {
                "name": "File ID with input_text type",
                "input": [{"role": "user", "content": [{"type": "input_text", "text": uploaded_file.id}]}]
            }
        ]
        
        for test_case in test_cases:
            print(f"\n2. Testing: {test_case['name']}")
            try:
                response = client.responses.create(
                    model="gpt-5",
                    instructions="Read this file and respond with 'file read successfully'",
                    input=test_case['input'],
                    max_output_tokens=100
                )
                print(f"✅ SUCCESS: {test_case['name']}")
                print(f"   Response type: {type(response)}")
                if hasattr(response, 'output'):
                    print(f"   Output length: {len(response.output) if response.output else 0}")
                    for i, output_item in enumerate(response.output):
                        print(f"   Output {i}: {type(output_item)} - {getattr(output_item, 'type', 'no type')}")
                        if hasattr(output_item, 'content') and output_item.content:
                            print(f"   Content: {output_item.content}")
            except Exception as e:
                print(f"❌ FAILED: {test_case['name']}")
                print(f"   Error: {e}")
        
        # test_file is BytesIO, no need to close
        
    except Exception as e:
        print(f"❌ File upload failed: {e}")

if __name__ == "__main__":
    test_file_id_as_content()
