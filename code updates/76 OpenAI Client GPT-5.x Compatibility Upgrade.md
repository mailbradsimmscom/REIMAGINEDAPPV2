# OpenAI Client GPT-5.x Compatibility Upgrade

**Date:** 2026-01-11
**Status:** Proposed (Not Implemented)
**Priority:** High
**Risk:** Medium-High (affects multiple features)

---

## Executive Summary

The shared OpenAI client (`src/clients/openai.client.js`) uses legacy Chat Completions API parameters that are incompatible or ignored by GPT-5.x models. This causes:
- Token limits being ignored
- Non-deterministic outputs despite `temperature: 0`
- Silent failures with `seed` parameter
- Inconsistent behavior across environments

**Recommendation:** Refactor the client to detect model family and use the correct API contract.

---

## Current State

### File Location
`src/clients/openai.client.js`

### Functions Affected

| Function | Used By | Current Issues |
|----------|---------|----------------|
| `oaiText()` | chat-completion.service.js, (season-recap isolated) | `max_completion_tokens` ignored, `seed` ignored, `temperature` unreliable |
| `oaiJson()` | equipment-extraction.service.js | Same issues + JSON mode may behave differently |
| `oaiVision()` | supplies photo analysis | `max_tokens` vs `max_output_tokens` mismatch |
| `oaiVisionMulti()` | supplies multi-photo analysis | Same as oaiVision |

### Current Parameter Usage (Problematic)

```javascript
const requestBody = {
  model: openaiModel,
  messages: [
    { role: 'system', content: system },
    { role: 'user', content: user }
  ],
  max_completion_tokens: maxTokens,  // ❌ Ignored by GPT-5.x
  temperature,                        // ❌ Ignored or unreliable
  seed: seed || 11,                   // ❌ Not supported
  response_format: { type: "json_object" }  // ⚠️ May behave differently
};
```

---

## Problem Details

### 1. `max_completion_tokens` vs `max_output_tokens`

| Model Family | Correct Parameter |
|--------------|-------------------|
| GPT-4, GPT-4-turbo | `max_completion_tokens` |
| GPT-4.1+, GPT-5.x | `max_output_tokens` |

**Symptom:** Responses truncate early or use default ~1k tokens.

### 2. `temperature` Parameter

| Model Family | Behavior |
|--------------|----------|
| GPT-4 | Works as expected (0 = deterministic) |
| GPT-5.x | Ignored unless using specific reasoning modes |

**Symptom:** "Boring" vs "creative" style distinction doesn't work.

**Solution:** Enforce tone via prompt, not temperature:
```
Tone: strictly technical, factual, concise. Avoid narrative language.
```

### 3. `seed` Parameter

| Model Family | Behavior |
|--------------|----------|
| GPT-4 | Supported for reproducibility |
| GPT-5.x | Silently ignored |

**Symptom:** False confidence in reproducible outputs.

### 4. `messages` vs `input`

The Responses API (GPT-5.x native) uses `input` instead of `messages`, though there's a compatibility layer that accepts `messages`.

---

## Recommended Fix

### Option A: Minimal Patch (Quick Fix)

Just swap the parameter name:

```diff
const requestBody = {
  model: openaiModel,
  messages: [...],
- max_completion_tokens: maxTokens,
+ max_output_tokens: maxTokens,
  temperature,
- seed: seed || 11
};
```

**Pros:** Fast, low risk
**Cons:** Still fragile, doesn't address temperature/seed issues

---

### Option B: Model Family Detection (Recommended)

Add intelligent model detection and use correct API shape:

```javascript
/**
 * Detect if model uses Responses API (GPT-5.x, GPT-4.1+)
 */
function isResponsesModel(model) {
  return model.startsWith('gpt-5') ||
         model.startsWith('gpt-4.1') ||
         model.includes('gpt-5');
}

/**
 * Build request body based on model family
 */
function buildRequestBody({ model, system, user, maxTokens, temperature, isJson }) {
  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: user }
  ];

  if (isResponsesModel(model)) {
    // GPT-5.x / GPT-4.1+ (Responses API)
    return {
      model,
      messages,  // Compatibility layer accepts messages
      max_output_tokens: maxTokens
      // Note: temperature and seed not supported
    };
  } else {
    // Legacy GPT-4 (Chat Completions API)
    return {
      model,
      messages,
      max_completion_tokens: maxTokens,
      temperature: temperature ?? 0.7,
      ...(isJson && { response_format: { type: "json_object" } })
    };
  }
}
```

### Option C: Separate Functions (Safest)

Create new functions for GPT-5.x and deprecate old ones:

```javascript
// New functions
export async function gpt5Text({ system, user, maxTokens }) { ... }
export async function gpt5Json({ system, user, schema, maxTokens }) { ... }
export async function gpt5Vision({ system, user, imageUrl, maxTokens }) { ... }

// Mark old functions as deprecated
/** @deprecated Use gpt5Text for GPT-5.x models */
export async function oaiText({ ... }) { ... }
```

**Pros:** Zero risk to existing features
**Cons:** More code, migration needed over time

---

## Implementation Plan

### Phase 1: Audit (1 hour)
- [ ] Search codebase for all `oaiText`, `oaiJson`, `oaiVision`, `oaiVisionMulti` usages
- [ ] Document current behavior in each location
- [ ] Identify which features need deterministic output

### Phase 2: Implement (2-3 hours)
- [ ] Add `isResponsesModel()` detection function
- [ ] Update `oaiText()` with model-aware logic
- [ ] Update `oaiJson()` with model-aware logic
- [ ] Update `oaiVision()` and `oaiVisionMulti()` with model-aware logic
- [ ] Move style/tone enforcement to prompts where needed

### Phase 3: Test (2-3 hours)
- [ ] Test chat completion with GPT-5.x
- [ ] Test equipment extraction with GPT-5.x
- [ ] Test supplies photo analysis with GPT-5.x
- [ ] Test with fallback to GPT-4 (if OPENAI_MODEL unset)
- [ ] Verify no regressions in existing functionality

### Phase 4: Deploy
- [ ] Deploy to staging
- [ ] Monitor for errors
- [ ] Deploy to production

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/clients/openai.client.js` | Add model detection, update all 4 functions |
| `src/services/chat-completion.service.js` | May need prompt adjustments for tone |
| `src/services/equipment-extraction.service.js` | Verify JSON extraction still works |
| `src/services/supplies/supplies.service.js` | Verify vision analysis still works |

---

## Testing Checklist

### Chat Completion
- [ ] Basic question answering works
- [ ] Conversation context preserved
- [ ] Response length appropriate (not truncated)

### Equipment Extraction
- [ ] JSON output is valid
- [ ] All expected fields populated
- [ ] Manufacturer/model normalization works

### Supplies Photo Analysis
- [ ] Single image analysis works
- [ ] Multi-image analysis works
- [ ] Item detection accurate
- [ ] Category suggestions reasonable

### Season Recap (Already Isolated)
- [x] Boring recap generates correctly
- [x] Exciting recap generates correctly
- [x] HTML formatting correct

---

## Rollback Plan

If issues arise after deployment:

1. Revert `src/clients/openai.client.js` to previous version
2. Set `OPENAI_MODEL=gpt-4o` in environment (known working model)
3. Restart services

---

## Environment Variables

Ensure these are set correctly:

| Variable | Current | Notes |
|----------|---------|-------|
| `OPENAI_MODEL` | `gpt-5.1-chat-latest` | Primary model |
| `OPENAI_API_KEY` | (set) | API authentication |
| `VISION_MODEL` | `gpt-4o` | May need update for GPT-5.x vision |
| `LLM_TEMPERATURE` | `0.7` | Will be ignored by GPT-5.x |

---

## References

- [OpenAI API Migration Guide](https://platform.openai.com/docs/guides/migration)
- [GPT-5 Model Card](https://platform.openai.com/docs/models/gpt-5)
- [Responses API Documentation](https://platform.openai.com/docs/api-reference/responses)

---

## Current Workaround

The Season Recap feature (`src/services/season-recap/season-recap.service.js`) uses a direct OpenAI call with correct GPT-5.x parameters, bypassing the shared client. This serves as a working reference implementation.

```javascript
async function callOpenAI(systemPrompt, userPrompt) {
  const env = getEnv();
  const model = env.OPENAI_MODEL || 'gpt-4o';

  const requestBody = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    max_output_tokens: 4000
  };

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(requestBody)
  });

  const data = await response.json();
  return data.choices[0].message.content.trim();
}
```

---

## Decision Required

**Before implementing, decide:**

1. **Which option?** A (minimal), B (recommended), or C (safest)?
2. **Timeline?** Immediate or schedule for later sprint?
3. **Testing scope?** Full regression or targeted?

---

*Document created: 2026-01-11*
*Author: Claude Code*
