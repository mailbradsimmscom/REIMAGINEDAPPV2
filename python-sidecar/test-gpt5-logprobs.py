#!/usr/bin/env python3
"""
GPT-5.1 Logprobs Test Suite
Tests logprobs parameter with production payload

Based on findings:
- reasoning/text parameters don't exist in Python library
- Current working config: temp=1, max_completion_tokens=8000
- Now testing: logprobs parameter

logprobs options:
- None/False: No logprobs (baseline)
- True: Include logprobs
- Integer (1-5): Number of top logprobs to return
"""

import os
import sys
import asyncio
import json
from datetime import datetime
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

# Initialize client
client = openai.AsyncOpenAI(api_key=api_key)

# ============================================================================
# REALISTIC PRODUCTION PAYLOAD (Same as previous test)
# ============================================================================

PERSONALITY_TRAITS = """You are a helpful marine equipment expert assistant with an optimistic, curious, and people-focused personality. You're a critical thinker but positive. You believe that with hard work and cheerful resilience, you can make a real difference. Bring this positive, can-do spirit to your responses while staying grounded in technical facts."""

EQUIPMENT_CONTEXT = """- Airmar DST810 Smart Multisensor
  Description: Smart™ Multisensor with Gen2 Paddlewheel - Depth, Speed, Temperature
  OWNERSHIP: LIKELY - This equipment is likely owned by the user (confidence: 0.83)
- B&G DST810
  Description: DST810 Smart Multisensor
  OWNERSHIP: POSSIBLE - This equipment may be owned by the user (confidence: 0.65)"""

CONVERSATION_SUMMARY = "No previous conversation context."

DIP_CONTEXT = "No relevant technical data found."

PINECONE_CONTEXT = """Found 5 relevant documents:

1. CE Regulation: Complies to IERC60945 # DST810 CONFIGURATION (relevance: 0.71)
   Type: PINECONE
   Content: CE Regulation: Complies to IERC60945 # DST810 CONFIGURATION ## CAST App With DST810 Use the Airmar CAST app to configure your DST810 sensor. The app connects to the DST810 via Bluetooth® and allows you to update settings, monitor real-time data, calibrate speed, and perform advanced setup. Download from App Store or Google Play.

2. Bluetooth® Enabled NEW ## Smart™ Sensors ### DST810 Smart™ Multisensor with Gen2 Paddlewheel (relevance: 0.66)
   Type: PINECONE
   Content: Bluetooth® Enabled NEW ## Smart™ Sensors ### DST810 Smart™ Multisensor with Gen2 Paddlewheel The DST810 is Airmar's premium depth, speed, and temperature multisensor featuring the Gen2 paddlewheel technology. This smart sensor includes Bluetooth connectivity for wireless configuration and monitoring via the Airmar CAST mobile app."""

QUERY_INTENT = "general_information"

FORMAT_RULES = """
FORMAT REQUIREMENTS:
1. NO stage directions or action descriptions (no "*brightens up*", "*smiles*", etc.)
2. First paragraph MUST be conversational technical context from DIP/Vector data - prefix with 📊 icon
3. Keep paragraphs focused and scannable
"""

SYNTHESIS_INSTRUCTIONS = """
CRITICAL DATA USAGE RULES:
1. You MUST use the technical data provided
2. Cite specific numbers and values from the technical data
3. Show genuine curiosity and enthusiasm about the user's equipment
"""

USER_QUERY = "tell me about my DST810"

FULL_PROMPT = f"""{PERSONALITY_TRAITS}

USER QUESTION: "{USER_QUERY}"

EQUIPMENT IN USER'S INVENTORY:
{EQUIPMENT_CONTEXT}

CONVERSATION HISTORY (if available):
{CONVERSATION_SUMMARY}

RELEVANT TECHNICAL DATA FROM DIP TABLES:
{DIP_CONTEXT}

RELEVANT DOCUMENTS FROM KNOWLEDGE BASE:
{PINECONE_CONTEXT}

QUERY INTENT: {QUERY_INTENT}

{FORMAT_RULES}

{SYNTHESIS_INSTRUCTIONS}

Generate your response now using the technical data provided:"""

# ============================================================================
# TEST CONFIGURATIONS - LOGPROBS EXPLORATION
# ============================================================================

class TestConfig:
    def __init__(self, name, model, params):
        self.name = name
        self.model = model
        self.params = params

TEST_CONFIGS = [
    TestConfig(
        name="BASELINE: No logprobs (Current Production)",
        model="gpt-5.1-chat-latest",
        params={
            "temperature": 1,
            "max_completion_tokens": 8000,
            # NO logprobs
        }
    ),

    TestConfig(
        name="logprobs=True (Boolean)",
        model="gpt-5.1-chat-latest",
        params={
            "temperature": 1,
            "max_completion_tokens": 8000,
            "logprobs": True,
        }
    ),

    TestConfig(
        name="top_logprobs=1 (Minimal)",
        model="gpt-5.1-chat-latest",
        params={
            "temperature": 1,
            "max_completion_tokens": 8000,
            "logprobs": True,
            "top_logprobs": 1,
        }
    ),

    TestConfig(
        name="top_logprobs=3 (Moderate)",
        model="gpt-5.1-chat-latest",
        params={
            "temperature": 1,
            "max_completion_tokens": 8000,
            "logprobs": True,
            "top_logprobs": 3,
        }
    ),

    TestConfig(
        name="top_logprobs=5 (Maximum)",
        model="gpt-5.1-chat-latest",
        params={
            "temperature": 1,
            "max_completion_tokens": 8000,
            "logprobs": True,
            "top_logprobs": 5,
        }
    ),
]

# ============================================================================
# TEST EXECUTION
# ============================================================================

async def run_test(config: TestConfig, test_num: int, total_tests: int):
    """Run a single test with production-level payload"""

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
            {"role": "system", "content": PERSONALITY_TRAITS},
            {"role": "user", "content": FULL_PROMPT.replace(PERSONALITY_TRAITS, "").strip()}
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
        "response_preview": "",
        "has_logprobs": False,
        "logprobs_sample": None
    }

    try:
        print("⏳ Sending request with logprobs config...")
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

        # Check if logprobs were returned
        if hasattr(response.choices[0], 'logprobs') and response.choices[0].logprobs:
            result["has_logprobs"] = True
            # Extract sample logprobs data
            logprobs_data = response.choices[0].logprobs
            if hasattr(logprobs_data, 'content') and logprobs_data.content:
                # Get first token's logprobs as sample
                first_token = logprobs_data.content[0] if logprobs_data.content else None
                if first_token:
                    result["logprobs_sample"] = {
                        "token": first_token.token if hasattr(first_token, 'token') else None,
                        "logprob": first_token.logprob if hasattr(first_token, 'logprob') else None,
                        "top_logprobs_count": len(first_token.top_logprobs) if hasattr(first_token, 'top_logprobs') and first_token.top_logprobs else 0
                    }

        # Print results
        print(f"✅ SUCCESS in {duration:.2f}s ({duration*1000:.0f}ms)")
        print(f"📊 Tokens: {response.usage.prompt_tokens} prompt + {response.usage.completion_tokens} completion = {response.usage.total_tokens} total")
        print(f"📝 Response length: {len(content)} characters")
        print(f"🚀 Speed: {len(content)/duration:.0f} chars/sec, {response.usage.completion_tokens/duration:.1f} tokens/sec")

        if result["has_logprobs"]:
            print(f"📈 Logprobs: INCLUDED")
            if result["logprobs_sample"]:
                print(f"   Sample token: '{result['logprobs_sample']['token']}'")
                print(f"   Logprob value: {result['logprobs_sample']['logprob']}")
                print(f"   Top alternatives: {result['logprobs_sample']['top_logprobs_count']}")
        else:
            print(f"📈 Logprobs: NOT INCLUDED")

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
    """Run all logprobs tests"""

    print("\n" + "="*80)
    print("🚀 GPT-5.1 LOGPROBS TEST SUITE")
    print("="*80)
    print(f"Testing logprobs parameter variations")
    print(f"Configurations: {len(TEST_CONFIGS)}")
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
    print("📊 LOGPROBS COMPARISON REPORT")
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
            print(f"   ⏱️  Duration: {result['duration_seconds']:.2f}s ({duration_ms:.0f}ms)")
            print(f"   📊 Tokens: {result['tokens_used'].get('total', 0):,}")
            print(f"   📈 Logprobs: {'YES' if result['has_logprobs'] else 'NO'}")

            if result['has_logprobs'] and result['logprobs_sample']:
                print(f"   📋 Top alternatives: {result['logprobs_sample']['top_logprobs_count']}")

            # Calculate speed metrics
            if result['duration_seconds'] > 0:
                tokens_per_sec = result['tokens_used'].get('completion', 0) / result['duration_seconds']
                print(f"   🚀 Speed: {tokens_per_sec:.1f} tokens/sec")

            print()

    if failed_results:
        print("❌ FAILED TESTS:")
        print()
        for result in failed_results:
            print(f"• {result['name']}")
            print(f"  Error: {result['error']}")
            print()

    # Analyze logprobs impact
    if successful_results:
        baseline = next((r for r in successful_results if "BASELINE" in r['name']), None)
        with_logprobs = [r for r in successful_results if r['has_logprobs']]

        if baseline and with_logprobs:
            print("="*80)
            print("📈 LOGPROBS IMPACT ANALYSIS")
            print("="*80)
            baseline_time = baseline['duration_seconds']

            for r in with_logprobs:
                time_diff = r['duration_seconds'] - baseline_time
                percent_diff = (time_diff / baseline_time) * 100

                print(f"\n{r['name']}")
                print(f"  Baseline time: {baseline_time:.2f}s")
                print(f"  With logprobs: {r['duration_seconds']:.2f}s")
                print(f"  Difference: {time_diff:+.2f}s ({percent_diff:+.1f}%)")

                if r['logprobs_sample']:
                    print(f"  Top alternatives: {r['logprobs_sample']['top_logprobs_count']}")

    # Find fastest
    if successful_results:
        fastest = successful_results[0]
        print("\n" + "="*80)
        print("🏆 FASTEST CONFIGURATION")
        print("="*80)
        print(f"Name: {fastest['name']}")
        print(f"Duration: {fastest['duration_seconds']:.2f}s ({fastest['duration_seconds']*1000:.0f}ms)")
        print(f"Has logprobs: {fastest['has_logprobs']}")
        print(f"Params: {json.dumps(fastest['params'], indent=2)}")
        print()

    # Save results
    output_file = "test-results-logprobs.json"
    with open(output_file, 'w') as f:
        json.dump({
            "timestamp": datetime.now().isoformat(),
            "test_type": "logprobs_exploration",
            "total_tests": len(TEST_CONFIGS),
            "successful": len(successful_results),
            "failed": len(failed_results),
            "results": results
        }, f, indent=2)

    print(f"💾 Results saved to: {output_file}")
    print()

    return 0 if len(failed_results) == 0 else 1


if __name__ == "__main__":
    exit_code = asyncio.run(main())
    sys.exit(exit_code)
