#!/usr/bin/env python3
"""
Test what we can put in the input parameter for responses.create()
"""

import os
from dotenv import load_dotenv
from openai import OpenAI

# Load environment variables
load_dotenv()

def test_input_parameter():
    """Test what we can put in the input parameter"""
    
    client = OpenAI()
    
    print("Testing input parameter variations for responses.create()...")
    
    # Test different input structures
    test_cases = [
        {
            "name": "Simple string content",
            "input": [{"role": "user", "content": "Hello"}]
        },
        {
            "name": "Array content with text",
            "input": [{"role": "user", "content": [{"type": "text", "text": "Hello"}]}]
        },
        {
            "name": "Array content with input_text",
            "input": [{"role": "user", "content": [{"type": "input_text", "text": "Hello"}]}]
        },
        {
            "name": "Array content with input_file",
            "input": [{"role": "user", "content": [{"type": "input_file", "file_id": "file-123"}]}]
        },
        {
            "name": "Mixed content array",
            "input": [{"role": "user", "content": [{"type": "text", "text": "Hello"}, {"type": "input_file", "file_id": "file-123"}]}]
        },
        {
            "name": "Multiple messages",
            "input": [
                {"role": "user", "content": "Hello"},
                {"role": "assistant", "content": "Hi there"}
            ]
        }
    ]
    
    for test_case in test_cases:
        print(f"\nTesting: {test_case['name']}")
        try:
            response = client.responses.create(
                model="gpt-5",
                instructions="Respond with 'test successful'",
                input=test_case['input'],
                max_output_tokens=50
            )
            print(f"✅ SUCCESS: {test_case['name']}")
            print(f"   Response type: {type(response)}")
            if hasattr(response, 'output'):
                print(f"   Output length: {len(response.output) if response.output else 0}")
                for i, output_item in enumerate(response.output):
                    print(f"   Output {i}: {type(output_item)} - {getattr(output_item, 'type', 'no type')}")
        except Exception as e:
            print(f"❌ FAILED: {test_case['name']}")
            print(f"   Error: {e}")

if __name__ == "__main__":
    test_input_parameter()
