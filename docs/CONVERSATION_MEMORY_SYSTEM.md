# Conversation Memory System Architecture

## Overview
Comprehensive conversation memory system for marine equipment chat that maintains context across exchanges, handles equipment relationships, and provides intelligent conversation management.

## Core Requirements

### Thread Management
- **New thread triggers**: New browser session, "New Chat" button, page refresh
- **Thread persistence**: Store forever in database
- **Thread naming**: Auto-generate 2-6 word summary after first Q&A exchange

### Context Preservation
- **Equipment context**: Always send systems table data with each query
- **Conversation memory**: Fading memory system with weight-based prioritization
- **Equipment relationships**: LLM-inferred connections (GPS→V100→Zeus example)

### Database Storage
- **Full context**: User query + assistant response + systems context + metadata + formatted response
- **Memory optimization**: Weight-based context where recent exchanges get more tokens
- **Equipment accumulation**: Maintain conversation-level equipment context as new equipment is mentioned

## System Architecture

### Current Chat Flow (BEFORE)
```
User Query → Extract Keywords → Systems Search → Python LangGraph → Response
                                                ↑
                                         No conversation context
```

### Enhanced Chat Flow (AFTER)
```
User Query → Context Analysis → Weighted Memory + Equipment Context → Python LangGraph → Response
                ↓                                                            ↓
        Thread Summary Generation                              Store Full Context
                ↓                                                            ↓
        Update Thread Name                                        Update Memory Weights
```

## Implementation Components

### 1. Conversation Context Manager
**Location**: `src/services/conversation-context.service.js`

**Responsibilities**:
- Fetch and weight conversation history
- Merge equipment context across exchanges
- Generate conversation summaries for LLM context

**Memory Weighting Strategy**:
```javascript
// Recent exchanges = full context, older = compressed
const weights = {
  current: 1.0,      // Full detail
  last_2: 0.8,       // High detail
  last_5: 0.5,       // Medium detail
  older: 0.2         // Compressed summary
}
```

### 2. Equipment Relationship Handler
**Location**: `src/services/equipment-relationship.service.js`

**Responsibilities**:
- Track equipment mentioned in conversation
- Maintain accumulated equipment context
- Handle equipment transitions intelligently

**Equipment Context Strategy**:
- **Primary equipment**: From original systems search
- **Related equipment**: Added as conversation progresses
- **Context preservation**: Keep all mentioned equipment in weighted context

### 3. Thread Naming Service
**Location**: `src/services/thread-naming.service.js`

**Responsibilities**:
- Generate thread names after first exchange
- Use fast/cheap LLM for naming
- Update thread records with generated names

**Naming Prompt Template**:
```
Generate a 2-6 word title for this marine equipment conversation:

User: {first_question}
Assistant: {first_response}
Equipment: {equipment_context}

Title:
```

### 4. Enhanced Database Schema

#### chat_messages Table (ENHANCED)
```sql
-- Existing fields + new ones
ALTER TABLE chat_messages ADD COLUMN equipment_context JSONB;
ALTER TABLE chat_messages ADD COLUMN conversation_summary TEXT;
ALTER TABLE chat_messages ADD COLUMN memory_weight DECIMAL(3,2);
ALTER TABLE chat_messages ADD COLUMN processing_metadata JSONB;
```

#### chat_threads Table (ENHANCED)
```sql
-- Add thread naming and accumulated context
ALTER TABLE chat_threads ADD COLUMN auto_generated_name VARCHAR(100);
ALTER TABLE chat_threads ADD COLUMN accumulated_equipment JSONB;
ALTER TABLE chat_threads ADD COLUMN conversation_summary TEXT;
```

### 5. LangGraph Integration
**Location**: `python-sidecar/app/chat/workflows/chat_workflow.py`

**Enhanced State**:
```python
class WorkflowState(TypedDict):
    # Existing fields...
    conversation_history: Optional[str]          # NEW: Weighted conversation summary
    accumulated_equipment: List[Dict[str, Any]]  # NEW: All equipment from conversation
    memory_context: Optional[Dict[str, Any]]     # NEW: Memory weights and summaries
```

**New Node**: `memory_integration_node`
- Processes conversation history
- Merges equipment contexts
- Prepares weighted context for LLM

## Data Flow Examples

### First Exchange
```
1. User: "tell me about my fortress anchor"
2. Systems search: Fortress FX-37 found
3. LangGraph: Process with equipment context
4. Response: Technical details about Fortress FX-37
5. Store: Full exchange + equipment context
6. Thread naming: "Fortress Anchor Discussion"
```

### Second Exchange
```
1. User: "what is it made of?"
2. Context analysis: No new equipment keywords
3. Memory retrieval: Weight previous exchange (1.0) + equipment context
4. LangGraph: Process with Fortress context + conversation memory
5. Response: Material details for Fortress FX-37 (NOT watermaker!)
6. Store: New exchange + updated memory weights
```

### Equipment Transition Example
```
1. User: "how does my GPS connect to the V100?"
2. Systems search: GPS equipment found
3. Context analysis: Fortress anchor (0.5 weight) + GPS (1.0 weight)
4. LangGraph: Process with both equipment contexts
5. Response: GPS-V100 connection details
6. Store: Accumulated equipment = [Fortress, GPS, V100]
```

## Technical Implementation Plan

### Phase 1: Foundation (Current Priority)
1. ✅ Enhanced systems context (COMPLETED)
2. 🔄 Conversation context service
3. 🔄 Memory weighting system
4. 🔄 Database schema updates

### Phase 2: Core Features
1. Thread naming service
2. Equipment relationship handling
3. LangGraph memory integration
4. Enhanced conversation storage

### Phase 3: Advanced Features
1. Multi-equipment context management
2. Conversation topic transition handling
3. Memory optimization and pruning
4. Advanced equipment relationship inference

## Success Metrics

### Immediate Fixes
- ✅ "what is it made of?" maintains Fortress anchor context
- ✅ Equipment identification stays consistent (no more Wichard confusion)
- ✅ Thread conversations maintain coherent context

### Advanced Goals
- 🎯 Handle complex equipment relationships (GPS→V100→Zeus)
- 🎯 Generate meaningful thread names automatically
- 🎯 Maintain context across long conversations (10+ exchanges)
- 🎯 Smart memory management with fading importance

## Risk Mitigation

### Context Loss Prevention
- **Full documentation**: This file prevents implementation detail loss
- **Comprehensive testing**: Test all conversation scenarios
- **Incremental implementation**: Phase-based rollout
- **Rollback capability**: Maintain current system during development

### Performance Considerations
- **Memory limits**: Cap conversation context at reasonable token limits
- **Fast LLM calls**: Use cheaper models for naming/summarization
- **Database optimization**: Index conversation tables properly
- **Async processing**: Background thread naming and summarization

---

*This architecture ensures robust conversation memory that scales with complex marine equipment discussions while maintaining performance and preventing context loss.*