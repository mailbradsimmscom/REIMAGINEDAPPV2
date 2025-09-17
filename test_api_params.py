#!/usr/bin/env python3
"""
Test OpenAI API parameters to understand what's supported
"""

import os
from dotenv import load_dotenv
from openai import OpenAI

# Load environment variables
load_dotenv()

def test_api_parameters():
    """Test what parameters the OpenAI API accepts"""
    
    client = OpenAI()
    
    print("Testing OpenAI API parameters...")
    print(f"Model: {os.getenv('OPENAI_MODEL', 'gpt-4-turbo')}")
    
    # Test 1: Check if responses API exists
    print("\n1. Testing if responses API exists...")
    try:
        # Just check if the method exists
        if hasattr(client, 'responses'):
            print("✅ responses API exists")
            if hasattr(client.responses, 'create'):
                print("✅ responses.create() method exists")
            else:
                print("❌ responses.create() method does not exist")
        else:
            print("❌ responses API does not exist")
    except Exception as e:
        print(f"❌ Error checking responses API: {e}")
    
    # Test 2: Check what parameters chat.completions.create accepts
    print("\n2. Testing chat.completions.create parameters...")
    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",  # Use a known working model
            messages=[{"role": "user", "content": "Hello"}],
            max_tokens=10
        )
        print("✅ chat.completions.create works with max_tokens")
    except Exception as e:
        print(f"❌ chat.completions.create error: {e}")
    
    # Test 3: Check what parameters responses.create accepts (if it exists)
    print("\n3. Testing responses.create parameters...")
    try:
        if hasattr(client, 'responses') and hasattr(client.responses, 'create'):
            # Try minimal parameters
            response = client.responses.create(
                model="gpt-4o-mini",
                instructions="Hello",
                input=[{"role": "user", "content": "Hello"}]
            )
            print("✅ responses.create works with minimal parameters")
        else:
            print("❌ responses.create not available")
    except Exception as e:
        print(f"❌ responses.create error: {e}")
    
    # Test 4: Check available models
    print("\n4. Checking available models...")
    try:
        models = client.models.list()
        available_models = [model.id for model in models.data]
        print(f"Available models: {available_models[:10]}...")  # Show first 10
        
        # Check for specific models
        for model_name in ["gpt-4", "gpt-4-turbo", "gpt-4o", "gpt-4o-mini", "gpt-5"]:
            if model_name in available_models:
                print(f"✅ {model_name} is available")
            else:
                print(f"❌ {model_name} is not available")
                
    except Exception as e:
        print(f"❌ Error listing models: {e}")

if __name__ == "__main__":
    test_api_parameters()
