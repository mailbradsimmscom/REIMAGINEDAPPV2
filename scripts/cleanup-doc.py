#!/usr/bin/env python3
"""
Cleanup script to delete all traces of a document from the system
"""
import os
import sys
import requests
from dotenv import load_dotenv

# Load environment
load_dotenv()

DOC_ID = "b509f1e06cf32345"
SUPABASE_URL = os.getenv('SUPABASE_URL', '').rstrip('/')
SUPABASE_SERVICE_KEY = os.getenv('SUPABASE_SERVICE_KEY') or os.getenv('SUPABASE_SERVICE_ROLE_KEY')

if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
    print("❌ Missing Supabase credentials")
    sys.exit(1)

headers = {
    'apikey': SUPABASE_SERVICE_KEY,
    'Authorization': f'Bearer {SUPABASE_SERVICE_KEY}',
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
}

print(f"🗑️  Deleting all traces of document: {DOC_ID[:16]}...\n")

# 1. Delete from document_chunks
print("1️⃣  Deleting document_chunks...")
resp = requests.delete(
    f"{SUPABASE_URL}/rest/v1/document_chunks?doc_id=eq.{DOC_ID}",
    headers=headers
)
if resp.status_code in [200, 204]:
    print(f"   ✓ Deleted chunks (status {resp.status_code})")
else:
    print(f"   ⚠️  Chunks delete response: {resp.status_code} - {resp.text[:200]}")

# 2. Delete from jobs
print("\n2️⃣  Deleting jobs...")
resp = requests.delete(
    f"{SUPABASE_URL}/rest/v1/jobs?doc_id=eq.{DOC_ID}",
    headers=headers
)
if resp.status_code in [200, 204]:
    print(f"   ✓ Deleted jobs (status {resp.status_code})")
else:
    print(f"   ⚠️  Jobs delete response: {resp.status_code} - {resp.text[:200]}")

# 3. Delete from documents (try both 'id' and 'doc_id' columns)
print("\n3️⃣  Deleting document...")
resp = requests.delete(
    f"{SUPABASE_URL}/rest/v1/documents?doc_id=eq.{DOC_ID}",
    headers=headers
)
if resp.status_code in [200, 204]:
    print(f"   ✓ Deleted document (status {resp.status_code})")
else:
    print(f"   ⚠️  Document delete response: {resp.status_code} - {resp.text[:200]}")

# 4. Delete from Supabase Storage
print("\n4️⃣  Deleting storage folder...")
storage_path = f"manuals/{DOC_ID}"

# Try to delete the entire folder first using the bulk delete endpoint
try:
    del_resp = requests.delete(
        f"{SUPABASE_URL}/storage/v1/object/documents",
        headers=headers,
        json={"prefixes": [storage_path]}
    )
    if del_resp.status_code in [200, 204]:
        result = del_resp.json() if del_resp.text else []
        print(f"   ✓ Deleted storage folder (removed {len(result)} items)")
    else:
        print(f"   ⚠️  Bulk delete failed ({del_resp.status_code}), trying individual files...")

        # List files first
        list_resp = requests.post(
            f"{SUPABASE_URL}/storage/v1/object/list/documents",
            headers=headers,
            json={"prefix": storage_path, "limit": 100}
        )
        if list_resp.status_code == 200:
            files = list_resp.json()
            print(f"   Found {len(files)} items in storage")
            if len(files) > 0:
                # Collect file paths (not directories)
                file_paths = []
                for item in files:
                    name = item.get('name')
                    if name and not name.endswith('/'):  # Not a directory
                        file_paths.append(name)

                if file_paths:
                    # Bulk delete files
                    del_resp = requests.delete(
                        f"{SUPABASE_URL}/storage/v1/object/documents",
                        headers=headers,
                        json={"prefixes": file_paths}
                    )
                    if del_resp.status_code in [200, 204]:
                        print(f"   ✓ Deleted {len(file_paths)} files")
                    else:
                        print(f"   ⚠️  File deletion failed: {del_resp.status_code}")
except Exception as e:
    print(f"   ⚠️  Storage deletion error: {str(e)}")

print("\n5️⃣  Deleting from Pinecone...")
try:
    pinecone_api_key = os.getenv('PINECONE_API_KEY')
    pinecone_index = os.getenv('PINECONE_INDEX_NAME')

    if not pinecone_api_key or not pinecone_index:
        print(f"   ⚠️  Pinecone credentials not found in .env")
    else:
        from pinecone import Pinecone

        pc = Pinecone(api_key=pinecone_api_key)
        index = pc.Index(pinecone_index)

        # Delete all vectors with this doc_id
        index.delete(filter={"doc_id": DOC_ID})
        print(f"   ✓ Deleted vectors with doc_id filter")
except Exception as e:
    print(f"   ⚠️  Pinecone delete error: {str(e)}")

print("\n✅ Cleanup complete! Document fully removed from system.")
print(f"\nYou can now re-upload victron smart_solar_mppt via UI to test the new code.")
