#!/usr/bin/env python3
"""
Test DIP Golden Rules Extraction with Model Tagging

Tests extracting validation rules/test assertions from Yanmar manual with applies_to_models field.
User's systems: 4JH57, VC20, SD60

Usage:
    cd /Users/brad/code/REIMAGINEDAPPV2
    python-sidecar/.venv/bin/python scripts/test-dip-golden-rules-models.py
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

# Enhanced golden rules prompt with model tagging
GOLDEN_RULES_PROMPT_WITH_MODELS = """CRITICAL: You MUST respond with ONLY pure JSON. No explanations, no text before or after JSON.
FORMAT REQUIREMENT: Output must start with { and end with }. Nothing else.

CONTEXT: The user owns these specific systems: 4JH57 (engine), VC20 (vessel control), SD60 (saildrive).
This manual covers multiple engine models: 3JH40, 4JH45, 4JH57, 4JH80, 4JH110.
It also references: VC10, VC20, VC30 (vessel control), SD60 (saildrive), KM35/KM4 (marine gears).

TASK: Extract validation rules and test assertions with MODEL APPLICABILITY. These are ground-truth statements that verify correct operation or diagnose problems.

OUTPUT FORMAT (copy exactly):
{"golden_rules":[{
  "query":"string",
  "expected_value":"string",
  "test_method":"string",
  "failure_indication":"string",
  "applies_to_models":["string"],
  "page":"string"
}]}

CRITICAL FIELD - applies_to_models:
- If the rule is SPECIFIC to a model (e.g., "4JH57 oil capacity should be 5.0L"), use ["4JH57"]
- If the rule applies to MULTIPLE models, list them all: ["4JH45", "4JH57"]
- If the rule applies to ALL engine models, use ["3JH40", "4JH45", "4JH57", "4JH80", "4JH110"]
- If about referenced products (VC20, SD60, KM35), tag with that specific model
- NEVER leave applies_to_models empty

FOCUS ON:
- Safety interlocks and their expected behavior
- Normal operating indicators (lights, sounds, displays)
- Automatic shutoff conditions and timing
- Temperature/pressure limits and responses
- Error code meanings and triggers
- Quality checks during installation/maintenance
- Alarm thresholds that differ by model
- Specifications that can be tested/verified

FOR EACH RULE PROVIDE:
- Query: The condition or thing to check
- Expected Value: What should be true in normal operation
- Test Method: How to verify this
- Failure Indication: What it means if this fails
- Applies To Models: Which models this rule applies to
- Page: Page number reference

RULES:
- Extract validation rules with their MODEL APPLICABILITY
- Pay special attention to thresholds/limits that differ by model
- If a rule has different values per model, create SEPARATE entries
- Maximum 40 rules
- Start with { and end with }
- No markdown, no explanations"""

def read_markdown():
    """Read the saved Yanmar markdown"""
    markdown_path = "/Users/brad/code/REIMAGINEDAPPV2/python-sidecar/llamaparse_output/0AJHC-EN001F-Sep.2025-0_JH-CR_OPM_20250917_markdown.md"

    with open(markdown_path, 'r') as f:
        content = f.read()

    print(f"Loaded markdown: {len(content):,} characters")
    return content

def extract_golden_rules(markdown_content):
    """Run golden rules extraction with model tagging"""

    print(f"\nSending to Claude ({MODEL})...")
    print(f"User's systems: {USER_SYSTEMS}")

    response = client.messages.create(
        model=MODEL,
        max_tokens=8000,
        messages=[{
            "role": "user",
            "content": f"{GOLDEN_RULES_PROMPT_WITH_MODELS}\n\nDOCUMENT CONTENT:\n{markdown_content}"
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
    if not data or 'golden_rules' not in data:
        print("No golden rules found")
        return

    rules = data['golden_rules']
    print(f"\n{'='*70}")
    print(f"EXTRACTED {len(rules)} GOLDEN RULES")
    print(f"{'='*70}\n")

    # Group by model
    by_model = {}
    for rule in rules:
        models = rule.get('applies_to_models', ['unknown'])
        for model in models:
            if model not in by_model:
                by_model[model] = []
            by_model[model].append(rule)

    # Show summary by model
    print("GOLDEN RULES BY MODEL:")
    print("-" * 40)
    for model, model_rules in sorted(by_model.items()):
        print(f"  {model}: {len(model_rules)} rules")

    # Show rules for user's systems
    print(f"\n{'='*70}")
    print("GOLDEN RULES FOR USER'S SYSTEMS")
    print(f"{'='*70}")

    for user_system in USER_SYSTEMS:
        print(f"\n{'='*70}")
        print(f"--- {user_system} ---")
        print(f"{'='*70}")
        found = False
        count = 0
        for rule in rules:
            models = rule.get('applies_to_models', [])
            if user_system in models:
                found = True
                count += 1
                query = rule.get('query', '?')
                expected = rule.get('expected_value', '?')
                test = rule.get('test_method', '?')
                failure = rule.get('failure_indication', '?')
                page = rule.get('page', '?')

                # Check if model-specific or shared
                if len(models) == 1:
                    scope = f"({user_system} ONLY)"
                elif len(models) == 5 and all(m in models for m in ['3JH40', '4JH45', '4JH57', '4JH80', '4JH110']):
                    scope = "(ALL ENGINES)"
                else:
                    scope = f"(shared: {models})"

                print(f"\n{count}. {query}")
                print(f"   {scope} | Page: {page}")
                print(f"   EXPECTED: {expected}")
                print(f"   TEST: {test}")
                print(f"   IF FAILS: {failure}")
        if not found:
            print(f"  No golden rules found for {user_system}")

    # Save full results
    output_path = "/Users/brad/code/REIMAGINEDAPPV2/scripts/test-data/dip-golden-rules-results.json"
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, 'w') as f:
        json.dump(data, f, indent=2)
    print(f"\n\nFull results saved to: {output_path}")

def main():
    print("DIP Golden Rules Model Tagging Test")
    print("=" * 70)

    # Read markdown
    markdown = read_markdown()

    # Extract golden rules
    results = extract_golden_rules(markdown)

    # Analyze
    if results:
        analyze_results(results)

if __name__ == "__main__":
    main()
