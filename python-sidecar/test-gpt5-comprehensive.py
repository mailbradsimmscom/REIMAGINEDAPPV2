#!/usr/bin/env python3
"""
Comprehensive GPT-5.1 Test Suite
Tests multiple configurations side-by-side to find optimal settings

Tests:
1. GPT-5 vs GPT-5.1-chat-latest (model comparison)
2. Different reasoning_effort values (if supported)
3. Different temperature values
4. Different max_tokens values
5. System/User message split vs combined

Usage:
    python test-gpt5-comprehensive.py
"""

import os
import sys
import asyncio
import json
from datetime import datetime
from dotenv import load_dotenv
from pathlib import Path

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

# Initialize client
client = openai.AsyncOpenAI(api_key=api_key)

# Test prompt (actual synthesis prompt from app)
SYSTEM_MESSAGE = "You are a helpful marine equipment expert assistant with an optimistic, curious, and people-focused personality. You're a critical thinker but positive. You believe that with hard work and cheerful resilience, you can make a real difference. Bring this positive, can-do spirit to your responses while staying grounded in technical facts."

USER_MESSAGE = """USER QUESTION: "tell me about my DST810"

EQUIPMENT IN USER'S INVENTORY:
- Airmar DST810
  OWNERSHIP: POSSIBLE - This equipment may be owned by the user (confidence: 0.83)

CONVERSATION HISTORY (if available):
No previous conversation context.

RELEVANT TECHNICAL DATA FROM DIP TABLES:
No relevant technical data found.

RELEVANT DOCUMENTS FROM KNOWLEDGE BASE:
1. DST810 Smart™ Multisensor with Gen2 Paddlewheel - Airmar Technology Corporation
2. CE Regulation: Complies to IERC60945 # DST810 CONFIGURATION

QUERY INTENT: general_information

FORMAT REQUIREMENTS:
1. NO stage directions or action descriptions (no "*brightens up*", "*smiles*", etc.)
2. First paragraph MUST be conversational technical context from DIP/Vector data - prefix with 📊 icon
3. If the query asks for steps/procedures/how-to, the second section MUST extract and list those steps explicitly - prefix with 🔧 icon. They should be numbered and clear.
4. Use actual numbers and specifications from the technical data provided
5. Be conversational but precise in context paragraphs
6. Keep paragraphs focused and scannable

Generate your response now using the technical data provided:"""


class TestConfig:
    """Configuration for a single test"""
    def __init__(self, name, model, params):
        self.name = name
        self.model = model
        self.params = params


# Define test configurations
TEST_CONFIGS = [
    # GPT-5.1 Configurations (RECOMMENDED)
    TestConfig(
        name="GPT-5.1 Optimized (RECOMMENDED)",
        model="gpt-5.1-chat-latest",
        params={
            "temperature": 1,  # Only supported value
            "max_completion_tokens": 8000,
            # NO reasoning_effort - not supported
        }
    ),

    TestConfig(
        name="GPT-5.1 Lower Tokens",
        model="gpt-5.1-chat-latest",
        params={
            "temperature": 1,
            "max_completion_tokens": 4000,
        }
    ),

    # GPT-5 Configurations (OLD - SLOW)
    TestConfig(
        name="GPT-5 with reasoning=medium (OLD - BROKEN)",
        model="gpt-5",
        params={
            "reasoning_effort": "medium",  # NOT SUPPORTED - will fail
            "max_completion_tokens": 8000,
        }
    ),

    TestConfig(
        name="GPT-5 with temperature=1",
        model="gpt-5",
        params={
            "temperature": 1,
            "max_completion_tokens": 8000,
        }
    ),

    # GPT-4.1-mini for comparison
    TestConfig(
        name="GPT-4.1-mini (FASTEST)",
        model="gpt-4.1-mini",
        params={
            "temperature": 0,
            "max_completion_tokens": 4000,
        }
    ),
]


async def run_test(config: TestConfig, test_num: int, total_tests: int):
    """Run a single test configuration"""

    print("\n" + "="*80)
    print(f"🧪 TEST {test_num}/{total_tests}: {config.name}")
    print("="*80)
    print(f"Model: {config.model}")
    print(f"Params: {json.dumps(config.params, indent=2)}")
    print()

    # Build request parameters
    request_params = {
        "model": config.model,
        "messages": [
            {"role": "system", "content": SYSTEM_MESSAGE},
            {"role": "user", "content": USER_MESSAGE}
        ],
        "stream": False,
        **config.params
    }

    result = {
        "name": config.name,
        "model": config.model,
        "params": config.params,
        "success": False,
        "duration_seconds": 0,
        "error": None,
        "response_length": 0,
        "tokens_used": {},
        "response_preview": ""
    }

    try:
        print("⏳ Sending request...")
        start_time = datetime.now()

        response = await client.chat.completions.create(**request_params)

        end_time = datetime.now()
        duration = (end_time - start_time).total_seconds()

        # Extract results
        content = response.choices[0].message.content
        result["success"] = True
        result["duration_seconds"] = duration
        result["response_length"] = len(content)
        result["tokens_used"] = {
            "prompt": response.usage.prompt_tokens,
            "completion": response.usage.completion_tokens,
            "total": response.usage.total_tokens
        }
        result["response_preview"] = content[:200] + "..." if len(content) > 200 else content

        # Print results
        print(f"✅ SUCCESS in {duration:.2f}s ({duration*1000:.0f}ms)")
        print(f"📊 Tokens: {response.usage.prompt_tokens} prompt + {response.usage.completion_tokens} completion = {response.usage.total_tokens} total")
        print(f"📝 Response length: {len(content)} characters")
        print()
        print("Response preview:")
        print(content[:300] + ("..." if len(content) > 300 else ""))

    except Exception as e:
        duration = (datetime.now() - start_time).total_seconds() if 'start_time' in locals() else 0
        result["duration_seconds"] = duration
        result["error"] = str(e)

        print(f"❌ FAILED after {duration:.2f}s")
        print(f"Error: {e}")
        print(f"Error type: {type(e).__name__}")

    return result


async def main():
    """Run all tests and generate comparison report"""

    print("\n" + "="*80)
    print("🚀 GPT-5.1 COMPREHENSIVE TEST SUITE")
    print("="*80)
    print(f"Testing {len(TEST_CONFIGS)} configurations")
    print(f"API Key: {api_key[:20]}...")
    print()

    # Run all tests
    results = []
    for i, config in enumerate(TEST_CONFIGS, 1):
        result = await run_test(config, i, len(TEST_CONFIGS))
        results.append(result)

        # Small delay between tests
        if i < len(TEST_CONFIGS):
            print("\n⏸️  Waiting 2 seconds before next test...")
            await asyncio.sleep(2)

    # Generate comparison report
    print("\n\n" + "="*80)
    print("📊 COMPARISON REPORT")
    print("="*80)
    print()

    # Sort by duration (successful tests first)
    successful_results = [r for r in results if r["success"]]
    failed_results = [r for r in results if not r["success"]]

    successful_results.sort(key=lambda x: x["duration_seconds"])

    if successful_results:
        print("✅ SUCCESSFUL TESTS (sorted by speed):")
        print()

        for i, result in enumerate(successful_results, 1):
            duration_ms = result["duration_seconds"] * 1000
            print(f"{i}. {result['name']}")
            print(f"   Model: {result['model']}")
            print(f"   ⏱️  Duration: {result['duration_seconds']:.2f}s ({duration_ms:.0f}ms)")
            print(f"   📊 Tokens: {result['tokens_used'].get('total', 0):,}")
            print(f"   📝 Response: {result['response_length']:,} chars")

            # Calculate speed metrics
            if result['duration_seconds'] > 0:
                chars_per_sec = result['response_length'] / result['duration_seconds']
                tokens_per_sec = result['tokens_used'].get('completion', 0) / result['duration_seconds']
                print(f"   🚀 Speed: {chars_per_sec:.0f} chars/sec, {tokens_per_sec:.1f} tokens/sec")

            print()

    if failed_results:
        print("❌ FAILED TESTS:")
        print()

        for result in failed_results:
            print(f"• {result['name']}")
            print(f"  Model: {result['model']}")
            print(f"  Error: {result['error']}")
            print()

    # Find fastest
    if successful_results:
        fastest = successful_results[0]
        print("="*80)
        print("🏆 FASTEST CONFIGURATION")
        print("="*80)
        print(f"Name: {fastest['name']}")
        print(f"Model: {fastest['model']}")
        print(f"Duration: {fastest['duration_seconds']:.2f}s ({fastest['duration_seconds']*1000:.0f}ms)")
        print(f"Params: {json.dumps(fastest['params'], indent=2)}")
        print()

    # Save results to file
    output_file = "test-results-gpt5.json"
    with open(output_file, 'w') as f:
        json.dump({
            "timestamp": datetime.now().isoformat(),
            "total_tests": len(TEST_CONFIGS),
            "successful": len(successful_results),
            "failed": len(failed_results),
            "results": results
        }, f, indent=2)

    print(f"💾 Results saved to: {output_file}")
    print()

    # Return exit code
    return 0 if len(failed_results) == 0 else 1


if __name__ == "__main__":
    exit_code = asyncio.run(main())
    sys.exit(exit_code)
