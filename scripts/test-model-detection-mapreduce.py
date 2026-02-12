#!/usr/bin/env python3
"""
Test model detection using MAP-REDUCE approach.

Instead of sending one massive blob and asking the LLM to find everything,
this breaks the document into focused chunks:

  MAP:    Each chunk → "What models/products are mentioned here?"
  REDUCE: All findings + filename → "Classify as primary vs referenced"

Usage:
  cd python-sidecar && source venv/bin/activate && cd ..
  python scripts/test-model-detection-mapreduce.py <doc_id>
  python scripts/test-model-detection-mapreduce.py 1a178ba54c77a95553a48a362166b3f09c0b24e6e0b634ba8a942d87e5b02df5

Options:
  --chunk-size=50000    Characters per chunk (default 50000)
  --overlap=2000        Overlap between chunks (default 2000)
  --model=gpt-4.1-mini  Model to use (default from env or gpt-4.1-mini)
"""

import os
import sys
import json
import time
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / '.env')

from openai import OpenAI
from supabase import create_client

# Init clients
openai_client = OpenAI(api_key=os.getenv('OPENAI_API_KEY'))
supabase_key = os.getenv('PY_SUPABASE_SERVICE_KEY') or os.getenv('SUPABASE_SERVICE_KEY') or os.getenv('SUPABASE_SERVICE_ROLE_KEY')
supabase = create_client(os.getenv('SUPABASE_URL'), supabase_key)


def fetch_markdown_from_storage(doc_id: str) -> str:
    """Fetch llamaparse_raw.json and build markdown, same as production."""
    storage_path = f"manuals/{doc_id}/llamaparse_raw.json"
    print(f"   Fetching: {storage_path}")

    response = supabase.storage.from_('documents').download(storage_path)
    raw_json = json.loads(response)

    pages = raw_json.get('pages', [])
    print(f"   Pages: {len(pages)}")

    markdown_parts = []
    for page in pages:
        for item in page.get('items', []):
            item_type = item.get('type', '')
            value = item.get('value', '')
            if item_type in ('text', 'table'):
                markdown_parts.append(value)
            elif item_type == 'heading':
                markdown_parts.append(f"# {value}")

    markdown = '\n'.join(markdown_parts)
    print(f"   Markdown: {len(markdown):,} chars")
    return markdown


def fetch_reference_data() -> dict:
    """Fetch reference tables, same as Node proxy."""
    mfrs = supabase.table('ref_manufacturers').select('name').order('name').execute()
    types = supabase.table('ref_product_types').select('name').order('name').execute()
    systems = supabase.table('ref_system_categories').select('id, name').order('display_order').execute()
    subsystems = supabase.table('ref_subsystem_categories').select('id, name, system_id').order('display_order').execute()

    system_map = {s['id']: s['name'] for s in (systems.data or [])}
    subsystem_list = [
        {'name': sub['name'], 'system_id': sub['system_id'], 'system_name': system_map.get(sub['system_id'], 'Unknown')}
        for sub in (subsystems.data or [])
    ]

    return {
        'manufacturers': [m['name'] for m in (mfrs.data or [])],
        'product_types': [t['name'] for t in (types.data or [])],
        'system_categories': [s['name'] for s in (systems.data or [])],
        'subsystem_categories': subsystem_list
    }


def chunk_text(text: str, chunk_size: int = 50000, overlap: int = 2000) -> list:
    """Split text into overlapping chunks."""
    chunks = []
    start = 0
    while start < len(text):
        end = start + chunk_size
        chunk = text[start:end]
        chunks.append({
            'text': chunk,
            'start': start,
            'end': min(end, len(text)),
            'index': len(chunks)
        })
        start = end - overlap
    return chunks


def map_phase(chunks: list, filename: str, model: str) -> list:
    """MAP: Ask each chunk what models/products it mentions."""

    system_prompt = """You are an expert at identifying product models and equipment in technical manuals for marine vessels.

Given a section of a technical manual, extract EVERY specific product model you find.

A "product model" is a specific purchasable/installable system with a model number — like an engine (4JH57), a saildrive (SD60), a marine gear (KM4A1), or a vessel control system (VC20).

For each product model found, provide:
- model: The exact model number as written (e.g., "4JH57", "SD60", "Zeus 3S 16")
- manufacturer: The manufacturer if identifiable (e.g., "Yanmar", "B&G", "ZF")
- type: What kind of product (e.g., "Engine", "Saildrive", "Marine Gear", "Chartplotter")
- description: One sentence describing what this product is and does
- context: How it appears in this section — main subject, referenced in a diagram, in a specs table, in a compatibility list, etc.

IMPORTANT:
- Extract EVERY specific product model, not just the main product
- Include models from compatibility tables, wiring diagrams, specifications, installation instructions
- Do NOT include part numbers (e.g., "129670-07202", "177524-02903") — only product MODEL numbers
- Do NOT include document/figure reference numbers (e.g., "037639-00E00", "122768-00X00")
- Do NOT include tools (e.g., "Puller A")
- Do NOT include consumables (oil, coolant, sealant brands)
- Do NOT include firmware/software version numbers
- Do NOT include series names or generic family references (e.g., "JH Series", "3/4JH common rail series") — only specific model numbers
- Return ONLY valid JSON

Return JSON:
{
  "models_found": [
    {"model": "4JH57", "manufacturer": "Yanmar", "type": "Engine", "description": "57HP 4-cylinder marine diesel engine", "context": "Main subject, listed in model specifications"},
    {"model": "SD60", "manufacturer": "Yanmar", "type": "Saildrive", "description": "Saildrive unit that connects engine to propeller for sailboat installations", "context": "Referenced in installation diagram and oil capacity table"}
  ]
}

If no product models found in this section, return: {"models_found": []}"""

    user_template = """This is chunk {chunk_num} of {total_chunks} from a technical manual.
Filename: {filename}

Content:
{text}"""

    total_tokens_in = 0
    total_tokens_out = 0
    all_findings = []

    for chunk in chunks:
        user_prompt = user_template.format(
            chunk_num=chunk['index'] + 1,
            total_chunks=len(chunks),
            filename=filename,
            text=chunk['text']
        )

        print(f"   Chunk {chunk['index']+1}/{len(chunks)}: chars {chunk['start']:,}-{chunk['end']:,} ({len(chunk['text']):,} chars)...", end='', flush=True)
        start = time.time()

        response = openai_client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            temperature=0,
            seed=42,
            max_tokens=2000,
            response_format={"type": "json_object"}
        )

        elapsed = time.time() - start
        result_text = response.choices[0].message.content
        usage = response.usage
        total_tokens_in += usage.prompt_tokens
        total_tokens_out += usage.completion_tokens

        result = json.loads(result_text)
        models_found = result.get('models_found', [])

        # Tag each finding with its chunk
        for m in models_found:
            m['chunk'] = chunk['index'] + 1

        all_findings.extend(models_found)
        print(f" {elapsed:.1f}s, {len(models_found)} models found")

    return all_findings, total_tokens_in, total_tokens_out


def reduce_phase(findings: list, filename: str, ref_data: dict, model: str) -> dict:
    """REDUCE: Classify all findings as primary vs referenced."""

    # Deduplicate findings by model name (keep all contexts and descriptions)
    model_map = {}
    for f in findings:
        key = f.get('model', '').strip().upper()
        if not key:
            continue
        if key not in model_map:
            model_map[key] = {
                'model': f.get('model', '').strip(),
                'manufacturer': f.get('manufacturer', ''),
                'type': f.get('type', ''),
                'description': f.get('description', ''),
                'contexts': [],
                'chunks': []
            }
        ctx = f.get('context', '')
        if ctx and ctx not in model_map[key]['contexts']:
            model_map[key]['contexts'].append(ctx)
        chunk = f.get('chunk', 0)
        if chunk and chunk not in model_map[key]['chunks']:
            model_map[key]['chunks'].append(chunk)
        # Keep best description (longest)
        desc = f.get('description', '')
        if desc and len(desc) > len(model_map[key].get('description', '')):
            model_map[key]['description'] = desc

    # Build findings summary for reduce prompt
    findings_text = []
    for key, info in sorted(model_map.items()):
        chunks_str = ', '.join(str(c) for c in sorted(info['chunks']))
        contexts_str = '; '.join(info['contexts'][:3])  # limit to 3 contexts
        desc = info.get('description', '')
        findings_text.append(
            f"- {info['model']} (mfr: {info['manufacturer']}, type: {info['type']}, "
            f"desc: \"{desc}\", "
            f"found in chunks: {chunks_str}, context: {contexts_str})"
        )

    ref_section = f"""
KNOWN VALUES (select from these when possible, or suggest new if no match):

MANUFACTURERS: {', '.join(ref_data['manufacturers']) if ref_data['manufacturers'] else 'None provided'}

PRODUCT TYPES: {', '.join(ref_data['product_types']) if ref_data['product_types'] else 'None provided'}

SYSTEM CATEGORIES: {', '.join(ref_data['system_categories']) if ref_data['system_categories'] else 'None provided'}

SUBSYSTEM CATEGORIES (grouped by system):
{chr(10).join([f"  - {s['name']} (under {s['system_name']})" for s in ref_data['subsystem_categories']]) if ref_data['subsystem_categories'] else 'None provided'}
"""

    system_prompt = f"""You are an expert at classifying products found in technical manuals for marine vessels.

You will receive a list of models/products extracted from different sections of a technical manual,
along with the filename, description, and context about where each was found.

Your job:

1. GROUP primary models into a FAMILY when they are related (same product line, same manufacturer).
   - The family has a "family_name" (e.g., "Yanmar JH-CR Series") and "family_aliases" — any
     series-level names found in the document (e.g., "3/4JH", "JH Series", "JH-CR").
   - Each individual model is listed as a "member" with its own display_name, aliases, description.
   - Series/family names like "3/4JH" or "JH Series" go into family_aliases, NOT as separate products.
   - If there is only one primary model, still use the family structure (family with one member).

2. LIST each referenced product as a FLAT entry with display_name and aliases.
   - Do NOT use family_name/members nesting for referenced products. Only primary_family uses that structure.
   - Each referenced product is one flat object with keys: display_name, aliases, type, manufacturer, description.

   CLUSTERING RULES — only cluster when names differ by a minor suffix/revision:
   - CLUSTER: "SD60-4" and "SD60-5" → display_name "SD60", aliases ["SD60", "SD60-4", "SD60-5"]
   - CLUSTER: "KM4A1" and "KM4A2" → display_name "KM4A", aliases ["KM4A1", "KM4A2"]
   - CLUSTER: "Halo20" and "Halo20+" → display_name "Halo20", aliases ["Halo20", "Halo20+"]

   NEVER cluster products that are fundamentally different — even if same manufacturer/category:
   - H5000, Hercules, Triton Edge → 3 SEPARATE entries (different sailing processors)
   - Halo20 and Halo24 → 2 SEPARATE entries (different radar units)
   - VC10, VC20, VC30 → 3 SEPARATE entries (different control systems)
   - ZF25 and ZF30M → 2 SEPARATE entries (different gearboxes)
   - FLIR M232 and FLIR M300 → 2 SEPARATE entries (different cameras)
   - AXIS P1244, IP CAM-1, IRIS S460 → 3 SEPARATE entries (different cameras)
   - GFS, PWE, CMCF, GFSF → 4 SEPARATE entries (different weather models)

   Rule: if the names share a common base and differ only by a number suffix, revision letter, or "+" → cluster.
   Otherwise → separate entries.

3. CLASSIFY referenced products:
   - REFERENCED products appear in compatibility tables, wiring diagrams, installation instructions.
   - They have meaningful technical content about how they integrate with the primary product.
   - Products appearing in multiple chunks with real content ARE referenced.
   - Do NOT include products only mentioned once in passing.

4. IDENTIFY for the manual overall:
   - MANUFACTURER, PRODUCT TYPE, SYSTEM CATEGORY, SUBSYSTEM CATEGORY
{ref_section}
Return ONLY valid JSON:
{{
  "manufacturer": "Yanmar",
  "product_type": "Engine",
  "system_category": "Propulsion",
  "subsystem_category": "Engines",
  "is_multi_model": true,
  "primary_family": {{
    "family_name": "Yanmar JH-CR Series",
    "family_aliases": ["3/4JH", "JH Series", "JH-CR", "3/4JH common rail"],
    "description": "Common-rail marine diesel engine series for sailboats and small craft",
    "members": [
      {{
        "display_name": "3JH40",
        "aliases": ["3JH40"],
        "type": "Engine",
        "manufacturer": "Yanmar",
        "description": "40HP 3-cylinder marine diesel engine"
      }},
      {{
        "display_name": "4JH57",
        "aliases": ["4JH57"],
        "type": "Engine",
        "manufacturer": "Yanmar",
        "description": "57HP 4-cylinder marine diesel engine"
      }}
    ]
  }},
  "referenced_products": [
    {{
      "display_name": "SD60",
      "aliases": ["SD60", "SD60-4", "SD60-5"],
      "type": "Saildrive",
      "manufacturer": "Yanmar",
      "description": "Saildrive unit connecting engine to propeller for sailboat installations"
    }},
    {{
      "display_name": "KM4A",
      "aliases": ["KM4A1", "KM4A2"],
      "type": "Marine Gear",
      "manufacturer": "Yanmar",
      "description": "Marine reduction gear for engine-to-shaft connection"
    }}
  ],
  "confidence": "high",
  "evidence": "Brief explanation of classification reasoning"
}}"""

    user_prompt = f"""Classify and cluster the following models extracted from a technical manual.

Filename: {filename}
Total chunks analyzed: {len(set(f.get('chunk', 0) for f in findings))}

Models/products found across the document:
{chr(10).join(findings_text)}

Group primary models into a family, cluster referenced product variants, and classify."""

    print(f"\n   Reduce: {len(model_map)} unique models to classify...", end='', flush=True)
    start = time.time()

    response = openai_client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        temperature=0,
        seed=42,
        max_tokens=4000,
        response_format={"type": "json_object"}
    )

    elapsed = time.time() - start
    result_text = response.choices[0].message.content
    usage = response.usage

    print(f" {elapsed:.1f}s")

    result = json.loads(result_text)
    return result, usage.prompt_tokens, usage.completion_tokens, model_map


def run_detection(doc_id: str, filename: str = None, chunk_size: int = 50000, overlap: int = 2000):
    print(f"\n{'='*70}")
    print(f"  MODEL DETECTION TEST — MAP-REDUCE")
    print(f"  chunk_size={chunk_size:,}, overlap={overlap:,}")
    print(f"{'='*70}\n")

    # Step 1: Fetch markdown
    print("1. Fetching markdown from Supabase Storage...")
    markdown = fetch_markdown_from_storage(doc_id)

    # Step 2: Fetch reference data
    print("\n2. Fetching reference data from Supabase...")
    ref_data = fetch_reference_data()
    print(f"   Manufacturers: {len(ref_data['manufacturers'])}")
    print(f"   Product types: {len(ref_data['product_types'])}")
    print(f"   System categories: {len(ref_data['system_categories'])}")
    print(f"   Subsystem categories: {len(ref_data['subsystem_categories'])}")

    # Step 3: Get filename
    if not filename:
        doc = supabase.table('documents').select('storage_path').eq('doc_id', doc_id).execute()
        if doc.data:
            filename = doc.data[0].get('storage_path', '').split('/')[-1]
        else:
            filename = 'unknown.pdf'
    print(f"\n   Filename: {filename}")

    # Step 4: Chunk the document
    print(f"\n3. Chunking document...")
    chunks = chunk_text(markdown, chunk_size, overlap)
    print(f"   {len(chunks)} chunks of ~{chunk_size:,} chars (overlap: {overlap:,})")

    model = os.getenv('MODEL_DETECTION_MODEL', 'gpt-4.1-mini')

    # Step 5: MAP phase
    print(f"\n4. MAP phase — scanning each chunk ({model}, temp=0, seed=42)...")
    total_start = time.time()
    findings, map_tokens_in, map_tokens_out = map_phase(chunks, filename, model)
    map_elapsed = time.time() - total_start
    print(f"\n   MAP complete: {len(findings)} total findings in {map_elapsed:.1f}s")
    print(f"   MAP tokens: {map_tokens_in:,} in, {map_tokens_out:,} out")

    # Step 6: Show raw findings
    print(f"\n{'='*70}")
    print(f"  RAW MAP FINDINGS ({len(findings)} total)")
    print(f"{'='*70}")
    for f in findings:
        print(f"   chunk {f.get('chunk', '?'):>2}: {f.get('model', '?'):20s}  type={f.get('type', '?'):20s}  mfr={f.get('manufacturer', '?'):15s}  ctx={f.get('context', '?')[:50]}")

    # Step 7: REDUCE phase
    print(f"\n5. REDUCE phase — classifying findings ({model}, temp=0, seed=42)...")
    result, reduce_tokens_in, reduce_tokens_out, model_map = reduce_phase(findings, filename, ref_data, model)
    total_elapsed = time.time() - total_start

    total_tokens_in = map_tokens_in + reduce_tokens_in
    total_tokens_out = map_tokens_out + reduce_tokens_out
    # gpt-4.1-mini pricing: $0.40/M input, $1.60/M output
    total_cost = (total_tokens_in * 0.40 + total_tokens_out * 1.60) / 1_000_000

    print(f"\n   Total time: {total_elapsed:.1f}s")
    print(f"   Total tokens: {total_tokens_in:,} in, {total_tokens_out:,} out")
    print(f"   Total cost: ~${total_cost:.4f}")

    # Step 8: Display results
    print(f"\n{'='*70}")
    print(f"  RESULTS")
    print(f"{'='*70}")
    print(f"\n  Manufacturer:      {result.get('manufacturer')}")
    print(f"  Product Type:      {result.get('product_type')}")
    print(f"  System Category:   {result.get('system_category')}")
    print(f"  Subsystem:         {result.get('subsystem_category')}")
    print(f"  Confidence:        {result.get('confidence')}")
    print(f"  Multi-model:       {result.get('is_multi_model')}")

    family = result.get('primary_family', {})
    referenced = result.get('referenced_products', [])

    # Also support old format fallback
    primary_list = result.get('primary_models', [])

    if family:
        print(f"\n  PRIMARY FAMILY: {family.get('family_name', '?')}")
        fam_aliases = family.get('family_aliases', [])
        if fam_aliases:
            print(f"    family aliases: {', '.join(fam_aliases)}")
        fam_desc = family.get('description', '')
        if fam_desc:
            print(f"    description:    {fam_desc}")

        members = family.get('members', [])
        print(f"\n    MEMBERS ({len(members)}):")
        for m in members:
            name = m.get('display_name', '?')
            aliases = m.get('aliases', [])
            desc = m.get('description', '')
            mfr = m.get('manufacturer', '')
            mtype = m.get('type', '')
            all_chunks = set()
            for a in aliases:
                info = model_map.get(a.strip().upper(), {})
                all_chunks.update(info.get('chunks', []))
            chunks_str = ', '.join(str(c) for c in sorted(all_chunks))
            aliases_str = ', '.join(aliases) if len(aliases) > 1 or (len(aliases) == 1 and aliases[0] != name) else ''
            print(f"      {name}")
            if aliases_str:
                print(f"        aliases:     {aliases_str}")
            print(f"        type:        {mtype}  |  mfr: {mfr}")
            print(f"        description: {desc}")
            print(f"        chunks:      {chunks_str}")
    elif primary_list:
        # Fallback: old format
        print(f"\n  PRIMARY MODELS ({len(primary_list)}):")
        for m in primary_list:
            if isinstance(m, dict):
                name = m.get('display_name', m.get('model', '?'))
                print(f"    - {name}")
            else:
                print(f"    - {m}")

    print(f"\n  REFERENCED PRODUCTS ({len(referenced)}):")
    for rp in referenced:
        if isinstance(rp, dict) and 'display_name' in rp:
            name = rp.get('display_name', '?')
            aliases = rp.get('aliases', [])
            desc = rp.get('description', '')
            mfr = rp.get('manufacturer', '')
            mtype = rp.get('type', '')
            all_chunks = set()
            for a in aliases:
                info = model_map.get(a.strip().upper(), {})
                all_chunks.update(info.get('chunks', []))
            chunks_str = ', '.join(str(c) for c in sorted(all_chunks))
            aliases_str = ', '.join(aliases) if len(aliases) > 1 or (len(aliases) == 1 and aliases[0] != name) else ''
            print(f"    {name}")
            if aliases_str:
                print(f"      aliases:     {aliases_str}")
            print(f"      type:        {mtype}  |  mfr: {mfr}")
            print(f"      description: {desc}")
            print(f"      chunks:      {chunks_str}")
        elif isinstance(rp, dict):
            # Old format with model key
            key = rp.get('model', '').strip().upper()
            info = model_map.get(key, {})
            chunks_str = ', '.join(str(c) for c in sorted(info.get('chunks', [])))
            print(f"    - {rp.get('model', '?'):20s}  type={rp.get('type', '?'):20s}  mfr={rp.get('manufacturer', '?'):15s}  (chunks: {chunks_str})")

    print(f"\n  Evidence: {result.get('evidence', 'N/A')}")

    # Step 9: Coverage check
    print(f"\n{'='*70}")
    print(f"  COVERAGE CHECK")
    print(f"{'='*70}")

    known_models = ['SD60', 'VC20', 'VC10', 'VC30', 'KM4A', 'KMH4A', 'ZF25', 'ZF30']

    # Collect all names from result (handle family + referenced format)
    all_detected = []
    # From primary family
    fam = result.get('primary_family', {})
    if fam:
        all_detected.extend(fam.get('family_aliases', []))
        for m in fam.get('members', []):
            all_detected.append(m.get('display_name', ''))
            all_detected.extend(m.get('aliases', []))
    # Fallback: old primary_models format
    for m in result.get('primary_models', []):
        if isinstance(m, dict):
            all_detected.append(m.get('display_name', ''))
            all_detected.extend(m.get('aliases', []))
        else:
            all_detected.append(m)
    # From referenced products
    for rp in result.get('referenced_products', []):
        if isinstance(rp, dict) and 'display_name' in rp:
            all_detected.append(rp.get('display_name', ''))
            all_detected.extend(rp.get('aliases', []))
        elif isinstance(rp, dict):
            all_detected.append(rp.get('model', ''))
    all_detected_upper = [m.upper().replace(' ', '').replace('-', '') for m in all_detected if m]

    # Also check raw map findings
    all_map_models = [f.get('model', '').upper().replace(' ', '').replace('-', '') for f in findings]

    for km in known_models:
        norm = km.upper().replace(' ', '').replace('-', '')
        in_result = any(norm in d for d in all_detected_upper)
        in_map = any(norm in d for d in all_map_models)
        if in_result:
            status = 'FOUND (in final result)'
            marker = '  '
        elif in_map:
            status = 'FOUND IN MAP but dropped in reduce'
            marker = '! '
        else:
            status = 'MISSING'
            marker = '**'
        print(f"  {marker} {km:10s} — {status}")

    # Step 10: Save results
    output_path = Path(__file__).parent / f"test-detection-mapreduce-{doc_id[:12]}.json"
    with open(output_path, 'w') as f:
        json.dump({
            'doc_id': doc_id,
            'filename': filename,
            'approach': 'map-reduce',
            'chunk_size': chunk_size,
            'overlap': overlap,
            'markdown_total_chars': len(markdown),
            'num_chunks': len(chunks),
            'model': model,
            'map_findings_count': len(findings),
            'map_findings': findings,
            'unique_models_found': len(model_map),
            'map_tokens_in': map_tokens_in,
            'map_tokens_out': map_tokens_out,
            'reduce_tokens_in': reduce_tokens_in,
            'reduce_tokens_out': reduce_tokens_out,
            'total_tokens_in': total_tokens_in,
            'total_tokens_out': total_tokens_out,
            'total_cost': total_cost,
            'total_time': total_elapsed,
            'result': result
        }, f, indent=2)
    print(f"\n  Raw result saved to: {output_path}")

    print(f"\n{'='*70}\n")
    return result


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python scripts/test-model-detection-mapreduce.py <doc_id> [--chunk-size=50000] [--overlap=2000]")
        print("\nExample:")
        print("  python scripts/test-model-detection-mapreduce.py 1a178ba54c77a95553a48a362166b3f09c0b24e6e0b634ba8a942d87e5b02df5")
        sys.exit(1)

    doc_id = sys.argv[1]
    chunk_size = 50000
    overlap = 2000
    filename = None

    for arg in sys.argv[2:]:
        if arg.startswith('--chunk-size='):
            chunk_size = int(arg.split('=')[1])
        elif arg.startswith('--overlap='):
            overlap = int(arg.split('=')[1])
        else:
            filename = arg

    run_detection(doc_id, filename, chunk_size, overlap)
