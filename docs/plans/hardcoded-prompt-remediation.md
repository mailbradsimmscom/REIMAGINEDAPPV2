# Hardcoded Prompt Remediation Plan

**Created:** 2026-01-21  
**Status:** Ready for implementation  
**Scope:** Production LLM prompts only

---

## Background

When using AI with the same test documents repeatedly, specific product names and examples can become hardcoded into prompts. This can bias the model toward those products and reduce generalization. This plan inventories and remediates hardcoded content across production LLM prompts.

---

## Decisions (Pre-Implementation)

| Decision | Choice |
|----------|--------|
| **Scope** | Fix all 5 production prompts identified |
| **Example approach** | Diversify examples — mix brands (Yanmar, B&G, Fortress, Victron, Schenker, etc.) so no single product dominates |
| **Weather fallbacks** | Keep as-is — app is Caribbean-focused; fallbacks only used when area/preferences missing |
| **Test scripts** | Leave as-is — hardcoded doc IDs and model names are acceptable test fixtures |
| **Synonyms duplication** | Update both `keywords-synonyms-generation.service.js` and `scripts/bulk/generate-keywords-synonyms.js` to keep in sync |

---

## Work Items

### 1. CLASSIFICATION_PROMPT_TEMPLATE

**File:** `python-sidecar/app/chat/config/system_prompts.py`

**Current:** JSON example uses `"search_keywords": ["anchor", "fortress", "specifications"]`

**Issue:** "anchor" and "fortress" are specific product examples; may bias toward Fortress anchor.

**Change:** Diversify to a mix of equipment types and brands, e.g.:
```json
"search_keywords": ["anchor", "chartplotter", "watermaker", "specifications"]
```
(or similar mix across brands/types)

---

### 2. SYNTHESIS_INSTRUCTIONS

**File:** `python-sidecar/app/chat/config/system_prompts.py`

**Current:** "Marco pumps, Victron systems, Schenker watermakers"

**Issue:** Only three brands; may bias toward these.

**Change:** Add more brands so no single product dominates, e.g.:
- Marco pumps, Victron inverters, Schenker watermakers, B&G chartplotters, Fortress anchors, Yanmar engines

---

### 3. Model Detection Prompt (JSON Example)

**File:** `python-sidecar/app/main.py` (lines ~529–543)

**Current:** JSON example uses only Yanmar:
- `primary_models`: ["3JH40", "4JH45", "4JH57", "4JH80", "4JH110"]
- `referenced_products`: VC10, VC20, KM35 (all Yanmar)

**Issue:** Model may favor Yanmar-style outputs.

**Change:** Diversify primary_models and referenced_products in the example — include mix of Yanmar + B&G + Schenker (or similar) so example isn't Yanmar-only.

---

### 4. Equipment Extraction Prompt

**File:** `src/services/equipment-extraction.service.js`

**Current:** Examples use V100, Zeus, fortress anchor, harken winches (B&G, Fortress, Harken).

**Change:** Add examples from other brands (Victron, Schenker, Yanmar, etc.) so the mix is balanced.

---

### 5. Synonyms Prompts

**Files:**
- `src/services/keywords-synonyms-generation.service.js`
- `scripts/bulk/generate-keywords-synonyms.js`

**Current:** Examples use DST810, HALO24, NAIS500 (all B&G/Raymarine).

**Change:** Add format examples from other brands (Victron, Schenker, Fortress, Yanmar) in the same format. Update both files to stay in sync.

---

## Out of Scope

| Item | Reason |
|------|--------|
| Weather route fallbacks | Fallbacks only; used when area/preferences missing. App is Caribbean-focused. |
| Test scripts | Hardcoded doc IDs and model names are acceptable test fixtures. |
| Docstring examples | e.g. `normalize-model-key.js` — illustrative only, not sent to LLM. |

---

## Files to Modify

| # | File | Prompt(s) |
|---|------|-----------|
| 1 | `python-sidecar/app/chat/config/system_prompts.py` | CLASSIFICATION_PROMPT_TEMPLATE, SYNTHESIS_INSTRUCTIONS |
| 2 | `python-sidecar/app/main.py` | Model detection JSON example |
| 3 | `src/services/equipment-extraction.service.js` | EXTRACTION_PROMPT |
| 4 | `src/services/keywords-synonyms-generation.service.js` | SYNONYMS_PROMPT |
| 5 | `scripts/bulk/generate-keywords-synonyms.js` | SYNONYMS_PROMPT |

---

## Validation

After changes:

1. Run existing tests that touch these prompts (equipment extraction, chat flow, DIP extraction).
2. Spot-check: run a few chat queries with diverse equipment (not just Fortress/Yanmar) and confirm responses are balanced.
3. Verify bulk synonym script still runs correctly.

---

## Reference: Weather Fallbacks (Not in Scope)

For context, these are the hardcoded fallbacks in `maintenance-agent/src/routes/weather.route.js`:

| Fallback | Value | When used |
|----------|-------|-----------|
| `area?.name \|\| 'Caribbean'` | Caribbean | When area.name missing |
| `area?.name \|\| 'Guadeloupe'` | Guadeloupe | When area.name missing (outlook prompt) |
| `area?.lat \|\| '16.2'` | 16.2°N | When area.lat missing |
| `area?.lng \|\| '-61.5'` | -61.5°W | When area.lng missing |
| `preferWind \|\| 20` | 20 kn | When preference missing |
| `maxWind \|\| 25` | 25 kn | When preference missing |
| `preferWave \|\| 1.3` | 1.3 m | When preference missing |
| `maxWave \|\| 1.5` | 1.5 m | When preference missing |
| `minPeriod \|\| 6` | 6 s | When preference missing |

Also: "in the Caribbean" and "January" are hardcoded in the outlook prompt text. All are fallbacks only.
