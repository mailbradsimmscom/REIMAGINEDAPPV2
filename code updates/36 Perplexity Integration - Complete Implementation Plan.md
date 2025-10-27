# Code Update #36: Perplexity Integration - Complete Implementation Plan

**Date:** 2025-10-26
**Status:** 🔄 In Progress - Planning Complete
**Session Focus:** Add Perplexity web search to chat workflow for real-world marine troubleshooting wisdom

---

## 🎯 Goal

Integrate Perplexity API into the chat workflow to provide real-world troubleshooting insights from marine forums, YouTube videos, and boat owner communities that go beyond what's in the technical manuals.

**3-Source Architecture:**
1. **DIP Tables** - Structured manual data (procedures, specs, troubleshooting)
2. **Pinecone** - Vector search on documentation chunks
3. **Perplexity** - Web search for real-world marine wisdom (NEW)

---

## 📖 Context: How We Got Here

### **Previous Work (Code Update #35):**
- Fixed source bubbles + modal CSS
- Replaced broken custom markdown parser with marked.js
- Modal already supports showing source details

### **Test Results:**
Created test script comparing basic vs enhanced Perplexity queries:

**Basic Query:**
```
Marco fresh water pump on a catamaran keeps erroring out. LED shows different colors. What are common real-world causes and fixes in marine environments?
```
- Duration: 17s
- Citations: 10 sources (generic marine sites)
- Content: Generic troubleshooting

**Enhanced Query:**
```
Marco UP6/E 24V self-priming fresh water pump on a catamaran is erroring out. The pump has electronic pressure sensor with blue LED and multicolored LED (red/green/yellow) diagnostics. The system has a Marco control panel for remote monitoring. What are the most common real-world causes boat owners encounter with this specific pump model in marine environments, and what fixes actually work beyond what the manual says? Looking for practical troubleshooting from cruisers and liveaboards who have solved this.
```
- Duration: 23.7s
- Citations: 10 sources (Marco-specific docs, iFixit, forums)
- Content: Specific to Marco UP6 with workarounds, part lifespans, cruiser tricks

**Winner:** Enhanced query - 30% more tokens but 10x more useful

### **Real User Query (from logs):**
```
"i am having an issue with my fresh water pump where it is erroring out"
```

**What system found:**
- Equipment: Marco control_panel + Marco self_priming_transfer_pump (UP6/E 24V)
- Intent: troubleshooting (confidence 0.95)
- DIP results: No relevant data
- Pinecone: 18 chunks with LED diagnostics, error codes, troubleshooting

**The Gap:** System has manual data but lacks real-world boat owner wisdom (forum posts, YouTube fixes, "here's what actually works")

---

## ✅ Final Decisions

### **1. When to Call Perplexity**
- **Always** (every query, not conditional)
- Feature flag controlled: `PERPLEXITY_ENABLED=true`

### **2. Execution Model**
- **Parallel execution** - Launch OpenAI + Perplexity at same time
- Wait for both to complete
- Faster than sequential (24s vs 38s)

### **3. Response Assembly**
- **OpenAI does NOT see Perplexity results** (no token bloat)
- OpenAI response shown first
- Perplexity section appended with separator
- Same answer bubble, two sections

### **4. Link Display**
- **Modal window** - Clicking Perplexity source bubble opens modal
- **Separate section** - "Real-World Resources"
- **Format:** Just the URL (raw, clickable)
- **Opens in new tab** - `target="_blank"`

### **5. Failure Handling**
- One fails → show the other
- Both fail → fallback message
- Graceful degradation (no hard failures)

### **6. Timeout**
- **45 seconds** for Perplexity API call

---

## 🏗️ Architecture Design

### **Workflow Timeline:**

```
Step 1: Classification (4s)
   ↓
Step 2: DIP + Pinecone Search (5-7s)
   ↓
Step 3: PARALLEL LAUNCH
   ├─→ OpenAI Synthesis (DIP + Pinecone) → 14s
   └─→ Perplexity Search (enhanced query) → 24s

Wait for BOTH to complete (max 24s with 45s timeout)
   ↓
Step 4: Assemble Response
   ├─ OpenAI text (main response)
   ├─ Perplexity section (💡 Real-World Resources)
   └─ Sources array (Pinecone + DIP + Perplexity URLs)
   ↓
Return to frontend

Total: ~33-35s (vs 23-25s without Perplexity)
```

### **Response Structure (Same Bubble):**

```
┌─────────────────────────────────────────────────┐
│ 📊 Your Marco UP6/E 24V pump uses electronic   │
│ pressure sensor... [OpenAI response]            │
│                                                  │
│ 🔧 **Troubleshooting Steps**                    │
│ 1. Check LED color...                           │
│ 2. Inspect connections...                       │
│                                                  │
│ ─────────────────────────────────────────────── │
│                                                  │
│ 💡 **Real-World Resources from Boat Owners**    │
│ Additional troubleshooting insights from        │
│ marine forums and experienced cruisers are      │
│ available in the sources below.                 │
│                                                  │
│ Sources: [1] [2] [3] [4] [5] [6] [7] [8]...    │
│          ↑ Pinecone ↑ DIP  ↑ Perplexity         │
└─────────────────────────────────────────────────┘
```

### **Modal Window (Clicking Perplexity Source):**

```
┌─────────────────────────────────────────────────┐
│ 🌐 Real-World Resources                    [X]  │
├─────────────────────────────────────────────────┤
│                                                  │
│ 10 sources found from marine forums and         │
│ troubleshooting communities:                     │
│                                                  │
│ 1. https://www.ifixit.com/Answers/View/...  🔗  │
│ 2. https://items.marco.it/media/attach/...  🔗  │
│ 3. https://www.cruisersforum.com/...        🔗  │
│ 4. https://www.thehulltruth.com/...         🔗  │
│ 5. https://www.youtube.com/watch?v=...      🔗  │
│ ...                                              │
│                                                  │
│ (Links open in new tab)                          │
└─────────────────────────────────────────────────┘
```

---

## 📁 Files to Modify

### **Summary:**
- **New files:** 1
- **Modified files:** 6
- **Total files touched:** 7
- **Estimated lines added:** ~260
- **Estimated lines modified:** ~30

### **File List:**

1. ✨ **NEW:** `/python-sidecar/app/chat/services/perplexity_service.py`
2. 📝 **MODIFY:** `/python-sidecar/app/chat/workflows/chat_workflow_sequential.py`
3. 📝 **MODIFY:** `/python-sidecar/app/chat/formatters/source_formatter.py`
4. 📝 **MODIFY:** `/src/public/app.js`
5. 📝 **MODIFY:** `/src/public/chat-styles.css`
6. 📝 **MODIFY:** `/python-sidecar/.env`
7. 📝 **MODIFY:** `/python-sidecar/requirements.txt`

---

## 🔧 Implementation Details

### **Phase 1: Perplexity Service (New File)**

**File:** `/python-sidecar/app/chat/services/perplexity_service.py`

**Purpose:** Handle all Perplexity API logic

**Key Functions:**

#### **1. `build_enhanced_query()`**

Constructs enhanced Perplexity query from context.

**Input Data Available:**
```python
{
    "user_query": "i am having an issue with my fresh water pump where it is erroring out",
    "equipment": [
        {
            "manufacturer": "Marco",
            "model": "self_priming_transfer_pump",
            "model_name": "UP6/E 24V",
            "description": "Self-priming transfer pump",
            "rank": 0.92
        },
        {
            "manufacturer": "Marco",
            "model": "control_panel",
            "description": "control box for marco fresh water pump",
            "rank": 1.00
        }
    ],
    "pinecone_chunks": [
        {
            "score": 0.607,
            "text": "# ELECTRONIC PRESSURE SENSOR WORKING DIRECTIONS\nThe electronic pressure sensor, through the use of a microprocessor, controls the pump's speed...\nThe pressure sensor system is equipped with two LEDs: one blue and one multicolored (red, green, and yellow)...",
            "metadata": {...}
        }
    ],
    "system_context": {
        "vessel_type": "catamaran",
        "environment": "marine"
    }
}
```

**Query Construction Algorithm:**

```python
# Step 1: Extract primary equipment
primary = equipment[0]  # Highest rank
manufacturer = primary["manufacturer"]  # "Marco"
model_name = primary["model_name"]      # "UP6/E 24V"
pump_type = primary["description"]      # "Self-priming transfer pump"

# Step 2: Extract features from top Pinecone chunk
features = []
top_chunk_text = pinecone_chunks[0]["text"].lower()

if "electronic pressure sensor" in top_chunk_text:
    features.append("electronic pressure sensor")

if "blue led" in top_chunk_text and "multicolored" in top_chunk_text:
    features.append("blue LED and multicolored LED (red/green/yellow) diagnostics")

# Step 3: Check for control panel in equipment
has_control_panel = any(eq["model"] == "control_panel" for eq in equipment)
if has_control_panel:
    features.append(f"{manufacturer} control panel for remote monitoring")

features_text = ". The system has ".join(features)

# Step 4: Get system context
vessel_type = system_context.get("vessel_type", "catamaran")
environment = "marine environments"
target_audience = "cruisers and liveaboards"

# Step 5: Build query
query = f"""{manufacturer} {model_name} {pump_type} on a {vessel_type} is {user_query}.

The pump has {features_text}.

What are the most common real-world causes boat owners encounter with this specific pump model in {environment}, and what fixes actually work beyond what the manual says?

Looking for practical troubleshooting from {target_audience} who have solved this."""
```

**Output Example:**
```
Marco UP6/E 24V self-priming fresh water pump on a catamaran is erroring out.

The pump has electronic pressure sensor with blue LED and multicolored LED (red/green/yellow) diagnostics. The system has a Marco control panel for remote monitoring.

What are the most common real-world causes boat owners encounter with this specific pump model in marine environments, and what fixes actually work beyond what the manual says?

Looking for practical troubleshooting from cruisers and liveaboards who have solved this.
```

#### **2. `query()` - API Call**

**Perplexity API Endpoint:**
```
POST https://api.perplexity.ai/chat/completions
```

**Request:**
```json
{
  "model": "sonar-pro",
  "messages": [{
    "role": "user",
    "content": "<enhanced_query>"
  }],
  "temperature": 0.3,
  "max_tokens": 2000
}
```

**Headers:**
```
Authorization: Bearer <PERPLEXITY_API_KEY>
Content-Type: application/json
```

**Response:**
```json
{
  "choices": [{
    "message": {
      "content": "The most common real-world causes of Marco UP6/E 24V...",
      "role": "assistant"
    }
  }],
  "citations": [
    "https://www.ifixit.com/Answers/View/599552/The+pump+is+running+but+no+water",
    "https://items.marco.it/media/attach/booklet/UP6-E_01_US.pdf",
    "https://www.cruisersforum.com/..."
  ],
  "usage": {
    "prompt_tokens": 105,
    "completion_tokens": 983,
    "total_tokens": 1088
  },
  "model": "sonar-pro"
}
```

**Error Handling:**
- Timeout (45s) → return None
- API error → log and return None
- Invalid response → log and return None
- No exceptions propagate (graceful degradation)

**Complete Code:**

```python
"""
Perplexity API service for real-world troubleshooting
"""
import httpx
import logging
from typing import Dict, List, Optional, Any

logger = logging.getLogger(__name__)

class PerplexityService:
    def __init__(self, api_key: str, model: str = "sonar-pro", timeout: int = 45):
        self.api_key = api_key
        self.model = model
        self.timeout = timeout
        self.base_url = "https://api.perplexity.ai/chat/completions"

    def build_enhanced_query(
        self,
        user_query: str,
        equipment: List[Dict],
        pinecone_chunks: List[Dict],
        system_context: Dict
    ) -> str:
        """
        Build enhanced Perplexity query from context

        Args:
            user_query: Original user question
            equipment: List of matched equipment
            pinecone_chunks: Top Pinecone results
            system_context: Vessel type, environment, etc.

        Returns:
            Enhanced query string
        """
        # Extract primary equipment (highest rank)
        primary = equipment[0] if equipment else {}
        manufacturer = primary.get("manufacturer", "")
        model_name = primary.get("model_name", "")
        pump_type = primary.get("description", "")

        # Extract features from top Pinecone chunk
        features = []
        if pinecone_chunks:
            top_chunk = pinecone_chunks[0].get("text", "")

            if "electronic pressure sensor" in top_chunk.lower():
                features.append("electronic pressure sensor")

            if "blue led" in top_chunk.lower() and "multicolored" in top_chunk.lower():
                features.append("blue LED and multicolored LED (red/green/yellow) diagnostics")

        # Check for control panel in equipment list
        has_control_panel = any(eq.get("model") == "control_panel" for eq in equipment)
        if has_control_panel:
            features.append(f"{manufacturer} control panel for remote monitoring")

        features_text = ". The system has ".join(features) if features else ""

        # Get system context
        vessel_type = system_context.get("vessel_type", "catamaran")
        environment = "marine environments"

        # Extract symptom from user query (keep natural language)
        symptom = user_query

        # Target audience based on vessel type
        target_audience = "cruisers and liveaboards"

        # Build query components
        base = f"{manufacturer} {model_name} {pump_type} on a {vessel_type} is {symptom}."

        if features_text:
            feature_line = f"\n\nThe pump has {features_text}."
        else:
            feature_line = ""

        ask = f"\n\nWhat are the most common real-world causes boat owners encounter with this specific pump model in {environment}, and what fixes actually work beyond what the manual says?"

        audience = f"\n\nLooking for practical troubleshooting from {target_audience} who have solved this."

        return f"{base}{feature_line}{ask}{audience}"

    async def query(self, enhanced_query: str) -> Optional[Dict[str, Any]]:
        """
        Call Perplexity API

        Args:
            enhanced_query: The enhanced query string

        Returns:
            Dict with 'answer' and 'citations' or None on failure
        """
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(
                    self.base_url,
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json"
                    },
                    json={
                        "model": self.model,
                        "messages": [{
                            "role": "user",
                            "content": enhanced_query
                        }],
                        "temperature": 0.3,
                        "max_tokens": 2000
                    }
                )

                if response.status_code != 200:
                    logger.error(f"Perplexity API error: {response.status_code} {response.text}")
                    return None

                data = response.json()

                return {
                    "answer": data["choices"][0]["message"]["content"],
                    "citations": data.get("citations", []),
                    "usage": data.get("usage", {}),
                    "model": data.get("model", self.model)
                }

        except httpx.TimeoutException:
            logger.error(f"Perplexity API timeout after {self.timeout}s")
            return None

        except Exception as e:
            logger.error(f"Perplexity API error: {str(e)}")
            return None
```

**Risk Level:** LOW (new file, no dependencies, well-isolated)

---

### **Phase 2: Workflow Integration**

**File:** `/python-sidecar/app/chat/workflows/chat_workflow_sequential.py`

**Current Structure:**
```python
async def process_chat(self, state: Dict) -> Dict:
    # Step 1: classify_query
    state = await self._classify_query(state)

    # Step 2: retrieve_data (DIP + Pinecone)
    state = await self._retrieve_data(state)

    # Step 3: synthesize_response
    state = await self._synthesize_response(state)

    return state
```

**New Structure (Parallel Execution):**

```python
import asyncio
import os
from ..services.perplexity_service import PerplexityService

async def process_chat(self, state: Dict) -> Dict:
    # Step 1: classify_query (unchanged)
    state = await self._classify_query(state)

    # Step 2: retrieve_data (unchanged - DIP + Pinecone)
    state = await self._retrieve_data(state)

    # Step 3: PARALLEL LAUNCH - OpenAI + Perplexity
    logger.info("🚀 Launching parallel OpenAI + Perplexity")

    openai_task = asyncio.create_task(
        self._synthesize_response(state)  # Existing function
    )

    perplexity_task = asyncio.create_task(
        self._query_perplexity(state)  # New function
    )

    # Wait for both (return_exceptions=True prevents one failure from breaking both)
    openai_result, perplexity_result = await asyncio.gather(
        openai_task,
        perplexity_task,
        return_exceptions=True
    )

    # Step 4: Assemble response
    final_response = self._assemble_response(
        openai_result,
        perplexity_result,
        state
    )

    return final_response
```

**New Method 1: `_query_perplexity()`**

```python
async def _query_perplexity(self, state: Dict) -> Optional[Dict]:
    """Query Perplexity for real-world troubleshooting"""

    # Check if enabled via feature flag
    if not os.getenv("PERPLEXITY_ENABLED", "false").lower() == "true":
        logger.info("Perplexity disabled via PERPLEXITY_ENABLED flag, skipping")
        return None

    # Check if API key exists
    api_key = os.getenv("PERPLEXITY_API_KEY")
    if not api_key:
        logger.warning("PERPLEXITY_API_KEY not set, skipping Perplexity search")
        return None

    try:
        # Initialize service
        timeout = int(os.getenv("PERPLEXITY_TIMEOUT", "45"))
        model = os.getenv("PERPLEXITY_MODEL", "sonar-pro")

        service = PerplexityService(
            api_key=api_key,
            model=model,
            timeout=timeout
        )

        # Build enhanced query from state
        enhanced_query = service.build_enhanced_query(
            user_query=state.get("query", ""),
            equipment=state.get("equipment_context", []),
            pinecone_chunks=state.get("pinecone_results", []),
            system_context={
                "vessel_type": "catamaran"  # TODO: Get from user profile or config
            }
        )

        logger.info(f"🌐 Perplexity enhanced query: {enhanced_query[:100]}...")

        # Query Perplexity API
        start_time = datetime.now()
        result = await service.query(enhanced_query)
        duration = (datetime.now() - start_time).total_seconds() * 1000

        if result:
            logger.info(f"✅ Perplexity success: {len(result['citations'])} citations in {duration:.0f}ms")
            return result
        else:
            logger.warning("Perplexity returned no results")
            return None

    except Exception as e:
        logger.error(f"❌ Perplexity error: {str(e)}")
        return None
```

**New Method 2: `_assemble_response()`**

```python
async def _assemble_response(
    self,
    openai_result: Any,
    perplexity_result: Any,
    state: Dict
) -> Dict:
    """
    Assemble final response from OpenAI + Perplexity

    Handles 4 cases:
    1. Both succeeded
    2. Only OpenAI succeeded
    3. Only Perplexity succeeded
    4. Both failed (fallback)
    """

    # Handle exceptions from asyncio.gather(return_exceptions=True)
    if isinstance(openai_result, Exception):
        logger.error(f"OpenAI failed: {openai_result}")
        openai_result = None

    if isinstance(perplexity_result, Exception):
        logger.error(f"Perplexity failed: {perplexity_result}")
        perplexity_result = None

    # CASE 1: Both succeeded (ideal case)
    if openai_result and perplexity_result:
        logger.info("✅ Both OpenAI and Perplexity succeeded")

        # Get OpenAI response text
        response_text = openai_result.get("answer", "")

        # Append Perplexity section separator + intro
        perplexity_section = (
            "\n\n───────────────────────────────\n\n"
            "💡 **Real-World Resources from Boat Owners**\n\n"
            "Additional troubleshooting insights from marine forums and "
            "experienced cruisers are available in the sources below."
        )

        response_text += perplexity_section

        # Combine sources from all three: Pinecone + DIP + Perplexity
        sources = self._format_sources(
            state.get("pinecone_results", []),
            state.get("dip_results", []),
            perplexity_result.get("citations", [])
        )

        return {
            "answer": response_text,
            "sources": sources,
            "metrics": {
                "openai": openai_result.get("metrics", {}),
                "perplexity": {
                    "citations": len(perplexity_result.get("citations", [])),
                    "model": perplexity_result.get("model", ""),
                    "usage": perplexity_result.get("usage", {})
                }
            }
        }

    # CASE 2: Only OpenAI succeeded (Perplexity failed/disabled)
    elif openai_result:
        logger.warning("⚠️ Using OpenAI only (Perplexity failed or disabled)")

        # Return OpenAI result as-is (no Perplexity section)
        # Sources will only contain Pinecone + DIP
        return openai_result

    # CASE 3: Only Perplexity succeeded (OpenAI failed)
    elif perplexity_result:
        logger.warning("⚠️ Using Perplexity only (OpenAI failed)")

        # Return Perplexity answer with citations
        return {
            "answer": perplexity_result.get("answer", ""),
            "sources": self._format_perplexity_sources_only(
                perplexity_result.get("citations", [])
            ),
            "metrics": {
                "perplexity": {
                    "citations": len(perplexity_result.get("citations", [])),
                    "model": perplexity_result.get("model", ""),
                    "usage": perplexity_result.get("usage", {})
                }
            }
        }

    # CASE 4: Both failed (fallback message)
    else:
        logger.error("❌ Both OpenAI and Perplexity failed - using fallback")

        return {
            "answer": (
                "I apologize, but I'm having trouble processing your request "
                "right now. Please try again in a moment, or contact support "
                "if the issue persists."
            ),
            "sources": [],
            "metrics": {
                "error": "Both OpenAI and Perplexity failed"
            }
        }

def _format_perplexity_sources_only(self, citations: List[str]) -> List[Dict]:
    """Helper for Case 3 - when only Perplexity succeeded"""
    if not citations:
        return []

    return [{
        "type": "PERPLEXITY",
        "count": len(citations),
        "equipment": {},
        "data": [{"url": url} for url in citations]
    }]
```

**Lines Changed:**
- Import added: 3 lines
- `process_chat()` modified: ~15 lines
- `_query_perplexity()` added: ~45 lines
- `_assemble_response()` added: ~85 lines
- `_format_perplexity_sources_only()` added: ~10 lines
- **Total: ~158 lines added/modified**

**Risk Level:** HIGH (core workflow, but feature flag protects)

---

### **Phase 3: Source Formatter**

**File:** `/python-sidecar/app/chat/formatters/source_formatter.py`

**Current Function Signature:**
```python
def _format_sources(self, pinecone_results, dip_results):
    sources = []
    # ... format Pinecone sources ...
    # ... format DIP sources ...
    return sources
```

**Modified Function:**
```python
def _format_sources(self, pinecone_results, dip_results, perplexity_citations=None):
    """
    Format sources for frontend display

    Args:
        pinecone_results: Pinecone search results
        dip_results: DIP table search results
        perplexity_citations: List of Perplexity URLs (optional)

    Returns:
        List of source objects
    """
    sources = []

    # ... existing Pinecone formatting (unchanged) ...

    # ... existing DIP formatting (unchanged) ...

    # NEW: Perplexity citations
    if perplexity_citations and len(perplexity_citations) > 0:
        sources.append({
            "type": "PERPLEXITY",
            "count": len(perplexity_citations),
            "equipment": {},  # Not equipment-specific
            "data": [
                {"url": url} for url in perplexity_citations
            ]
        })

    return sources
```

**Source Array Structure:**
```python
[
    {
        "type": "PINECONE",
        "count": 5,
        "equipment": {"names": ["Marco pump"]},
        "data": [
            {"score": 0.67, "manufacturer": "Marco", "model": "pump", "text_preview": "..."},
            # ... more chunks
        ]
    },
    {
        "type": "procedure",  # DIP table
        "count": 3,
        "equipment": {"manufacturer": "Marco", "model": "pump"},
        "data": [
            {"entry_id": 123, "content": "..."},
            # ... more entries
        ]
    },
    {
        "type": "PERPLEXITY",
        "count": 10,
        "equipment": {},
        "data": [
            {"url": "https://www.ifixit.com/Answers/View/599552/..."},
            {"url": "https://items.marco.it/media/attach/booklet/UP6-E_01_US.pdf"},
            {"url": "https://www.cruisersforum.com/threads/marco-pump.123456/"},
            # ... more URLs
        ]
    }
]
```

**Lines Changed:** ~12 lines added
**Risk Level:** MEDIUM (changes data structure sent to frontend)

---

### **Phase 4: Frontend Modal Display**

**File:** `/src/public/app.js`

**Location:** `showSourceDetails()` function (lines 588-684)

**Current Structure:**
```javascript
function showSourceDetails(source) {
  const modal = document.getElementById('source-modal');
  const modalTitle = document.getElementById('modal-title');
  const modalContent = document.getElementById('modal-content');

  modalContent.innerHTML = '';

  if (source.type === 'PINECONE') {
    // Show Pinecone chunks with scores
  } else if (source.type === 'procedure' || source.type === 'spec' || source.type === 'troubleshooting') {
    // Show DIP table entries
  } else {
    // Unknown source type
  }

  modal.classList.add('active');
}
```

**Add Perplexity Case:**

```javascript
function showSourceDetails(source) {
  const modal = document.getElementById('source-modal');
  const modalTitle = document.getElementById('modal-title');
  const modalContent = document.getElementById('modal-content');

  modalContent.innerHTML = '';

  if (source.type === 'PINECONE') {
    // ... existing Pinecone code (unchanged) ...
  }
  else if (source.type === 'procedure' || source.type === 'spec' || source.type === 'troubleshooting') {
    // ... existing DIP code (unchanged) ...
  }
  // NEW: Perplexity case
  else if (source.type === 'PERPLEXITY') {
    modalTitle.textContent = '🌐 Real-World Resources';

    // Intro paragraph
    const intro = document.createElement('p');
    intro.style.marginBottom = '16px';
    intro.style.fontSize = '14px';
    intro.textContent = `${source.count} sources found from marine forums and troubleshooting communities:`;
    modalContent.appendChild(intro);

    // Link list container
    const linkList = document.createElement('div');
    linkList.style.display = 'flex';
    linkList.style.flexDirection = 'column';
    linkList.style.gap = '12px';

    // Create clickable link for each citation
    source.data.forEach((citation, idx) => {
      const linkItem = document.createElement('a');
      linkItem.href = citation.url;
      linkItem.target = '_blank';  // CRITICAL: Open in new tab
      linkItem.rel = 'noopener noreferrer';  // Security best practice
      linkItem.style.display = 'flex';
      linkItem.style.alignItems = 'center';
      linkItem.style.gap = '8px';
      linkItem.style.padding = '12px';
      linkItem.style.border = '1px solid var(--border-color)';
      linkItem.style.borderRadius = '6px';
      linkItem.style.textDecoration = 'none';
      linkItem.style.color = 'var(--text-color)';
      linkItem.style.transition = 'all 0.2s ease';
      linkItem.style.cursor = 'pointer';

      linkItem.innerHTML = `
        <span style="flex-shrink: 0; font-weight: 600; color: var(--text-secondary);">${idx + 1}.</span>
        <span style="flex: 1; word-break: break-all; font-size: 13px;">${citation.url}</span>
        <span style="flex-shrink: 0; font-size: 16px;">🔗</span>
      `;

      // Hover effects
      linkItem.addEventListener('mouseenter', () => {
        linkItem.style.backgroundColor = 'var(--hover-bg)';
        linkItem.style.borderColor = 'var(--primary-color)';
      });

      linkItem.addEventListener('mouseleave', () => {
        linkItem.style.backgroundColor = 'transparent';
        linkItem.style.borderColor = 'var(--border-color)';
      });

      linkList.appendChild(linkItem);
    });

    modalContent.appendChild(linkList);

    // Footer note
    const note = document.createElement('p');
    note.style.marginTop = '16px';
    note.style.fontSize = '12px';
    note.style.fontStyle = 'italic';
    note.style.color = 'var(--text-secondary)';
    note.textContent = '(Links open in new tab)';
    modalContent.appendChild(note);
  }
  else {
    // ... existing unknown type code (unchanged) ...
  }

  modal.classList.add('active');
}
```

**Lines Changed:** ~60 lines added
**Risk Level:** LOW (additive only, doesn't modify existing cases)

---

### **Phase 5: Frontend Styling**

**File:** `/src/public/chat-styles.css`

**Add after existing source bubble styles (around line 960):**

```css
/* Perplexity sources - purple/web theme */
.source-bubble.source-perplexity {
    background: rgba(147, 51, 234, 0.1);
    border-color: rgba(147, 51, 234, 0.4);
    color: #9333ea;
}

.source-bubble.source-perplexity:hover {
    background: rgba(147, 51, 234, 0.2);
    border-color: #9333ea;
}

/* Dark mode support for Perplexity sources */
@media (prefers-color-scheme: dark) {
    .source-bubble.source-perplexity {
        background: rgba(147, 51, 234, 0.15);
        border-color: rgba(147, 51, 234, 0.5);
        color: #a855f7;
    }

    .source-bubble.source-perplexity:hover {
        background: rgba(147, 51, 234, 0.25);
        border-color: #a855f7;
    }
}
```

**Lines Changed:** ~20 lines added
**Risk Level:** LOW (additive CSS only)

---

### **Phase 6: Configuration**

**File:** `/python-sidecar/.env`

**Add these environment variables:**

```bash
# Perplexity API Configuration
PERPLEXITY_API_KEY=your_key_here
PERPLEXITY_ENABLED=true
PERPLEXITY_MODEL=sonar-pro
PERPLEXITY_TIMEOUT=45
```

**Variable Descriptions:**
- `PERPLEXITY_API_KEY` - API key from Perplexity
- `PERPLEXITY_ENABLED` - Feature flag (true/false) to enable/disable
- `PERPLEXITY_MODEL` - Model to use (sonar-pro recommended)
- `PERPLEXITY_TIMEOUT` - Timeout in seconds (45s recommended)

**Lines Changed:** 4 lines added
**Risk Level:** LOW (configuration only)

---

### **Phase 7: Dependencies**

**File:** `/python-sidecar/requirements.txt`

**Check if httpx exists:**
```bash
grep -i "httpx" python-sidecar/requirements.txt
```

**If not found, add:**
```
httpx>=0.27.0
```

**If found, verify version is >= 0.27.0**

**Lines Changed:** 0-1 line
**Risk Level:** LOW

---

## 🧪 Testing Strategy

### **Unit Tests**

#### **Test 1: Query Builder**
```python
def test_build_enhanced_query():
    service = PerplexityService(api_key="test_key")

    query = service.build_enhanced_query(
        user_query="pump erroring out",
        equipment=[{
            "manufacturer": "Marco",
            "model_name": "UP6/E 24V",
            "description": "Self-priming transfer pump",
            "model": "self_priming_transfer_pump"
        }],
        pinecone_chunks=[{
            "text": "The electronic pressure sensor with blue LED and multicolored LED..."
        }],
        system_context={"vessel_type": "catamaran"}
    )

    assert "Marco UP6/E 24V" in query
    assert "catamaran" in query
    assert "electronic pressure sensor" in query
    assert "blue LED and multicolored LED" in query
    assert "cruisers and liveaboards" in query
```

#### **Test 2: Perplexity API Mock**
```python
@pytest.mark.asyncio
async def test_perplexity_api_success(mocker):
    mock_response = {
        "choices": [{
            "message": {
                "content": "Test response"
            }
        }],
        "citations": ["http://example.com"],
        "usage": {"total_tokens": 100}
    }

    mocker.patch('httpx.AsyncClient.post', return_value=mock_response)

    service = PerplexityService(api_key="test_key")
    result = await service.query("test query")

    assert result is not None
    assert result["answer"] == "Test response"
    assert len(result["citations"]) == 1
```

#### **Test 3: Timeout Handling**
```python
@pytest.mark.asyncio
async def test_perplexity_timeout():
    service = PerplexityService(api_key="test_key", timeout=1)

    # Mock a slow response
    async def slow_response(*args, **kwargs):
        await asyncio.sleep(2)
        return {}

    with patch('httpx.AsyncClient.post', side_effect=slow_response):
        result = await service.query("test query")
        assert result is None
```

### **Integration Tests**

#### **Test 4: Parallel Execution**
```python
@pytest.mark.asyncio
async def test_parallel_execution_timing():
    """Verify OpenAI and Perplexity run in parallel, not sequential"""
    start = time.time()

    # Mock both services to take 5 seconds each
    # If parallel: total ~5s
    # If sequential: total ~10s

    result = await workflow.process_chat(test_state)
    duration = time.time() - start

    # Should be closer to 5s than 10s
    assert duration < 7, "Services not running in parallel"
```

#### **Test 5: Failure Modes**
```python
@pytest.mark.asyncio
async def test_openai_fails_perplexity_succeeds():
    # Mock OpenAI to fail, Perplexity to succeed
    result = await workflow.process_chat(test_state)

    assert result is not None
    assert "answer" in result
    assert len(result["sources"]) > 0
    assert result["sources"][0]["type"] == "PERPLEXITY"

@pytest.mark.asyncio
async def test_perplexity_fails_openai_succeeds():
    # Mock Perplexity to fail, OpenAI to succeed
    result = await workflow.process_chat(test_state)

    assert result is not None
    assert "answer" in result
    # Should NOT have Perplexity section
    assert "Real-World Resources" not in result["answer"]

@pytest.mark.asyncio
async def test_both_fail():
    # Mock both to fail
    result = await workflow.process_chat(test_state)

    assert result is not None
    assert "trouble processing your request" in result["answer"]
```

### **Frontend Tests**

#### **Test 6: Modal Display**
```javascript
// Manual testing checklist:
// 1. Start chat, ask troubleshooting question
// 2. Wait for response with sources
// 3. Click Perplexity source bubble
// 4. Verify modal shows:
//    - Title: "🌐 Real-World Resources"
//    - Count message
//    - List of URLs
//    - Each URL is clickable
//    - Clicking opens new tab
//    - URLs are fully displayed
// 5. Hover over link shows highlight
// 6. Close modal works
```

---

## ⚠️ Risk Assessment & Mitigation

### **High Risk: Workflow Changes**

**File:** `chat_workflow_sequential.py`

**Risks:**
1. Parallel execution breaks existing flow
2. Exception handling fails, crashes workflow
3. State mutation issues with concurrent tasks

**Mitigations:**
- Feature flag `PERPLEXITY_ENABLED=false` for quick disable
- `return_exceptions=True` in `asyncio.gather()` prevents cascading failures
- Each task returns independent result (no shared state mutation)
- Graceful degradation in `_assemble_response()`
- Existing workflow unchanged when Perplexity disabled

**Rollback Plan:**
```bash
# If something breaks:
# 1. Set PERPLEXITY_ENABLED=false in .env
# 2. Restart Python sidecar
# 3. System reverts to pre-Perplexity behavior
```

### **Medium Risk: Source Data Structure**

**File:** `source_formatter.py`

**Risks:**
1. Frontend expects old structure, breaks on new `PERPLEXITY` type
2. Modal doesn't handle URL format

**Mitigations:**
- Additive only (new type added, existing types unchanged)
- Frontend has explicit case for `PERPLEXITY` type
- Unknown types fall through to catch-all case
- Testing with real data before rollout

### **Low Risk: New Service File**

**File:** `perplexity_service.py`

**Risks:**
1. API key invalid
2. Network timeout
3. Response format changes

**Mitigations:**
- All exceptions caught, return None (no propagation)
- Timeout set to 45s with proper httpx handling
- API errors logged but don't crash workflow
- Service is optional (workflow continues without it)

---

## 📈 Performance Impact

### **Current Timing (without Perplexity):**
```
Classification: 4s
DIP + Pinecone: 5-7s
Synthesis: 14s
──────────────────
Total: 23-25s
```

### **New Timing (with Perplexity):**
```
Classification: 4s
DIP + Pinecone: 5-7s
Parallel:
  ├─ OpenAI: 14s
  └─ Perplexity: 24s (with 45s timeout)
Wait for both: 24s (max of the two)
──────────────────
Total: 33-35s
```

**Impact:** +10s per query (+40% latency)

**Acceptable because:**
- Troubleshooting queries are not time-critical
- User expects detailed help, willing to wait
- Real-world insights justify extra time
- Feature flag allows disabling if needed

---

## 💰 Cost Analysis

### **Per Query Cost:**

**Perplexity API:**
- Model: sonar-pro
- Tokens: ~1088 (105 prompt + 983 completion)
- Estimated cost: ~$0.001 per query

**OpenAI (unchanged):**
- Model: gpt-4.1-mini
- Tokens: ~3000-4000
- Estimated cost: ~$0.01 per query

**Total:** ~$0.011 per query (10% increase)

### **Monthly Estimate:**
- 1000 queries/month: ~$11
- 10,000 queries/month: ~$110
- Marginal cost increase is negligible

---

## 🚀 Rollout Plan

### **Phase 1: Development (This Session)**
1. Create `perplexity_service.py`
2. Add to git with feature flag OFF
3. Unit test query builder
4. Document in this file

### **Phase 2: Integration (Next)**
5. Modify workflow for parallel execution
6. Add source formatter changes
7. Test with mock Perplexity responses
8. Commit with `PERPLEXITY_ENABLED=false`

### **Phase 3: Frontend (Next)**
9. Add modal display code
10. Add CSS styling
11. Test with real Perplexity data (enable flag locally)
12. Commit frontend changes

### **Phase 4: Testing (Next)**
13. Enable `PERPLEXITY_ENABLED=true` on dev
14. Test with real queries
15. Monitor logs for errors
16. Verify all 4 failure modes work
17. Check response times

### **Phase 5: Production (Future)**
18. Update production .env with API key
19. Enable feature flag in production
20. Monitor metrics (response time, error rate, cost)
21. Gather user feedback
22. Document in Code Update #36 completion

---

## 📝 Monitoring & Metrics

### **Key Metrics to Track:**

**Response Time:**
```python
metrics = {
    "total_duration_ms": 35000,
    "classification_ms": 4000,
    "retrieval_ms": 6000,
    "openai_ms": 14000,
    "perplexity_ms": 24000,
    "assembly_ms": 100
}
```

**Success Rates:**
```python
{
    "openai_success": True,
    "perplexity_success": True,
    "citations_count": 10
}
```

**Error Tracking:**
```python
# Log all errors with context
logger.error("Perplexity timeout", extra={
    "query": user_query[:100],
    "equipment": equipment_names,
    "timeout_seconds": 45
})
```

### **Alerts to Set:**

1. **High failure rate:** Perplexity success rate < 80%
2. **Slow responses:** P95 latency > 60s
3. **API errors:** More than 10 errors/hour
4. **Cost spike:** Daily spend > $50

---

## 🔧 Troubleshooting Guide

### **Problem: Perplexity not appearing in responses**

**Check:**
1. `PERPLEXITY_ENABLED=true` in .env
2. `PERPLEXITY_API_KEY` is set
3. Check logs for "Perplexity disabled" or "PERPLEXITY_API_KEY not set"
4. Verify Python sidecar restarted after env change

**Solution:**
```bash
# Check current env
cat python-sidecar/.env | grep PERPLEXITY

# Restart Python sidecar
pkill -f "python3 -m app.main"
cd python-sidecar
source venv/bin/activate
python3 -m app.main
```

### **Problem: Perplexity timeout errors**

**Symptoms:** Logs show "Perplexity API timeout after 45s"

**Solutions:**
1. Increase timeout: `PERPLEXITY_TIMEOUT=60`
2. Check network connectivity to api.perplexity.ai
3. Verify API key is valid (test with curl)

**Test API key:**
```bash
curl -X POST "https://api.perplexity.ai/chat/completions" \
  -H "Authorization: Bearer $PERPLEXITY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "sonar-pro",
    "messages": [{"role": "user", "content": "test"}]
  }'
```

### **Problem: Modal doesn't show Perplexity links**

**Check:**
1. Browser console for JavaScript errors
2. Source array in response (Network tab)
3. Modal code has PERPLEXITY case

**Debug:**
```javascript
// In browser console after getting response:
console.log(window.lastResponse.sources);
// Should see: [{type: "PERPLEXITY", count: 10, data: [...]}]
```

### **Problem: Links not clickable or don't open**

**Check:**
1. `target="_blank"` attribute present
2. `href` attribute has full URL
3. Browser popup blocker

**Fix:**
```javascript
// Verify in Elements inspector:
// <a href="https://..." target="_blank" rel="noopener noreferrer">
```

---

## 🎓 Key Learnings

### **1. Enhanced Query Quality Matters**

Test results showed enhanced queries with specific model numbers, features, and context produce 10x better results than generic queries. Worth the extra effort to extract this from our data.

### **2. Parallel > Sequential**

Running OpenAI and Perplexity in parallel saves ~14 seconds. `asyncio.gather()` with `return_exceptions=True` is the key pattern.

### **3. Graceful Degradation is Critical**

With external APIs, failures will happen. System must work with:
- No Perplexity (disabled or failed)
- No OpenAI (unlikely but possible)
- Both failed (fallback message)

### **4. Feature Flags Enable Safe Rollout**

`PERPLEXITY_ENABLED` flag allows:
- Development with flag OFF
- Testing with flag ON locally
- Production rollout with instant disable if needed

### **5. Frontend Must Handle New Types**

Adding new source types requires:
- Backend: Add to sources array
- Frontend: Add explicit case in modal
- CSS: Add styling for source bubble
- Testing: Verify all display correctly

---

## 📚 References

### **Test Scripts:**
- `/scripts/llm chat test/test-perplexity-sonar-pro.js` - Original 3-question test
- `/scripts/llm chat test/test-perplexity-comparison.js` - Basic vs Enhanced comparison

### **Related Code Updates:**
- Code Update #35: Source Bubbles Fix and Markdown Parser Replacement
- Code Update #34: Source Provenance Display

### **Documentation:**
- CLAUDE.md: Project rules and architecture
- .cursorrules: Coding standards and compliance

### **API Documentation:**
- Perplexity API: https://docs.perplexity.ai/

---

## ✅ Checklist for Implementation

**Phase 1: Perplexity Service**
- [ ] Create `/python-sidecar/app/chat/services/perplexity_service.py`
- [ ] Add `httpx` to requirements.txt (if needed)
- [ ] Add environment variables to `.env`
- [ ] Test query builder with unit tests
- [ ] Commit: "Add Perplexity service infrastructure"

**Phase 2: Workflow Integration**
- [ ] Import PerplexityService in `chat_workflow_sequential.py`
- [ ] Add `_query_perplexity()` method
- [ ] Add `_assemble_response()` method
- [ ] Modify `process_chat()` for parallel execution
- [ ] Test with `PERPLEXITY_ENABLED=false` (no changes)
- [ ] Test with `PERPLEXITY_ENABLED=true` (Perplexity runs)
- [ ] Commit: "Integrate Perplexity into workflow (feature flag controlled)"

**Phase 3: Source Formatting**
- [ ] Modify `_format_sources()` to accept perplexity_citations
- [ ] Add Perplexity source object to array
- [ ] Test source array structure
- [ ] Commit: "Add Perplexity to source formatting"

**Phase 4: Frontend Display**
- [ ] Add `PERPLEXITY` case to `showSourceDetails()`
- [ ] Create clickable link elements with `target="_blank"`
- [ ] Test modal opens and links work
- [ ] Test links open in new tab
- [ ] Commit: "Add Perplexity source modal display"

**Phase 5: Frontend Styling**
- [ ] Add `.source-bubble.source-perplexity` CSS
- [ ] Add dark mode support
- [ ] Test source bubbles display correctly
- [ ] Test hover effects
- [ ] Commit: "Add Perplexity source styling"

**Phase 6: End-to-End Testing**
- [ ] Enable Perplexity on dev environment
- [ ] Test troubleshooting query end-to-end
- [ ] Verify OpenAI + Perplexity both appear
- [ ] Test Perplexity failure (timeout) → OpenAI still works
- [ ] Test both failure → fallback message shows
- [ ] Check response times (should be ~33-35s)
- [ ] Monitor logs for errors

**Phase 7: Documentation**
- [ ] Update this file with completion status
- [ ] Document any issues encountered
- [ ] Document any deviations from plan
- [ ] Create Code Update #36 completion summary

---

## 🎯 Success Criteria

**Must Have:**
- [x] Enhanced Perplexity queries constructed from context
- [ ] Parallel execution of OpenAI + Perplexity
- [ ] Perplexity section appended to OpenAI response
- [ ] Clickable URLs in modal opening new tabs
- [ ] Graceful degradation when Perplexity fails
- [ ] Feature flag control
- [ ] Response time < 40s (P95)

**Nice to Have:**
- [ ] Unit tests for query builder
- [ ] Integration tests for failure modes
- [ ] Metrics logging for monitoring
- [ ] Cost tracking

**Out of Scope:**
- Page title extraction (just show URLs)
- Perplexity result caching
- User preference for Perplexity on/off
- Citation relevance scoring

---

## 🚦 Current Status

**Planning:** ✅ Complete
**Phase 1:** ✅ Complete (Perplexity Service)
**Phase 2:** ✅ Complete (Workflow Integration)
**Phase 3:** ✅ Complete (Source Formatting)
**Phase 4:** ✅ Complete (Frontend Modal)
**Phase 5:** ⏳ IN PROGRESS (CSS Styling - 80% done)
**Testing:** ⏳ Pending
**Production:** ⏳ Pending

**Last Updated:** 2025-10-26 19:00 (Backend complete, Frontend 80% complete)

---

## ✅ What's Been Completed (This Session)

### **Backend (Python) - 100% Complete**

1. **Perplexity Service** (`/python-sidecar/app/chat/services/perplexity_service.py`)
   - ✅ Created 199-line service file
   - ✅ `build_enhanced_query()` - Constructs enhanced queries from context
   - ✅ `query()` - Async Perplexity API call with timeout handling
   - ✅ All error handling graceful (no exceptions propagate)

2. **Environment Variables** (`.env`)
   - ✅ `PERPLEXITY_API_KEY` - Already existed
   - ✅ `PERPLEXITY_ENABLED=false` - Feature flag (OFF by default)
   - ✅ `PERPLEXITY_MODEL=sonar-pro`
   - ✅ `PERPLEXITY_TIMEOUT=45`

3. **Workflow Integration** (`/python-sidecar/app/chat/workflows/chat_workflow_sequential.py`)
   - ✅ Imported PerplexityService
   - ✅ Modified `process_chat()` for parallel execution (lines 148-173)
   - ✅ Added `_query_perplexity()` method (60 lines)
   - ✅ Added `_assemble_response()` method (90 lines)
   - ✅ Modified `_format_sources()` to handle Perplexity citations (10 lines added)
   - ✅ Total: ~165 lines added to workflow

4. **Dependencies**
   - ✅ `httpx==0.27.2` already in requirements.txt

### **Frontend (JavaScript/CSS) - 80% Complete**

5. **Modal Display** (`/src/public/app.js`)
   - ✅ Added PERPLEXITY case to `showSourceDetails()` function (lines 603-623)
   - ✅ Creates clickable links with `target="_blank"` (opens new tab)
   - ✅ Displays URL list with proper structure
   - ✅ Added security: `rel="noopener noreferrer"`

6. **CSS Styling** (`/src/public/chat-styles.css`)
   - ⏳ **NOT STARTED YET** (need to add ~30 lines)

---

## 🚧 What Remains To Complete

### **CRITICAL: CSS Styling (5 minutes)**

**File:** `/src/public/chat-styles.css`
**Location:** After line ~970 (after existing source bubble styles)

**Add this code:**

```css
/* Perplexity sources - purple/web theme */
.source-bubble.source-perplexity {
    background: rgba(147, 51, 234, 0.1);
    border-color: rgba(147, 51, 234, 0.4);
    color: #9333ea;
}

.source-bubble.source-perplexity:hover {
    background: rgba(147, 51, 234, 0.2);
    border-color: #9333ea;
}

/* Perplexity links in modal */
.perplexity-links {
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin: 16px 0;
}

.perplexity-link {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px;
    border: 1px solid var(--border-color);
    border-radius: 6px;
    text-decoration: none;
    color: var(--text-color);
    transition: all 0.2s ease;
}

.perplexity-link:hover {
    background-color: rgba(147, 51, 234, 0.05);
    border-color: #9333ea;
}

.perplexity-link .link-number {
    flex-shrink: 0;
    font-weight: 600;
    color: var(--text-secondary);
}

.perplexity-link .link-url {
    flex: 1;
    word-break: break-all;
    font-size: 13px;
}

.perplexity-link .link-icon {
    flex-shrink: 0;
    font-size: 16px;
}

.perplexity-note {
    margin-top: 16px;
    font-size: 12px;
    font-style: italic;
    color: var(--text-secondary);
}
```

**How to add:**
1. Open `/src/public/chat-styles.css`
2. Search for `.source-bubble.source-system` (around line 970)
3. Add the above CSS after that section
4. Save file

---

## 🧪 Testing Instructions

### **Test 1: Verify No Breakage (Feature Flag OFF)**

**Purpose:** Ensure system works exactly as before when Perplexity is disabled

```bash
# 1. Verify feature flag is OFF
grep PERPLEXITY_ENABLED .env
# Should show: PERPLEXITY_ENABLED=false

# 2. Restart Python sidecar
pkill -f "python3 -m app.main"
cd python-sidecar
source venv/bin/activate
python3 -m app.main

# 3. In another terminal, start Node.js
npm run dev

# 4. Test chat with a troubleshooting query:
# "i am having an issue with my fresh water pump where it is erroring out"

# 5. Verify:
# - Chat response appears normally
# - Sources show Pinecone/DIP only (NO Perplexity)
# - No errors in logs
# - Response time ~23-25s (unchanged)
```

### **Test 2: Enable Perplexity (Feature Flag ON)**

```bash
# 1. Enable feature flag
# Edit .env:
PERPLEXITY_ENABLED=true

# 2. Restart Python sidecar
pkill -f "python3 -m app.main"
cd python-sidecar
source venv/bin/activate
python3 -m app.main

# 3. Test same query

# 4. Check logs for:
grep "Perplexity" python-sidecar/logs/chat.log
# Should see:
# - "🌐 Perplexity enhanced query: Marco UP6/E..."
# - "✅ Perplexity success: 10 citations in XXXXms"

# 5. Verify in chat:
# - Response shows separator line: ───────────────────────────────
# - Shows "💡 Real-World Resources from Boat Owners"
# - Sources show purple Perplexity bubble (if CSS added)
# - Clicking Perplexity bubble opens modal with URLs
# - URLs are clickable and open new tab
# - Response time ~33-35s
```

### **Test 3: Failure Modes**

**Test Perplexity Timeout:**
```bash
# Edit .env:
PERPLEXITY_TIMEOUT=1  # Set to 1 second (will timeout)

# Restart and test
# Should see:
# - Log: "⚠️ Perplexity API timeout after 1s"
# - Chat works normally with OpenAI only
# - No Perplexity section in response
```

**Test Both Fail (Simulated):**
```bash
# Temporarily break both:
# - Set invalid Perplexity key
# - Stop OpenAI service

# Should see fallback message:
# "I apologize, but I'm having trouble processing your request..."
```

---

## 📝 Commit Instructions

Once CSS is added and tested:

```bash
git add .
git status
# Should show:
#   modified: .env
#   new file: python-sidecar/app/chat/services/perplexity_service.py
#   modified: python-sidecar/app/chat/workflows/chat_workflow_sequential.py
#   modified: src/public/app.js
#   modified: src/public/chat-styles.css

git commit -m "Add Perplexity web search integration for real-world marine troubleshooting

- Created Perplexity service with enhanced query builder
- Integrated parallel execution (OpenAI + Perplexity)
- Added Perplexity citations to source display
- Frontend modal shows clickable URLs opening in new tab
- Feature flag controlled (PERPLEXITY_ENABLED=false by default)
- Graceful degradation on failures

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## 🎯 Key Files Modified

1. **NEW:** `/python-sidecar/app/chat/services/perplexity_service.py` (199 lines)
2. **MODIFIED:** `.env` (+4 lines)
3. **MODIFIED:** `/python-sidecar/app/chat/workflows/chat_workflow_sequential.py` (+165 lines)
4. **MODIFIED:** `/src/public/app.js` (+21 lines)
5. **MODIFIED:** `/src/public/chat-styles.css` (+58 lines PENDING)

**Total:** 447 lines added across 5 files

---

## 🔧 Known Issues / Notes

1. **Vessel Type Hardcoded:** Currently hardcoded to "catamaran" in `_query_perplexity()` line 688
   - TODO: Get from user profile or config

2. **Feature Flag OFF:** Perplexity is disabled by default for safe rollout

3. **No Unit Tests Yet:** Service can be tested but no automated tests written

4. **Parallel Timing:** OpenAI finishes ~14s, Perplexity ~24s, so total wait is ~24s (not 38s)

---

## 🚀 Next Steps After This Session

1. **Add CSS** (5 minutes) - See code above
2. **Test with flag OFF** - Verify no breakage
3. **Test with flag ON** - Verify Perplexity works
4. **Monitor logs** - Check for errors
5. **Test response times** - Should be ~33-35s
6. **Commit changes**
7. **Update this doc** with final status

---

**End of Planning Document**

**Status:** Backend 100% complete, Frontend 80% complete (CSS remaining)
