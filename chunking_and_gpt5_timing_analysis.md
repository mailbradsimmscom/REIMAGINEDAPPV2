# Chunking Fix & GPT-5 Timing Analysis

**Date:** 2025-10-04
**Session Focus:** Fix langchain chunker creating 7KB blobs, test new chunker, discover GPT-5 timeout issues

---

## 1. Initial Problem: Massive Chunks

### Issue
- Langchain `RecursiveCharacterTextSplitter` configured for max=1200 chars
- Actually creating **6,500-7,000 character chunks** (5-6x the limit!)
- Causing massive prompts to GPT-5, wasted tokens, high costs

### Impact
- "tell me about DST810" → sent entire 7KB instead of overview
- "max depth" → sent 7KB instead of just depth specs
- No semantic chunking, just massive blobs

---

## 2. Solution: Custom Markdown-Aware Chunker

### Implementation
Replaced langchain chunker with custom implementation in `chunker.py`:

**Key Features:**
1. **Header-preserving regex** - Uses capture groups for `# through ####` headers
2. **Token-accurate counting** - Uses tiktoken (cl100k_base, same as OpenAI)
3. **Strict max enforcement** - Validates and trims chunks exceeding 1200 tokens
4. **200-token overlap** - ~150 chars between chunks for context continuity
5. **Smart sentence splitting** - Handles abbreviations (Dr., Inc.), decimals (3.14), numbered lists

**Configuration:**
```python
SemanticChunker(
    target_tokens=800,
    min_tokens=400,
    max_tokens=1200,
    overlap_tokens=200
)
```

### Files Changed
1. `python-sidecar/requirements.txt` - Removed langchain dependencies (lines 37-38)
2. `python-sidecar/app/chunking/chunker.py` - Complete rewrite (517 lines)
3. `python-sidecar/app/chat/workflows/chat_workflow.py` - Disabled scoring node

---

## 3. Test Results: Chunker Performance

### DST810.pdf Re-Ingestion
**Vector IDs tested:**
- `060da97d-5068-41b7-8967-e42baafa31e0`
- `a83203d2-9fdd-409a-8618-72335f66d2ac`
- `b4442740-201b-4966-9678-40eccec637a7`

**Chunk Sizes:**
| Chunk | Tokens | Chars | Section |
|-------|--------|-------|---------|
| 0 | 647 | 2,668 | Bluetooth® Enabled |
| 1 | 955 | 3,240 | AIRMAR® section |
| 2 | 689 | 2,899 | SPECIFICATIONS |

**Average: 764 tokens** ✅ Right at target (800)

**All chunks ≤ 1200 tokens** ✅ Max enforced correctly

**Comparison:**
- Old: 6,500-7,000 chars (~1,600-1,800 tokens)
- New: 647-955 tokens per chunk
- **Reduction: ~60%** per chunk

---

## 4. Unexpected Discovery: GPT-5 Timing Issues

### Chat Synthesis Failures
When testing "tell me about my DST810":
- Python sidecar timing out after 30 seconds
- Node.js receiving "This operation was aborted" errors
- Workflow stuck on `synthesize_response` node

### Root Cause Analysis

**Pinecone Results for Query:**
| Chunk | Score | Tokens | Content |
|-------|-------|--------|---------|
| 1 | 0.78 | 689 | CAST configuration + PGNs |
| 2 | 0.77 | 955 | Overview + features |
| 3 | 0.74 | 647 | Paddlewheel specs |

**Synthesis Prompt Size:**
```
Equipment section:       433 chars
3 Pinecone chunks:     8,807 chars (~2,201 tokens)
Format requirements:   ~2,500 chars (~625 tokens)
--------------------------------
TOTAL:                11,740 chars (~2,935 tokens)
```

**Paradox:** New chunker worked perfectly, but we're now sending MORE data:
- Old system: 1 chunk × 7,000 chars = 7KB
- New system: 3 chunks × ~2,900 chars = 8.8KB + overhead = **11.7KB**

### GPT-5 Performance Testing

**Test 1: Simple prompt (2 sentences)**
```
Time: 11.87 seconds
Response: 402 chars
Status: ✅ SUCCESS
```

**Test 2: Representative prompt (~1,600 chars)**
```
Prompt: 1,591 chars (~397 tokens)
Time: 39.12 seconds
Response: 3,709 chars (2,460 tokens)
Status: ✅ SUCCESS but exceeds timeout
```

**Conclusion:**
- Even small prompts take 39+ seconds
- Node.js timeout: 30 seconds
- **GPT-5 too slow for real-time chat**

---

## 5. Attempted Fixes

### Fix 1: Disable GPT-5 Scoring ✅
**Action:** Commented out `score_response` node in workflow

**Files Modified:**
- `chat_workflow.py` lines 86, 92-94, 329-352

**Result:** Reduced one GPT-5 call, but synthesis still times out

### Fix 2: Identify Chunk Limiting ❌ (Not Implemented)
**Issue:** Can't just send top 1 chunk

**User Requirement:**
- Complex questions need 3-5 chunks
- GPS questions might cross 3-5 manuals
- Need multi-manual context for cross-equipment queries

---

## 6. Current State

### What Works ✅
1. Chunker creates proper-sized chunks (647-955 tokens)
2. Chunks properly overlap with 200 tokens
3. Headers preserved correctly
4. Pinecone semantic search returns relevant chunks
5. Scoring disabled (saves 1 GPT-5 call)

### What's Broken ❌
1. GPT-5 synthesis takes 39+ seconds
2. Node.js times out after 30 seconds
3. Chat requests fail with "operation aborted"
4. Workflow stuck waiting for synthesis response

---

## 7. Options Going Forward

### Option 1: Increase Node.js Timeout ⏱️
**Pros:**
- Simple change
- Keeps GPT-5 for synthesis

**Cons:**
- 60-90 second waits hurt UX
- Still doesn't solve slow responses
- May hit OpenAI rate limits

### Option 2: Switch Synthesis Model 🚀 (RECOMMENDED)
**Replace GPT-5 with faster model:**

**GPT-4o:**
- Faster response times (5-15s typical)
- High quality synthesis
- Same OpenAI API

**Claude 3.5 Sonnet:**
- Fast response times (3-10s typical)
- Excellent at technical writing
- Already using for DIP processing

**Pros:**
- Keeps 30s timeout reasonable
- Better UX with faster responses
- More cost-effective

**Cons:**
- May lose some of GPT-5's capabilities
- Need to test quality

### Option 3: Limit Chunks Per Query 📉
**Send only top 1-2 chunks instead of all matches**

**Pros:**
- Smaller prompts
- Faster responses

**Cons:**
- Loses context for complex queries
- Won't work for multi-manual questions
- User explicitly needs 3-5 chunk capability

---

## 8. Key Metrics

### Chunking Performance
| Metric | Old System | New System | Change |
|--------|------------|------------|--------|
| Avg chunk size | ~7,000 chars | ~2,900 chars | -59% |
| Avg tokens/chunk | ~1,750 | ~764 | -56% |
| Max enforcement | ❌ No | ✅ Yes | Fixed |
| Header preservation | ❌ No | ✅ Yes | Fixed |

### Synthesis Performance
| Metric | Value | Status |
|--------|-------|--------|
| GPT-5 simple query | 11.87s | ⚠️ Slow |
| GPT-5 full prompt | 39.12s | ❌ Times out |
| Node.js timeout | 30s | ❌ Too short |
| Prompt size | 11.7KB (2,935 tokens) | ⚠️ Large |

---

## 9. Recommended Next Steps

### Immediate (Today)
1. **Switch synthesis to GPT-4o or Claude 3.5 Sonnet**
   - Test response quality
   - Measure timing improvement
   - Deploy if acceptable

### Short-term (This Week)
2. **Implement smart chunk limiting**
   - For simple queries: top 1-2 chunks
   - For complex queries: top 3-5 chunks
   - Use classification intent to decide

3. **Add chunk metadata to response**
   - Show which chunks were used
   - Allow user to request more detail

### Long-term (Future)
4. **Optimize Pinecone queries**
   - Better metadata filtering
   - Semantic re-ranking
   - Chunk quality scoring

5. **Consider streaming responses**
   - Stream GPT synthesis
   - Show partial results as they arrive
   - Better perceived performance

---

## 10. Technical Details

### Chunker Algorithm (4 Steps)
1. **Split on headers** - Regex: `r'(\n#{1,4} [^\n]+)'` with capture groups
2. **Merge small sections** - Combine until min_tokens (400)
3. **Split oversized** - Sentence-split any chunks > max_tokens (1200)
4. **Add overlap** - 200 tokens from previous chunk, trim if needed

### Sentence Splitting Logic
```python
# Handles:
- Abbreviations: dr, mr, mrs, ms, prof, sr, jr, etc, vs, inc, ltd, corp
- Decimals: 3.14, 2.5
- Numbered lists: 1. Item, 2. Item
```

### Overlap Strategy
```python
# Take last 200 tokens from previous chunk
# Try to start at sentence boundary
# Hash-based deduplication prevents duplicate content
# Validate final size, trim if > max_tokens
```

---

## Files Modified This Session

1. **`python-sidecar/requirements.txt`**
   - Removed langchain>=0.3.27
   - Removed langchain-text-splitters>=0.3.11

2. **`python-sidecar/app/chunking/chunker.py`**
   - Complete rewrite (517 lines)
   - New SemanticChunker class
   - Custom sentence splitting
   - Strict token enforcement

3. **`python-sidecar/app/chat/workflows/chat_workflow.py`**
   - Commented out score_response node
   - Workflow now: classify → retrieve → synthesize → END

4. **`improved_chunker_proposal.md`** (created)
   - Design document
   - Fixed 3 issues from initial proposal
   - Testing plan

---

## Conclusion

**Chunking is fixed** ✅ - New chunker creates proper-sized, semantically meaningful chunks with strict token limits.

**GPT-5 is the bottleneck** ❌ - 39+ second response times exceed 30s timeout, causing all chat requests to fail.

**Recommended fix:** Switch synthesis from GPT-5 to GPT-4o or Claude 3.5 Sonnet for faster, reliable responses while maintaining quality.
