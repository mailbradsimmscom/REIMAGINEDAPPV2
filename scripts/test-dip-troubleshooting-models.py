#!/usr/bin/env python3
"""
Test DIP Troubleshooting Extraction with Model Tagging

NEW DIP TYPE: Extracts symptom → cause → fix chains from manuals.
User's systems: 4JH57, VC20, SD60

Usage:
    cd /Users/brad/code/REIMAGINEDAPPV2
    python-sidecar/.venv/bin/python scripts/test-dip-troubleshooting-models.py
"""

import os
import json
from dotenv import load_dotenv
from anthropic import Anthropic

load_dotenv()

# Initialize Anthropic client
client = Anthropic(api_key=os.getenv('ANTHROPIC_API_KEY'))
MODEL = os.getenv('ANTHROPIC_MODEL', 'claude-sonnet-4-20250514')

# User's systems
USER_SYSTEMS = ["4JH57", "VC20", "SD60"]

# Troubleshooting extraction prompt with model tagging and exclusions
TROUBLESHOOTING_PROMPT = """CRITICAL: You MUST respond with ONLY pure JSON. No explanations, no text before or after JSON.
FORMAT REQUIREMENT: Output must start with { and end with }. Nothing else.

USER'S ACTUAL SYSTEMS (extract content for these):
- 4JH57 (engine) - naturally aspirated 4-cylinder diesel
- VC20 (vessel control system)
- SD60 (saildrive)

INCLUDE troubleshooting content that is:
1. SPECIFIC to user's systems (4JH57, VC20, SD60)
2. GENERAL content that applies to ALL models

EXCLUDE troubleshooting content SPECIFIC to systems user does NOT have:
- VC10, VC30 specific issues (user has VC20)
- KM35, KM35A, KM35P, KM4A1, KMH4A marine gear issues (user has SD60 saildrive)
- 3JH40, 4JH45 specific issues (user has 4JH57)
- 4JH80, 4JH110 turbocharger issues (user has naturally aspirated 4JH57)
- B25/C35 instrument panel issues (user has VC20 vessel control)

TASK: Extract TROUBLESHOOTING information - symptom → cause → fix chains.

This is DIFFERENT from Golden Rules:
- Golden Rules = "What SHOULD be true" (validation)
- Troubleshooting = "What to do when something goes WRONG" (diagnosis)

OUTPUT FORMAT (copy exactly):
{"troubleshooting":[{
  "symptom":"string",
  "symptom_variations":["string"],
  "possible_causes":[{
    "cause":"string",
    "likelihood":"string",
    "fix":"string",
    "fix_steps":["string"]
  }],
  "applies_to_models":["string"],
  "source_type":"string",
  "page":"string"
}]}

FIELDS:
- symptom: The problem the user observes (e.g., "Engine won't start", "White smoke")
- symptom_variations: Other ways user might describe this (e.g., ["won't crank", "no start", "starter not working"])
- possible_causes: Array of cause→fix pairs (there can be MULTIPLE causes for one symptom)
  - cause: What might be wrong
  - likelihood: "common", "occasional", "rare"
  - fix: Brief description of solution
  - fix_steps: Step-by-step instructions if available
- applies_to_models: Which systems this applies to
- source_type: "troubleshooting_table", "warning_section", "procedure_note", "error_code"
- page: Page reference

FOCUS ON:
- Troubleshooting tables/charts in the manual (Symptom | Cause | Remedy format)
- Error codes and their meanings
- Warning indicators and what they mean
- Common problems mentioned in procedures
- "If X happens, do Y" statements
- Diagnostic flowcharts

FOR applies_to_models:
- Use ["4JH57"] for engine-specific issues
- Use ["VC20"] for vessel control specific issues
- Use ["SD60"] for saildrive specific issues
- Use ["4JH57", "VC20"] if issue involves both
- Use ["all"] for general issues that apply universally

RULES:
- Extract diagnostic chains with MULTIPLE possible causes per symptom
- Include symptom variations (how users might describe the problem)
- Only extract content RELEVANT to user's equipment
- SKIP turbocharger troubleshooting (4JH57 is naturally aspirated)
- Maximum 40 troubleshooting entries
- Start with { and end with }
- No markdown, no explanations"""

def read_markdown():
    """Read the saved Yanmar markdown"""
    markdown_path = "/Users/brad/code/REIMAGINEDAPPV2/python-sidecar/llamaparse_output/0AJHC-EN001F-Sep.2025-0_JH-CR_OPM_20250917_markdown.md"

    with open(markdown_path, 'r') as f:
        content = f.read()

    print(f"Loaded markdown: {len(content):,} characters")
    return content

def extract_troubleshooting(markdown_content):
    """Run troubleshooting extraction with model tagging"""

    print(f"\nSending to Claude ({MODEL})...")
    print(f"User's systems: {USER_SYSTEMS}")
    print("Excluding: VC10, VC30, KM35, KM4, 4JH80/110 turbo, B25/C35")

    response = client.messages.create(
        model=MODEL,
        max_tokens=8000,
        messages=[{
            "role": "user",
            "content": f"{TROUBLESHOOTING_PROMPT}\n\nDOCUMENT CONTENT:\n{markdown_content}"
        }]
    )

    # Get response text
    response_text = response.content[0].text

    # Parse JSON - handle markdown code blocks
    try:
        text = response_text.strip()
        if '```json' in text:
            text = text.split('```json')[1].split('```')[0].strip()
        elif '```' in text:
            text = text.split('```')[1].split('```')[0].strip()
        start = text.find('{')
        end = text.rfind('}') + 1
        if start >= 0 and end > start:
            text = text[start:end]
        data = json.loads(text)
        return data
    except json.JSONDecodeError as e:
        print(f"JSON parse error: {e}")
        print(f"Response preview: {response_text[:500]}")
        return None

def analyze_results(data):
    """Analyze and display results"""
    if not data or 'troubleshooting' not in data:
        print("No troubleshooting entries found")
        return

    entries = data['troubleshooting']
    print(f"\n{'='*70}")
    print(f"EXTRACTED {len(entries)} TROUBLESHOOTING ENTRIES")
    print(f"{'='*70}\n")

    # Group by model
    by_model = {}
    for entry in entries:
        models = entry.get('applies_to_models', ['unknown'])
        for model in models:
            if model not in by_model:
                by_model[model] = []
            by_model[model].append(entry)

    print("TROUBLESHOOTING BY MODEL:")
    print("-" * 40)
    for model, model_entries in sorted(by_model.items()):
        print(f"  {model}: {len(model_entries)} entries")

    # Group by source type
    by_source = {}
    for entry in entries:
        source = entry.get('source_type', 'unknown')
        if source not in by_source:
            by_source[source] = []
        by_source[source].append(entry)

    print("\nTROUBLESHOOTING BY SOURCE TYPE:")
    print("-" * 40)
    for source, source_entries in sorted(by_source.items()):
        print(f"  {source}: {len(source_entries)} entries")

    # Count total causes
    total_causes = sum(len(e.get('possible_causes', [])) for e in entries)
    print(f"\nTOTAL SYMPTOM→CAUSE CHAINS: {total_causes}")

    # Show all entries
    print(f"\n{'='*70}")
    print("ALL TROUBLESHOOTING ENTRIES")
    print(f"{'='*70}")

    for i, entry in enumerate(entries, 1):
        symptom = entry.get('symptom', '?')
        variations = entry.get('symptom_variations', [])
        causes = entry.get('possible_causes', [])
        models = entry.get('applies_to_models', [])
        source = entry.get('source_type', '?')
        page = entry.get('page', '?')

        print(f"\n{i}. SYMPTOM: {symptom}")
        if variations:
            print(f"   Also described as: {variations[:3]}")
        print(f"   Applies to: {models} | Source: {source} | Page: {page}")
        print(f"   POSSIBLE CAUSES ({len(causes)}):")

        for j, cause_entry in enumerate(causes[:4], 1):  # Show up to 4 causes
            cause = cause_entry.get('cause', '?')
            likelihood = cause_entry.get('likelihood', '?')
            fix = cause_entry.get('fix', '?')
            steps = cause_entry.get('fix_steps', [])

            print(f"      {j}. {cause} [{likelihood}]")
            print(f"         Fix: {fix[:60]}{'...' if len(fix) > 60 else ''}")
            if steps:
                print(f"         Steps: {len(steps)} steps")

        if len(causes) > 4:
            print(f"      ... and {len(causes) - 4} more causes")

    # Check for excluded system leakage
    print(f"\n{'='*70}")
    print("CHECKING FOR EXCLUDED SYSTEM LEAKAGE")
    print(f"{'='*70}")
    excluded_keywords = ['VC10', 'VC30', 'KM35', 'KM4', 'KMH4A', '4JH80', '4JH110', '3JH40', '4JH45', 'B25', 'C35', 'turbo', 'turbocharger']
    leaks = []
    for entry in entries:
        symptom = entry.get('symptom', '')
        for cause_entry in entry.get('possible_causes', []):
            cause = cause_entry.get('cause', '')
            fix = cause_entry.get('fix', '')
            for kw in excluded_keywords:
                if kw.lower() in symptom.lower() or kw.lower() in cause.lower():
                    leaks.append(f"  - '{symptom}' / '{cause}' mentions {kw}")
    if leaks:
        print("⚠️  Found references to excluded systems:")
        for leak in leaks[:5]:
            print(leak)
    else:
        print("✅ No leakage - all troubleshooting relevant to user's systems")

    # Save full results
    output_path = "/Users/brad/code/REIMAGINEDAPPV2/scripts/test-data/dip-troubleshooting-results.json"
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, 'w') as f:
        json.dump(data, f, indent=2)
    print(f"\n\nFull results saved to: {output_path}")

def main():
    print("DIP Troubleshooting Model Tagging Test")
    print("=" * 70)

    # Read markdown
    markdown = read_markdown()

    # Extract troubleshooting
    results = extract_troubleshooting(markdown)

    # Analyze
    if results:
        analyze_results(results)

if __name__ == "__main__":
    main()
