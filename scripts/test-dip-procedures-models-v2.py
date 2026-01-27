#!/usr/bin/env python3
"""
Test DIP Procedures Extraction with Model Tagging V2

IMPROVED: Excludes content for systems user doesn't have, keeps general content.
User's systems: 4JH57, VC20, SD60

Usage:
    cd /Users/brad/code/REIMAGINEDAPPV2
    python-sidecar/.venv/bin/python scripts/test-dip-procedures-models-v2.py
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

# Enhanced procedures prompt with EXCLUSION logic
PROCEDURES_PROMPT_WITH_EXCLUSIONS = """CRITICAL: You MUST respond with ONLY pure JSON. No explanations, no text before or after JSON.
FORMAT REQUIREMENT: Output must start with { and end with }. Nothing else.

USER'S ACTUAL SYSTEMS (extract content for these):
- 4JH57 (engine) - naturally aspirated 4-cylinder
- VC20 (vessel control system)
- SD60 (saildrive)

INCLUDE content that is:
1. SPECIFIC to user's systems (4JH57, VC20, SD60)
2. GENERAL content that applies to ALL models (safety, common maintenance, universal procedures)

EXCLUDE content that is SPECIFIC to systems user does NOT have:
- VC10, VC30 procedures (user has VC20, not these)
- KM35, KM35A, KM35P, KM4A1, KMH4A marine gear procedures (user has SD60 saildrive)
- 3JH40-specific content (user has 4JH57)
- 4JH45-specific content (user has 4JH57)
- 4JH80-specific content (user has 4JH57) - this is turbocharged, user's is not
- 4JH110-specific content (user has 4JH57) - this is turbocharged, user's is not
- B25/C35 instrument panel procedures (user has VC20 vessel control)

TASK: Extract installation, operation, and maintenance procedures RELEVANT TO USER'S EQUIPMENT.

OUTPUT FORMAT (copy exactly):
{"procedures":[{
  "title":"string",
  "category":"string",
  "preconditions":["string"],
  "steps":["string"],
  "expected_outcome":"string",
  "applies_to_models":["string"],
  "page":"string",
  "warnings":["string"]
}]}

CATEGORIES:
- "installation" - Initial setup and mounting
- "operation" - Starting, running, stopping
- "maintenance" - Scheduled service tasks
- "troubleshooting" - Diagnostic and repair procedures

FOR applies_to_models:
- Use ["4JH57"] for 4JH57-specific content
- Use ["4JH57", "VC20"] if procedure involves both
- Use ["SD60"] for saildrive-specific content
- Use ["all"] for general content that applies universally

RULES:
- Only extract procedures RELEVANT to user's equipment (4JH57, VC20, SD60)
- Include general/universal procedures that apply to all models
- SKIP procedures specific to VC10, VC30, KM35, KM4, 4JH80, 4JH110, B25/C35
- Maximum 35 procedures
- Start with { and end with }
- No markdown, no explanations"""

def read_markdown():
    """Read the saved Yanmar markdown"""
    markdown_path = "/Users/brad/code/REIMAGINEDAPPV2/python-sidecar/llamaparse_output/0AJHC-EN001F-Sep.2025-0_JH-CR_OPM_20250917_markdown.md"

    with open(markdown_path, 'r') as f:
        content = f.read()

    print(f"Loaded markdown: {len(content):,} characters")
    return content

def extract_procedures(markdown_content):
    """Run procedures extraction with exclusion logic"""

    print(f"\nSending to Claude ({MODEL})...")
    print(f"User's systems: {USER_SYSTEMS}")
    print("Excluding: VC10, VC30, KM35, KM4, 4JH80, 4JH110, B25/C35")

    response = client.messages.create(
        model=MODEL,
        max_tokens=8000,
        messages=[{
            "role": "user",
            "content": f"{PROCEDURES_PROMPT_WITH_EXCLUSIONS}\n\nDOCUMENT CONTENT:\n{markdown_content}"
        }]
    )

    # Get response text
    response_text = response.content[0].text

    # Parse JSON - handle markdown code blocks
    try:
        text = response_text.strip()
        # Remove markdown code blocks if present
        if '```json' in text:
            text = text.split('```json')[1].split('```')[0].strip()
        elif '```' in text:
            text = text.split('```')[1].split('```')[0].strip()
        # Find JSON object
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
    if not data or 'procedures' not in data:
        print("No procedures found")
        return

    procedures = data['procedures']
    print(f"\n{'='*70}")
    print(f"EXTRACTED {len(procedures)} PROCEDURES (filtered for user's systems)")
    print(f"{'='*70}\n")

    # Group by model
    by_model = {}
    for proc in procedures:
        models = proc.get('applies_to_models', ['unknown'])
        for model in models:
            if model not in by_model:
                by_model[model] = []
            by_model[model].append(proc)

    # Show summary by model
    print("PROCEDURES BY MODEL:")
    print("-" * 40)
    for model, model_procs in sorted(by_model.items()):
        print(f"  {model}: {len(model_procs)} procedures")

    # Group by category
    by_category = {}
    for proc in procedures:
        cat = proc.get('category', 'unknown')
        if cat not in by_category:
            by_category[cat] = []
        by_category[cat].append(proc)

    print("\nPROCEDURES BY CATEGORY:")
    print("-" * 40)
    for cat, cat_procs in sorted(by_category.items()):
        print(f"  {cat}: {len(cat_procs)} procedures")

    # Show all procedures
    print(f"\n{'='*70}")
    print("ALL EXTRACTED PROCEDURES")
    print(f"{'='*70}")

    for i, proc in enumerate(procedures, 1):
        title = proc.get('title', '?')
        category = proc.get('category', '?')
        models = proc.get('applies_to_models', [])
        steps = proc.get('steps', [])
        outcome = proc.get('expected_outcome', '?')
        page = proc.get('page', '?')
        warnings = proc.get('warnings', [])

        print(f"\n{i}. {title}")
        print(f"   Category: {category} | Page: {page}")
        print(f"   Applies to: {models}")
        print(f"   Steps: {len(steps)} steps")
        if steps:
            for j, step in enumerate(steps[:3], 1):
                print(f"      {j}. {step[:70]}{'...' if len(step) > 70 else ''}")
            if len(steps) > 3:
                print(f"      ... and {len(steps) - 3} more steps")
        print(f"   Outcome: {outcome[:80]}{'...' if len(outcome) > 80 else ''}")
        if warnings:
            print(f"   ⚠️  Warning: {warnings[0][:60]}...")

    # Check for any leakage of excluded systems
    print(f"\n{'='*70}")
    print("CHECKING FOR EXCLUDED SYSTEM LEAKAGE")
    print(f"{'='*70}")
    excluded_keywords = ['VC10', 'VC30', 'KM35', 'KM4', 'KMH4A', '4JH80', '4JH110', '3JH40', '4JH45', 'B25', 'C35']
    leaks = []
    for proc in procedures:
        title = proc.get('title', '')
        for kw in excluded_keywords:
            if kw in title:
                leaks.append(f"  - '{title}' mentions {kw}")
    if leaks:
        print("⚠️  Found references to excluded systems:")
        for leak in leaks:
            print(leak)
    else:
        print("✅ No leakage - all procedures relevant to user's systems")

    # Save full results
    output_path = "/Users/brad/code/REIMAGINEDAPPV2/scripts/test-data/dip-procedures-v2-results.json"
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, 'w') as f:
        json.dump(data, f, indent=2)
    print(f"\n\nFull results saved to: {output_path}")

def main():
    print("DIP Procedures Model Tagging Test V2 (with exclusions)")
    print("=" * 70)

    # Read markdown
    markdown = read_markdown()

    # Extract procedures
    results = extract_procedures(markdown)

    # Analyze
    if results:
        analyze_results(results)

if __name__ == "__main__":
    main()
