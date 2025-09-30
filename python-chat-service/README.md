# Python Chat Service

Standalone LangGraph + LangChain powered chat service with DIP table integration.

## Features

- **LangGraph Workflow**: Multi-step chat processing with conditional routing
- **LangChain Memory**: Session/thread management with PostgreSQL persistence
- **DIP Integration**: Production table queries (spec_suggestions, playbook_hints, intent_router, golden_tests)
- **Query Classification**: Intelligent routing based on intent analysis
- **Response Scoring**: 0-100 quality score with confidence levels
- **Equipment Context**: HVAC-specific entity extraction and memory

## Architecture

- **Port**: 8001 (separate from Node.js sidecar on 8000)
- **Framework**: FastAPI + LangGraph + LangChain
- **Memory**: PostgresChatMessageHistory + CombinedMemory
- **Database**: Supabase (DIP tables + chat persistence)
- **Deployment**: Docker container

## API Endpoints

### Chat Processing
- `POST /v1/chat/process` - Main chat endpoint
- `POST /v1/chat/sessions` - Create session
- `POST /v1/chat/threads` - Create thread
- `DELETE /v1/chat/sessions/{session_id}` - Clear session memory

### Health & Debug
- `GET /health` - Service health check
- `GET /v1/debug/classification?query=...` - Test query classification
- `GET /v1/debug/dip-search?query=...&table=...` - Test DIP searches

## Quick Start

```bash
# Using Docker Compose
docker-compose up -d

# Or run directly
pip install -r requirements.txt
python app/main.py
```

## Environment Variables

```
OPENAI_API_KEY=sk-...
SUPABASE_URL=https://...
SUPABASE_SERVICE_KEY=...
DATABASE_URL=postgresql://...
```

## Integration with Node.js UI

Update frontend to call Python service endpoints:

```javascript
const response = await fetch('http://localhost:8001/v1/chat/process', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    query: userInput,
    session_id: sessionId,
    thread_id: threadId
  })
});
```

## LangGraph Workflow

1. **load_memory** - Load conversation history
2. **classify_query** - Determine intent and routing
3. **query_dip_tables** - Search production DIP tables
4. **query_pinecone** - Vector search (if needed)
5. **query_web** - Web search (conditional)
6. **merge_results** - Combine all sources
7. **score_response** - Calculate quality score
8. **format_response** - Generate final answer
9. **save_memory** - Persist conversation

## Memory Management

- **Window Memory**: Last 10 messages
- **Summary Memory**: Conversation summaries
- **Entity Memory**: Equipment context (manufacturer, model, etc.)
- **Persistence**: PostgreSQL via LangChain