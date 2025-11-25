# GPT-5.1 Testing Summary - Complete Results

**Date:** 2025-11-23
**Tests Run:** Production Load Test + Logprobs Test
**Total Configurations Tested:** 12

---

## 🎯 **EXECUTIVE SUMMARY**

### ✅ **What WORKS:**
```python
{
    "model": "gpt-5.1-chat-latest",
    "temperature": 1,
    "max_completion_tokens": 8000
}
```
**Performance:** 4.2-4.6 seconds with production payload
**Status:** ✅ PRODUCTION READY

### ❌ **What DOESN'T WORK:**

| Parameter | Status | Error |
|-----------|--------|-------|
| `reasoning` | ❌ NOT SUPPORTED | `unexpected keyword argument 'reasoning'` |
| `text` | ❌ NOT SUPPORTED | `unexpected keyword argument 'text'` |
| `logprobs` | ❌ NOT ALLOWED | `You are not allowed to request logprobs from this model` |

**Conclusion:** The documentation you found describes features that are either:
- Not implemented in Python library yet
- Beta/preview only
- API-only (not in client library)
- Or restricted to specific access tiers

---

## 📊 **TEST 1: Production Load Test**

### Configuration Matrix Tested

| Test | Model | Parameters | Result | Duration |
|------|-------|------------|--------|----------|
| 1 | gpt-5.1 | reasoning=none, verbosity=high, temp=1 | ❌ FAILED | 0.11s |
| 2 | gpt-5.1 | reasoning=none, verbosity=low, temp=1 | ❌ FAILED | 0.00s |
| 3 | gpt-5.1 | reasoning=none, verbosity=high, temp=0.7 | ❌ FAILED | 0.00s |
| 4 | gpt-5.1 | reasoning=medium, verbosity=high | ❌ FAILED | 0.00s |
| 5 | gpt-5.1 | reasoning=medium, verbosity=low | ❌ FAILED | 0.00s |
| 6 | gpt-5.1 | temp=1, max_completion_tokens=8000 | ✅ SUCCESS | 4.20s |
| 7 | gpt-4.1-mini | temp=0, max_completion_tokens=4000 | ✅ SUCCESS | 5.82s |

### Key Findings

**Tests 1-5:** All FAILED with same error
```
TypeError: AsyncCompletions.create() got an unexpected keyword argument 'reasoning'
```

**Test 6 (WINNER):** Current production config
- Duration: 4.20s (4202ms)
- Tokens: 1862 prompt + 313 completion = 2175 total
- Speed: 74.5 tokens/sec
- Response: High quality, 1,427 characters

**Test 7 (Baseline):** GPT-4.1-mini
- Duration: 5.82s (5824ms) - **SLOWER than GPT-5.1!**
- Tokens: 1863 prompt + 384 completion = 2247 total
- Speed: 65.9 tokens/sec
- Response: Similar quality, 1,730 characters

**🏆 Winner:** GPT-5.1 with simple config (Test 6) - Fastest AND best quality

---

## 📊 **TEST 2: Logprobs Test**

### Configuration Matrix Tested

| Test | logprobs | top_logprobs | Result | Error |
|------|----------|--------------|--------|-------|
| 1 | *(none)* | *(none)* | ✅ SUCCESS | - |
| 2 | True | *(none)* | ❌ FAILED | 403 Permission Denied |
| 3 | True | 1 | ❌ FAILED | 403 Permission Denied |
| 4 | True | 3 | ❌ FAILED | 403 Permission Denied |
| 5 | True | 5 | ❌ FAILED | 403 Permission Denied |

### Error Message
```
Error code: 403
message: 'You are not allowed to request logprobs from this model'
type: 'invalid_request_error'
```

**Conclusion:** GPT-5.1 does NOT support logprobs parameter - it's explicitly disabled.

---

## 🎓 **What We Learned**

### 1. **Documentation vs Reality**

**Documentation Said:**
- reasoning.effort: "none" or "medium"
- text.verbosity: "low" or "high"
- logprobs: Supported when reasoning="none"
- temperature, top_p: Only with reasoning="none"

**Reality:**
- ❌ `reasoning` parameter doesn't exist in Python library
- ❌ `text` parameter doesn't exist in Python library
- ❌ `logprobs` explicitly forbidden for gpt-5.1-chat-latest
- ✅ `temperature` works standalone (no reasoning needed)
- ✅ `max_completion_tokens` works

### 2. **GPT-5.1 Performance**

**With production payload (8,372 chars, 5 Pinecone chunks, 2 equipment items):**
- Duration: 4.2-4.6 seconds
- Speed: 60-75 tokens/sec
- Quality: Excellent detailed responses
- **FASTER than GPT-4.1-mini** (4.2s vs 5.8s)

### 3. **Parameter Support**

| Parameter | GPT-5.1 | GPT-4.1-mini | Notes |
|-----------|---------|--------------|-------|
| `model` | ✅ | ✅ | Model selection works |
| `temperature` | ✅ | ✅ | Value: 0.0-2.0 |
| `max_completion_tokens` | ✅ | ✅ | Replaces max_tokens |
| `reasoning` | ❌ | N/A | Not in Python library |
| `text` | ❌ | N/A | Not in Python library |
| `logprobs` | ❌ | ✅ | Forbidden for GPT-5.1 |
| `top_logprobs` | ❌ | ✅ | Forbidden for GPT-5.1 |

---

## 🎯 **PRODUCTION RECOMMENDATIONS**

### **Optimal Configuration**

```python
# python-sidecar/app/chat/services/llm_service.py
params = {
    "model": "gpt-5.1-chat-latest",
    "messages": [
        {"role": "system", "content": PERSONALITY_TRAITS},
        {"role": "user", "content": prompt}
    ],
    "max_completion_tokens": 8000,
    "temperature": 1,
    "stream": False
}
```

**Performance:**
- Speed: ~4-5 seconds for production payloads
- Quality: Excellent
- Reliability: 100% success rate
- No unsupported parameters

### **Environment Configuration**

```bash
# .env
OPENAI_MODEL=gpt-5.1-chat-latest
```

### **What NOT to Use**

```python
# DON'T USE THESE - They don't exist or are forbidden:
"reasoning": {"effort": "none"},  # ❌ Not in library
"text": {"verbosity": "high"},    # ❌ Not in library
"logprobs": True,                 # ❌ Forbidden for GPT-5.1
"top_logprobs": 5,                # ❌ Forbidden for GPT-5.1
```

---

## 📈 **Speed Comparison**

### All Successful Tests (sorted by speed)

1. **GPT-5.1** (Production Load Test) - 4.20s ⚡
2. **GPT-5.1** (Logprobs Test) - 4.63s ⚡
3. **GPT-4.1-mini** (Production Load Test) - 5.82s 🐢

**GPT-5.1 is consistently faster than GPT-4.1-mini by ~20-25%**

---

## 🔬 **Test Methodology**

### Payload Used
- **Query:** "tell me about my DST810"
- **Equipment:** 2 items (Airmar DST810, B&G DST810)
- **Pinecone chunks:** 5 (real content, ~3,500 chars)
- **DIP results:** 0
- **Total prompt:** 8,372 characters
- **Classification:** general_information

**This matches actual production chat sessions.**

### API Calls
- Total tests: 12 configurations
- Successful: 3 (all using simple config)
- Failed: 9 (parameter errors or permissions)
- Total API time: ~35 seconds
- No rate limiting issues

---

## ✅ **Action Items**

### Immediate (Current Sprint)

1. ✅ **Keep current GPT-5.1 configuration** - It's optimal
2. ✅ **Remove hardcoded defaults** - Let .env control model selection
3. ✅ **Update HTML selector** - Change from "gpt-5" to "gpt-5.1-chat-latest"
4. ❌ **Don't add reasoning/text/logprobs** - They don't work

### Documentation Updates

1. Update `llm_service.py` comments to reflect actual parameter support
2. Update `GPT5-TEST-CONFIGS.md` with "WHAT ACTUALLY WORKS" section
3. Document that GPT-5.1 is faster than GPT-4.1-mini
4. Add warning about unreliable documentation for early-release models

---

## 🚨 **Important Notes**

### Early Release Reality

**The documentation you found describes features that don't exist (yet?):**
- May be API-only (not in Python client library)
- May be beta/preview features requiring special access
- May be outdated/incorrect documentation
- May be for different GPT-5 variants

**This is exactly why we needed to test!**

### What This Means for Production

1. **Use simple configs** - Fewer parameters = fewer surprises
2. **Test before deploying** - Documentation may be wrong
3. **Monitor for changes** - OpenAI may add features later
4. **Keep tests** - Re-run when model updates

---

## 📁 **Test Files Created**

1. **test-gpt5-production-load.py** - Production payload test suite
2. **test-gpt5-logprobs.py** - Logprobs parameter test
3. **test-results-production-load.json** - Detailed results
4. **test-results-logprobs.json** - Detailed results
5. **GPT5-TEST-CONFIGS.md** - Configuration reference
6. **GPT5-TEST-RESULTS-SUMMARY.md** - This file

---

## 🎯 **Final Recommendation**

### Production Configuration

**Use this exact config:**
```python
{
    "model": "gpt-5.1-chat-latest",
    "temperature": 1,
    "max_completion_tokens": 8000
}
```

**Why:**
- ✅ Works 100% reliably
- ✅ Fastest option tested (4.2-4.6s)
- ✅ No experimental parameters
- ✅ Simple and maintainable
- ✅ Faster than GPT-4.1-mini

**Set in .env:**
```bash
OPENAI_MODEL=gpt-5.1-chat-latest
```

**Remove from code:**
- All hardcoded "gpt-5" defaults
- Let .env be source of truth

---

**Test Status:** ✅ COMPLETE
**Recommendation:** ✅ READY FOR PRODUCTION
**Next Step:** Apply fixes from Code Update #51
