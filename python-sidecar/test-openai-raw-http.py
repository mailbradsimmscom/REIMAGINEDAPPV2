#!/usr/bin/env python3
"""
One-time test script using RAW HTTP to send exact JSON format
"""

import os
import sys
import asyncio
import json
from dotenv import load_dotenv

# Load environment
load_dotenv('../.env')

# Import httpx for async HTTP
try:
    import httpx
    print("✅ httpx library loaded")
except ImportError:
    print("❌ httpx library not found. Install with: pip install httpx")
    sys.exit(1)

# Get API key
api_key = os.getenv('OPENAI_API_KEY')
if not api_key:
    print("❌ OPENAI_API_KEY not found in .env")
    sys.exit(1)

print(f"✅ API key loaded: {api_key[:20]}...")

# The exact prompt content we're using
SYSTEM_MESSAGE = "You are a helpful marine equipment expert assistant with an optimistic, curious, and people-focused personality. You're a critical thinker but positive. You believe that with hard work and cheerful resilience, you can make a real difference. Bring this positive, can-do spirit to your responses while staying grounded in technical facts."

USER_MESSAGE = """USER QUESTION: "tell me about my DST810"

EQUIPMENT IN USER'S INVENTORY:
- Airmar DST810
  OWNERSHIP: POSSIBLE - This equipment may be owned by the user (confidence: 0.00)

CONVERSATION HISTORY (if available):
No previous conversation context.

RELEVANT TECHNICAL DATA FROM DIP TABLES:
No relevant technical data found.

RELEVANT DOCUMENTS FROM KNOWLEDGE BASE:
No relevant documents found in knowledge base.

QUERY INTENT: general_information


FORMAT REQUIREMENTS:
1. NO stage directions or action descriptions (no "*brightens up*", "*smiles*", etc.)
2. First paragraph MUST be conversational technical context from DIP/Vector data - prefix with 📊 icon
3. If the query asks for steps/procedures/how-to, the second section MUST extract and list those steps explicitly - prefix with 🔧 icon. They should be numbered and clear.
4. Third section can include world knowledge and context - prefix with 💡 icon (not yet implemented)
5. Use actual numbers and specifications from the technical data provided
6. Be conversational but precise in context paragraphs
7. Be direct and verbatim when listing procedural steps
8. Keep paragraphs focused and scannable

Generate your response now using the technical data provided:"""


async def test_openai_raw_http():
    """Test OpenAI request with RAW HTTP and exact JSON format"""

    print("\n" + "="*80)
    print("🚀 TESTING OPENAI WITH RAW HTTP REQUEST (EXACT JSON FORMAT)")
    print("="*80 + "\n")

    # Build request body in EXACT format specified
    request_body = {
        "model": "gpt-5.1-chat-latest",
        "messages": [
            {"role": "system", "content": SYSTEM_MESSAGE},
            {"role": "user", "content": USER_MESSAGE}
        ],
        "max_completion_tokens": 8000,
        "temperature": 1,
        "stream": False
    }

    print("📋 REQUEST BODY (EXACT JSON):")
    print(json.dumps(request_body, indent=2))
    print()

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}"
    }

    url = "https://api.openai.com/v1/chat/completions"

    try:
        print(f"⏳ Sending POST to {url}...")
        import time
        start = time.time()

        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                url,
                json=request_body,
                headers=headers
            )

        duration = time.time() - start
        print(f"✅ Response received in {duration:.2f}s")
        print(f"📊 Status code: {response.status_code}\n")

        if response.status_code == 200:
            result = response.json()

            print("="*80)
            print("📄 RESPONSE")
            print("="*80)
            print(result['choices'][0]['message']['content'])
            print()

            print("="*80)
            print("📊 USAGE STATS")
            print("="*80)
            print(f"Model: {result.get('model', 'N/A')}")
            print(f"Prompt tokens: {result['usage']['prompt_tokens']}")
            print(f"Completion tokens: {result['usage']['completion_tokens']}")
            print(f"Total tokens: {result['usage']['total_tokens']}")
            print(f"Duration: {duration:.2f}s")
            print()

            return True
        else:
            print("="*80)
            print("❌ ERROR RESPONSE")
            print("="*80)
            print(f"Status: {response.status_code}")
            print(f"Body: {response.text}")
            print()
            return False

    except Exception as e:
        print(f"❌ ERROR: {e}")
        print(f"Error type: {type(e).__name__}")
        import traceback
        traceback.print_exc()
        return False


if __name__ == "__main__":
    result = asyncio.run(test_openai_raw_http())
    sys.exit(0 if result else 1)
