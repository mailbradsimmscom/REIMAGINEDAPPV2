# GPT-5.1 Test Configuration Matrix

**Based on:** OpenAI GPT-5.1 documentation
**Test File:** `test-gpt5-production-load.py`
**Payload:** REALISTIC production load (2 equipment, 5 Pinecone chunks, ~6,500 char prompt)

---

## 🔑 Key GPT-5.1 Parameters Discovered

### **1. reasoning.effort**
Controls reasoning mode:
- `"none"` - Fast mode, allows temperature/top_p/logprobs
- `"medium"` - Reasoning mode, NO temperature/top_p/logprobs allowed

### **2. text.verbosity**
Controls response detail level:
- `"low"` - Concise responses
- `"high"` - Detailed responses

### **3. temperature** ⚠️
**ONLY works when `reasoning.effort="none"`**
- Values: 0.0 to 2.0
- Cannot be used with `reasoning.effort="medium"`

### **4. top_p, logprobs** ⚠️
**ONLY works when `reasoning.effort="none"`**
- Same constraint as temperature

---

## 📊 7 Test Configurations

### **TEST 1: reasoning=none, temp=1, verbosity=high (RECOMMENDED)**
```python
{
    "model": "gpt-5.1-chat-latest",
    "reasoning": {"effort": "none"},
    "text": {"verbosity": "high"},
    "temperature": 1,
    "max_completion_tokens": 8000
}
```
**Why:** Fast mode with detailed responses and maximum creativity.
**Expected:** ~3-4 seconds, high-quality detailed answers.

---

### **TEST 2: reasoning=none, temp=1, verbosity=low**
```python
{
    "model": "gpt-5.1-chat-latest",
    "reasoning": {"effort": "none"},
    "text": {"verbosity": "low"},
    "temperature": 1,
    "max_completion_tokens": 8000
}
```
**Why:** Fast mode with concise responses.
**Expected:** ~3-4 seconds, shorter answers, possibly faster completion.

---

### **TEST 3: reasoning=none, temp=0.7, verbosity=high**
```python
{
    "model": "gpt-5.1-chat-latest",
    "reasoning": {"effort": "none"},
    "text": {"verbosity": "high"},
    "temperature": 0.7,
    "max_completion_tokens": 8000
}
```
**Why:** Test lower temperature for more deterministic responses.
**Expected:** ~3-4 seconds, more focused/consistent answers.

---

### **TEST 4: reasoning=medium, verbosity=high**
```python
{
    "model": "gpt-5.1-chat-latest",
    "reasoning": {"effort": "medium"},
    "text": {"verbosity": "high"},
    # NO temperature - not allowed
    "max_completion_tokens": 8000
}
```
**Why:** Test reasoning mode - does it improve quality?
**Expected:** SLOWER (possibly 10-30s), higher reasoning quality.
**Risk:** This was the OLD broken config - may cause errors.

---

### **TEST 5: reasoning=medium, verbosity=low**
```python
{
    "model": "gpt-5.1-chat-latest",
    "reasoning": {"effort": "medium"},
    "text": {"verbosity": "low"},
    # NO temperature - not allowed
    "max_completion_tokens": 8000
}
```
**Why:** Reasoning mode with concise output.
**Expected:** SLOWER, shorter but well-reasoned answers.

---

### **TEST 6: NO reasoning param, temp=1 (CURRENT PRODUCTION)**
```python
{
    "model": "gpt-5.1-chat-latest",
    "temperature": 1,
    "max_completion_tokens": 8000
    # NO reasoning parameter
    # NO text.verbosity parameter
}
```
**Why:** This is what we currently use - what's the default?
**Expected:** ~3-4 seconds (we know this works).
**Question:** What defaults does OpenAI use?

---

### **TEST 7: GPT-4.1-mini (BASELINE)**
```python
{
    "model": "gpt-4.1-mini",
    "temperature": 0,
    "max_completion_tokens": 4000
}
```
**Why:** Baseline for speed/cost comparison.
**Expected:** ~2-3 seconds (fastest).

---

## 🎯 What We're Testing

### Speed Comparison
| Config | reasoning.effort | text.verbosity | temperature | Expected Speed |
|--------|-----------------|----------------|-------------|----------------|
| **Test 1** | none | high | 1 | ~3-4s |
| **Test 2** | none | low | 1 | ~3-4s |
| **Test 3** | none | high | 0.7 | ~3-4s |
| **Test 4** | medium | high | N/A | ~10-30s? |
| **Test 5** | medium | low | N/A | ~10-30s? |
| **Test 6** | *(default)* | *(default)* | 1 | ~3-4s |
| **Test 7** | N/A | N/A | 0 | ~2-3s |

### Quality Comparison
- **verbosity=high** vs **verbosity=low** - Detail level
- **reasoning=none** vs **reasoning=medium** - Reasoning quality
- **temp=1** vs **temp=0.7** - Creativity vs consistency

### Parameter Compatibility
- ✅ Confirm: `reasoning=none` allows `temperature`
- ❌ Confirm: `reasoning=medium` BLOCKS `temperature`
- 🔍 Discover: What defaults when params omitted?

---

## 🚨 Critical Questions to Answer

### 1. Does `reasoning.effort` exist?
- **Test 1-5:** Use reasoning parameter
- **Test 6:** Omit reasoning parameter
- **Result:** Which ones work? Which fail?

### 2. Does `text.verbosity` work?
- **Tests 1-5:** Use verbosity parameter
- **Test 6:** Omit verbosity parameter
- **Result:** Does it affect output length?

### 3. What are the defaults?
- **Test 6:** No reasoning, no verbosity
- **Result:** Compare to Test 1 - same or different?

### 4. Is `reasoning=medium` slow?
- **Tests 4-5:** Use reasoning=medium
- **Result:** How much slower? Worth it for quality?

### 5. Does `verbosity=low` save time?
- **Compare Test 1 vs Test 2**
- **Result:** Shorter response = faster completion?

---

## 📋 How to Run

```bash
cd python-sidecar
python test-gpt5-production-load.py
```

**Output:**
- 7 test results with timing
- Comparison report sorted by speed
- JSON file: `test-results-production-load.json`

**What to look for:**
1. Which tests succeed vs fail (parameter errors)
2. Speed differences between configs
3. Response quality differences
4. Token usage differences

---

## 🎯 Expected Outcomes

### Best Case Scenario
**Test 1 wins:** reasoning=none, temp=1, verbosity=high
- Fast (~3-4s)
- High quality detailed responses
- Uses temperature for creativity

**This would be our production config!**

### Worst Case Scenario
**All reasoning tests fail:** Parameters don't exist or have changed
- Fall back to Test 6 (current config)
- We know this works

### Surprising Case
**Test 4/5 wins:** reasoning=medium provides better quality
- Worth the extra time?
- Depends on speed penalty

---

## 🔧 Next Steps After Testing

### If Test 1 Wins (reasoning=none, verbosity=high)
```python
# Update llm_service.py with:
params = {
    "model": "gpt-5.1-chat-latest",
    "reasoning": {"effort": "none"},
    "text": {"verbosity": "high"},
    "temperature": 1,
    "max_completion_tokens": 8000
}
```

### If Test 4 Wins (reasoning=medium)
- Decide: Is quality improvement worth speed cost?
- Consider: Offer both as user options in selector?

### If Tests 1-5 All Fail
- Parameters don't exist or syntax wrong
- Fall back to Test 6 (current working config)
- Document what actually works

---

## 📚 OpenAI Documentation Notes

From your findings:
> ⚠️ Important: The following parameters are only supported when using GPT-5.1 with reasoning effort set to none:
> - temperature
> - top_p
> - logprobs

**This means:**
- `reasoning.effort="none"` → Can use temperature/top_p/logprobs
- `reasoning.effort="medium"` → CANNOT use temperature/top_p/logprobs
- **Our tests validate this constraint**

---

## 🎓 What We Learn

After running these tests, we'll know:

1. ✅ **What parameters actually work** (not just docs)
2. ✅ **Actual speed of each configuration**
3. ✅ **Quality differences between settings**
4. ✅ **Default behavior when params omitted**
5. ✅ **Best configuration for production**
6. ✅ **Whether reasoning mode is worth the speed cost**

---

**Last Updated:** 2025-11-23
**Status:** Ready to run - Comprehensive parameter exploration
