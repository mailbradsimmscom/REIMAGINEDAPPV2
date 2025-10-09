"""
Chat-specific Pydantic models for LangGraph state and API contracts
"""
from typing import Dict, Any, List, Optional
from datetime import datetime
from pydantic import BaseModel, Field

class ChatState(BaseModel):
    """LangGraph state for chat processing"""
    user_query: str
    thread_id: Optional[str] = None
    systems_context: Optional[List[Dict[str, Any]]] = []

    # NEW: Conversation memory state
    conversation_summary: Optional[str] = None
    memory_context: Optional[Dict[str, Any]] = None
    accumulated_equipment: List[Dict[str, Any]] = []

    # Processing state
    classification: Optional[Dict[str, Any]] = None
    dip_results: List[Dict[str, Any]] = []
    pinecone_results: Optional[Dict[str, Any]] = None
    web_results: Optional[Dict[str, Any]] = None

    # Final outputs
    final_response: Optional[str] = None
    response_score: Optional[Dict[str, Any]] = None
    processing_steps: List[str] = []

    # Metadata
    start_time: Optional[datetime] = None
    error: Optional[str] = None

class QueryClassification(BaseModel):
    """Query classification result"""
    primary: str = Field(description="Primary intent category")
    confidence: float = Field(ge=0.0, le=1.0, description="Classification confidence")
    table_types: List[str] = Field(description="Recommended DIP table types to query")
    equipment_context: Optional[Dict[str, Any]] = None
    reasoning: Optional[str] = None

class ResponseScore(BaseModel):
    """Response quality scoring"""
    total_score: int = Field(ge=0, le=100, description="Total quality score")
    confidence: str = Field(description="Confidence level: high|medium|low|very_low")
    breakdown: Dict[str, float] = Field(description="Score breakdown by component")
    confidence_emoji: str = Field(description="Visual confidence indicator")
    reasoning: str = Field(description="Human-readable score reasoning")

# API Request/Response Models
class ChatRequest(BaseModel):
    """Incoming chat request"""
    query: str
    thread_id: Optional[str] = None
    systems_context: Optional[List[Dict[str, Any]]] = []

    # NEW: Conversation memory from Node.js
    conversation_summary: Optional[str] = None
    memory_context: Optional[Dict[str, Any]] = None
    equipment_inference: Optional[Dict[str, Any]] = None
    table_types: Optional[List[str]] = None

    # Model selection for synthesis
    synthesis_model: Optional[str] = None  # Default None = use env var OPENAI_MODEL

class ChatResponse(BaseModel):
    """Chat response"""
    response: str
    thread_id: str
    sources: List[Dict[str, Any]] = []
    score: Optional[ResponseScore] = None
    classification: Optional[QueryClassification] = None
    processing_time_ms: int
    metadata: Dict[str, Any] = {}
    detailed_metrics: Optional[Dict[str, Any]] = None  # Added for stats panel

class HealthResponse(BaseModel):
    """Health check response"""
    status: str
    timestamp: datetime
    services: Dict[str, str]