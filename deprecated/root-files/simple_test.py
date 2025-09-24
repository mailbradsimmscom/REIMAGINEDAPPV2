#!/usr/bin/env python3
"""
Simple test to check OpenAI API connectivity
"""

import os
from dotenv import load_dotenv
from openai import OpenAI

# Load environment variables
load_dotenv()

def test_basic_api():
    """Test basic OpenAI API call"""
    
    # Initialize OpenAI client
    client = OpenAI()
    
    print("Testing basic OpenAI API call...")
    
    try:
        # Simple test call
        response = client.responses.create(
            model="gpt-4o-mini",  # Use a known working model
            input="Hello, can you respond with just 'API working'?",
            max_output_tokens=10
        )
        
        print("✅ API call successful!")
        print(f"Response: {response}")
        
        if response.output and len(response.output) > 0:
            content = response.output[0].content[0].text
            print(f"Content: {content}")
        
    except Exception as e:
        print(f"❌ API call failed: {e}")
        print(f"Error type: {type(e)}")

if __name__ == "__main__":
    test_basic_api()
