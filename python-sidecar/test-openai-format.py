#!/usr/bin/env python3
"""
One-time test script to send OpenAI request in exact format specified
"""

import os
import sys
import asyncio
import json
from dotenv import load_dotenv

# Load environment
load_dotenv('../.env')

# Import OpenAI
try:
    import openai
    print("✅ OpenAI library loaded")
except ImportError:
    print("❌ OpenAI library not found. Install with: pip install openai")
    sys.exit(1)

# Get API key
api_key = os.getenv('OPENAI_API_KEY')
if not api_key:
    print("❌ OPENAI_API_KEY not found in .env")
    sys.exit(1)

print(f"✅ API key loaded: {api_key[:20]}...")

# Initialize client
client = openai.AsyncOpenAI(api_key=api_key)

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


async def test_openai_request():
    """Test OpenAI request with exact format specified"""

    print("\n" + "="*80)
    print("🚀 TESTING OPENAI REQUEST WITH EXACT FORMAT")
    print("="*80 + "\n")

    # Build request in EXACT format specified
    request_params = {
        "model": "gpt-5.1-chat-latest",
        "messages": [
            {"role": "system", "content": SYSTEM_MESSAGE},
            {"role": "user", "content": USER_MESSAGE}
        ],
        "max_tokens": 8000,
        "temperature": 0.3,
        "stream": False,
        "reasoning.effort": "none"
    }

    print("📋 REQUEST PARAMETERS:")
    print(json.dumps(request_params, indent=2, default=str))
    print()

    try:
        print("⏳ Sending request to OpenAI...")
        import time
        start = time.time()

        response = await client.chat.completions.create(**request_params)

        duration = time.time() - start
        print(f"✅ Request completed in {duration:.2f}s\n")

        print("="*80)
        print("📄 RESPONSE")
        print("="*80)
        print(response.choices[0].message.content)
        print()

        print("="*80)
        print("📊 USAGE STATS")
        print("="*80)
        print(f"Model: {response.model}")
        print(f"Prompt tokens: {response.usage.prompt_tokens}")
        print(f"Completion tokens: {response.usage.completion_tokens}")
        print(f"Total tokens: {response.usage.total_tokens}")
        print(f"Duration: {duration:.2f}s")
        print()

        return True

    except Exception as e:
        print(f"❌ ERROR: {e}")
        print(f"Error type: {type(e).__name__}")
        import traceback
        traceback.print_exc()
        return False


if __name__ == "__main__":
    result = asyncio.run(test_openai_request())
    sys.exit(0 if result else 1)
