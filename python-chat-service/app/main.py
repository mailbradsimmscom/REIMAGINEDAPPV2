"""
Standalone Python Chat Service with LangGraph and DIP Integration
Runs on port 8001 to avoid conflicts with existing sidecar (port 8000)
"""
import os
import logging
from datetime import datetime
from typing import Dict, Any, List
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Import chat components
from chat.models import (
    ChatRequest,
    ChatResponse,
    SessionRequest,
    ThreadRequest,
    HealthResponse,
    ChatState
)
from chat.workflow import chat_workflow
from chat.services.memory_manager import MemoryManagerFactory

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan management"""
    logger.info("🚀 Starting Python Chat Service")

    # Validate environment variables
    required_vars = ["OPENAI_API_KEY", "SUPABASE_URL", "SUPABASE_SERVICE_KEY", "DATABASE_URL"]
    missing_vars = [var for var in required_vars if not os.getenv(var)]

    if missing_vars:
        logger.error(f"❌ Missing required environment variables: {missing_vars}")
        raise ValueError(f"Missing environment variables: {missing_vars}")

    logger.info("✅ Environment validation completed")
    logger.info("✅ Chat service ready")

    yield

    logger.info("🛑 Shutting down Python Chat Service")


# Create FastAPI app
app = FastAPI(
    title="Intelligent Chat Service",
    description="LangGraph-powered chat with DIP table integration and LangChain memory",
    version="1.0.0",
    lifespan=lifespan
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3001"],  # Node.js frontend
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Dependency for request logging
def get_request_logger():
    """Create request-scoped logger"""
    return logger


@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Health check endpoint"""
    try:
        # Test database connection
        from chat.services.simple_dip_retriever import SimpleDIPRetriever
        retriever = SimpleDIPRetriever()

        services = {
            "database": "healthy",
            "langgraph": "healthy",
            "langchain": "healthy",
            "openai": "healthy" if os.getenv("OPENAI_API_KEY") else "missing_key"
        }

        return HealthResponse(
            status="healthy",
            timestamp=datetime.now(),
            services=services
        )
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        return HealthResponse(
            status="unhealthy",
            timestamp=datetime.now(),
            services={"error": str(e)}
        )


@app.post("/v1/chat/process", response_model=ChatResponse)
async def process_chat(
    request: ChatRequest,
    request_logger = Depends(get_request_logger)
) -> ChatResponse:
    """
    Main chat processing endpoint
    Processes user query through LangGraph workflow with DIP integration
    """
    start_time = datetime.now()

    try:
        request_logger.info(f"📨 Processing chat request: {request.query[:100]}...")

        # Create initial state
        state = ChatState(
            user_query=request.query,
            session_id=request.session_id,
            thread_id=request.thread_id,
            systems_context=request.systems_context or [],
            start_time=start_time
        )

        # Process through LangGraph workflow
        final_state = await chat_workflow.process_chat(state)

        if final_state.error:
            raise HTTPException(status_code=500, detail=final_state.error)

        # Calculate processing time
        processing_time_ms = int((datetime.now() - start_time).total_seconds() * 1000)

        # Build sources from final state
        sources = []
        if final_state.dip_results:
            for table_result in final_state.dip_results:
                sources.append({
                    "type": table_result["table"],
                    "count": table_result["count"],
                    "data": table_result["results"][:3]  # Limit to top 3 for response
                })

        # Build response
        response = ChatResponse(
            response=final_state.final_response or "I couldn't generate a response.",
            session_id=final_state.session_id or "unknown",
            thread_id=final_state.thread_id or "unknown",
            sources=sources,
            score=final_state.response_score or {},
            classification=final_state.classification or {},
            processing_time_ms=processing_time_ms,
            metadata={
                "processing_steps": final_state.processing_steps,
                "has_dip_results": len(final_state.dip_results) > 0,
                "has_pinecone_results": bool(final_state.pinecone_results),
                "should_search_web": final_state.should_search_web
            }
        )

        request_logger.info(f"✅ Chat processed successfully in {processing_time_ms}ms")
        return response

    except HTTPException:
        raise
    except Exception as e:
        request_logger.error(f"❌ Chat processing failed: {e}")
        raise HTTPException(status_code=500, detail=f"Chat processing failed: {str(e)}")


@app.post("/v1/chat/sessions")
async def create_session(request: SessionRequest):
    """Create a new chat session"""
    try:
        # For now, generate a simple session ID
        # This could be enhanced to store session metadata in database
        session_id = f"session-{datetime.now().strftime('%Y%m%d-%H%M%S')}-{os.urandom(4).hex()}"

        return {
            "session_id": session_id,
            "name": request.name,
            "description": request.description,
            "created_at": datetime.now().isoformat(),
            "metadata": request.metadata
        }
    except Exception as e:
        logger.error(f"Session creation failed: {e}")
        raise HTTPException(status_code=500, detail=f"Session creation failed: {str(e)}")


@app.get("/v1/chat/sessions")
async def list_sessions(limit: int = 25):
    """List chat sessions"""
    try:
        # This is a placeholder - would integrate with actual session storage
        return {
            "sessions": [],
            "message": "Session listing not yet implemented - using LangChain memory storage"
        }
    except Exception as e:
        logger.error(f"Session listing failed: {e}")
        raise HTTPException(status_code=500, detail=f"Session listing failed: {str(e)}")


@app.post("/v1/chat/threads")
async def create_thread(request: ThreadRequest):
    """Create a new thread within a session"""
    try:
        thread_id = f"thread-{datetime.now().strftime('%Y%m%d-%H%M%S')}-{os.urandom(4).hex()}"

        return {
            "thread_id": thread_id,
            "session_id": request.session_id,
            "name": request.name,
            "created_at": datetime.now().isoformat(),
            "metadata": request.metadata
        }
    except Exception as e:
        logger.error(f"Thread creation failed: {e}")
        raise HTTPException(status_code=500, detail=f"Thread creation failed: {str(e)}")


@app.get("/v1/chat/threads/{thread_id}")
async def get_thread(thread_id: str):
    """Get thread with message history"""
    try:
        # This would integrate with LangChain memory to get thread history
        return {
            "thread_id": thread_id,
            "messages": [],
            "message": "Thread retrieval uses LangChain memory - check PostgresChatMessageHistory"
        }
    except Exception as e:
        logger.error(f"Thread retrieval failed: {e}")
        raise HTTPException(status_code=500, detail=f"Thread retrieval failed: {str(e)}")


@app.delete("/v1/chat/sessions/{session_id}")
async def delete_session(session_id: str):
    """Delete a chat session and clear its memory"""
    try:
        # Clear memory for session
        memory_manager = MemoryManagerFactory.get_manager(session_id)
        memory_manager.clear_memory()
        MemoryManagerFactory.cleanup_manager(session_id)

        return {"message": f"Session {session_id} deleted successfully"}
    except Exception as e:
        logger.error(f"Session deletion failed: {e}")
        raise HTTPException(status_code=500, detail=f"Session deletion failed: {str(e)}")


@app.get("/v1/debug/classification")
async def debug_classification(query: str):
    """Debug endpoint for query classification"""
    try:
        from chat.services.query_classifier import QueryClassifier
        classifier = QueryClassifier()

        result = classifier.classify(query)
        return result.dict()
    except Exception as e:
        logger.error(f"Classification debug failed: {e}")
        raise HTTPException(status_code=500, detail=f"Classification failed: {str(e)}")


@app.get("/v1/debug/dip-search")
async def debug_dip_search(query: str, table: str = "spec_suggestions"):
    """Debug endpoint for DIP table searches"""
    try:
        from chat.services.simple_dip_retriever import SimpleDIPRetriever
        retriever = SimpleDIPRetriever()

        if table == "spec_suggestions":
            results = await retriever.search_spec_suggestions(query)
        elif table == "playbook_hints":
            results = await retriever.search_playbook_hints(query)
        elif table == "intent_router":
            results = await retriever.search_intent_router(query)
        elif table == "golden_tests":
            results = await retriever.search_golden_tests(query)
        else:
            raise HTTPException(status_code=400, detail=f"Unknown table: {table}")

        return {
            "query": query,
            "table": table,
            "results": results,
            "count": len(results)
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"DIP search debug failed: {e}")
        raise HTTPException(status_code=500, detail=f"DIP search failed: {str(e)}")


# Error handlers
@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    """Global exception handler"""
    logger.error(f"Unhandled exception: {exc}")
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error", "error": str(exc)}
    )


if __name__ == "__main__":
    # Run the service
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8001,  # Different from existing sidecar (8000)
        reload=True,
        log_level="info"
    )