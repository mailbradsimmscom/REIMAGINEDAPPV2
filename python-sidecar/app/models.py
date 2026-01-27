from pydantic import BaseModel, Field, validator
from typing import List, Dict, Any, Optional
from datetime import datetime

def _coerce_bbox(v):
    if isinstance(v, BoundingBox):
        return v
    if isinstance(v, (list, tuple)) and len(v) == 4:
        x0, y0, x1, y1 = v
        return {"x0": x0, "y0": y0, "x1": x1, "y1": y1}
    return v

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

    @validator("bbox", pre=True)
    @classmethod
    def _bbox_tuple_ok(cls, v): return _coerce_bbox(v)

class Table(BaseModel):
    table_id: str
    page: int
    bbox: BoundingBox
    cells: List[TableCell]
    rows: int
    cols: int

    @validator("bbox", pre=True)
    @classmethod
    def _bbox_tuple_ok(cls, v): return _coerce_bbox(v)

class PageElement(BaseModel):
    page: int
    element_type: str  # 'text', 'table', 'figure', 'ocr'
    content: str
    bbox: BoundingBox
    has_text_layer: bool
    ocr_used: bool = False
    confidence: Optional[float] = None

    @validator("bbox", pre=True)
    @classmethod
    def _bbox_tuple_ok(cls, v): return _coerce_bbox(v)

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

# DIP (Document Intelligence Packet) Models
class DIPEntity(BaseModel):
    """Individual entity extracted from document"""
    entity_type: str  # 'manufacturer', 'model', 'specification', 'warning', 'procedure', etc.
    value: str
    confidence: float  # 0.0 to 1.0
    page: int
    context: str  # Surrounding text for context
    bbox: Optional[BoundingBox] = None

class DIPSpecHint(BaseModel):
    """Specification hint extracted from document"""
    hint_type: str  # 'pressure', 'temperature', 'voltage', 'flow_rate', etc.
    value: str
    unit: Optional[str] = None
    page: int
    context: str
    confidence: float
    bbox: Optional[BoundingBox] = None

class DIPGoldenTest(BaseModel):
    """Golden test case extracted from document"""
    test_name: str
    test_type: str  # 'procedure', 'checklist', 'measurement', 'validation'
    description: str
    steps: List[str]
    expected_result: str
    page: int
    confidence: float
    bbox: Optional[BoundingBox] = None

class DIPRequest(BaseModel):
    """Request for DIP generation"""
    doc_id: str
    file_path: str
    options: Dict[str, Any] = Field(default_factory=dict)

class DIPGenerateRequest(BaseModel):
    """Request for DIP generation from existing chunks"""
    doc_id: str

class DIPResponse(BaseModel):
    """Response from DIP generation"""
    success: bool
    doc_id: str
    entities: List[DIPEntity]
    spec_hints: List[DIPSpecHint]
    golden_tests: List[DIPGoldenTest]
    processing_time: float
    pages_processed: int
    entities_count: int
    hints_count: int
    tests_count: int
    error: Optional[str] = None

class DIPPacketRequest(BaseModel):
    """Request for running DIP packet processing"""
    doc_id: str
    file_path: str
    output_dir: str
    options: Dict[str, Any] = Field(default_factory=dict)

class DIPPacketResponse(BaseModel):
    """Response from DIP packet processing"""
    success: bool
    doc_id: str
    output_files: Dict[str, str]  # filename -> filepath
    spec_suggestions_file: str
    playbook_hints_file: str
    intent_router_file: str
    golden_tests_file: str
    processing_time: float
    error: Optional[str] = None


# Model Detection Models (v5 Pipeline - Document-First Architecture)
class ReferenceData(BaseModel):
    """Reference table data for LLM to select from"""
    manufacturers: List[str] = Field(default_factory=list, description="Known manufacturer names")
    product_types: List[str] = Field(default_factory=list, description="Known product types")
    system_categories: List[str] = Field(default_factory=list, description="Known system categories")
    subsystem_categories: List[Dict[str, Any]] = Field(default_factory=list, description="Known subsystem categories with parent system")


class ModelDetectionRequest(BaseModel):
    """Request for detecting models covered by a document"""
    markdown: str = Field(..., description="Full parsed markdown content from LlamaParse")
    doc_id: str = Field(..., description="Document UUID")
    filename: str = Field(..., description="Original filename for context")
    reference_data: Optional[ReferenceData] = Field(None, description="Reference table data for categorization")


class ReferencedProduct(BaseModel):
    """A product referenced in the document but not the primary subject"""
    model: str = Field(..., description="Model number/name")
    type: Optional[str] = Field(None, description="Product type (e.g., 'Vessel Control System')")
    manufacturer: Optional[str] = Field(None, description="Manufacturer if different from primary")


class ModelDetectionResponse(BaseModel):
    """Response from model detection - document-first architecture"""
    success: bool
    manufacturer: Optional[str] = Field(None, description="Detected/suggested manufacturer name")
    product_category: Optional[str] = Field(None, description="Product type/category (legacy)")
    product_type: Optional[str] = Field(None, description="Suggested product type from reference table")
    system_category: Optional[str] = Field(None, description="Suggested system category from reference table")
    subsystem_category: Optional[str] = Field(None, description="Suggested subsystem category from reference table")
    primary_models: List[str] = Field(default_factory=list, description="Primary model numbers this manual is FOR")
    referenced_products: List[ReferencedProduct] = Field(default_factory=list, description="Other products mentioned but not primary subject")
    is_multi_model: bool = Field(default=False, description="True if manual covers multiple models")
    confidence: str = Field(default="low", description="Confidence level: high, medium, low")
    evidence: str = Field(default="", description="Brief explanation of how models were detected")
    processing_time: float
    error: Optional[str] = None

    # Legacy field for backwards compatibility
    @property
    def models_detected(self) -> List[str]:
        return self.primary_models


class LlamaParseResponse(BaseModel):
    """Response from LlamaParse document parsing"""
    success: bool
    text: str = Field(default="", description="Full parsed text/markdown content")
    content_length: int = Field(default=0, description="Length of parsed content in characters")
    sections_count: int = Field(default=0, description="Number of sections extracted")
    llamaparse_path: Optional[str] = Field(default=None, description="Storage path to llamaparse_raw.json if stored")
    processing_time: float
    error: Optional[str] = None


# ============================================================================
# Vision Analysis Models (Stage 6-7)
# ============================================================================

class VisionAnalysisPath(BaseModel):
    """Result for a single page analysis"""
    page_number: int
    analysis_path: str = Field(..., description="Storage path to page analysis JSON")
    figures_found: int = Field(default=0)
    tables_found: int = Field(default=0)


class VisionAnalyzeRequest(BaseModel):
    """Request for Vision Stage 6: analyze pages"""
    doc_id: str = Field(..., description="Document ID")
    storage_path: str = Field(..., description="Supabase Storage path to PDF")
    models_covered: List[str] = Field(default_factory=list, description="All models covered by document (informational)")
    selected_models: List[str] = Field(..., description="User-approved primary models (tag universe)")
    referenced_selections: List[str] = Field(default_factory=list, description="User's selected referenced systems (e.g., VC20, SD605)")
    pages: str = Field(default="1-10", description="Page range to analyze (e.g., '1-10' or '1,5,10')")
    context: str = Field(default="", description="Document context for Vision prompt")


class VisionAnalyzeResponse(BaseModel):
    """Response from Vision Stage 6: analyze pages"""
    success: bool
    pages_analyzed: int = Field(default=0)
    pages_skipped: int = Field(default=0, description="Pages skipped (not relevant to user's model selection)")
    analysis_paths: List[VisionAnalysisPath] = Field(default_factory=list)
    warnings: List[Dict[str, Any]] = Field(default_factory=list)
    processing_time: float = Field(default=0.0)
    error: Optional[str] = None


class VisionCropRequest(BaseModel):
    """Request for Vision Stage 7: crop figures"""
    doc_id: str = Field(..., description="Document ID")
    storage_path: str = Field(..., description="Supabase Storage path to PDF")
    analysis_paths: List[VisionAnalysisPath] = Field(..., description="Analysis results from Stage 6")


class VisionAsset(BaseModel):
    """A cropped asset (figure or table) with metadata"""
    doc_id: str
    page_number: int
    asset_kind: str = Field(..., description="'figure' or 'table'")
    asset_index: int = Field(..., description="0-based index within (doc_id, page_number, asset_kind)")
    asset_type: Optional[str] = Field(None, description="Subtype: wiring_diagram, specifications, etc.")
    title: Optional[str] = None
    description: Optional[str] = None
    bbox: Dict[str, float] = Field(..., description="Percentage bbox {x, y, width, height}")
    storage_path: str = Field(..., description="Storage path to cropped image")
    analysis_path: str = Field(..., description="Storage path to page analysis JSON")
    applies_to_models: List[str] = Field(..., description="Canonical primary models")
    referenced_systems: List[str] = Field(default_factory=list, description="Canonical referenced systems")
    is_universal: bool = Field(default=False, description="True if applies to all selected_models")
    confidence: str = Field(default="low", description="Model attribution confidence: high, medium, low")
    attribution_warnings: List[str] = Field(default_factory=list, description="Warning codes: MODEL_ATTRIBUTION_DEFAULTED, etc.")
    asset_json: Dict[str, Any] = Field(..., description="Full element payload after canonicalization")


class VisionCropResponse(BaseModel):
    """Response from Vision Stage 7: crop figures"""
    success: bool
    assets: List[VisionAsset] = Field(default_factory=list)
    figures_cropped: int = Field(default=0)
    tables_cropped: int = Field(default=0)
    manifest_path: Optional[str] = Field(None, description="Storage path to manifest.json")
    warnings: List[Dict[str, Any]] = Field(default_factory=list)
    processing_time: float = Field(default=0.0)
    error: Optional[str] = None
