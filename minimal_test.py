#!/usr/bin/env python3
"""
Minimal test to isolate the issue
"""

import os
from dotenv import load_dotenv

print("1. Starting...")
load_dotenv()
print("2. Environment loaded")

import requests
print("3. Requests imported")

from openai import OpenAI
print("4. OpenAI imported")

# Test Supabase connection
supabase_url = os.getenv('SUPABASE_URL')
supabase_key = os.getenv('SUPABASE_SERVICE_KEY') or os.getenv('SUPABASE_SERVICE_ROLE_KEY')

print("5. Supabase config loaded")

url = supabase_url.rstrip('/')
headers = {
    'apikey': supabase_key,
    'Authorization': f'Bearer {supabase_key}'
}

doc_id = '759ac8ff51c98c10358e2c0604c1ca73cf975023949d6e122f9af6e8cb32f061'

print("6. About to make Supabase request...")

response = requests.get(
    f'{url}/rest/v1/document_chunks',
    headers=headers,
    params={'doc_id': f'eq.{doc_id}', 'select': 'text', 'limit': '1'}
)

print(f"7. Supabase response: {response.status_code}")

if response.status_code == 200:
    chunks = response.json()
    print(f"8. Got {len(chunks)} chunks")
    
    if chunks:
        text = chunks[0]['text']
        print(f"9. First chunk: {text[:50]}...")
        
        # Test OpenAI
        print("10. Testing OpenAI...")
        client = OpenAI()
        
        response = client.chat.completions.create(
            model='gpt-4.1',
            messages=[
                {'role': 'system', 'content': 'You are a helpful assistant.'},
                {'role': 'user', 'content': f'Extract procedures from: {text[:200]}'}
            ],
            max_tokens=100
        )
        
        print("11. OpenAI call successful!")
        print(f"12. Response: {response.choices[0].message.content}")
        
else:
    print(f"Error: {response.text}")

print("13. Done!")
