"""
Pydantic models for the standalone chat service
"""
from pydantic import BaseModel, Field
from typing import Dict, List, Optional, Any, Literal
from datetime import datetime


# Request/Response models
class ChatRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=1000)
    session_id: Optional[str] = None
    thread_id: Optional[str] = None
    systems_context: Optional[List[Dict[str, Any]]] = []


class ChatResponse(BaseModel):
    response: str
    session_id: str
    thread_id: str
    sources: List[Dict[str, Any]]
    score: Dict[str, Any]
    classification: Dict[str, Any]
    processing_time_ms: int
    metadata: Dict[str, Any]


class SessionRequest(BaseModel):
    name: Optional[str] = "New Chat"
    description: Optional[str] = ""
    metadata: Optional[Dict[str, Any]] = {}


class ThreadRequest(BaseModel):
    session_id: str
    name: Optional[str] = "New Thread"
    metadata: Optional[Dict[str, Any]] = {}


# LangGraph State model
class ChatState(BaseModel):
    # Input
    user_query: str
    session_id: Optional[str] = None
    thread_id: Optional[str] = None
    systems_context: List[Dict[str, Any]] = []

    # Processing state
    classification: Optional[Dict[str, Any]] = None
    memory_context: Optional[Dict[str, Any]] = None
    dip_results: List[Dict[str, Any]] = []
    pinecone_results: Optional[Dict[str, Any]] = None
    web_results: List[Dict[str, Any]] = []
    merged_context: Optional[Dict[str, Any]] = None
    response_score: Optional[Dict[str, Any]] = None
    final_response: Optional[str] = None

    # Control flow
    should_search_web: bool = False
    error: Optional[str] = None

    # Metadata
    start_time: datetime = Field(default_factory=datetime.now)
    processing_steps: List[str] = []


# DIP table result models
class SpecSuggestion(BaseModel):
    parameter: str
    value: str
    range: Optional[str] = None
    units: Optional[str] = None
    normalized_units: Optional[str] = None
    converted_value: Optional[float] = None
    description: Optional[str] = None
    manufacturer_norm: Optional[str] = None
    model_norm: Optional[str] = None


class PlaybookHint(BaseModel):
    title: str
    steps: List[str]
    expected_outcome: Optional[str] = None
    preconditions: List[str] = []
    error_codes: List[str] = []
    page: Optional[int] = None
    confidence: Optional[float] = None


class IntentRoute(BaseModel):
    question: str
    answer: str
    question_variations: List[str] = []
    question_type: Optional[str] = None
    references: List[str] = []


class GoldenTest(BaseModel):
    query: str
    expected: str
    test_method: Optional[str] = None
    failure_indication: Optional[str] = None
    related_procedures: List[str] = []


# Query classification models
class QueryClassification(BaseModel):
    primary: Literal["spec", "procedure", "troubleshooting", "routing", "general"]
    confidence: float = Field(ge=0.0, le=1.0)
    scores: Dict[str, float]
    target_tables: List[str]
    reasoning: str


# Response scoring models
class ResponseScore(BaseModel):
    total_score: int = Field(ge=0, le=100)
    confidence: Literal["high", "medium", "low", "very_low"]
    breakdown: Dict[str, float]
    confidence_emoji: str
    reasoning: str


# Memory models for LangChain integration
class MemoryContext(BaseModel):
    recent_messages: List[Dict[str, Any]] = []
    conversation_summary: Optional[str] = None
    equipment_entities: Dict[str, Any] = {}
    context_keywords: List[str] = []


# Source attribution models
class Source(BaseModel):
    type: Literal["spec_suggestions", "playbook_hints", "intent_router", "golden_tests", "pinecone", "web"]
    icon: str
    count: int
    confidence: float
    details: List[Dict[str, Any]] = []


# Health check models
class HealthResponse(BaseModel):
    status: str
    timestamp: datetime
    services: Dict[str, str]
    version: str = "1.0.0"