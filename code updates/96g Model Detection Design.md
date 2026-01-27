# 96g Model Detection Design

**Date:** 2026-01-15
**Status:** Design Complete
**Parent Documents:** 96d, 96e, 96f

---

## Key Insights from Testing

### 1. Full Document Scan Required

**15K chars is NOT enough.** Model references are scattered throughout documents:
- Yanmar manual: 391K chars, models mentioned 150+ times throughout
- Zeus 3S manual: 343K chars, product references throughout

**Regex won't work.** Need context to understand:
- VC10, VC20, VC30 are "Vessel Control Systems" not sail drives
- Need to distinguish primary models vs referenced products

### 2. Document Complexity Varies

| Type | Example | Model Detection |
|------|---------|-----------------|
| **Simple** | Single bilge pump manual | Auto-continue, no pause |
| **Multi-model** | Yanmar 5-engine family | Pause, ask user which model |
| **Multi-integration** | Zeus 3S + 20 accessories | Note references, maybe pause |

### 3. Primary vs Referenced Products

**Yanmar Manual:**
- **Primary models:** 3JH40, 4JH45, 4JH57, 4JH80, 4JH110
- **Referenced:** VC10/VC20/VC30 (control systems), KM35/KM4 (gears), SD60

**Zeus 3S Manual:**
- **Primary model:** Zeus 3S (all screen sizes)
- **Referenced:** Halo radar, ForwardScan, H5000, Triton, 20+ products

### 4. System Relationships Matter

User has Zeus 3S + Halo 24+ → Need content from BOTH manuals:
- Zeus manual: "How to configure radar overlay"
- Halo manual: "Radar specifications, range settings"

---

## LLM Models for Detection

From `.env`:

| Variable | Model | Cost (per 1M tokens) | Use For |
|----------|-------|---------------------|---------|
| `OPENAI_MODEL` | gpt-5.1-chat-latest | Higher | Main chat |
| `OPENAI_SUMMARY_MODEL` | **gpt-4.1-mini** | ~$0.15 input | Model detection ✅ |
| `VISION_MODEL` | gpt-4o | Medium | Photo analysis |

### Cost for Model Detection

Full Yanmar manual (~100K tokens):
- gpt-4.1-mini: **~$0.015** (1.5 cents)
- Acceptable for every upload

---

## Test Markdown Files

LlamaParse output saved for testing:

```
/Users/brad/code/REIMAGINEDAPPV2/python-sidecar/llamaparse_output/
├── 0AJHC-EN001F-Sep.2025-0_JH-CR_OPM_20250917_markdown.md  (Yanmar 4JH CR - 391K chars)
└── Zeus3S_OM_EN_005_w_markdown.md                          (B&G Zeus 3S - 343K chars)
```

### Yanmar Manual Stats
- **PDF:** 32 MB, 230 pages
- **Markdown:** 385 KB, 391,285 chars (~98K tokens)
- **Primary models:** 3JH40, 4JH45, 4JH57, 4JH80, 4JH110
- **Marine gears:** KM35, KM4, ZF25, SD60-5
- **Control systems:** VC10, VC20, VC30

### Zeus 3S Manual Stats
- **PDF:** 14.6 MB, 167 pages
- **Markdown:** 335 KB, 342,866 chars (~86K tokens)
- **Primary model:** Zeus 3S
- **Referenced products:** ForwardScan (44x), Halo (4x), Broadband (7x), + 20 others

---

## Model Detection Prompt Design

Send full markdown to gpt-4.1-mini with prompt:

```
Analyze this technical manual and identify:

1. PRIMARY PRODUCTS: What specific product model(s) is this manual FOR?
   - List exact model numbers (e.g., "4JH57", "Zeus 3S")
   - Is this a multi-model manual covering a product family?

2. REFERENCED PRODUCTS: What other products are mentioned but not the main subject?
   - Compatible accessories
   - Related systems
   - Integration partners

3. PRODUCT RELATIONSHIPS: How do the primary and referenced products connect?

Return as JSON:
{
  "primary_models": ["4JH45", "4JH57", "4JH80", "4JH110", "3JH40"],
  "is_multi_model": true,
  "referenced_products": ["VC10", "VC20", "VC30", "KM35", "KM4"],
  "product_category": "Marine Diesel Engine",
  "manufacturer": "Yanmar"
}
```

---

## Pipeline Integration

### Where Model Detection Fits

```
1. uploading       → PDF to Supabase Storage
2. verifying       → File validation
3. parsing         → LlamaParse → markdown
   └── NEW: Save markdown to storage/file
4. model_detection → gpt-4.1-mini analyzes full markdown
   └── Returns: primary_models, is_multi_model, referenced_products
5. model_selection → IF is_multi_model: pause, show UI
   └── User selects their specific model
6. vision_analysis → (future)
7. figure_cropping → (future)
8. chunking        → Tag chunks with applies_to_models
9. embedding       → Include model in Pinecone metadata
10-14. Continue...
```

### Storing the Markdown

Save LlamaParse markdown for:
1. Model detection (immediate use)
2. Reprocessing without re-parsing (cost savings)
3. Debugging/testing
4. Future vision analysis

Storage location options:
- Supabase Storage: `/markdown/{doc_id}/parsed.md`
- Local file: Already done for testing

---

## Next Steps

1. **Build model detection endpoint** in Python sidecar
   - Input: markdown text (or doc_id to fetch from storage)
   - Output: JSON with primary_models, is_multi_model, etc.
   - Uses: OPENAI_SUMMARY_MODEL (gpt-4.1-mini)

2. **Store markdown after parsing**
   - Add to pipeline after LlamaParse step
   - Save to Supabase Storage

3. **Test against saved markdown files**
   - Yanmar: Should detect 5 primary models + references
   - Zeus: Should detect 1 primary model + 20 references

4. **Build model selection UI** (if multi-model detected)
   - Show checkboxes for detected models
   - Pre-select user's uploaded model if it matches

---

## Script for Testing

Created: `scripts/extract-llamaparse-markdown.py`

```bash
# Extract markdown from any PDF
/Users/brad/code/REIMAGINEDAPPV2/python-sidecar/.venv/bin/python \
  scripts/extract-llamaparse-markdown.py \
  "/path/to/manual.pdf"

# Output saved to: python-sidecar/llamaparse_output/{filename}_markdown.md
```

---

*This document captures model detection design decisions from 2026-01-15 session.*
