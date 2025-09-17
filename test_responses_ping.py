#!/usr/bin/env python3
"""
Test responses.create() to see what it supports and get a reply
"""

import os
from dotenv import load_dotenv
from openai import OpenAI

# Load environment variables
load_dotenv()

def test_responses_create():
    """Test responses.create() and see what it supports"""
    
    client = OpenAI()
    
    print("Testing responses.create() with gpt-5...")
    
    try:
        response = client.responses.create(
            model="gpt-5",
            instructions="Hello, respond with 'API test successful'",
            input=[{"role": "user", "content": "Test message"}],
            max_output_tokens=100
        )
        
        print("✅ SUCCESS: Got response from responses.create()")
        print(f"Response type: {type(response)}")
        
        if hasattr(response, 'output') and response.output:
            print(f"Output length: {len(response.output)}")
            for i, output_item in enumerate(response.output):
                print(f"Output {i}: {type(output_item)}")
                if hasattr(output_item, 'type'):
                    print(f"  Type: {output_item.type}")
                if hasattr(output_item, 'content'):
                    print(f"  Content: {output_item.content}")
        
        print("\n" + "="*50)
        print("RESPONSE SUCCESSFUL - STOPPING HERE")
        print("="*50)
        
    except Exception as e:
        print(f"❌ FAILED: {e}")
        print(f"Error type: {type(e)}")

if __name__ == "__main__":
    test_responses_create()
