#!/usr/bin/env python3
"""
Test DIP Procedures Extraction with Model Tagging

Tests extracting installation and maintenance procedures from Yanmar manual with applies_to_models field.
User's systems: 4JH57, VC20, SD60

Usage:
    cd /Users/brad/code/REIMAGINEDAPPV2
    python-sidecar/.venv/bin/python scripts/test-dip-procedures-models.py
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

# Enhanced procedures prompt with model tagging
PROCEDURES_PROMPT_WITH_MODELS = """CRITICAL: You MUST respond with ONLY pure JSON. No explanations, no text before or after JSON.
FORMAT REQUIREMENT: Output must start with { and end with }. Nothing else.

CONTEXT: The user owns these specific systems: 4JH57 (engine), VC20 (vessel control), SD60 (saildrive).
This manual covers multiple engine models: 3JH40, 4JH45, 4JH57, 4JH80, 4JH110.
It also references: VC10, VC20, VC30 (vessel control), SD60 (saildrive), KM35/KM4 (marine gears).

TASK: Extract installation, operation, and maintenance procedures with MODEL APPLICABILITY.

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

CRITICAL FIELD - applies_to_models:
- If procedure is SPECIFIC to a model (e.g., "4JH80 turbo inspection"), use ["4JH80"]
- If procedure applies to MULTIPLE models, list them all: ["4JH45", "4JH57"]
- If procedure applies to ALL engine models, use ["3JH40", "4JH45", "4JH57", "4JH80", "4JH110"]
- If about referenced products (VC20, SD60, KM35), tag with that specific model
- NEVER leave applies_to_models empty

CATEGORIES:
- "installation" - Initial setup and mounting
- "operation" - Starting, running, stopping
- "maintenance" - Scheduled service tasks
- "troubleshooting" - Diagnostic and repair procedures

FOCUS ON:
- Engine starting and stopping procedures
- Oil change procedures (note different capacities per model)
- Coolant service procedures
- Filter replacement procedures
- Saildrive (SD60) specific procedures
- Vessel Control (VC20) specific procedures
- Winterization/storage procedures
- Procedures that differ by model

FOR EACH PROCEDURE PROVIDE:
- Title: Clear descriptive name
- Category: installation/operation/maintenance/troubleshooting
- Preconditions: What must be true before starting
- Steps: Numbered step-by-step instructions
- Expected Outcome: What should happen when done correctly
- Applies To Models: Which models this procedure applies to
- Page: Page number reference
- Warnings: Safety warnings if any

RULES:
- Extract procedures with their MODEL APPLICABILITY
- Pay special attention to procedures that differ by model
- If a procedure has different steps per model, create SEPARATE entries
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
    """Run procedures extraction with model tagging"""

    print(f"\nSending to Claude ({MODEL})...")
    print(f"User's systems: {USER_SYSTEMS}")

    response = client.messages.create(
        model=MODEL,
        max_tokens=8000,
        messages=[{
            "role": "user",
            "content": f"{PROCEDURES_PROMPT_WITH_MODELS}\n\nDOCUMENT CONTENT:\n{markdown_content}"
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
    print(f"EXTRACTED {len(procedures)} PROCEDURES")
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

    # Show procedures for user's systems
    print(f"\n{'='*70}")
    print("PROCEDURES FOR USER'S SYSTEMS")
    print(f"{'='*70}")

    for user_system in USER_SYSTEMS:
        print(f"\n{'='*70}")
        print(f"--- {user_system} ---")
        print(f"{'='*70}")
        found = False
        count = 0
        for proc in procedures:
            models = proc.get('applies_to_models', [])
            if user_system in models:
                found = True
                count += 1
                title = proc.get('title', '?')
                category = proc.get('category', '?')
                steps = proc.get('steps', [])
                outcome = proc.get('expected_outcome', '?')
                page = proc.get('page', '?')
                warnings = proc.get('warnings', [])

                # Check if model-specific or shared
                if len(models) == 1:
                    scope = f"({user_system} ONLY)"
                elif len(models) == 5 and all(m in models for m in ['3JH40', '4JH45', '4JH57', '4JH80', '4JH110']):
                    scope = "(ALL ENGINES)"
                else:
                    scope = f"(shared: {[m for m in models if m != user_system]})"

                print(f"\n{count}. {title}")
                print(f"   Category: {category} | Page: {page} | {scope}")
                print(f"   Steps: {len(steps)} steps")
                if steps:
                    for i, step in enumerate(steps[:3], 1):
                        print(f"      {i}. {step[:70]}{'...' if len(step) > 70 else ''}")
                    if len(steps) > 3:
                        print(f"      ... and {len(steps) - 3} more steps")
                print(f"   Outcome: {outcome[:80]}{'...' if len(outcome) > 80 else ''}")
                if warnings:
                    print(f"   ⚠️  Warnings: {warnings[0][:60]}...")
        if not found:
            print(f"  No procedures found for {user_system}")

    # Save full results
    output_path = "/Users/brad/code/REIMAGINEDAPPV2/scripts/test-data/dip-procedures-results.json"
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, 'w') as f:
        json.dump(data, f, indent=2)
    print(f"\n\nFull results saved to: {output_path}")

def main():
    print("DIP Procedures Model Tagging Test")
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
