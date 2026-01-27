#!/usr/bin/env python3
"""
Test model detection using gpt-4.1-mini against saved markdown files.
"""

import os
import sys
import json
from pathlib import Path
from openai import OpenAI
from dotenv import load_dotenv

# Load env
load_dotenv(Path(__file__).parent.parent / '.env')

client = OpenAI(api_key=os.getenv('OPENAI_API_KEY'))

PROMPT = """Analyze this technical manual and identify:

1. PRIMARY PRODUCTS: What specific product model(s) is this manual FOR?
   - List exact model numbers (e.g., "4JH57", "Zeus 3S")
   - Is this a multi-model manual covering a product family?

2. REFERENCED PRODUCTS: What other products are mentioned but not the main subject?
   - Compatible accessories, related systems, integration partners

3. MANUFACTURER: Who makes the primary product(s)?

Return ONLY valid JSON (no markdown, no explanation):
{
  "primary_models": ["model1", "model2"],
  "is_multi_model": true/false,
  "referenced_products": ["product1", "product2"],
  "product_category": "category",
  "manufacturer": "manufacturer name"
}
"""

def detect_models(markdown_path: str):
    """Send markdown to gpt-4.1-mini for model detection."""
    
    print(f"Reading: {markdown_path}")
    with open(markdown_path, 'r') as f:
        content = f.read()
    
    print(f"Content length: {len(content):,} chars (~{len(content)//4:,} tokens)")
    print(f"Sending to gpt-4.1-mini...")
    print("-" * 50)
    
    response = client.chat.completions.create(
        model="gpt-4.1-mini",
        messages=[
            {"role": "system", "content": PROMPT},
            {"role": "user", "content": content}
        ],
        temperature=0
    )
    
    result = response.choices[0].message.content
    usage = response.usage
    
    print(f"Input tokens: {usage.prompt_tokens:,}")
    print(f"Output tokens: {usage.completion_tokens:,}")
    print(f"Estimated cost: ${(usage.prompt_tokens * 0.15 + usage.completion_tokens * 0.60) / 1_000_000:.4f}")
    print("-" * 50)
    print("RESULT:")
    print(result)
    
    # Try to parse as JSON
    try:
        parsed = json.loads(result)
        print("-" * 50)
        print("PARSED:")
        print(json.dumps(parsed, indent=2))
    except:
        print("(Could not parse as JSON)")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python test-model-detection-llm.py <markdown_file>")
        print("\nAvailable test files:")
        output_dir = Path(__file__).parent.parent / "python-sidecar/llamaparse_output"
        for f in output_dir.glob("*.md"):
            print(f"  {f}")
        sys.exit(1)
    
    detect_models(sys.argv[1])
