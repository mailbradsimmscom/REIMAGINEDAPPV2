#!/usr/bin/env python3
"""
Test DIP Intent Router Extraction with Model Tagging

Tests extracting Q&A pairs from Yanmar manual with applies_to_models field.
User's systems: 4JH57, VC20, SD60

Usage:
    cd /Users/brad/code/REIMAGINEDAPPV2
    python-sidecar/.venv/bin/python scripts/test-dip-intent-router-models.py
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

# Enhanced intent router prompt with model tagging
INTENT_PROMPT_WITH_MODELS = """CRITICAL: You MUST respond with ONLY pure JSON. No explanations, no text before or after JSON.
FORMAT REQUIREMENT: Output must start with { and end with }. Nothing else.

CONTEXT: The user owns these specific systems: 4JH57 (engine), VC20 (vessel control), SD60 (saildrive).
This manual covers multiple engine models: 3JH40, 4JH45, 4JH57, 4JH80, 4JH110.
It also references: VC10, VC20, VC30 (vessel control), SD60 (saildrive), KM35/KM4 (marine gears).

TASK: Extract question-answer pairs with MODEL APPLICABILITY for natural language query routing.

OUTPUT FORMAT (copy exactly):
{"intent_routes":[{
  "question":"string",
  "question_variations":["string"],
  "answer":"string",
  "question_type":"string",
  "applies_to_models":["string"],
  "page":"string"
}]}

CRITICAL FIELD - applies_to_models:
- If the answer is SPECIFIC to a model (e.g., "4JH57 oil capacity is 5.0L"), use ["4JH57"]
- If the answer applies to MULTIPLE models, list them all: ["4JH45", "4JH57"]
- If the answer applies to ALL engine models, use ["3JH40", "4JH45", "4JH57", "4JH80", "4JH110"]
- If about referenced products (VC20, SD60, KM35), tag with that specific model
- NEVER leave applies_to_models empty

FOCUS ON:
- Common user questions about operation, maintenance, troubleshooting
- Questions where the answer differs by model (oil capacity, power, etc.)
- Questions about the saildrive (SD60)
- Questions about the vessel control (VC10, VC20, VC30)
- Clear, direct answers that can be used as query responses

FOR EACH Q&A PAIR PROVIDE:
- Question: The main question as it appears or implied in manual
- Question Variations: 2-4 different ways users might ask this
- Answer: Direct, specific answer (1-3 sentences max)
- Question Type: What/How/When/Where/Why
- Applies To Models: Which models this answer is valid for
- Page: Page number reference

RULES:
- Extract Q&A pairs with their MODEL APPLICABILITY
- Pay special attention to answers that differ by model
- If a question has different answers per model, create SEPARATE entries
- Maximum 50 Q&A pairs
- Start with { and end with }
- No markdown, no explanations"""

def read_markdown():
    """Read the saved Yanmar markdown"""
    markdown_path = "/Users/brad/code/REIMAGINEDAPPV2/python-sidecar/llamaparse_output/0AJHC-EN001F-Sep.2025-0_JH-CR_OPM_20250917_markdown.md"

    with open(markdown_path, 'r') as f:
        content = f.read()

    print(f"Loaded markdown: {len(content):,} characters")
    return content

def extract_intents(markdown_content):
    """Run intent router extraction with model tagging"""

    print(f"\nSending to Claude ({MODEL})...")
    print(f"User's systems: {USER_SYSTEMS}")

    response = client.messages.create(
        model=MODEL,
        max_tokens=8000,
        messages=[{
            "role": "user",
            "content": f"{INTENT_PROMPT_WITH_MODELS}\n\nDOCUMENT CONTENT:\n{markdown_content}"
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
    if not data or 'intent_routes' not in data:
        print("No intent routes found")
        return

    intents = data['intent_routes']
    print(f"\n{'='*70}")
    print(f"EXTRACTED {len(intents)} Q&A PAIRS")
    print(f"{'='*70}\n")

    # Group by model
    by_model = {}
    for intent in intents:
        models = intent.get('applies_to_models', ['unknown'])
        for model in models:
            if model not in by_model:
                by_model[model] = []
            by_model[model].append(intent)

    # Show summary by model
    print("Q&A PAIRS BY MODEL:")
    print("-" * 40)
    for model, model_intents in sorted(by_model.items()):
        print(f"  {model}: {len(model_intents)} Q&A pairs")

    # Show Q&A for user's systems
    print(f"\n{'='*70}")
    print("Q&A FOR USER'S SYSTEMS")
    print(f"{'='*70}")

    for user_system in USER_SYSTEMS:
        print(f"\n{'='*70}")
        print(f"--- {user_system} ---")
        print(f"{'='*70}")
        found = False
        for intent in intents:
            models = intent.get('applies_to_models', [])
            if user_system in models:
                found = True
                q = intent.get('question', '?')
                a = intent.get('answer', '?')
                qtype = intent.get('question_type', '?')
                variations = intent.get('question_variations', [])
                page = intent.get('page', '?')

                # Check if model-specific or shared
                if len(models) == 1:
                    scope = f"({user_system} ONLY)"
                elif len(models) == 5 and all(m in models for m in ['3JH40', '4JH45', '4JH57', '4JH80', '4JH110']):
                    scope = "(ALL ENGINES)"
                else:
                    scope = f"(shared: {models})"

                print(f"\nQ: {q}")
                print(f"   Type: {qtype} | Page: {page} | {scope}")
                print(f"A: {a}")
                if variations:
                    print(f"   Also asked as: {variations[:2]}")
        if not found:
            print(f"  No Q&A found for {user_system}")

    # Save full results
    output_path = "/Users/brad/code/REIMAGINEDAPPV2/scripts/test-data/dip-intent-router-results.json"
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, 'w') as f:
        json.dump(data, f, indent=2)
    print(f"\n\nFull results saved to: {output_path}")

def main():
    print("DIP Intent Router Model Tagging Test")
    print("=" * 70)

    # Read markdown
    markdown = read_markdown()

    # Extract intents
    results = extract_intents(markdown)

    # Analyze
    if results:
        analyze_results(results)

if __name__ == "__main__":
    main()
