"""
Two-Call Chat Endpoints for Performance Optimization

Provides fast initial response with cached state, followed by
web-enriched response in background
"""

import os
import logging
from typing import Dict, Any, Optional
from datetime import datetime
from pydantic import BaseModel, Field
from fastapi import HTTPException

logger = logging.getLogger(__name__)

# Request/Response models for two-call mode
class FastChatRequest(BaseModel):
    """Request for fast chat endpoint"""
    query: str = Field(..., description="User query")
    thread_id: Optional[str] = Field(None, description="Conversation thread ID")
    session_id: Optional[str] = Field(None, description="Session ID")
    synthesis_model: Optional[str] = Field("gpt-5", description="Model for synthesis")
    return_cached_state: bool = Field(True, description="Return cached state for web enrichment")
    cache_config: Optional[Dict[str, int]] = Field(None, description="Cache configuration")

class FastChatResponse(BaseModel):
    """Response from fast chat endpoint"""
    message: str = Field(..., description="Initial response message")
    cachedState: Optional[Dict[str, Any]] = Field(None, description="Cached state for enrichment")
    sequenceNumber: Optional[int] = Field(None, description="Message sequence number")

class WebEnrichRequest(BaseModel):
    """Request for web enrichment endpoint"""
    thread_id: str = Field(..., description="Thread ID")
    message_id: str = Field(..., description="Message ID to enrich")
    cached_state: Dict[str, Any] = Field(..., description="Cached state from fast response")

class WebEnrichResponse(BaseModel):
    """Response from web enrichment endpoint"""
    enrichedContent: str = Field(..., description="Enriched message content")
    webSources: Optional[list] = Field(None, description="Web sources used")


class TwoCallHandler:
    """Handler for two-call chat optimization"""

    def __init__(self, llm_service, dip_retriever, pinecone_client, perplexity_service=None):
        self.llm_service = llm_service
        self.dip_retriever = dip_retriever
        self.pinecone_client = pinecone_client
        self.perplexity_service = perplexity_service

        # Get configuration from environment
        self.chunks_for_cache = int(os.getenv("PINECONE_CHUNKS_FOR_CACHE", "5"))
        self.chunk_size = int(os.getenv("PINECONE_CHUNK_SIZE", "1000"))

        logger.info(f"Two-call handler initialized with cache config: {self.chunks_for_cache} chunks × {self.chunk_size} chars")

    async def process_fast(self, request: FastChatRequest) -> FastChatResponse:
        """
        Process fast chat request - returns quickly with cached state
        """
        start_time = datetime.now()

        try:
            # Import the sequential workflow
            from .workflows.chat_workflow_sequential import ChatWorkflowSequential

            # Initialize workflow
            workflow = ChatWorkflowSequential(
                self.llm_service,
                self.dip_retriever,
                self.pinecone_client
            )

            # Process with minimal steps for fast response
            state = await self._process_minimal_workflow(workflow, request)

            # Create cached state if requested
            cached_state = None
            if request.return_cached_state:
                cached_state = self._create_cached_state(state, request.cache_config)

            # Generate quick response
            quick_response = self._generate_quick_response(state)

            duration = (datetime.now() - start_time).total_seconds() * 1000
            logger.info(f"Fast chat processed in {duration:.0f}ms")

            return FastChatResponse(
                message=quick_response,
                cachedState=cached_state
            )

        except Exception as e:
            logger.error(f"Fast chat processing failed: {e}")
            raise HTTPException(status_code=500, detail=str(e))

    async def _process_minimal_workflow(self, workflow, request: FastChatRequest) -> Dict[str, Any]:
        """
        Run minimal workflow steps for fast response
        """
        from datetime import datetime

        # Initialize state
        state = {
            "user_query": request.query,
            "thread_id": request.thread_id,
            "systems_context": [],
            "conversation_summary": None,
            "memory_context": None,
            "synthesis_model": request.synthesis_model,
            "classification": None,
            "primary_equipment": None,
            "secondary_equipment": [],
            "dip_results": [],
            "pinecone_results": None,
            "final_response": None,
            "response_score": None,
            "start_time": datetime.now(),
            "processing_steps": []
        }

        # Step 1: Quick classification
        state = await workflow._classify_query(state)

        # Step 2: Fast data retrieval (Pinecone only, skip DIP for speed)
        if self.pinecone_client:
            # Skip DIP for fast mode, just do Pinecone
            state["skip_dip"] = True
            state = await workflow._retrieve_data(state)

        # Step 3: Generate initial response without web enrichment
        # Use a simpler synthesis for speed
        state["skip_web_enrichment"] = True
        state = await workflow._synthesize_response(state)

        return state

    def _create_cached_state(self, state: Dict[str, Any], cache_config: Optional[Dict[str, int]] = None) -> Dict[str, Any]:
        """
        Create cached state for web enrichment
        """
        chunks = cache_config.get("chunks", self.chunks_for_cache) if cache_config else self.chunks_for_cache
        chunk_size = cache_config.get("chunk_size", self.chunk_size) if cache_config else self.chunk_size

        # Extract limited Pinecone results for cache
        pinecone_matches = []
        if state.get("pinecone_results") and state["pinecone_results"].get("matches"):
            for match in state["pinecone_results"]["matches"][:chunks]:
                pinecone_matches.append({
                    "text": match.get("text", "")[:chunk_size],
                    "score": match.get("score", 0),
                    "doc_type": match.get("metadata", {}).get("doc_type"),
                    "manufacturer": match.get("metadata", {}).get("manufacturer"),
                    "model": match.get("metadata", {}).get("model")
                })

        cached_state = {
            "user_query": state.get("user_query"),
            "systems_context": state.get("systems_context", []),
            "classification": state.get("classification", {}),
            "synthesis_model": state.get("synthesis_model"),

            # Limited Pinecone results for cache
            "pinecone_results": {
                "matches": pinecone_matches
            },

            "conversation_summary": state.get("conversation_summary", ""),
            "memory_context": {
                "total_exchanges": state.get("memory_context", {}).get("total_exchanges", 0)
                if state.get("memory_context") else 0
            }
        }

        # Log cache size
        import json
        cache_size = len(json.dumps(cached_state))
        logger.info(f"Created cached state: {cache_size} bytes, {len(pinecone_matches)} Pinecone matches")

        return cached_state

    def _generate_quick_response(self, state: Dict[str, Any]) -> str:
        """
        Generate a quick initial response
        """
        if state.get("final_response"):
            return state["final_response"]

        # Fallback response if synthesis failed
        classification = state.get("classification", {})
        intent = classification.get("primary", "general")

        return f"I'm processing your {intent} question. Let me gather the relevant information for you..."

    async def enrich_with_web(self, request: WebEnrichRequest) -> WebEnrichResponse:
        """
        Enrich message with web content using cached state
        """
        start_time = datetime.now()

        try:
            # Check if Perplexity is enabled
            if not self.perplexity_service or not self.perplexity_service.is_enabled():
                logger.info("Web enrichment skipped - Perplexity not enabled")
                return WebEnrichResponse(
                    enrichedContent="Web enrichment is not currently available.",
                    webSources=[]
                )

            # Use cached state to generate web-enriched response
            enriched_result = await self._generate_web_enrichment(request.cached_state)

            duration = (datetime.now() - start_time).total_seconds() * 1000
            logger.info(f"Web enrichment completed in {duration:.0f}ms")

            return WebEnrichResponse(
                enrichedContent=enriched_result["content"],
                webSources=enriched_result.get("sources", [])
            )

        except Exception as e:
            logger.error(f"Web enrichment failed: {e}")
            raise HTTPException(status_code=500, detail=str(e))

    async def _generate_web_enrichment(self, cached_state: Dict[str, Any]) -> Dict[str, Any]:
        """
        Generate web-enriched content using Perplexity
        """
        if not self.perplexity_service:
            return {"content": "Web enrichment service not available", "sources": []}

        # Reconstruct context from cached state
        query = cached_state.get("user_query", "")
        classification = cached_state.get("classification", {})
        pinecone_matches = cached_state.get("pinecone_results", {}).get("matches", [])

        # Build context for Perplexity
        context_parts = []

        # Add classification context
        if classification:
            intent = classification.get("primary", "general")
            context_parts.append(f"Query type: {intent}")

        # Add top Pinecone results as context
        if pinecone_matches:
            context_parts.append("Relevant documentation found:")
            for match in pinecone_matches[:3]:  # Top 3 matches
                if match.get("text"):
                    context_parts.append(f"- {match['text'][:200]}...")

        full_context = "\n".join(context_parts) if context_parts else None

        # Call Perplexity for web enrichment
        try:
            result = await self.perplexity_service.search(
                query=query,
                context=full_context,
                intent=classification.get("primary", "general")
            )

            return {
                "content": result.get("answer", ""),
                "sources": result.get("sources", [])
            }
        except Exception as e:
            logger.error(f"Perplexity search failed: {e}")
            return {
                "content": "Unable to fetch web enrichment at this time.",
                "sources": []
            }


def register_two_call_endpoints(app, llm_service, dip_retriever, pinecone_client):
    """
    Register two-call endpoints with FastAPI app

    Args:
        app: FastAPI application instance
        llm_service: LLM service instance
        dip_retriever: DIP retriever instance
        pinecone_client: Pinecone client instance
    """
    # Initialize Perplexity service if available
    perplexity_service = None
    try:
        from .services.perplexity_service import PerplexityService
        perplexity_service = PerplexityService()
        if perplexity_service.is_enabled():
            logger.info("✅ Perplexity service available for web enrichment")
        else:
            logger.info("⚠️ Perplexity service disabled - web enrichment unavailable")
    except Exception as e:
        logger.warning(f"Could not initialize Perplexity service: {e}")

    # Create handler
    handler = TwoCallHandler(llm_service, dip_retriever, pinecone_client, perplexity_service)

    @app.post("/chat/fast", response_model=FastChatResponse)
    async def fast_chat(request: FastChatRequest):
        """
        Fast chat endpoint - returns quickly with cached state

        This endpoint processes the chat query with minimal steps to provide
        a quick initial response. It returns cached state that can be used
        for background web enrichment.
        """
        return await handler.process_fast(request)

    @app.post("/chat/enrich-web", response_model=WebEnrichResponse)
    async def enrich_web(request: WebEnrichRequest):
        """
        Web enrichment endpoint - enriches message with web content

        This endpoint takes cached state from the fast response and
        enriches it with web search results from Perplexity.
        """
        return await handler.enrich_with_web(request)

    logger.info("✅ Two-call endpoints registered: /chat/fast and /chat/enrich-web")