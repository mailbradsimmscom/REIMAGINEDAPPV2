#!/usr/bin/env python3
"""
Test what parameters gpt-5 supports with responses.create()
"""

import os
from dotenv import load_dotenv
from openai import OpenAI

# Load environment variables
load_dotenv()

def test_gpt5_parameters():
    """Test what parameters gpt-5 supports with responses.create()"""
    
    client = OpenAI()
    
    print("Testing gpt-5 parameters with responses.create()...")
    
    # Test different parameter combinations
    test_cases = [
        {
            "name": "Basic parameters only",
            "params": {
                "model": "gpt-5",
                "instructions": "Hello",
                "input": [{"role": "user", "content": "Hello"}]
            }
        },
        {
            "name": "With max_output_tokens",
            "params": {
                "model": "gpt-5",
                "instructions": "Hello",
                "input": [{"role": "user", "content": "Hello"}],
                "max_output_tokens": 100
            }
        },
        {
            "name": "With temperature",
            "params": {
                "model": "gpt-5",
                "instructions": "Hello",
                "input": [{"role": "user", "content": "Hello"}],
                "temperature": 0
            }
        },
        {
            "name": "With max_tokens",
            "params": {
                "model": "gpt-5",
                "instructions": "Hello",
                "input": [{"role": "user", "content": "Hello"}],
                "max_tokens": 100
            }
        },
        {
            "name": "With max_completion_tokens",
            "params": {
                "model": "gpt-5",
                "instructions": "Hello",
                "input": [{"role": "user", "content": "Hello"}],
                "max_completion_tokens": 100
            }
        },
        {
            "name": "With response_format",
            "params": {
                "model": "gpt-5",
                "instructions": "Hello",
                "input": [{"role": "user", "content": "Hello"}],
                "response_format": {"type": "json_object"}
            }
        },
        {
            "name": "With metadata",
            "params": {
                "model": "gpt-5",
                "instructions": "Hello",
                "input": [{"role": "user", "content": "Hello"}],
                "metadata": {"test": "value"}
            }
        }
    ]
    
    for test_case in test_cases:
        print(f"\nTesting: {test_case['name']}")
        try:
            response = client.responses.create(**test_case['params'])
            print(f"✅ SUCCESS: {test_case['name']}")
            print(f"   Response type: {type(response)}")
            if hasattr(response, 'output'):
                print(f"   Output length: {len(response.output) if response.output else 0}")
        except Exception as e:
            print(f"❌ FAILED: {test_case['name']}")
            print(f"   Error: {e}")

if __name__ == "__main__":
    test_gpt5_parameters()
