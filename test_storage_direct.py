#!/usr/bin/env python3
"""
Direct test of Supabase Storage upload functionality
"""

import os
import json
import requests
from supabase import create_client
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

def test_storage_upload():
    """Test direct storage upload"""
    print("🔍 Testing Supabase Storage upload...")
    
    # Get environment variables
    supabase_url = os.getenv('SUPABASE_URL')
    supabase_key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVyaXF1bmVha2ZjZm1lZWNxeW9mIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NjY1ODE0NywiZXhwIjoyMDcyMjM0MTQ3fQ.wXS2MlxRBqc7aH7KBIpgDh7MxtseLALetoyy1xF_oHU"
    
    print(f"🌐 Supabase URL: {supabase_url}")
    print(f"🔑 Supabase key: {supabase_key[:20]}..." if supabase_key else "None")
    
    if not supabase_url or not supabase_key:
        print("❌ Missing Supabase credentials")
        return False
    
    try:
        # Test REST API directly instead of Python client
        print("🔍 Testing REST API directly...")
        
        headers = {
            'Authorization': f'Bearer {supabase_key}',
            'Content-Type': 'text/plain'
        }
        
        # Test storage upload via REST API
        storage_url = f"{supabase_url}/storage/v1/object/documents/manuals/test.json"
        test_data = '{"test": true, "timestamp": "2025-09-22T20:05:00Z"}'
        
        print(f"📤 Uploading to: {storage_url}")
        print(f"📄 Data: {test_data}")
        
        try:
            response = requests.post(storage_url, headers=headers, data=test_data)
            print(f"📊 REST API result: {response.status_code} - {response.text}")
            
            if response.status_code in [200, 201]:
                print("✅ REST API upload successful!")
                return True
            else:
                print(f"❌ REST API upload failed: {response.status_code}")
                return False
                
        except Exception as rest_e:
            print(f"❌ REST API request failed: {rest_e}")
            return False
        
        
    except Exception as e:
        print(f"❌ Upload failed: {e}")
        return False

if __name__ == "__main__":
    test_storage_upload()
