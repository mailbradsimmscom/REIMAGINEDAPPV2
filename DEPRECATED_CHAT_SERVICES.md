# Deprecated Chat Services

## Overview
The enhanced-chat service and its dependencies have been fully replaced by the Python LangGraph workflow with conversation memory system.

## Migration Status: ✅ COMPLETE

### Replaced Service
**Old**: `src/services/enhanced-chat.service.js`
**New**: `src/services/chat-proxy.service.js` → Python LangGraph

### Updated Routes
All chat routes now use the chat repository directly instead of the deprecated service:

| Route | Status | New Implementation |
|-------|--------|-------------------|
| `/chat/process` | ✅ Migrated | Uses `chat-proxy.service.js` |
| `/chat/history` | ✅ Migrated | Uses `getChatMessages` from repository |
| `/chat/list` | ✅ Migrated | Uses `listChatSessions` from repository |
| `/chat/delete` | ✅ Migrated | Uses `deleteChatSession` from repository |
| `/chat/:sessionId` (delete) | ✅ Migrated | Uses `deleteChatSession` from repository |
| `/chat/context` | ✅ Migrated | Uses repository + `getWeightedConversationContext` |

### Orphaned Services (Not in Use)
These services were part of the old enhanced-chat workflow and are no longer referenced anywhere in the active codebase:

- `src/services/assistant-response.service.js`
- `src/services/summarization.service.js`
- `src/services/intent-router.service.js`
- `src/utils/context-utils.js`

**Recommendation**: These can be safely deleted or moved to an archive folder.

## New Architecture

### Core Services
1. **chat-proxy.service.js** - Main orchestrator
   - Handles conversation memory
   - Equipment relationship inference
   - Message persistence
   - Thread naming
   - Proxies to Python LangGraph

2. **conversation-context.service.js** - Memory management
   - Weighted conversation context
   - Equipment accumulation
   - Memory fading

3. **thread-naming.service.js** - Auto-naming
   - LLM-powered thread naming
   - Generates descriptive names after first exchange

4. **equipment-relationship-inference.service.js** - Smart inference
   - Detects equipment references ("it", "this device")
   - Understands equipment relationships
   - LLM-powered context resolution

### Python LangGraph Workflow
Located in `python-sidecar/app/chat/`:
- `workflows/chat_workflow.py` - Main LangGraph StateGraph
- `services/llm_service.py` - LLM operations (classification, synthesis, scoring)
- `services/dip_retriever.py` - DIP table queries
- `config/system_prompts.py` - Centralized prompts with conversation memory

## Key Improvements

### Before (enhanced-chat.service.js)
- ❌ No conversation memory
- ❌ Lost equipment context between messages
- ❌ No relationship inference
- ❌ Manual thread naming
- ❌ Simple keyword matching

### After (chat-proxy + LangGraph)
- ✅ Full conversation memory with weights
- ✅ Equipment context preserved across conversation
- ✅ Smart equipment relationship inference
- ✅ Auto thread naming with LLM
- ✅ LLM-powered intent classification
- ✅ Multi-source data retrieval (DIP + Pinecone)
- ✅ Response quality scoring
- ✅ Message persistence for memory

## Testing
All routes tested and working:
- ✅ Chat processing with equipment context
- ✅ Message persistence to database
- ✅ History retrieval
- ✅ Session/thread management
- ✅ Delete operations

## Next Steps

### To Fully Activate Conversation Memory:
1. Run database migration: `scripts/migrations/017_enhance_chat_schema_for_conversation_memory.sql`
2. This adds:
   - Equipment context tracking tables
   - Memory weight fields
   - Conversation statistics
   - Thread summarization support

### Optional Cleanup:
```bash
# Move deprecated services to archive
mkdir -p src/services/archived
mv src/services/enhanced-chat.service.js src/services/archived/
mv src/services/assistant-response.service.js src/services/archived/
mv src/services/summarization.service.js src/services/archived/
mv src/services/intent-router.service.js src/services/archived/
mv src/utils/context-utils.js src/utils/archived/
```

## Date
September 27, 2025