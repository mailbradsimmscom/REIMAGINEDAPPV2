#!/usr/bin/env python3
"""
GPT-5.1 Production Load Test
Tests with REALISTIC FULL PAYLOAD matching actual production chat

Based on actual chat session showing:
- Query: "tell me about my DST810"
- Equipment: 2 items (Airmar DST810, B&G DST810)
- Pinecone: 5 chunks with real content
- Classification: general_information, complexity 0.50
- DIP: 0 tables

This matches the ACTUAL load sent to OpenAI in production.
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
# REALISTIC PRODUCTION PAYLOAD (Matches actual chat session)
# ============================================================================

PERSONALITY_TRAITS = """You are a helpful marine equipment expert assistant with an optimistic, curious, and people-focused personality. You're a critical thinker but positive. You believe that with hard work and cheerful resilience, you can make a real difference. Bring this positive, can-do spirit to your responses while staying grounded in technical facts."""

# EQUIPMENT CONTEXT (2 items - matches production)
EQUIPMENT_CONTEXT = """- Airmar DST810 Smart Multisensor
  Description: Smart™ Multisensor with Gen2 Paddlewheel - Depth, Speed, Temperature
  OWNERSHIP: LIKELY - This equipment is likely owned by the user (confidence: 0.83)
- B&G DST810
  Description: DST810 Smart Multisensor
  OWNERSHIP: POSSIBLE - This equipment may be owned by the user (confidence: 0.65)"""

# CONVERSATION HISTORY
CONVERSATION_SUMMARY = "No previous conversation context."

# DIP CONTEXT (empty in this case - matches production)
DIP_CONTEXT = "No relevant technical data found."

# PINECONE CONTEXT (5 chunks - matches production with REAL content)
PINECONE_CONTEXT = """Found 5 relevant documents:

1. CE Regulation: Complies to IERC60945 # DST810 CONFIGURATION (relevance: 0.71)
   Type: PINECONE
   Content: CE Regulation: Complies to IERC60945 # DST810 CONFIGURATION ## CAST App With DST810 Use the Airmar CAST app to configure your DST810 sensor. The app connects to the DST810 via Bluetooth® and allows you to update settings, monitor real-time data, calibrate speed, and perform advanced setup. Download from App Store or Google Play. ### Configuration Steps 1. Power on DST810 (LED will flash blue for Bluetooth pairing) 2. Open CAST app on smartphone/tablet 3. Select DST810 from device list 4. Enter pairing code if prompted 5. Configure settings as needed 6. Save configuration to sensor The CAST app provides access to all DST810 configuration parameters including: - Speed calibration factor - Depth offset - Temperature offset - NMEA 2000 device instance - Update rate for depth, speed, temperature - Paddlewheel type selection

2. Bluetooth® Enabled NEW ## Smart™ Sensors ### DST810 Smart™ Multisensor with Gen2 Paddlewheel (relevance: 0.66)
   Type: PINECONE
   Content: Bluetooth® Enabled NEW ## Smart™ Sensors ### DST810 Smart™ Multisensor with Gen2 Paddlewheel The DST810 is Airmar's premium depth, speed, and temperature multisensor featuring the Gen2 paddlewheel technology. This smart sensor includes Bluetooth connectivity for wireless configuration and monitoring via the Airmar CAST mobile app. #### Key Features - Gen2 paddlewheel: Most sensitive and accurate paddlewheel available - Bluetooth Smart® (BLE 5.0) for wireless configuration - NMEA 2000® certified output - Depth range: 0.5 to 200 meters (1.5 to 650 feet) - Speed range: 0 to 45 knots - Temperature range: -10°C to +50°C (14°F to 122°F) - Low power consumption: 25mA typical - Retractable paddlewheel for easy maintenance - Compatible with all major MFD brands

3. The Gen2 paddlewheel is the most sensitive and accurate paddlewheel available for sailing and power (relevance: 0.64)
   Type: PINECONE
   Content: The Gen2 paddlewheel is the most sensitive and accurate paddlewheel available for sailing and power vessels. It features a low-friction design with sapphire bearings that provide exceptional sensitivity at low speeds while remaining accurate at high speeds. The retractable design allows for easy cleaning and maintenance without haul-out. ### Paddlewheel Specifications - Activation speed: 0.15 knots (improved from 0.5 knots) - Accuracy: ±0.1 knots or 2% (whichever is greater) - Maximum speed: 45 knots - Bearing type: Sapphire bearings for long life - Materials: Bronze housing, carbon fiber wheel - Retraction: Tool-free removal from inside boat ### Installation Recommendations - Install in location with smooth water flow - Avoid areas with turbulence from hull fittings - Mount at least 18 inches from other through-hulls - Ensure paddlewheel axis is parallel to centerline - Use marine sealant on all through-hull connections

4. Water will also block a Bluetooth signal, so make sure the device isn't submerged. # NAVIGATING AIR (relevance: 0.59)
   Type: PINECONE
   Content: Water will also block a Bluetooth signal, so make sure the device isn't submerged. # NAVIGATING AIRMAR CAST APP ## Main Dashboard The CAST app opens to the main dashboard showing real-time data from all connected sensors. Each sensor appears as a tile displaying its current readings and status. - Depth displayed in feet or meters - Speed displayed in knots, mph, or km/h - Temperature in °F or °C - Signal strength indicator - Battery level (if applicable) ## Sensor Configuration Tap any sensor tile to access detailed configuration: ### General Settings - Friendly name (customize sensor identification) - Device information (serial number, firmware version) - Network settings (NMEA 2000 instance, update rates) ### Calibration - Speed calibration factor (adjust for propeller slip) - Depth offset (adjust for transducer location) - Temperature offset (sensor calibration) ### Advanced - Paddlewheel sensitivity - Damping settings - Output format options - Bluetooth pairing management

5. If you connect from another device or delete and reinstall the Airmar CAST app on your phone, you'll (relevance: 0.58)
   Type: PINECONE
   Content: If you connect from another device or delete and reinstall the Airmar CAST app on your phone, you'll need to pair again with your DST810. The sensor remembers up to 8 paired devices. To pair a new device: 1. Ensure DST810 is powered on and LED is flashing blue 2. Open CAST app on new device 3. Grant Bluetooth permissions when prompted 4. Select "Add New Sensor" from menu 5. Choose DST810 from available devices list 6. Enter pairing code if required (default: 000000) 7. Wait for connection confirmation Once paired, the app will automatically reconnect when in range. If connection fails, try: - Verify Bluetooth is enabled on mobile device - Ensure DST810 is powered on (check LED) - Move closer to sensor (within 30 feet) - Restart CAST app - Remove and re-pair sensor if issue persists"""

# QUERY INTENT
QUERY_INTENT = "general_information"

# FORMAT RULES
FORMAT_RULES = """
FORMAT REQUIREMENTS:
1. NO stage directions or action descriptions (no "*brightens up*", "*smiles*", etc.)
2. First paragraph MUST be conversational technical context from DIP/Vector data - prefix with 📊 icon
3. If the query asks for steps/procedures/how-to, the second section MUST extract and list those steps explicitly - prefix with 🔧 icon. They should be numbered and clear.
4. Third section can include world knowledge and context - prefix with 💡 icon (not yet implemented)
5. Use actual numbers and specifications from the technical data provided
6. Be conversational but precise in context paragraphs
7. Be direct and verbatim when listing procedural steps
8. Keep paragraphs focused and scannable
"""

# SYNTHESIS INSTRUCTIONS
SYNTHESIS_INSTRUCTIONS = """
CRITICAL DATA USAGE RULES:
1. You MUST use the technical data provided in RELEVANT TECHNICAL DATA and RELEVANT DOCUMENTS sections
2. DO NOT say "I don't have information" if technical data is provided above
3. DO NOT use general knowledge for specifications when DIP data is available
4. Directly answer the question using the specs, procedures, and data shown
5. Cite specific numbers, parameters, and values from the technical data
6. EQUIPMENT IDENTIFICATION IS NON-NEGOTIABLE: NEVER change manufacturer or model from EQUIPMENT IN USER'S INVENTORY - this is ground truth
7. Use documents for technical specifications ONLY, not for equipment identification
8. If documents mention different manufacturers/models, ignore that - stick to inventory data
9. If DIP data contradicts your general knowledge, ALWAYS use the DIP data
10. Show genuine curiosity and enthusiasm about the user's equipment
11. If you spot opportunities for improvement or optimization, mention them positively in the 💡 section

PROCEDURE EXTRACTION RULES:
12. When query asks for steps/procedures/how-to AND documents contain procedures, you MUST include a 🔧 section
13. The 🔧 section must come AFTER the 📊 conversational context paragraph
14. Extract and LIST steps explicitly - DO NOT summarize procedures conversationally
15. Format as numbered lists - preserve section structure from source (e.g., "Preliminary Checks:", "Start-up:")
16. Include all steps verbatim from source documents - do not abbreviate or paraphrase
17. Be direct: Lead with section heading, then list steps immediately
"""

# USER QUERY
USER_QUERY = "tell me about my DST810"

# BUILD FULL PROMPT (Matches production synthesis prompt template)
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
# TEST CONFIGURATIONS
# ============================================================================

class TestConfig:
    def __init__(self, name, model, params):
        self.name = name
        self.model = model
        self.params = params

# ============================================================================
# TEST CONFIGURATIONS - GPT-5.1 PARAMETER EXPLORATION
# ============================================================================
#
# Based on OpenAI documentation for GPT-5.1:
# - reasoning.effort: "none" or "medium" (controls reasoning mode)
# - text.verbosity: "low" or "high" (controls response detail)
# - temperature, top_p, logprobs: ONLY supported when reasoning.effort="none"
#
# ⚠️ CRITICAL: If reasoning.effort != "none", cannot use temperature/top_p/logprobs
#
TEST_CONFIGS = [
    # ========== REASONING EFFORT = "none" (allows temperature) ==========

    TestConfig(
        name="GPT-5.1: reasoning=none, temp=1, verbosity=high (RECOMMENDED)",
        model="gpt-5.1-chat-latest",
        params={
            "reasoning": {"effort": "none"},
            "text": {"verbosity": "high"},
            "temperature": 1,
            "max_completion_tokens": 8000,
        }
    ),

    TestConfig(
        name="GPT-5.1: reasoning=none, temp=1, verbosity=low",
        model="gpt-5.1-chat-latest",
        params={
            "reasoning": {"effort": "none"},
            "text": {"verbosity": "low"},
            "temperature": 1,
            "max_completion_tokens": 8000,
        }
    ),

    TestConfig(
        name="GPT-5.1: reasoning=none, temp=0.7, verbosity=high",
        model="gpt-5.1-chat-latest",
        params={
            "reasoning": {"effort": "none"},
            "text": {"verbosity": "high"},
            "temperature": 0.7,
            "max_completion_tokens": 8000,
        }
    ),

    # ========== REASONING EFFORT = "medium" (NO temperature allowed) ==========

    TestConfig(
        name="GPT-5.1: reasoning=medium, verbosity=high (WILL THIS WORK?)",
        model="gpt-5.1-chat-latest",
        params={
            "reasoning": {"effort": "medium"},
            "text": {"verbosity": "high"},
            # NO temperature - not allowed with reasoning=medium
            "max_completion_tokens": 8000,
        }
    ),

    TestConfig(
        name="GPT-5.1: reasoning=medium, verbosity=low",
        model="gpt-5.1-chat-latest",
        params={
            "reasoning": {"effort": "medium"},
            "text": {"verbosity": "low"},
            # NO temperature - not allowed with reasoning=medium
            "max_completion_tokens": 8000,
        }
    ),

    # ========== OLD CONFIG (what we currently use - NO reasoning param) ==========

    TestConfig(
        name="GPT-5.1: NO reasoning param, temp=1 (CURRENT PRODUCTION)",
        model="gpt-5.1-chat-latest",
        params={
            # NO reasoning parameter at all
            "temperature": 1,
            "max_completion_tokens": 8000,
        }
    ),

    # ========== BASELINE COMPARISON ==========

    TestConfig(
        name="GPT-4.1-mini (BASELINE - No reasoning support)",
        model="gpt-4.1-mini",
        params={
            "temperature": 0,
            "max_completion_tokens": 4000,
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
    print(f"Prompt size: {len(FULL_PROMPT):,} characters")
    print()

    # Build request parameters (split system/user for GPT-5.1)
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
        "prompt_size_chars": len(FULL_PROMPT)
    }

    try:
        print("⏳ Sending PRODUCTION-SIZED request...")
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
        result["response_preview"] = content[:300] + "..." if len(content) > 300 else content

        # Print results
        print(f"✅ SUCCESS in {duration:.2f}s ({duration*1000:.0f}ms)")
        print(f"📊 Tokens: {response.usage.prompt_tokens} prompt + {response.usage.completion_tokens} completion = {response.usage.total_tokens} total")
        print(f"📝 Response length: {len(content)} characters")
        print(f"🚀 Speed: {len(content)/duration:.0f} chars/sec, {response.usage.completion_tokens/duration:.1f} tokens/sec")
        print()
        print("Response preview:")
        print(content[:400] + ("..." if len(content) > 400 else ""))

    except Exception as e:
        duration = (datetime.now() - start_time).total_seconds() if 'start_time' in locals() else 0
        result["duration_seconds"] = duration
        result["error"] = str(e)

        print(f"❌ FAILED after {duration:.2f}s")
        print(f"Error: {e}")
        print(f"Error type: {type(e).__name__}")

    return result


async def main():
    """Run all tests with production payload"""

    print("\n" + "="*80)
    print("🚀 GPT-5.1 PRODUCTION LOAD TEST")
    print("="*80)
    print(f"Testing with REALISTIC PRODUCTION PAYLOAD")
    print(f"Configurations: {len(TEST_CONFIGS)}")
    print(f"API Key: {api_key[:20]}...")
    print()
    print("PAYLOAD SUMMARY:")
    print(f"  Equipment items: 2 (Airmar DST810, B&G DST810)")
    print(f"  Pinecone chunks: 5 (total ~3,500 chars)")
    print(f"  DIP results: 0")
    print(f"  Classification: {QUERY_INTENT}")
    print(f"  Total prompt size: {len(FULL_PROMPT):,} characters")
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
    print("📊 PRODUCTION LOAD COMPARISON REPORT")
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
            print(f"  Error: {result['error']}")
            print()

    # Find fastest
    if successful_results:
        fastest = successful_results[0]
        print("="*80)
        print("🏆 FASTEST CONFIGURATION (Production Load)")
        print("="*80)
        print(f"Name: {fastest['name']}")
        print(f"Model: {fastest['model']}")
        print(f"Duration: {fastest['duration_seconds']:.2f}s ({fastest['duration_seconds']*1000:.0f}ms)")
        print(f"Params: {json.dumps(fastest['params'], indent=2)}")
        print()

    # Save results
    output_file = "test-results-production-load.json"
    with open(output_file, 'w') as f:
        json.dump({
            "timestamp": datetime.now().isoformat(),
            "test_type": "production_load",
            "payload_size": len(FULL_PROMPT),
            "equipment_count": 2,
            "pinecone_chunks": 5,
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
