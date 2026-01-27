#!/usr/bin/env python3
"""
Test DIP Spec Extraction with Model Tagging

Tests extracting specifications from Yanmar manual with applies_to_models field.
User's systems: 4JH57, VC20, SD60

Usage:
    cd /Users/brad/code/REIMAGINEDAPPV2
    python-sidecar/.venv/bin/python scripts/test-dip-model-tagging.py
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

# Enhanced spec prompt with model tagging
SPEC_PROMPT_WITH_MODELS = """CRITICAL: You MUST respond with ONLY pure JSON. No explanations, no text before or after JSON.
FORMAT REQUIREMENT: Output must start with { and end with }. Nothing else.

CONTEXT: The user owns these specific systems: 4JH57 (engine), VC20 (vessel control), SD60 (saildrive).
This manual covers multiple models. For each specification, identify which model(s) it applies to.

TASK: Extract normalized technical specifications with MODEL APPLICABILITY.

OUTPUT FORMAT (copy exactly):
{"specifications":[{
  "parameter":"string",
  "value":"string",
  "unit":"string",
  "applies_to_models":["string"],
  "confidence":0.0,
  "page":"string",
  "source_context":"string"
}]}

CRITICAL FIELD - applies_to_models:
- If spec is for a SPECIFIC model (e.g., "4JH57 oil capacity"), use ["4JH57"]
- If spec applies to MULTIPLE models (e.g., "4JH45/4JH57 share same filter"), use ["4JH45", "4JH57"]
- If spec applies to ALL models in a family, use ["all_4JH"] or list them all
- If spec is for referenced products (VC10, VC20, VC30, SD60, KM35), tag with that specific model
- NEVER leave applies_to_models empty - always identify which model(s)

FOCUS ON:
- Engine specifications (oil capacity, coolant, dimensions, weights, power)
- Saildrive specifications (SD60)
- Vessel control specifications (VC10, VC20, VC30)
- Marine gear specifications (KM35, KM4)
- Operating ranges and limits
- Fluid capacities and types

RULES:
- Extract specifications with their MODEL APPLICABILITY
- Pay special attention to tables that show different values per model
- If a table has columns for different models, extract SEPARATE entries for each
- Maximum 50 specifications
- Start with { and end with }
- No markdown, no explanations"""

def read_markdown():
    """Read the saved Yanmar markdown"""
    markdown_path = "/Users/brad/code/REIMAGINEDAPPV2/python-sidecar/llamaparse_output/0AJHC-EN001F-Sep.2025-0_JH-CR_OPM_20250917_markdown.md"

    with open(markdown_path, 'r') as f:
        content = f.read()

    print(f"Loaded markdown: {len(content):,} characters")
    return content

def extract_specs(markdown_content):
    """Run spec extraction with model tagging"""

    print(f"\nSending to Claude ({MODEL})...")
    print(f"User's systems: {USER_SYSTEMS}")

    response = client.messages.create(
        model=MODEL,
        max_tokens=8000,
        messages=[{
            "role": "user",
            "content": f"{SPEC_PROMPT_WITH_MODELS}\n\nDOCUMENT CONTENT:\n{markdown_content}"
        }]
    )

    # Get response text
    response_text = response.content[0].text

    # Parse JSON
    try:
        data = json.loads(response_text)
        return data
    except json.JSONDecodeError as e:
        print(f"JSON parse error: {e}")
        print(f"Response preview: {response_text[:500]}")
        return None

def analyze_results(data):
    """Analyze and display results"""
    if not data or 'specifications' not in data:
        print("No specifications found")
        return

    specs = data['specifications']
    print(f"\n{'='*60}")
    print(f"EXTRACTED {len(specs)} SPECIFICATIONS")
    print(f"{'='*60}\n")

    # Group by model
    by_model = {}
    for spec in specs:
        models = spec.get('applies_to_models', ['unknown'])
        for model in models:
            if model not in by_model:
                by_model[model] = []
            by_model[model].append(spec)

    # Show summary by model
    print("SPECS BY MODEL:")
    print("-" * 40)
    for model, model_specs in sorted(by_model.items()):
        print(f"  {model}: {len(model_specs)} specs")

    # Show specs for user's systems
    print(f"\n{'='*60}")
    print("SPECS FOR USER'S SYSTEMS")
    print(f"{'='*60}")

    for user_system in USER_SYSTEMS:
        print(f"\n--- {user_system} ---")
        found = False
        for spec in specs:
            models = spec.get('applies_to_models', [])
            if user_system in models or any(user_system in m for m in models):
                found = True
                param = spec.get('parameter', '?')
                value = spec.get('value', '?')
                unit = spec.get('unit', '')
                context = spec.get('source_context', '')[:50]
                print(f"  {param}: {value} {unit}")
                if context:
                    print(f"    (from: {context}...)")
        if not found:
            print(f"  No specs found for {user_system}")

    # Save full results
    output_path = "/Users/brad/code/REIMAGINEDAPPV2/scripts/test-data/dip-model-tagging-results.json"
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, 'w') as f:
        json.dump(data, f, indent=2)
    print(f"\nFull results saved to: {output_path}")

def main():
    print("DIP Model Tagging Test")
    print("=" * 60)

    # Read markdown
    markdown = read_markdown()

    # Extract specs
    results = extract_specs(markdown)

    # Analyze
    if results:
        analyze_results(results)

if __name__ == "__main__":
    main()
