#!/usr/bin/env python3
"""
Test responses.create() parameters specifically
"""

import os
from dotenv import load_dotenv
from openai import OpenAI

# Load environment variables
load_dotenv()

def test_responses_parameters():
    """Test what parameters responses.create() accepts"""
    
    client = OpenAI()
    
    print("Testing responses.create() parameters...")
    
    # Test different parameter combinations
    test_cases = [
        {
            "name": "Basic parameters",
            "params": {
                "model": "gpt-4o-mini",
                "instructions": "Hello",
                "input": [{"role": "user", "content": "Hello"}]
            }
        },
        {
            "name": "With max_output_tokens",
            "params": {
                "model": "gpt-4o-mini",
                "instructions": "Hello",
                "input": [{"role": "user", "content": "Hello"}],
                "max_output_tokens": 100
            }
        },
        {
            "name": "With max_completion_tokens",
            "params": {
                "model": "gpt-4o-mini",
                "instructions": "Hello",
                "input": [{"role": "user", "content": "Hello"}],
                "max_completion_tokens": 100
            }
        },
        {
            "name": "With max_tokens",
            "params": {
                "model": "gpt-4o-mini",
                "instructions": "Hello",
                "input": [{"role": "user", "content": "Hello"}],
                "max_tokens": 100
            }
        },
        {
            "name": "With temperature",
            "params": {
                "model": "gpt-4o-mini",
                "instructions": "Hello",
                "input": [{"role": "user", "content": "Hello"}],
                "temperature": 0
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
                print(f"   Has output: {bool(response.output)}")
        except Exception as e:
            print(f"❌ FAILED: {test_case['name']}")
            print(f"   Error: {e}")

if __name__ == "__main__":
    test_responses_parameters()
