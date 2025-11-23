# GPT-5.1 Testing Guide

**Context:** GPT-5.1-chat-latest is an early release model. Parameter support and behavior may differ from documentation.

## ⚠️ Important Notes

1. **Early Release Quirks:** GPT-5.1 parameters aren't fully documented. This test suite helps discover what works.
2. **API Changes:** OpenAI may change parameter names, supported values, or behavior without notice.
3. **Iterative Testing:** Use this suite to test different configurations and find what actually works.

---

## 🧪 Test Suite

### `test-gpt5-comprehensive.py`

**What it tests:**
- ✅ GPT-5.1-chat-latest with different configurations
- ✅ GPT-5 (old model) for comparison
- ✅ GPT-4.1-mini for baseline
- ✅ Different parameter combinations
- ✅ Timing and performance metrics

**What it measures:**
- Request duration (seconds)
- Token usage (prompt + completion)
- Response quality
- Error messages (to discover unsupported parameters)

---

## 🚀 Running Tests

### Quick Start

```bash
cd python-sidecar
python test-gpt5-comprehensive.py
```

### What Happens

1. Runs 5 different configurations
2. Measures timing for each
3. Generates comparison report
4. Saves results to `test-results-gpt5.json`
5. Shows fastest configuration

### Expected Output

```
🧪 TEST 1/5: GPT-5.1 Optimized (RECOMMENDED)
Model: gpt-5.1-chat-latest
Params: {
  "temperature": 1,
  "max_completion_tokens": 8000
}

⏳ Sending request...
✅ SUCCESS in 3.42s (3420ms)
📊 Tokens: 450 prompt + 380 completion = 830 total
📝 Response length: 1523 characters

[... continues for all tests ...]

📊 COMPARISON REPORT
✅ SUCCESSFUL TESTS (sorted by speed):

1. GPT-4.1-mini (FASTEST)
   ⏱️  Duration: 2.85s (2850ms)

2. GPT-5.1 Optimized (RECOMMENDED)
   ⏱️  Duration: 3.42s (3420ms)

3. GPT-5.1 Lower Tokens
   ⏱️  Duration: 3.67s (3670ms)
```

---

## 🔍 What We're Testing

### Test 1: GPT-5.1 Optimized (RECOMMENDED)

```python
{
    "model": "gpt-5.1-chat-latest",
    "temperature": 1,  # Only supported value
    "max_completion_tokens": 8000,
    # NO reasoning_effort - not supported
}
```

**Why:** This is the configuration we discovered works best.

**Expected:** ~3-4 seconds

---

### Test 2: GPT-5.1 Lower Tokens

```python
{
    "model": "gpt-5.1-chat-latest",
    "temperature": 1,
    "max_completion_tokens": 4000,  # Lower limit
}
```

**Why:** Test if lower token limit improves speed.

**Expected:** ~3-4 seconds (may be faster)

---

### Test 3: GPT-5 with reasoning=medium (OLD - BROKEN)

```python
{
    "model": "gpt-5",
    "reasoning_effort": "medium",  # NOT SUPPORTED
    "max_completion_tokens": 8000,
}
```

**Why:** This is what the old code used. Should FAIL with error.

**Expected:** ❌ Error: `'reasoning_effort' does not support 'medium' with this model`

---

### Test 4: GPT-5 with temperature=1

```python
{
    "model": "gpt-5",
    "temperature": 1,
    "max_completion_tokens": 8000,
}
```

**Why:** Test if GPT-5 (not 5.1) works with temperature.

**Expected:** May work but could be slower than 5.1

---

### Test 5: GPT-4.1-mini (FASTEST)

```python
{
    "model": "gpt-4.1-mini",
    "temperature": 0,
    "max_completion_tokens": 4000,
}
```

**Why:** Baseline for comparison. Should be fastest.

**Expected:** ~2-3 seconds

---

## 📊 Interpreting Results

### Success Metrics

**Duration:**
- ✅ Good: < 5 seconds
- ⚠️ Acceptable: 5-10 seconds
- ❌ Slow: > 10 seconds

**Tokens per second:**
- ✅ Fast: > 50 tokens/sec
- ⚠️ Moderate: 20-50 tokens/sec
- ❌ Slow: < 20 tokens/sec

### Common Errors

**Error: `'reasoning_effort' does not support 'medium'`**
- Cause: GPT-5.1 doesn't support reasoning_effort parameter
- Fix: Remove parameter entirely

**Error: `Invalid temperature value`**
- Cause: GPT-5.1 only supports temperature=1
- Fix: Set temperature to 1 or omit

**Error: `max_tokens` vs `max_completion_tokens`**
- Cause: GPT-5.1 requires max_completion_tokens (not max_tokens)
- Fix: Use max_completion_tokens

---

## 🔧 Customizing Tests

### Add Your Own Configuration

Edit `test-gpt5-comprehensive.py` and add to `TEST_CONFIGS`:

```python
TestConfig(
    name="Your Custom Config",
    model="gpt-5.1-chat-latest",
    params={
        "temperature": 1,
        "max_completion_tokens": 6000,  # Your value
        # Add other parameters to test
    }
),
```

### Test Different Prompts

Edit the `USER_MESSAGE` variable to test with your actual chat queries.

### Test System Message Split

The test already uses split system/user messages (required for GPT-5.1).

---

## 📈 Tracking Results

### Results File

Each test run saves to `test-results-gpt5.json`:

```json
{
  "timestamp": "2025-11-23T15:30:00",
  "total_tests": 5,
  "successful": 4,
  "failed": 1,
  "results": [
    {
      "name": "GPT-5.1 Optimized",
      "model": "gpt-5.1-chat-latest",
      "success": true,
      "duration_seconds": 3.42,
      "tokens_used": {
        "prompt": 450,
        "completion": 380,
        "total": 830
      }
    }
  ]
}
```

### Compare Across Runs

Save results with timestamps:

```bash
python test-gpt5-comprehensive.py
cp test-results-gpt5.json results/test-$(date +%Y%m%d-%H%M%S).json
```

---

## 🎯 What We've Learned So Far

Based on testing from Nov 21-23:

### ✅ What Works (GPT-5.1-chat-latest)

1. **System/User message split:**
   ```python
   messages = [
       {"role": "system", "content": "..."},
       {"role": "user", "content": "..."}
   ]
   ```

2. **Temperature = 1:**
   ```python
   "temperature": 1  # Only supported value
   ```

3. **max_completion_tokens:**
   ```python
   "max_completion_tokens": 8000  # NOT max_tokens
   ```

4. **NO reasoning_effort:**
   - Don't include this parameter at all
   - Including it causes errors

### ❌ What Doesn't Work

1. **reasoning_effort parameter:**
   - Not supported by GPT-5.1
   - Error: `'reasoning_effort' does not support 'medium' with this model`

2. **temperature != 1:**
   - Only temperature=1 is supported
   - Other values may cause errors

3. **max_tokens:**
   - Use `max_completion_tokens` instead
   - max_tokens is deprecated

4. **Combined system+user in one message:**
   - Less optimal, split is better

---

## 🚨 Production Recommendations

### For Render Deployment

**Use this configuration:**

```python
{
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

**Set in `.env`:**
```bash
OPENAI_MODEL=gpt-5.1-chat-latest
```

**Expected performance:**
- Duration: ~3-4 seconds
- Quality: High (GPT-5.1 quality)
- Cost: Standard GPT-5 pricing

---

## 🔄 When to Re-test

**Re-run tests when:**
1. OpenAI announces GPT-5.1 updates
2. You see unexpected errors
3. Performance degrades
4. You want to try new parameters
5. Before major deployments

**Command:**
```bash
cd python-sidecar
python test-gpt5-comprehensive.py > test-results-$(date +%Y%m%d).log 2>&1
```

---

## 📞 Troubleshooting

### Test hangs or times out

**Check:**
- API key is valid: `echo $OPENAI_API_KEY`
- Network connectivity: `curl https://api.openai.com/`
- Timeout in code (default 60s)

### All tests fail

**Check:**
- Python OpenAI library version: `pip show openai`
- Update if needed: `pip install --upgrade openai`
- API key permissions

### Unexpected results

**Try:**
- Run tests individually
- Check OpenAI status: https://status.openai.com/
- Review error messages carefully
- Test with minimal parameters first

---

## 📚 Related Documentation

- `/code updates/51 Chat Model Configuration Audit and Fixes.md` - Full configuration audit
- `/code updates/50 Chat Defects.md` - GPT-5 performance investigation
- `python-sidecar/app/chat/services/llm_service.py` - Production LLM service

---

**Last Updated:** 2025-11-23
**Status:** Active - Use for iterative testing
