from pydantic import BaseModel, Field
from typing import List, Dict, Any, Optional
from datetime import datetime

class ParseRequest(BaseModel):
    file_url: str = Field(..., description="URL of the PDF file to parse")
    extract_tables: bool = Field(True, description="Whether to extract tables")
    ocr_enabled: bool = Field(True, description="Whether to enable OCR for pages without text")

class BoundingBox(BaseModel):
    x0: float
    y0: float
    x1: float
    y1: float

class TableCell(BaseModel):
    text: str
    bbox: BoundingBox
    row: int
    col: int

class Table(BaseModel):
    table_id: str
    page: int
    bbox: BoundingBox
    cells: List[TableCell]
    rows: int
    cols: int

class PageElement(BaseModel):
    page: int
    element_type: str  # 'text', 'table', 'figure', 'ocr'
    content: str
    bbox: BoundingBox
    has_text_layer: bool
    ocr_used: bool = False
    confidence: Optional[float] = None

class ParseResponse(BaseModel):
    success: bool
    filename: str
    pages_total: int
    pages_parsed: int
    pages_ocr: int
    tables_found: int
    elements: List[PageElement]
    tables: List[Table]
    metadata: Dict[str, Any]
    processing_time: float
    parser_version: str = "1.0.0"

class HealthResponse(BaseModel):
    status: str
    tesseract_available: bool
    version: str
    timestamp: datetime = Field(default_factory=datetime.now)

class VersionResponse(BaseModel):
    version: str
    api_version: str
    parser_version: str
    timestamp: datetime = Field(default_factory=datetime.now)

class EmbeddingRequest(BaseModel):
    text: str
    metadata: Dict[str, Any] = Field(default_factory=dict)

class EmbeddingResponse(BaseModel):
    success: bool
    embedding_id: str
    vector: List[float]
    metadata: Dict[str, Any]
    processing_time: float

class PineconeUpsertRequest(BaseModel):
    vectors: List[Dict[str, Any]]
    namespace: str = "REIMAGINEDDOCS"

class PineconeUpsertResponse(BaseModel):
    success: bool
    upserted_count: int
    namespace: str
    processing_time: float
