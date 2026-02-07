from fastapi import FastAPI, HTTPException, UploadFile, File, Form, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
import json
import logging
from typing import Optional, Dict, Any, List
import os
from pathlib import Path
from dotenv import load_dotenv
import hashlib
import requests
from supabase import create_client, Client

# Load environment variables - try multiple paths for compatibility
# Try to load .env from multiple possible locations
env_paths = [
    '.env',  # Current directory
    '../.env',  # Parent directory
    '../../.env',  # Two levels up (original path)
]

for env_path in env_paths:
    if os.path.exists(env_path):
        load_dotenv(env_path)
        break

from .parser import PDFParser
from .models import (
    ParseRequest, ParseResponse, HealthResponse, VersionResponse,
    EmbeddingRequest, EmbeddingResponse, PineconeUpsertRequest, PineconeUpsertResponse,
    DIPRequest, DIPResponse, DIPPacketRequest, DIPPacketResponse, DIPGenerateRequest,
    ModelDetectionRequest, ModelDetectionResponse, ReferencedProduct, LlamaParseResponse,
    VisionAnalyzeRequest, VisionAnalyzeResponse, VisionAnalysisPath,
    VisionCropRequest, VisionCropResponse, VisionAsset,
    DIPRunRequest, DIPRunResponse, DIPModeResult,
    IndexDocumentRequest, IndexDocumentResponse
)
import asyncio
import anthropic
import time
import random
from .pinecone_client import pinecone_client
from .dip_processor import DIPProcessor
from .utils.normalize import normalize_model_key
import re

# ============================================================================
# CANONICAL MODEL NORMALIZATION
# ============================================================================


async def canonicalize_model(raw: str, manufacturer_id: Optional[str] = None) -> str:
    """
    Resolve a raw model string to its canonical form.

    1. Normalize the raw string
    2. Look up in ref_canonical_models by canonical_norm
    3. If not found, look up in ref_model_synonyms by synonym_norm
    4. If still not found, create new canonical entry
    5. If raw differs from canonical, add synonym

    Returns the canonical_model string.
    """
    if not raw or not supabase:
        return raw or ""

    norm = normalize_model_key(raw)
    if not norm:
        return raw

    try:
        # Step 1: Check if canonical already exists with this norm
        result = supabase.table('ref_canonical_models').select('canonical_model').eq('canonical_norm', norm).execute()

        if result.data and len(result.data) > 0:
            return result.data[0]['canonical_model']

        # Step 2: Check synonyms table
        result = supabase.table('ref_model_synonyms').select('canonical_model').eq('synonym_norm', norm).execute()

        if result.data and len(result.data) > 0:
            return result.data[0]['canonical_model']

        # Step 3: Not found - create new canonical (canonical_model = norm for normalized storage)
        canonical_model = norm

        insert_data = {
            'canonical_model': canonical_model,
            'canonical_norm': norm,
            'manufacturer_id': manufacturer_id
        }

        supabase.table('ref_canonical_models').insert(insert_data).execute()
        logger.info(f"Created new canonical model: {canonical_model}")

        # Step 4: If raw differs from canonical, add as synonym
        if raw != canonical_model:
            synonym_data = {
                'synonym': raw,
                'synonym_norm': norm,
                'canonical_model': canonical_model
            }
            try:
                supabase.table('ref_model_synonyms').insert(synonym_data).execute()
                logger.info(f"Added synonym '{raw}' -> '{canonical_model}'")
            except Exception as syn_error:
                # Synonym might already exist, that's ok
                logger.debug(f"Could not add synonym (may already exist): {syn_error}")

        return canonical_model

    except Exception as e:
        logger.error(f"Error canonicalizing model '{raw}': {e}")
        # Fall back to normalized form if DB fails
        return norm


async def canonicalize_models_list(models: list, manufacturer_id: Optional[str] = None) -> list:
    """Canonicalize a list of model strings."""
    if not models:
        return []

    canonicalized = []
    for model in models:
        canonical = await canonicalize_model(model, manufacturer_id)
        if canonical and canonical not in canonicalized:
            canonicalized.append(canonical)

    return canonicalized


# Configure logging with file rotation and structured output
from .logging_config import setup_logging, get_log_level_from_env, is_development

# Setup logging infrastructure
setup_logging(
    service_name="python-sidecar",
    level=get_log_level_from_env(),
    enable_console=True,  # Always enable console for debugging
    enable_files=True  # Enable file logging
)
logger = logging.getLogger(__name__)

# Create FastAPI app
app = FastAPI(
    title="PDF Parser Sidecar",
    description="PDF parsing and OCR service for document processing pipeline",
    version="1.0.0"
)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize parser and DIP processor
parser = PDFParser()
dip_processor = DIPProcessor()

# Feature flag for semantic chunking
USE_SEMANTIC_CHUNKING = os.getenv('USE_SEMANTIC_CHUNKING', 'false').lower() == 'true'
logger.info(f"Semantic chunking {'ENABLED' if USE_SEMANTIC_CHUNKING else 'DISABLED'}")

# Initialize semantic chunking processor (lazy import to avoid errors if dependencies missing)
semantic_processor = None
if USE_SEMANTIC_CHUNKING:
    try:
        from .chunking import get_processor
        semantic_processor = get_processor(
            pinecone_client=pinecone_client
        )
        logger.info("Semantic chunking processor initialized")
    except Exception as e:
        logger.error(f"Failed to initialize semantic chunking: {e}")
        USE_SEMANTIC_CHUNKING = False

# Initialize Supabase client
supabase_url = os.getenv('SUPABASE_URL')
supabase_key = os.getenv('PY_SUPABASE_SERVICE_KEY') or os.getenv('SUPABASE_SERVICE_KEY') or os.getenv('SUPABASE_SERVICE_ROLE_KEY')
supabase: Optional[Client] = None

if supabase_url and supabase_key:
    try:
        supabase = create_client(supabase_url, supabase_key)
        logger.info("Supabase client initialized successfully")
    except Exception as e:
        logger.warning(f"Failed to initialize Supabase client: {e}")
        supabase = None
else:
    logger.warning("Supabase credentials not found in environment variables")

@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Health check endpoint"""
    try:
        # Check if Tesseract is available
        import pytesseract
        pytesseract.get_tesseract_version()
        tesseract_available = True
    except Exception as e:
        logger.warning(f"Tesseract not available: {e}")
        tesseract_available = False
    
    return HealthResponse(
        status="healthy",
        tesseract_available=tesseract_available,
        version="1.0.0"
    )

@app.get("/version", response_model=VersionResponse)
async def get_version():
    """Get service version"""
    return VersionResponse(
        version="1.0.0",
        api_version="v1",
        parser_version="1.0.0"
    )

@app.get("/v1/pinecone/stats")
async def get_pinecone_stats():
    """Get Pinecone index statistics"""
    try:
        logger.debug("Getting Pinecone index statistics")
        
        # Get stats from Pinecone client
        stats = pinecone_client.get_index_stats()
        
        if not stats["success"]:
            raise HTTPException(status_code=500, detail=stats["error"])

        logger.debug(f"Retrieved Pinecone stats: {stats['total_vector_count']} total vectors")
        return JSONResponse(content=stats)
        
    except Exception as e:
        logger.error(f"Failed to get Pinecone stats: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/v1/pinecone/search")
async def search_pinecone(request: dict):
    """Search Pinecone vectors"""
    try:
        logger.debug("Searching Pinecone vectors")
        
        # Parse request body properly
        query = request.get("query", "")
        top_k = request.get("topK", 10)
        namespace = request.get("namespace", "REIMAGINEDDOCS")
        filter_dict = request.get("filter", {})
        include_metadata = request.get("includeMetadata", True)
        include_values = request.get("includeValues", False)

        logger.debug(f"Search params: query='{query}', top_k={top_k}, namespace='{namespace}'")
        
        if not query:
            raise HTTPException(status_code=400, detail="Query is required")
        
        # Search vectors
        search_results = pinecone_client.search_vectors(
            query=query,
            top_k=top_k,
            namespace=namespace,
            filter_dict=filter_dict,
            include_metadata=include_metadata,
            include_values=include_values
        )
        
        if not search_results["success"]:
            raise HTTPException(status_code=500, detail=search_results["error"])

        logger.debug(f"Search completed: {len(search_results['matches'])} results")
        return JSONResponse(content=search_results)

    except Exception as e:
        logger.error(f"Failed to search Pinecone: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/v1/pinecone/delete")
async def delete_pinecone_vectors(request: dict):
    """Delete vectors from Pinecone by IDs"""
    try:
        logger.debug("Deleting Pinecone vectors")

        # Parse request body
        ids = request.get("ids", [])
        namespace = request.get("namespace", "REIMAGINEDDOCS")

        if not ids or not isinstance(ids, list) or len(ids) == 0:
            raise HTTPException(status_code=400, detail="ids array is required")

        logger.debug(f"Delete params: {len(ids)} vectors, namespace='{namespace}'")

        # Delete vectors
        delete_results = pinecone_client.delete_vectors(
            ids=ids,
            namespace=namespace
        )

        if not delete_results["success"]:
            raise HTTPException(status_code=500, detail=delete_results["error"])

        logger.info(f"Deleted {delete_results['deleted_count']} vectors from namespace '{namespace}'")
        return JSONResponse(content=delete_results)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete vectors: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/v1/parse", response_model=ParseResponse)
async def parse_pdf(
    file: UploadFile = File(...),
    extract_tables: bool = Form(True),
    ocr_enabled: bool = Form(True)
):
    """Parse PDF and extract text, tables, and metadata"""
    try:
        logger.debug(f"Parsing PDF: {file.filename}")
        
        # Read file content
        content = await file.read()
        
        # Parse the PDF
        result = await parser.parse_pdf(
            content,
            extract_tables=extract_tables,
            ocr_enabled=ocr_enabled
        )

        logger.debug(f"PDF parsed successfully: {file.filename}")
        return result
        
    except Exception as e:
        logger.error(f"Failed to parse PDF: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/v1/parse-url")
async def parse_pdf_from_url(
    request: ParseRequest
):
    """Parse PDF from URL"""
    try:
        logger.debug(f"Parsing PDF from URL: {request.file_url}")
        
        # Parse the PDF from URL
        result = await parser.parse_pdf_from_url(
            request.file_url,
            extract_tables=request.extract_tables,
            ocr_enabled=request.ocr_enabled
        )

        logger.debug(f"PDF parsed successfully from URL")
        return result

    except Exception as e:
        logger.error(f"Failed to parse PDF from URL: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/v1/llamaparse", response_model=LlamaParseResponse)
async def parse_with_llamaparse(
    file: UploadFile = File(...),
    doc_id: Optional[str] = Query(None)
):
    """
    Parse PDF using LlamaParse and return markdown content.
    Document-first architecture: parse first, then detect models.

    If doc_id is provided, stores the full LlamaParse JSON (with layout data)
    to Supabase Storage at manuals/{doc_id}/llamaparse_raw.json for later use
    in figure extraction and model detection.
    """
    import time
    import tempfile
    from pathlib import Path

    start_time = time.time()

    try:
        logger.info(f"LlamaParse processing: {file.filename}" + (f" (doc_id: {doc_id})" if doc_id else ""))

        # Initialize parser
        from .chunking.parser import DocumentParser
        doc_parser = DocumentParser()

        # Save uploaded file to temp location
        with tempfile.NamedTemporaryFile(delete=False, suffix=Path(file.filename).suffix) as tmp_file:
            content = await file.read()
            tmp_file.write(content)
            tmp_path = tmp_file.name

        try:
            # Parse document with layout data (includes bboxes for figures)
            result = await doc_parser.parse_document_with_layout(tmp_path, file.filename)

            if not result.get("success"):
                return LlamaParseResponse(
                    success=False,
                    processing_time=time.time() - start_time,
                    error=result.get("error", "Unknown parsing error")
                )

            # Get the markdown content
            markdown_content = result.get("markdown", "")
            raw_json = result.get("raw_json", {})
            pages_count = result.get("pages_count", 0)

            # Store raw JSON to Supabase Storage if doc_id provided
            json_stored = False
            if doc_id and supabase and raw_json:
                try:
                    storage_path = f"manuals/{doc_id}/llamaparse_raw.json"
                    json_content = json.dumps(raw_json, indent=2, ensure_ascii=False)

                    upload_result = supabase.storage.from_('documents').upload(
                        storage_path,
                        json_content.encode('utf-8'),
                        file_options={"content-type": "text/plain", "upsert": "true"}
                    )

                    json_stored = True
                    logger.info(f"Stored LlamaParse JSON to {storage_path} ({len(json_content)} bytes)")
                except Exception as storage_err:
                    logger.warning(f"Failed to store LlamaParse JSON: {storage_err}")

            # Build llamaparse_path for response
            llamaparse_path = f"manuals/{doc_id}/llamaparse_raw.json" if json_stored else None

            logger.info(f"LlamaParse complete: {len(markdown_content)} chars, "
                       f"{pages_count} pages, json_stored={json_stored}")

            return LlamaParseResponse(
                success=True,
                text=markdown_content,
                content_length=len(markdown_content),
                sections_count=pages_count,  # Using pages_count since we now use layout extraction
                llamaparse_path=llamaparse_path,
                processing_time=time.time() - start_time
            )

        finally:
            # Clean up temp file
            import os
            try:
                os.unlink(tmp_path)
            except Exception:
                pass

    except Exception as e:
        logger.error(f"LlamaParse failed: {e}")
        return LlamaParseResponse(
            success=False,
            processing_time=time.time() - start_time,
            error=str(e)
        )


@app.post("/v1/detect-models", response_model=ModelDetectionResponse)
async def detect_models(request: ModelDetectionRequest):
    """
    Detect models covered by a document using LLM analysis.
    Document-first architecture: analyze full markdown to identify primary models
    and referenced products before user selects which they have.
    """
    import time
    from openai import OpenAI

    start_time = time.time()

    try:
        logger.info(f"Detecting models for doc_id={request.doc_id}, filename={request.filename}")
        logger.debug(f"Markdown length: {len(request.markdown)} chars")

        # Initialize OpenAI client
        openai_client = OpenAI(api_key=os.getenv('OPENAI_API_KEY'))

        # Use gpt-4.1-mini for cost efficiency (~$0.015 per full manual)
        model = os.getenv('MODEL_DETECTION_MODEL', 'gpt-4.1-mini')

        # Build reference data section if provided
        ref_section = ""
        if request.reference_data:
            ref = request.reference_data
            ref_section = f"""
KNOWN VALUES (select from these when possible, or suggest new if no match):

MANUFACTURERS: {', '.join(ref.manufacturers) if ref.manufacturers else 'None provided'}

PRODUCT TYPES: {', '.join(ref.product_types) if ref.product_types else 'None provided'}

SYSTEM CATEGORIES: {', '.join(ref.system_categories) if ref.system_categories else 'None provided'}

SUBSYSTEM CATEGORIES (grouped by system):
{chr(10).join([f"  - {s['name']} (under {s['system_name']})" for s in ref.subsystem_categories]) if ref.subsystem_categories else 'None provided'}
"""

        system_prompt = f"""You are an expert at analyzing technical manuals to identify what products they cover.

Analyze the provided technical manual and identify:

1. MANUFACTURER: Who makes the primary products in this manual?
   - Select from known manufacturers if there's a match
   - If not in the list, provide the actual manufacturer name

2. PRODUCT TYPE: What type of product is this?
   - Select from known product types if there's a match (e.g., "Engine", "Chartplotter", "Autopilot Computer")
   - If not in list, suggest an appropriate type

3. SYSTEM CATEGORY: What system category does this equipment belong to?
   - Select from known system categories (e.g., "Propulsion", "Navigation", "Electrical (DC)")

4. SUBSYSTEM CATEGORY: What subsystem category does this equipment belong to?
   - Select from known subsystem categories that match the system category
   - e.g., "Engines" under "Propulsion", "Autopilot" under "Navigation"

5. PRIMARY MODELS: What specific model(s) is this manual FOR? These are the main subjects.
   - List exact model numbers (e.g., "4JH57", "Zeus 3S", "VC20")
   - If multiple models are covered, list all of them
   - Do NOT include generic references or part numbers

6. REFERENCED PRODUCTS: What other products are MENTIONED but not the main subject?
   - Compatible accessories, related systems, integration partners
   - Products in compatibility sections, wiring diagrams, etc.
{ref_section}
Return ONLY valid JSON in this exact format:
{{
  "manufacturer": "B&G",
  "product_type": "Chartplotter",
  "system_category": "Navigation",
  "subsystem_category": "Chartplotters & MFDs",
  "primary_models": ["Zeus 3S 16"],
  "is_multi_model": false,
  "referenced_products": [
    {{"model": "4JH57", "type": "Engine", "manufacturer": "Yanmar"}},
    {{"model": "ZEN15048VDC", "type": "Watermaker", "manufacturer": "Schenker"}}
  ],
  "confidence": "high",
  "evidence": "Found model name on title page and specifications section"
}}

IMPORTANT:
- Return ONLY the JSON, no explanations before or after
- Use "high", "medium", or "low" for confidence
- If no models found, return empty arrays
- Select from KNOWN VALUES when there's a match
- Distinguish between PRIMARY models (what manual is FOR) and REFERENCED products (what it mentions)"""

        user_prompt = f"""Analyze this technical manual and identify the models it covers.

Filename: {request.filename}

Document content:
{request.markdown[:100000]}"""  # Limit to ~100K chars for context window

        logger.debug(f"Making OpenAI API call with model={model}")

        response = openai_client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            temperature=0,
            max_tokens=2000,
            response_format={"type": "json_object"}
        )

        response_text = response.content[0].text if hasattr(response, 'content') else response.choices[0].message.content
        logger.debug(f"OpenAI response: {response_text[:500]}...")

        # Parse JSON response
        result = json.loads(response_text)

        processing_time = time.time() - start_time

        # ====================================================================
        # CANONICALIZE MODELS - ensure consistent naming across the system
        # ====================================================================

        # Canonicalize primary_models
        raw_primary = result.get("primary_models", [])
        canonical_primary = await canonicalize_models_list(raw_primary)
        logger.debug(f"Canonicalized primary models: {raw_primary} -> {canonical_primary}")

        # Canonicalize referenced_products
        referenced_products = []
        for rp in result.get("referenced_products", []):
            raw_model = rp.get("model", "")
            canonical_model = await canonicalize_model(raw_model) if raw_model else ""
            referenced_products.append(ReferencedProduct(
                model=canonical_model,
                type=rp.get("type"),
                manufacturer=rp.get("manufacturer")
            ))
            if raw_model != canonical_model:
                logger.debug(f"Canonicalized referenced: '{raw_model}' -> '{canonical_model}'")

        logger.info(f"Model detection complete: {len(canonical_primary)} primary, "
                   f"{len(referenced_products)} referenced, confidence={result.get('confidence', 'unknown')}")
        logger.info(f"Categories: product_type={result.get('product_type')}, "
                   f"system={result.get('system_category')}, subsystem={result.get('subsystem_category')}")

        return ModelDetectionResponse(
            success=True,
            manufacturer=result.get("manufacturer"),
            product_category=result.get("product_category"),  # Legacy
            product_type=result.get("product_type"),
            system_category=result.get("system_category"),
            subsystem_category=result.get("subsystem_category"),
            primary_models=canonical_primary,  # Use canonicalized models
            referenced_products=referenced_products,  # Already canonicalized above
            is_multi_model=result.get("is_multi_model", len(canonical_primary) > 1),
            confidence=result.get("confidence", "low"),
            evidence=result.get("evidence", ""),
            processing_time=processing_time
        )

    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse model detection response: {e}")
        return ModelDetectionResponse(
            success=False,
            processing_time=time.time() - start_time,
            error=f"Failed to parse LLM response: {str(e)}"
        )
    except Exception as e:
        logger.error(f"Model detection failed: {e}")
        return ModelDetectionResponse(
            success=False,
            processing_time=time.time() - start_time,
            error=str(e)
        )


@app.post("/v1/embed", response_model=EmbeddingResponse)
async def generate_embedding(request: EmbeddingRequest):
    """Generate embedding for text"""
    try:
        logger.debug("Generating embedding for text")
        
        result = pinecone_client.generate_embedding(
            text=request.text,
            metadata=request.metadata
        )
        
        if result["success"]:
            return EmbeddingResponse(
                success=True,
                embedding_id=result["embedding_id"],
                vector=result["vector"],
                metadata=result["metadata"],
                processing_time=result["processing_time"]
            )
        else:
            raise HTTPException(status_code=500, detail=result["error"])
            
    except Exception as e:
        logger.error(f"Failed to generate embedding: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/v1/upsert", response_model=PineconeUpsertResponse)
async def upsert_vectors(request: PineconeUpsertRequest):
    """Upsert vectors to Pinecone"""
    try:
        logger.debug(f"Upserting {len(request.vectors)} vectors to Pinecone")
        
        result = pinecone_client.upsert_vectors(request.vectors)
        
        if result["success"]:
            return PineconeUpsertResponse(
                success=True,
                upserted_count=result["upserted_count"],
                namespace=result["namespace"],
                processing_time=result["processing_time"]
            )
        else:
            raise HTTPException(status_code=500, detail=result["error"])
            
    except Exception as e:
        logger.error(f"Failed to upsert vectors: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/v1/process-document")
async def process_document_for_pinecone(
    file: UploadFile = File(...),
    doc_metadata: str = Form("{}"),
    extract_tables: bool = Form(True),
    ocr_enabled: bool = Form(True)
):
    """Parse PDF and store chunks in Pinecone"""
    try:
        logger.info(f"Processing document for Pinecone: {file.filename} (semantic_chunking={USE_SEMANTIC_CHUNKING})")

        # Parse metadata
        metadata = json.loads(doc_metadata)
        logger.info(f"Received metadata: {json.dumps(metadata, indent=2)}")

        # FEATURE FLAG: Use new semantic chunking or old page-based chunking
        if USE_SEMANTIC_CHUNKING and semantic_processor:
            # NEW SEMANTIC CHUNKING PATH
            logger.info(f"Using SEMANTIC chunking for {file.filename}")

            # Save uploaded file to temp location
            import tempfile
            with tempfile.NamedTemporaryFile(delete=False, suffix=Path(file.filename).suffix) as tmp_file:
                content = await file.read()
                tmp_file.write(content)
                tmp_path = tmp_file.name

            try:
                # Process with semantic chunker
                result = await semantic_processor.process_document(
                    file_path=tmp_path,
                    filename=file.filename,
                    metadata=metadata
                )

                # Clean up temp file
                os.unlink(tmp_path)

                if not result['success']:
                    raise HTTPException(status_code=500, detail=result.get('error', 'Semantic chunking failed'))

                # Return semantic chunking result
                return {
                    "success": True,
                    "filename": file.filename,
                    "chunks_processed": result['total_chunks'],
                    "vectors_upserted": result.get('pinecone_result', {}).get('upserted_count', result['total_chunks']),
                    "chunks_written_db": result.get('supabase_result', {}).get('stored_count', 0),
                    "chunks_written_storage": 0,  # Not using storage bucket for semantic chunks
                    "namespace": "REIMAGINEDDOCS",
                    "processing_time": 0,
                    "chunking_strategy": "semantic_v2",
                    "statistics": result.get('statistics', {}),
                    "document_id": result['document_id']
                }

            except Exception as e:
                # Clean up temp file on error
                if os.path.exists(tmp_path):
                    os.unlink(tmp_path)
                raise

        else:
            # OLD PAGE-BASED CHUNKING PATH (existing code)
            logger.info(f"Using LEGACY page-based chunking for {file.filename}")

            # Read file content
            content = await file.read()

            # Parse the PDF
            parse_result = await parser.parse_pdf(
                content,
                extract_tables=extract_tables,
                ocr_enabled=ocr_enabled
            )

            if not parse_result.success:
                raise HTTPException(status_code=500, detail="Failed to parse PDF")

            # Prepare chunks for Pinecone
            chunks = []
            for element in parse_result.elements:
                chunks.append({
                    "id": f"{file.filename}_{element.page}_{len(chunks)}",
                    "content": element.content,
                    "type": element.element_type,
                    "page": element.page
                })

            # Process chunks and store in Pinecone
            pinecone_result = pinecone_client.process_document_chunks(chunks, metadata)

            # Extract doc_id from metadata for chunk persistence
            doc_id = metadata.get('doc_id', file.filename.replace('.pdf', ''))

            # Persist chunks to Supabase DB and Storage
            chunks_written_db = 0
            chunks_written_storage = 0

            if supabase_url and supabase_key and pinecone_result["success"]:
                try:
                    # Clean URL and setup headers
                    url = supabase_url.rstrip("/")
                    headers = {
                        "apikey": supabase_key,
                        "Authorization": f"Bearer {supabase_key}"
                    }

                    # Prepare chunks for database insertion
                    db_chunks = []
                    for i, chunk in enumerate(chunks):
                        chunk_id = f"{doc_id}-chunk-{chunk['page']}"
                        chunk_text = chunk['content']
                        checksum = hashlib.sha256(chunk_text.encode('utf-8')).hexdigest()

                        db_chunk = {
                            "chunk_id": chunk_id,
                            "doc_id": doc_id,
                            "content_type": "text",
                            "page_start": chunk['page'],
                            "page_end": chunk['page'],
                            "chunk_index": i,
                            "text": chunk_text,
                            "checksum": checksum,
                            "metadata": {}
                        }
                        db_chunks.append(db_chunk)

                    # Insert chunks into database using requests
                    if db_chunks:
                        upsert_headers = {
                            **headers,
                            "Content-Type": "application/json",
                            "Prefer": "resolution=merge-duplicates"
                        }

                        response = requests.post(
                            f"{url}/rest/v1/document_chunks",
                            headers=upsert_headers,
                            json=db_chunks
                        )

                        if response.status_code in [200, 201]:
                            chunks_written_db = len(db_chunks)
                            logger.debug(f"Inserted {chunks_written_db} chunks into database")
                        else:
                            logger.warning(f"Failed to insert chunks: {response.status_code} {response.text}")

                    # Upload chunk text files to storage using requests
                    for chunk in chunks:
                        try:
                            storage_path = f"documents/manuals/{doc_id}/text/page-{chunk['page']}.txt"
                            content = chunk['content'].encode('utf-8')

                            storage_headers = {
                                **headers,
                                "Content-Type": "text/plain",
                                "x-upsert": "true"
                            }

                            storage_response = requests.post(
                                f"{url}/storage/v1/object/{storage_path}",
                                headers=storage_headers,
                                data=content
                            )

                            if storage_response.status_code in [200, 201]:
                                chunks_written_storage += 1
                            else:
                                logger.warning(f"Failed to upload chunk to storage: {storage_response.status_code}")

                        except Exception as e:
                            logger.warning(f"Failed to upload chunk to storage: {e}")
                            continue

                    logger.debug(f"Uploaded {chunks_written_storage} chunk files to storage")

                except Exception as e:
                    logger.error(f"Failed to persist chunks to Supabase: {e}")
                    # Continue execution - don't fail the entire process

            return {
                "success": pinecone_result["success"],
                "filename": file.filename,
                "chunks_processed": pinecone_result["chunks_processed"],
                "vectors_upserted": pinecone_result["vectors_upserted"],
                "chunks_written_db": chunks_written_db,
                "chunks_written_storage": chunks_written_storage,
                "namespace": pinecone_result["namespace"],
                "processing_time": pinecone_result["processing_time"],
                "error": pinecone_result.get("error"),
                "chunking_strategy": "legacy_page_based"
            }
        
    except Exception as e:
        logger.error(f"Failed to process document for Pinecone: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# COMMENTED OUT - OLD 2-FILE DIP ENDPOINT
# @app.post("/v1/dip")
# async def generate_dip(request: DIPGenerateRequest):
#     """
#     Generate Document Intelligence Packet from existing document chunks
#     """
#     try:
#         doc_id = request.doc_id
#         if not doc_id:
#             raise HTTPException(status_code=400, detail="doc_id is required")
#         
#         logger.info(f"Generating DIP for doc_id: {doc_id}")
#         
#         # Get Supabase credentials
#         supabase_url = os.getenv('SUPABASE_URL')
#         supabase_key = os.getenv('SUPABASE_SERVICE_KEY') or os.getenv('SUPABASE_SERVICE_ROLE_KEY')
#         
#         if not supabase_url or not supabase_key:
#             raise HTTPException(status_code=500, detail="Supabase configuration missing")
#         
#         # Read chunks from document_chunks table
#         url = supabase_url.rstrip("/")
#         headers = {
#             "apikey": supabase_key,
#             "Authorization": f"Bearer {supabase_key}"
#         }
#         
#         # Query document_chunks table
#         response = requests.get(
#             f"{url}/rest/v1/document_chunks",
#             headers=headers,
#             params={
#                 "doc_id": f"eq.{doc_id}",
#                 "content_type": "eq.text",
#                 "text": "not.is.null",
#                 "select": "chunk_id,doc_id,text,page_start,page_end,chunk_index,metadata",
#                 "order": "page_start,chunk_index"
#             }
#         )
#         
#         if response.status_code != 200:
#             logger.error(f"Failed to fetch chunks: {response.status_code} {response.text}")
#             raise HTTPException(status_code=500, detail="Failed to fetch document chunks")
#         
#         chunks_data = response.json()
#         
#         if not chunks_data:
#             # Try fallback: read from storage
#             logger.info(f"No chunks found in database, trying storage fallback for doc_id: {doc_id}")
#             chunks_data = await _read_chunks_from_storage(url, headers, doc_id)
#         
#         if not chunks_data:
#             raise HTTPException(status_code=404, detail="No document chunks found")
#         
#         # Convert to format expected by DIP processor
#         chunks = []
#         for chunk_data in chunks_data:
#             chunks.append({
#                 "id": chunk_data["chunk_id"],
#                 "content": chunk_data["text"],
#                 "page": chunk_data.get("page_start", 1),
#                 "metadata": chunk_data.get("metadata", {})
#             })
#         
#         # Generate DIP using existing processor
#         dip_result = await dip_processor.process_chunks(doc_id, chunks)
#         
#         # Write DIP and suggestions to storage
#         artifacts = await _write_dip_artifacts(url, headers, doc_id, dip_result)
#         
#         return {
#             "success": True,
#             "doc_id": doc_id,
#             "pages": len(set(chunk["page"] for chunk in chunks)),
#             "entities_count": dip_result.get("entities_count", 0),
#             "hints_count": dip_result.get("hints_count", 0),
#             "tests_count": dip_result.get("tests_count", 0),
#             "artifacts": artifacts
#         }
#         
#     except HTTPException:
#         raise
#     except Exception as e:
#         logger.error(f"DIP generation failed: {e}")
#         raise HTTPException(status_code=500, detail=str(e))

async def _read_chunks_from_storage(url, headers, doc_id):
    """Fallback: read chunks from storage files"""
    try:
        # List files in storage path
        storage_path = f"documents/manuals/{doc_id}/text/"
        response = requests.get(
            f"{url}/storage/v1/object/list/documents",
            headers=headers,
            params={"prefix": storage_path}
        )
        
        if response.status_code != 200:
            return []
        
        files = response.json()
        chunks = []
        
        for file_info in files:
            if file_info["name"].endswith(".txt"):
                # Read file content
                file_response = requests.get(
                    f"{url}/storage/v1/object/documents/{file_info['name']}",
                    headers=headers
                )
                
                if file_response.status_code == 200:
                    # Extract page number from filename
                    import re
                    filename = file_info["name"].split("/")[-1]
                    page_match = re.match(r"page-(\d+)\.txt", filename)
                    page_num = int(page_match.group(1)) if page_match else 1
                    
                    chunks.append({
                        "chunk_id": f"{doc_id}-chunk-{page_num}",
                        "doc_id": doc_id,
                        "text": file_response.text,
                        "page_start": page_num,
                        "page_end": page_num,
                        "chunk_index": page_num - 1,
                        "metadata": {}
                    })
        
        return chunks
        
    except Exception as e:
        logger.error(f"Failed to read chunks from storage: {e}")
        return []

async def _write_dip_artifacts(url, headers, doc_id, dip_result):
    """Write DIP and suggestions files to storage"""
    try:
        artifacts = {}
        
        # Write DIP file
        dip_path = f"documents/manuals/{doc_id}/dip.json"
        dip_data = dip_result.get("dip", {})
        # Convert Pydantic models to dicts for JSON serialization
        if "entities" in dip_data:
            dip_data["entities"] = [entity.dict() if hasattr(entity, 'dict') else entity for entity in dip_data["entities"]]
        if "spec_hints" in dip_data:
            dip_data["spec_hints"] = [hint.dict() if hasattr(hint, 'dict') else hint for hint in dip_data["spec_hints"]]
        if "golden_tests" in dip_data:
            dip_data["golden_tests"] = [test.dict() if hasattr(test, 'dict') else test for test in dip_data["golden_tests"]]
        
        dip_response = requests.post(
            f"{url}/storage/v1/object/{dip_path}",
            headers={
                **headers,
                "Content-Type": "text/plain",
                "x-upsert": "true"
            },
            data=json.dumps(dip_data, indent=2)
        )

        logger.debug(f"DIP storage response: {dip_response.status_code} - {dip_response.text}")
        if dip_response.status_code in [200, 201]:
            artifacts["dip"] = dip_path
        else:
            logger.error(f"Failed to store DIP: {dip_response.status_code} {dip_response.text}")
        
        # Write suggestions file
        suggestions_path = f"documents/manuals/{doc_id}/suggestions.json"
        suggestions_data = dip_result.get("suggestions", {})
        suggestions_response = requests.post(
            f"{url}/storage/v1/object/{suggestions_path}",
            headers={
                **headers,
                "Content-Type": "text/plain",
                "x-upsert": "true"
            },
            data=json.dumps(suggestions_data, indent=2)
        )

        logger.debug(f"Suggestions storage response: {suggestions_response.status_code} - {suggestions_response.text}")
        if suggestions_response.status_code in [200, 201]:
            artifacts["suggestions"] = suggestions_path
        else:
            logger.error(f"Failed to store suggestions: {suggestions_response.status_code} {suggestions_response.text}")
        
        return artifacts
        
    except Exception as e:
        logger.error(f"Failed to write DIP artifacts: {e}")
        return {}

# DISABLED: Old DIP endpoint - replaced with new Anthropic extraction service
# @app.post("/v1/runDocIntelligencePacket", response_model=DIPPacketResponse)
# async def run_dip_packet(request: DIPPacketRequest):
#     """Run complete DIP packet processing and save files"""
#     try:
#         doc_id = request.doc_id
#         if not doc_id:
#             raise HTTPException(status_code=400, detail="doc_id is required")
#
#         logger.info(f"Running DIP packet processing for document {doc_id}")
#
#         # Get Supabase credentials (use Python-specific key)
#         supabase_url = os.getenv('SUPABASE_URL')
#         supabase_key = os.getenv('PY_SUPABASE_SERVICE_KEY') or os.getenv('SUPABASE_SERVICE_KEY') or os.getenv('SUPABASE_SERVICE_ROLE_KEY')
#
#         if not supabase_url or not supabase_key:
#             raise HTTPException(status_code=500, detail="Supabase configuration missing")
#
#         # Read chunks from document_chunks table
#         url = supabase_url.rstrip("/")
#         headers = {
#             "apikey": supabase_key,
#             "Authorization": f"Bearer {supabase_key}"
#         }
#
#         # Query document_chunks table
#         response = requests.get(
#             f"{url}/rest/v1/document_chunks",
#             headers=headers,
#             params={
#                 "doc_id": f"eq.{doc_id}",
#                 "content_type": "eq.text",
#                 "text": "not.is.null",
#                 "select": "chunk_id,doc_id,text,page_start,page_end,chunk_index,metadata",
#                 "order": "page_start,chunk_index"
#             }
#         )
#
#         if response.status_code != 200:
#             logger.error(f"Failed to fetch chunks: {response.status_code} {response.text}")
#             raise HTTPException(status_code=500, detail="Failed to fetch document chunks")
#
#         chunks_data = response.json()
#
#         if not chunks_data:
#             # Try fallback: read from storage
#             logger.info(f"No chunks found in database, trying storage fallback for doc_id: {doc_id}")
#             chunks_data = await _read_chunks_from_storage(url, headers, doc_id)
#
#         if not chunks_data:
#             raise HTTPException(status_code=404, detail="No document chunks found")
#
#         logger.info(f"Found {len(chunks_data)} chunks for document {doc_id}")
#
#         # Convert to format expected by DIP processor
#         chunks = []
#         for chunk_data in chunks_data:
#             chunks.append({
#                 "id": chunk_data["chunk_id"],
#                 "content": chunk_data["text"],
#                 "page": chunk_data.get("page_start", 1),
#                 "metadata": chunk_data.get("metadata", {})
#             })
#
#         # Generate DIP using existing processor
#         dip_result = await dip_processor.process_chunks(doc_id, chunks)
#
#         # Write DIP files using new Supabase client method
#         from .supabase_storage import supabase_storage
#         artifacts = supabase_storage.upload_dip_data(doc_id, dip_result)
#
#         return DIPPacketResponse(
#             success=True,
#             doc_id=doc_id,
#             output_files=artifacts,
#             spec_suggestions_file=artifacts.get('spec_suggestions', ''),
#             playbook_hints_file=artifacts.get('playbook_hints', ''),
#             intent_router_file=artifacts.get('intent_router', ''),
#             golden_tests_file=artifacts.get('golden_tests', ''),
#             processing_time=dip_result.get('processing_time', 0.0)
#         )
#
#     except HTTPException:
#         raise
#     except Exception as e:
#         logger.error(f"DIP generation failed: {e}")
#         raise HTTPException(status_code=500, detail=str(e))

# ============================================================================
# V5 DIP EXTRACTION ENDPOINT - Streaming + Parallelism + Prompt Caching
# ============================================================================

# DIP mode to database table mapping
DIP_MODE_TABLE_MAP = {
    'specs': 'spec_suggestions',
    'troubleshooting': 'troubleshooting',
    'procedures': 'playbook_hints',
    'golden_rules': 'golden_tests',
    'intent_router': 'intent_router'
}

# DIP extraction prompts for each mode
# NOTE: These are TEMPLATES - {selected_models} and {referenced_selections} are injected at runtime
DIP_MODE_PROMPTS = {
    'specs': """Extract all technical specifications from this document.

For each specification, extract:
- parameter: what is being specified (e.g., "Operating Voltage", "Maximum Flow Rate")
- value: the numeric or text value
- units: measurement unit if applicable (use plural form)
- category: specification category (voltage, pressure, temperature, flow_rate, dimension, weight, capacity, etc.)
- description: surrounding context that explains this specification
- references: array of page/section references where this spec appears
- applies_to_models: which PRIMARY models this applies to (from allowed list below, or ["all"] if universal)
- referenced_systems: which REFERENCED systems this relates to (from allowed list below, or [] if none)

TAGGING RULES:
- applies_to_models: Use ONLY values from this list: {selected_models}, OR use ["all"] for universal specs
- referenced_systems: Use ONLY values from this list: {referenced_selections}, OR use [] if not about a referenced system
- If "all" is used in applies_to_models, it must be the ONLY value: ["all"]
- Never invent model/system keys outside these lists

Return ONLY a valid JSON array (no markdown, no extra text):
[{{"parameter": "...", "value": "...", "units": "...", "category": "...", "description": "...", "references": [], "applies_to_models": [...], "referenced_systems": [...]}}]

Maximum 50 items. Only include clearly stated specifications.""",

    'troubleshooting': """Extract all troubleshooting information from this document.

For each issue, extract:
- symptom: the problem description (REQUIRED)
- cause: the primary likely cause (REQUIRED - use first cause if multiple)
- check_action: diagnostic step to verify the cause
- resolution: step-by-step fix or solution
- possible_causes: array of possible causes if multiple exist, each with: {{"cause": "...", "likelihood": "high/medium/low", "fix": "...", "fix_steps": [...]}}
- applies_to_models: which PRIMARY models this applies to (from allowed list below, or ["all"] if universal)
- referenced_systems: which REFERENCED systems this relates to (from allowed list below, or [] if none)

TAGGING RULES:
- applies_to_models: Use ONLY values from this list: {selected_models}, OR use ["all"] for universal issues
- referenced_systems: Use ONLY values from this list: {referenced_selections}, OR use [] if not about a referenced system
- If "all" is used in applies_to_models, it must be the ONLY value: ["all"]
- Never invent model/system keys outside these lists

Return ONLY a valid JSON array (no markdown, no extra text):
[{{"symptom": "...", "cause": "...", "check_action": "...", "resolution": "...", "possible_causes": [...], "applies_to_models": [...], "referenced_systems": [...]}}]

Maximum 50 items. Only include actual troubleshooting content.""",

    'procedures': """Extract all maintenance, operation, and installation procedures from this document.

For each procedure, extract:
- title: procedure name (REQUIRED)
- description: brief description of the procedure's purpose
- preconditions: what must be true before starting (array of strings)
- steps: ordered list of steps (REQUIRED - array of strings)
- expected_outcome: what should happen when done correctly
- error_codes: related error codes (array of strings)
- applies_to_models: which PRIMARY models this applies to (from allowed list below, or ["all"] if universal)
- referenced_systems: which REFERENCED systems this relates to (from allowed list below, or [] if none)

TAGGING RULES:
- applies_to_models: Use ONLY values from this list: {selected_models}, OR use ["all"] for universal procedures
- referenced_systems: Use ONLY values from this list: {referenced_selections}, OR use [] if not about a referenced system
- If "all" is used in applies_to_models, it must be the ONLY value: ["all"]
- Never invent model/system keys outside these lists

Return ONLY a valid JSON array (no markdown, no extra text):
[{{"title": "...", "description": "...", "preconditions": [...], "steps": [...], "expected_outcome": "...", "error_codes": [...], "applies_to_models": [...], "referenced_systems": [...]}}]

Maximum 25 procedures.""",

    'golden_rules': """Extract critical safety rules, warnings, and best practices from this document.

For each rule, extract:
- query: the rule phrased as a test question (REQUIRED, e.g., "Is the circuit breaker OFF before servicing?")
- expected: what compliant behavior/result looks like (REQUIRED)
- description: full description of the rule
- test_method: how to verify compliance (safety, warning, caution, best_practice, inspection, measurement)
- failure_indication: what non-compliance looks like
- related_procedures: array of related procedure names or references
- applies_to_models: which PRIMARY models this applies to (from allowed list below, or ["all"] if universal)
- referenced_systems: which REFERENCED systems this relates to (from allowed list below, or [] if none)

TAGGING RULES:
- applies_to_models: Use ONLY values from this list: {selected_models}, OR use ["all"] for universal rules
- referenced_systems: Use ONLY values from this list: {referenced_selections}, OR use [] if not about a referenced system
- If "all" is used in applies_to_models, it must be the ONLY value: ["all"]
- Never invent model/system keys outside these lists

Return ONLY a valid JSON array (no markdown, no extra text):
[{{"query": "...", "expected": "...", "description": "...", "test_method": "...", "failure_indication": "...", "related_procedures": [...], "applies_to_models": [...], "referenced_systems": [...]}}]

Maximum 30 items.""",

    'intent_router': """Extract common questions and intents that users might have about this equipment.

For each intent, extract:
- question: example question a user might ask (REQUIRED)
- question_type: category (how_to, troubleshooting, specification, safety, maintenance, other)
- answer: the answer to the question based on the document
- description: additional context about the question topic
- question_variations: array of alternative phrasings of the same question
- references: array of page/section references where the answer can be found
- applies_to_models: which PRIMARY models this applies to (from allowed list below, or ["all"] if universal)
- referenced_systems: which REFERENCED systems this relates to (from allowed list below, or [] if none)

TAGGING RULES:
- applies_to_models: Use ONLY values from this list: {selected_models}, OR use ["all"] for universal questions
- referenced_systems: Use ONLY values from this list: {referenced_selections}, OR use [] if not about a referenced system
- If "all" is used in applies_to_models, it must be the ONLY value: ["all"]
- Never invent model/system keys outside these lists

Return ONLY a valid JSON array (no markdown, no extra text):
[{{"question": "...", "question_type": "...", "answer": "...", "description": "...", "question_variations": [...], "references": [...], "applies_to_models": [...], "referenced_systems": [...]}}]

Maximum 40 items. Focus on practical questions users would ask."""
}

# Max document chars for prompt
MAX_MARKDOWN_CHARS = 300000

# Retry configuration
MAX_RETRIES = 3
RETRY_BASE_DELAY = 1.0  # seconds


def _extract_markdown_from_page(page: dict) -> str:
    """
    Extract markdown text from a LlamaParse page object.

    LlamaParse pages have 'items' array with structured content:
    - {type: 'heading', lvl: N, value: '...'} -> # heading
    - {type: 'table', md: '...'} -> table markdown
    - {type: 'text', value: '...'} -> plain text
    """
    parts = []
    for item in page.get('items', []):
        item_type = item.get('type', '')
        if item_type == 'heading':
            level = item.get('lvl', 1)
            value = item.get('value', '')
            if value:
                parts.append(f"{'#' * level} {value}")
        elif item_type == 'table':
            md = item.get('md', '')
            if md:
                parts.append(md)
        elif item.get('value'):
            parts.append(item.get('value', ''))
    return '\n\n'.join(parts)


async def _fetch_document_markdown(doc_id: str, supabase_url: str, supabase_key: str) -> Optional[str]:
    """
    Fetch document content from llamaparse_raw.json and convert to markdown.

    Handles the LlamaParse JSON format: {pages: [{page: N, items: [...]}]}
    """
    url = supabase_url.rstrip("/")
    headers = {
        "apikey": supabase_key,
        "Authorization": f"Bearer {supabase_key}"
    }

    json_path = f"manuals/{doc_id}/llamaparse_raw.json"

    try:
        response = requests.get(
            f"{url}/storage/v1/object/documents/{json_path}",
            headers=headers
        )

        if response.status_code != 200:
            logger.error(f"Failed to fetch llamaparse_raw.json: {response.status_code}")
            return None

        raw_json = response.json()

        # Handle both formats:
        # 1. LlamaParse format: {pages: [{page: N, items: [...]}]}
        # 2. Legacy format: [{page: N, md: '...'}]
        if isinstance(raw_json, dict) and 'pages' in raw_json:
            pages_data = raw_json.get('pages', [])
        elif isinstance(raw_json, list):
            pages_data = raw_json
        else:
            logger.error(f"Unexpected llamaparse_raw.json format: {type(raw_json)}")
            return None

        # Build markdown from pages
        markdown_parts = []
        for page in pages_data:
            page_num = page.get('page', 0)

            # Try legacy 'md' field first, then extract from 'items'
            md = page.get('md', '')
            if not md and 'items' in page:
                md = _extract_markdown_from_page(page)

            if md:
                markdown_parts.append(f"## Page {page_num}\n{md}")

        full_markdown = "\n\n".join(markdown_parts)

        # Truncate if too long
        if len(full_markdown) > MAX_MARKDOWN_CHARS:
            full_markdown = full_markdown[:MAX_MARKDOWN_CHARS]
            logger.info(f"Truncated document to {MAX_MARKDOWN_CHARS} chars")

        return full_markdown

    except Exception as e:
        logger.error(f"Error fetching document markdown: {e}")
        return None


async def _run_dip_mode_with_cache(
    mode: str,
    cached_prefix: list,
    client: anthropic.AsyncAnthropic,
    model: str,
    doc_id: str,
    selected_models: list,
    referenced_selections: list,
    supabase_url: str,
    supabase_key: str
) -> DIPModeResult:
    """Run a single DIP mode with prompt caching and retry logic."""
    start_time = time.time()

    mode_prompt_template = DIP_MODE_PROMPTS.get(mode, "")
    if not mode_prompt_template:
        return DIPModeResult(
            mode=mode,
            success=False,
            error="Unknown DIP mode",
            error_code="UNKNOWN_MODE"
        )

    # Format prompt with allowlists for tagging
    mode_prompt = mode_prompt_template.format(
        selected_models=json.dumps(selected_models),
        referenced_selections=json.dumps(referenced_selections)
    )

    # Build messages with cached prefix + mode-specific prompt
    messages = [
        {
            "role": "user",
            "content": cached_prefix + [
                {"type": "text", "text": f"\n\n{mode_prompt}"}
            ]
        }
    ]

    last_error = None
    for attempt in range(MAX_RETRIES):
        try:
            response = await client.messages.create(
                model=model,
                max_tokens=8000,
                messages=messages
            )

            # Parse response
            response_text = response.content[0].text if response.content else ""

            # Extract JSON from response with retry on failure (Decision #8)
            extracted_data = None
            json_parse_error = None

            try:
                # Try to find JSON array in response
                json_match = re.search(r'\[[\s\S]*\]', response_text)
                if json_match:
                    extracted_data = json.loads(json_match.group())
                else:
                    json_parse_error = "No JSON array found in response"
            except json.JSONDecodeError as e:
                json_parse_error = str(e)

            # Decision #8: Retry once with "JSON only" repair instruction
            if json_parse_error is not None:
                logger.warning(f"DIP {mode}: JSON parse failed ({json_parse_error}), attempting repair request")
                try:
                    repair_messages = messages + [
                        {"role": "assistant", "content": response_text},
                        {"role": "user", "content": "Your response was not valid JSON. Please respond with ONLY a valid JSON array, no markdown fences, no explanation text. Just the raw JSON array starting with [ and ending with ]."}
                    ]
                    repair_response = await client.messages.create(
                        model=model,
                        max_tokens=8000,
                        messages=repair_messages
                    )
                    repair_text = repair_response.content[0].text if repair_response.content else ""
                    json_match = re.search(r'\[[\s\S]*\]', repair_text)
                    if json_match:
                        extracted_data = json.loads(json_match.group())
                        logger.info(f"DIP {mode}: JSON repair succeeded")
                    else:
                        # Still no valid JSON after repair - fail the mode
                        return DIPModeResult(
                            mode=mode,
                            success=False,
                            error="Invalid JSON after repair attempt",
                            error_code="INVALID_JSON",
                            duration_ms=int((time.time() - start_time) * 1000)
                        )
                except json.JSONDecodeError:
                    # Repair also failed - fail the mode
                    return DIPModeResult(
                        mode=mode,
                        success=False,
                        error="Invalid JSON after repair attempt",
                        error_code="INVALID_JSON",
                        duration_ms=int((time.time() - start_time) * 1000)
                    )
                except Exception as repair_error:
                    logger.error(f"DIP {mode}: JSON repair request failed: {repair_error}")
                    return DIPModeResult(
                        mode=mode,
                        success=False,
                        error=f"JSON repair failed: {repair_error}",
                        error_code="INVALID_JSON",
                        duration_ms=int((time.time() - start_time) * 1000)
                    )

            # At this point extracted_data should be a list (possibly empty)
            if extracted_data is None:
                extracted_data = []

            # Insert to database
            inserted_count = 0
            skipped_count = 0
            if extracted_data:
                inserted_count, skipped_count = await _insert_dip_results(
                    mode=mode,
                    doc_id=doc_id,
                    data=extracted_data,
                    selected_models=selected_models,
                    referenced_selections=referenced_selections,
                    supabase_url=supabase_url,
                    supabase_key=supabase_key
                )

            # Decision #9: If N>0 items returned but 0 valid after validation, fail the mode
            total_items = len(extracted_data)
            if total_items > 0 and inserted_count == 0:
                return DIPModeResult(
                    mode=mode,
                    success=False,
                    error=f"All {total_items} extracted items failed schema validation",
                    error_code="SCHEMA_VALIDATION_FAILED",
                    duration_ms=int((time.time() - start_time) * 1000)
                )

            duration_ms = int((time.time() - start_time) * 1000)

            # Extract cache metrics if available
            cache_read = 0
            cache_create = 0
            if hasattr(response, 'usage'):
                cache_read = getattr(response.usage, 'cache_read_input_tokens', 0) or 0
                cache_create = getattr(response.usage, 'cache_creation_input_tokens', 0) or 0
                if cache_read > 0 or cache_create > 0:
                    logger.info(f"DIP {mode} cache metrics: read={cache_read}, create={cache_create}")

            return DIPModeResult(
                mode=mode,
                success=True,
                count=total_items,
                inserted=inserted_count,
                duration_ms=duration_ms,
                cache_creation_input_tokens=cache_create,
                cache_read_input_tokens=cache_read
            )

        except anthropic.RateLimitError as e:
            last_error = e
            delay = RETRY_BASE_DELAY * (2 ** attempt) + random.uniform(0, 1)
            logger.warning(f"DIP {mode} rate limited (attempt {attempt + 1}), retrying in {delay:.1f}s")
            await asyncio.sleep(delay)

        except anthropic.APIStatusError as e:
            if e.status_code in [529, 503]:  # Overloaded
                last_error = e
                delay = RETRY_BASE_DELAY * (2 ** attempt) + random.uniform(0, 1)
                logger.warning(f"DIP {mode} API overloaded (attempt {attempt + 1}), retrying in {delay:.1f}s")
                await asyncio.sleep(delay)
            else:
                return DIPModeResult(
                    mode=mode,
                    success=False,
                    error=str(e),
                    error_code="API_ERROR",
                    duration_ms=int((time.time() - start_time) * 1000)
                )

        except asyncio.TimeoutError:
            last_error = "Timeout"
            delay = RETRY_BASE_DELAY * (2 ** attempt) + random.uniform(0, 1)
            logger.warning(f"DIP {mode} timeout (attempt {attempt + 1}), retrying in {delay:.1f}s")
            await asyncio.sleep(delay)

        except Exception as e:
            return DIPModeResult(
                mode=mode,
                success=False,
                error=str(e),
                error_code="EXTRACTION_ERROR",
                duration_ms=int((time.time() - start_time) * 1000)
            )

    # All retries exhausted
    return DIPModeResult(
        mode=mode,
        success=False,
        error=f"Failed after {MAX_RETRIES} retries: {last_error}",
        error_code="RETRY_EXHAUSTED",
        duration_ms=int((time.time() - start_time) * 1000)
    )


async def _insert_dip_results(
    mode: str,
    doc_id: str,
    data: list,
    selected_models: list,
    referenced_selections: list,
    supabase_url: str,
    supabase_key: str
) -> tuple[int, int]:
    """Insert extracted DIP data into the appropriate database table.

    Returns:
        tuple[int, int]: (inserted_count, skipped_count)

    Implements:
    - Decision #7: referenced_systems = item.referenced_systems ∩ referenced_selections
    - Decision #9: Skip invalid items; fail mode if 0 valid from N>0
    - Decision #11: If "all" in applies_to_models, normalize to ["all"]
    """
    table_name = DIP_MODE_TABLE_MAP.get(mode)
    if not table_name:
        return 0

    url = supabase_url.rstrip("/")
    headers = {
        "apikey": supabase_key,
        "Authorization": f"Bearer {supabase_key}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal"
    }

    # Helper: normalize applies_to_models per Decision #11 + intersect with selected_models
    def normalize_applies_to_models(raw_models):
        if not raw_models or not isinstance(raw_models, list):
            return []
        # If "all" is present, normalize to ["all"] exclusively (Decision #11)
        if "all" in raw_models:
            return ["all"]
        # Intersect with selected_models to prevent LLM from inventing keys
        allowed_set = set(selected_models)
        filtered = [m for m in raw_models if m in allowed_set]
        return filtered if filtered else []

    # Helper: intersect referenced_systems with allowed selections per Decision #7
    def filter_referenced_systems(raw_systems):
        if not raw_systems or not isinstance(raw_systems, list):
            return []
        allowed_set = set(referenced_selections)
        return [s for s in raw_systems if s in allowed_set]

    # Required fields per table (Decision #9)
    REQUIRED_FIELDS = {
        'specs': [],  # No strict NOT NULL besides doc_id
        'troubleshooting': ['symptom', 'cause'],
        'procedures': ['title', 'steps'],
        'golden_rules': ['query', 'expected'],
        'intent_router': ['question']
    }

    required = REQUIRED_FIELDS.get(mode, [])

    # Transform data for each table's schema
    rows = []
    skipped_count = 0
    for item in data:
        # Decision #9: Skip items missing required fields
        missing = [f for f in required if not item.get(f)]
        if missing:
            logger.warning(f"DIP {mode}: skipping item missing required fields: {missing}")
            skipped_count += 1
            continue

        row = {
            "doc_id": doc_id,
            "status": "dip_extracted"
        }

        # Common tagging fields for all modes
        applies_to = normalize_applies_to_models(item.get("applies_to_models", []))
        referenced = filter_referenced_systems(item.get("referenced_systems", []))

        if mode == 'specs':
            row.update({
                "parameter": item.get("parameter", ""),
                "value": str(item.get("value", "")),
                "units": item.get("units", ""),
                "description": item.get("description"),
                "category": item.get("category"),
                "references": item.get("references", []),
                "applies_to_models": applies_to,
                "referenced_systems": referenced
            })
        elif mode == 'troubleshooting':
            # Handle multi-cause: if possible_causes exists but cause is empty, use first cause
            cause = item.get("cause", "")
            possible_causes = item.get("possible_causes")
            if not cause and possible_causes and isinstance(possible_causes, list) and len(possible_causes) > 0:
                first_cause = possible_causes[0]
                if isinstance(first_cause, dict):
                    cause = first_cause.get("cause", "")

            row.update({
                "symptom": item.get("symptom", ""),
                "cause": cause,
                "check_action": item.get("check_action"),
                "resolution": item.get("resolution"),
                "possible_causes": possible_causes,
                "applies_to_models": applies_to,
                "referenced_systems": referenced
            })
        elif mode == 'procedures':
            row.update({
                "title": item.get("title", ""),
                "description": item.get("description"),
                "preconditions": item.get("preconditions", []),
                "steps": item.get("steps", []),
                "expected_outcome": item.get("expected_outcome", ""),
                "error_codes": item.get("error_codes", []),
                "applies_to_models": applies_to,
                "referenced_systems": referenced
            })
        elif mode == 'golden_rules':
            row.update({
                "query": item.get("query", ""),
                "expected": item.get("expected", ""),
                "test_method": item.get("test_method", ""),
                "description": item.get("description", ""),
                "failure_indication": item.get("failure_indication", ""),
                "related_procedures": item.get("related_procedures", []),
                "applies_to_models": applies_to,
                "referenced_systems": referenced
            })
        elif mode == 'intent_router':
            row.update({
                "question": item.get("question", ""),
                "question_type": item.get("question_type", ""),
                "answer": item.get("answer", ""),
                "description": item.get("description"),
                "question_variations": item.get("question_variations", []),
                "references": item.get("references", []),
                "applies_to_models": applies_to,
                "referenced_systems": referenced
            })

        rows.append(row)

    # Log skipped items for debugging
    if skipped_count > 0:
        logger.warning(f"DIP {mode}: skipped {skipped_count}/{len(data)} items due to missing required fields")

    if not rows:
        # Return (0, skipped_count) - no rows to insert, but track skipped
        return (0, skipped_count)

    try:
        response = requests.post(
            f"{url}/rest/v1/{table_name}",
            headers=headers,
            json=rows
        )

        if response.status_code in [200, 201]:
            logger.info(f"Inserted {len(rows)} rows into {table_name}")
            return (len(rows), skipped_count)
        else:
            logger.error(f"Failed to insert into {table_name}: {response.status_code} {response.text}")
            return (0, skipped_count)

    except Exception as e:
        logger.error(f"Error inserting into {table_name}: {e}")
        return (0, skipped_count)


async def _delete_existing_dip_data(doc_id: str, modes: list, supabase_url: str, supabase_key: str):
    """Delete existing DIP data for a document before rerun.

    Decision #4: Preserve approved rows - only delete where status != 'approved'
    """
    url = supabase_url.rstrip("/")
    headers = {
        "apikey": supabase_key,
        "Authorization": f"Bearer {supabase_key}"
    }

    for mode in modes:
        table_name = DIP_MODE_TABLE_MAP.get(mode)
        if table_name:
            try:
                # Preserve approved rows per Decision #4
                response = requests.delete(
                    f"{url}/rest/v1/{table_name}?doc_id=eq.{doc_id}&status=neq.approved",
                    headers=headers
                )
                if response.status_code in [200, 204]:
                    logger.info(f"Deleted existing {mode} data for {doc_id} (preserved approved rows)")
            except Exception as e:
                logger.warning(f"Failed to delete {mode} data: {e}")


async def _dip_run_stream_generator(request: DIPRunRequest):
    """SSE generator for streaming DIP extraction progress."""
    start_time = time.time()
    doc_id = request.doc_id
    modes = request.modes

    # Get credentials
    supabase_url = os.getenv('SUPABASE_URL')
    supabase_key = os.getenv('SUPABASE_SERVICE_KEY') or os.getenv('SUPABASE_SERVICE_ROLE_KEY')
    anthropic_key = os.getenv('ANTHROPIC_API_KEY')
    anthropic_model = os.getenv('ANTHROPIC_MODEL', 'claude-sonnet-4-20250514')

    if not all([supabase_url, supabase_key, anthropic_key]):
        yield f"event: run_failed\ndata: {json.dumps({'error_code': 'CONFIG_ERROR', 'error': 'Missing required configuration'})}\n\n"
        return

    # Initialize async Anthropic client
    client = anthropic.AsyncAnthropic(api_key=anthropic_key)

    # Emit run_started
    yield f"event: run_started\ndata: {json.dumps({'doc_id': doc_id, 'modes': modes, 'parallelism': len(modes) - 1, 'cache_control': 'ephemeral', 'warmup_mode': 'specs'})}\n\n"

    try:
        # Fetch document content
        markdown = await _fetch_document_markdown(doc_id, supabase_url, supabase_key)
        if not markdown:
            yield f"event: run_failed\ndata: {json.dumps({'error_code': 'DOCUMENT_NOT_FOUND', 'error': 'Failed to fetch document content'})}\n\n"
            return

        # Delete existing data if force_rerun
        if request.force_rerun:
            await _delete_existing_dip_data(doc_id, modes, supabase_url, supabase_key)

        # Build context section with exclude_models for precision
        exclude_models = request.exclude_models or []
        exclude_instruction = ""
        if exclude_models:
            exclude_instruction = f"""
Models to EXCLUDE (skip content specific to these): {', '.join(exclude_models)}"""

        context_section = f"""You are analyzing a technical manual for marine equipment.
Document ID: {doc_id}
Models covered by this document: {', '.join(request.models_covered)}
User's selected models (INCLUDE these): {', '.join(request.selected_models)}
User's selected referenced systems: {', '.join(request.referenced_selections) if request.referenced_selections else 'None'}{exclude_instruction}

Extract information that is relevant to the selected models and referenced systems.
- If content applies to ALL selected models, use applies_to_models=["all"]
- SKIP content that is specific to excluded models
- Content about referenced systems should have those systems in referenced_systems field"""

        # Build cached prefix (context + document)
        cached_prefix = [
            {
                "type": "text",
                "text": context_section + f"\n\nDOCUMENT CONTENT:\n{markdown}",
                "cache_control": {"type": "ephemeral"}
            }
        ]

        # Organize modes: warmup first, then others
        warmup_mode = 'specs' if 'specs' in modes else modes[0]
        other_modes = [m for m in modes if m != warmup_mode]

        results = []
        modes_completed = []
        modes_failed = []
        total_inserted = 0
        total_extracted = 0
        cache_creation_tokens = 0
        cache_read_tokens = 0

        # Wave 0: Warmup (creates cache)
        yield f"event: mode_started\ndata: {json.dumps({'mode': warmup_mode})}\n\n"

        warmup_result = await _run_dip_mode_with_cache(
            mode=warmup_mode,
            cached_prefix=cached_prefix,
            client=client,
            model=anthropic_model,
            doc_id=doc_id,
            selected_models=request.selected_models,
            referenced_selections=request.referenced_selections,
            supabase_url=supabase_url,
            supabase_key=supabase_key
        )

        results.append(warmup_result)

        # Accumulate cache metrics from warmup
        cache_creation_tokens += warmup_result.cache_creation_input_tokens
        cache_read_tokens += warmup_result.cache_read_input_tokens

        if warmup_result.success:
            modes_completed.append(warmup_mode)
            total_inserted += warmup_result.inserted
            total_extracted += warmup_result.count
            yield f"event: mode_completed\ndata: {json.dumps({'mode': warmup_mode, 'inserted': warmup_result.inserted, 'count': warmup_result.count, 'duration_ms': warmup_result.duration_ms, 'cache_creation_input_tokens': warmup_result.cache_creation_input_tokens, 'cache_read_input_tokens': warmup_result.cache_read_input_tokens})}\n\n"
            # Emit cache metrics after warmup (cache should be created here)
            if cache_creation_tokens > 0:
                yield f"event: run_cache_metrics\ndata: {json.dumps({'cache_creation_input_tokens': cache_creation_tokens, 'cache_read_input_tokens': cache_read_tokens})}\n\n"
        else:
            modes_failed.append(warmup_mode)
            yield f"event: mode_failed\ndata: {json.dumps({'mode': warmup_mode, 'error_code': warmup_result.error_code, 'error': warmup_result.error})}\n\n"
            yield f"event: warmup_failed_continuing\ndata: {json.dumps({'error_code': warmup_result.error_code, 'error': warmup_result.error, 'retries_attempted': MAX_RETRIES, 'caching_still_attempted': True})}\n\n"

        # Run all remaining modes in parallel (single wave)
        for i in range(0, len(other_modes), len(other_modes) or 1):
            batch = other_modes[i:i+len(other_modes)]

            # Emit mode_started for batch
            for mode in batch:
                yield f"event: mode_started\ndata: {json.dumps({'mode': mode})}\n\n"

            # Run batch concurrently
            tasks = [
                _run_dip_mode_with_cache(
                    mode=mode,
                    cached_prefix=cached_prefix,
                    client=client,
                    model=anthropic_model,
                    doc_id=doc_id,
                    selected_models=request.selected_models,
                    referenced_selections=request.referenced_selections,
                    supabase_url=supabase_url,
                    supabase_key=supabase_key
                )
                for mode in batch
            ]

            batch_results = await asyncio.gather(*tasks, return_exceptions=True)

            # Process batch results
            for mode, result in zip(batch, batch_results):
                if isinstance(result, Exception):
                    result = DIPModeResult(
                        mode=mode,
                        success=False,
                        error=str(result),
                        error_code="TASK_ERROR"
                    )

                results.append(result)

                # Accumulate cache metrics
                cache_creation_tokens += result.cache_creation_input_tokens
                cache_read_tokens += result.cache_read_input_tokens

                if result.success:
                    modes_completed.append(mode)
                    total_inserted += result.inserted
                    total_extracted += result.count
                    yield f"event: mode_completed\ndata: {json.dumps({'mode': mode, 'inserted': result.inserted, 'count': result.count, 'duration_ms': result.duration_ms, 'cache_creation_input_tokens': result.cache_creation_input_tokens, 'cache_read_input_tokens': result.cache_read_input_tokens})}\n\n"
                else:
                    modes_failed.append(mode)
                    yield f"event: mode_failed\ndata: {json.dumps({'mode': mode, 'error_code': result.error_code, 'error': result.error})}\n\n"

        # Emit final cache metrics (total across all modes)
        if cache_creation_tokens > 0 or cache_read_tokens > 0:
            yield f"event: run_cache_metrics\ndata: {json.dumps({'cache_creation_input_tokens': cache_creation_tokens, 'cache_read_input_tokens': cache_read_tokens})}\n\n"

        # Emit run_completed
        processing_time = time.time() - start_time
        yield f"event: run_completed\ndata: {json.dumps({'modes_completed': modes_completed, 'modes_failed': modes_failed, 'total_inserted': total_inserted, 'total_extracted': total_extracted, 'processing_time': round(processing_time, 2), 'cache_creation_input_tokens': cache_creation_tokens, 'cache_read_input_tokens': cache_read_tokens})}\n\n"

    except asyncio.CancelledError:
        logger.info(f"DIP run cancelled for {doc_id}")
        yield f"event: run_failed\ndata: {json.dumps({'error_code': 'CANCELLED', 'error': 'Run was cancelled'})}\n\n"
        raise

    except Exception as e:
        logger.error(f"DIP run failed for {doc_id}: {e}")
        yield f"event: run_failed\ndata: {json.dumps({'error_code': 'RUN_ERROR', 'error': str(e)})}\n\n"


@app.post("/v1/dip/run")
async def run_dip_extraction(request: DIPRunRequest):
    """
    Run v5 DIP extraction with streaming support.

    If stream=true: Returns SSE stream with per-mode progress events.
    If stream=false: Returns JSON DIPRunResponse after all modes complete.

    Features:
    - Prompt caching (cache_control: ephemeral) for efficiency
    - Warmup mode (intent_router) to create cache
    - Parallelism=2 for remaining modes
    - Retry/backoff for 429/529/timeouts
    - 30-minute timeout budget
    """
    logger.info(f"DIP run request: doc_id={request.doc_id}, modes={request.modes}, stream={request.stream}")

    if request.stream:
        return StreamingResponse(
            _dip_run_stream_generator(request),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no"
            }
        )

    # Non-streaming: collect all results and return JSON
    start_time = time.time()
    results = []
    modes_completed = []
    modes_failed = []
    total_inserted = 0
    total_extracted = 0

    # Get credentials
    supabase_url = os.getenv('SUPABASE_URL')
    supabase_key = os.getenv('SUPABASE_SERVICE_KEY') or os.getenv('SUPABASE_SERVICE_ROLE_KEY')
    anthropic_key = os.getenv('ANTHROPIC_API_KEY')
    anthropic_model = os.getenv('ANTHROPIC_MODEL', 'claude-sonnet-4-20250514')

    if not all([supabase_url, supabase_key, anthropic_key]):
        return DIPRunResponse(
            success=False,
            doc_id=request.doc_id,
            modes_requested=request.modes,
            error="Missing required configuration",
            error_code="CONFIG_ERROR"
        )

    # Fetch document
    markdown = await _fetch_document_markdown(request.doc_id, supabase_url, supabase_key)
    if not markdown:
        return DIPRunResponse(
            success=False,
            doc_id=request.doc_id,
            modes_requested=request.modes,
            error="Failed to fetch document content",
            error_code="DOCUMENT_NOT_FOUND"
        )

    # Delete existing if force_rerun
    if request.force_rerun:
        await _delete_existing_dip_data(request.doc_id, request.modes, supabase_url, supabase_key)

    # Initialize client and build cached prefix
    client = anthropic.AsyncAnthropic(api_key=anthropic_key)

    context_section = f"""You are analyzing a technical manual for marine equipment.
Document ID: {request.doc_id}
Models covered: {', '.join(request.models_covered)}
User's selected models: {', '.join(request.selected_models)}

Extract information that is relevant to the selected models. If content applies to all models, include it."""

    cached_prefix = [
        {
            "type": "text",
            "text": context_section + f"\n\nDOCUMENT CONTENT:\n{markdown}",
            "cache_control": {"type": "ephemeral"}
        }
    ]

    # Run modes: warmup first, then parallel
    warmup_mode = 'specs' if 'specs' in request.modes else request.modes[0]
    other_modes = [m for m in request.modes if m != warmup_mode]

    # Warmup
    warmup_result = await _run_dip_mode_with_cache(
        mode=warmup_mode,
        cached_prefix=cached_prefix,
        client=client,
        model=anthropic_model,
        doc_id=request.doc_id,
        selected_models=request.selected_models,
        supabase_url=supabase_url,
        supabase_key=supabase_key
    )
    results.append(warmup_result)
    if warmup_result.success:
        modes_completed.append(warmup_mode)
        total_inserted += warmup_result.inserted
        total_extracted += warmup_result.count
    else:
        modes_failed.append(warmup_mode)

    # Parallel execution of all remaining modes (single wave)
    for i in range(0, len(other_modes), len(other_modes) or 1):
        batch = other_modes[i:i+len(other_modes)]
        tasks = [
            _run_dip_mode_with_cache(
                mode=mode,
                cached_prefix=cached_prefix,
                client=client,
                model=anthropic_model,
                doc_id=request.doc_id,
                selected_models=request.selected_models,
                supabase_url=supabase_url,
                supabase_key=supabase_key
            )
            for mode in batch
        ]

        batch_results = await asyncio.gather(*tasks, return_exceptions=True)

        for mode, result in zip(batch, batch_results):
            if isinstance(result, Exception):
                result = DIPModeResult(
                    mode=mode,
                    success=False,
                    error=str(result),
                    error_code="TASK_ERROR"
                )
            results.append(result)
            if result.success:
                modes_completed.append(mode)
                total_inserted += result.inserted
                total_extracted += result.count
            else:
                modes_failed.append(mode)

    processing_time = time.time() - start_time

    return DIPRunResponse(
        success=len(modes_failed) == 0,
        doc_id=request.doc_id,
        modes_requested=request.modes,
        modes_completed=modes_completed,
        modes_failed=modes_failed,
        results=results,
        total_extracted=total_extracted,
        total_inserted=total_inserted,
        processing_time=round(processing_time, 2)
    )


# ============================================================================
# v5 INDEX DOCUMENT ENDPOINT
# ============================================================================

async def _fetch_llamaparse_raw_json(doc_id: str, supabase_url: str, supabase_key: str) -> Optional[list]:
    """
    Fetch raw llamaparse JSON from Supabase storage.

    Handles both formats:
    1. LlamaParse format: {pages: [{page: N, items: [...]}]}
    2. Legacy format: [{page: N, md: '...'}]

    Returns normalized list of pages with 'page' and 'md' fields, or None on failure.
    """
    url = supabase_url.rstrip("/")
    headers = {
        "apikey": supabase_key,
        "Authorization": f"Bearer {supabase_key}"
    }

    json_path = f"manuals/{doc_id}/llamaparse_raw.json"

    try:
        response = requests.get(
            f"{url}/storage/v1/object/documents/{json_path}",
            headers=headers
        )

        if response.status_code != 200:
            logger.error(f"Failed to fetch llamaparse_raw.json: {response.status_code}")
            return None

        raw_json = response.json()

        # Handle both formats
        if isinstance(raw_json, dict) and 'pages' in raw_json:
            # LlamaParse format: {pages: [{page: N, items: [...]}]}
            pages_data = raw_json.get('pages', [])
            # Convert to normalized format with 'md' extracted from 'items'
            normalized = []
            for page in pages_data:
                page_num = page.get('page', 0)
                # Extract markdown from items if no 'md' field
                md = page.get('md', '')
                if not md and 'items' in page:
                    md = _extract_markdown_from_page(page)
                normalized.append({'page': page_num, 'md': md})
            return normalized
        elif isinstance(raw_json, list):
            # Legacy format: [{page: N, md: '...'}] - already normalized
            return raw_json
        else:
            logger.error(f"Unexpected llamaparse_raw.json format: {type(raw_json)}")
            return None

    except Exception as e:
        logger.error(f"Error fetching llamaparse_raw.json: {e}")
        return None


def _extract_sections_from_markdown(markdown: str) -> List[Dict[str, Any]]:
    """
    Extract hierarchical sections from markdown.

    Identifies sections by markdown headers (# ## ### etc.)
    and builds hierarchical structure.

    This is a copy of parser._extract_sections to avoid dependency issues.
    """
    sections = []
    lines = markdown.split('\n')

    current_section = None
    current_content = []
    char_position = 0

    for line in lines:
        line_length = len(line) + 1  # +1 for newline

        # Check if line is a heading
        if line.startswith('#'):
            # Save previous section if exists
            if current_section is not None:
                current_section['content'] = '\n'.join(current_content).strip()
                current_section['end_char'] = char_position
                sections.append(current_section)

            # Start new section
            level = len(line) - len(line.lstrip('#'))
            title = line.lstrip('#').strip()

            current_section = {
                'level': level,
                'title': title,
                'start_char': char_position,
                'content': '',
                'end_char': 0
            }
            current_content = []
        else:
            # Add to current section content
            if current_section is not None:
                current_content.append(line)

        char_position += line_length

    # Save final section
    if current_section is not None:
        current_section['content'] = '\n'.join(current_content).strip()
        current_section['end_char'] = char_position
        sections.append(current_section)

    return sections


async def _delete_existing_index_data(doc_id: str, supabase_url: str, supabase_key: str) -> Dict[str, Any]:
    """
    Delete existing chunks from Supabase and Pinecone for a document.

    Returns dict with deletion results.
    """
    url = supabase_url.rstrip("/")
    headers = {
        "apikey": supabase_key,
        "Authorization": f"Bearer {supabase_key}"
    }

    deleted_chunks = 0
    deleted_vectors = 0

    try:
        # Step 1: Get existing chunk IDs from Supabase
        response = requests.get(
            f"{url}/rest/v1/document_chunks?doc_id=eq.{doc_id}&select=chunk_id",
            headers=headers
        )

        if response.status_code == 200:
            chunks = response.json()
            chunk_ids = [c['chunk_id'] for c in chunks if c.get('chunk_id')]

            if chunk_ids:
                # Step 2: Delete from Pinecone
                if pinecone_client and pinecone_client.index:
                    delete_result = pinecone_client.delete_vectors(chunk_ids)
                    if delete_result.get('success'):
                        deleted_vectors = delete_result.get('deleted_count', len(chunk_ids))
                        logger.info(f"Deleted {deleted_vectors} vectors from Pinecone for {doc_id}")

                # Step 3: Delete from Supabase
                delete_response = requests.delete(
                    f"{url}/rest/v1/document_chunks?doc_id=eq.{doc_id}",
                    headers=headers
                )

                if delete_response.status_code in [200, 204]:
                    deleted_chunks = len(chunk_ids)
                    logger.info(f"Deleted {deleted_chunks} chunks from Supabase for {doc_id}")

        return {
            'success': True,
            'deleted_chunks': deleted_chunks,
            'deleted_vectors': deleted_vectors
        }

    except Exception as e:
        logger.error(f"Error deleting existing index data: {e}")
        return {
            'success': False,
            'error': str(e),
            'deleted_chunks': deleted_chunks,
            'deleted_vectors': deleted_vectors
        }


@app.post("/v1/index-document", response_model=IndexDocumentResponse)
async def index_document(request: IndexDocumentRequest):
    """
    v5 Index Document: Chunk document with model tagging and store in Pinecone.

    Pipeline:
    1. Fetch llamaparse_raw.json from Supabase Storage
    2. Build markdown with page headers
    3. Extract sections for hierarchical context
    4. Chunk with v5 model tagging (high-recall: no skipping)
    5. Generate embeddings (text-embedding-3-large)
    6. Upsert to Pinecone and Supabase document_chunks

    Request fields:
    - doc_id: Document ID (required to fetch llamaparse_raw.json)
    - models_covered: All primary models the manual covers
    - selected_models: User's installed primary model(s)
    - referenced_selections: User's selected referenced systems
    - filename: Original filename for metadata
    - force_reindex: If true, delete existing chunks first
    """
    start_time = time.time()
    doc_id = request.doc_id

    logger.info(f"Index document request: doc_id={doc_id}, models_covered={request.models_covered}, "
                f"selected_models={request.selected_models}, force_reindex={request.force_reindex}")

    # ========================================================================
    # Validation
    # ========================================================================
    if not request.models_covered or len(request.models_covered) == 0:
        return IndexDocumentResponse(
            success=False,
            doc_id=doc_id,
            error_code="MODELS_COVERED_MISSING",
            error="models_covered is required and cannot be empty",
            processing_time=round(time.time() - start_time, 2)
        )

    # ========================================================================
    # Get credentials
    # ========================================================================
    supabase_url = os.getenv('SUPABASE_URL')
    supabase_key = os.getenv('SUPABASE_SERVICE_KEY') or os.getenv('SUPABASE_SERVICE_ROLE_KEY') or os.getenv('PY_SUPABASE_SERVICE_KEY')

    if not supabase_url or not supabase_key:
        return IndexDocumentResponse(
            success=False,
            doc_id=doc_id,
            error_code="CONFIG_ERROR",
            error="Missing Supabase configuration",
            processing_time=round(time.time() - start_time, 2)
        )

    # ========================================================================
    # Force reindex: delete existing chunks
    # ========================================================================
    if request.force_reindex:
        logger.info(f"Force reindex: deleting existing chunks for {doc_id}")
        delete_result = await _delete_existing_index_data(doc_id, supabase_url, supabase_key)
        if not delete_result['success']:
            logger.warning(f"Failed to delete existing data: {delete_result.get('error')}")

    # ========================================================================
    # Fetch llamaparse_raw.json
    # ========================================================================
    pages_data = await _fetch_llamaparse_raw_json(doc_id, supabase_url, supabase_key)

    if not pages_data:
        return IndexDocumentResponse(
            success=False,
            doc_id=doc_id,
            error_code="LLAMAPARSE_NOT_FOUND",
            error=f"Could not fetch llamaparse_raw.json for document {doc_id}",
            processing_time=round(time.time() - start_time, 2)
        )

    # ========================================================================
    # Build markdown with page headers
    # ========================================================================
    markdown_parts = []
    for page in pages_data:
        page_num = page.get('page', 0)
        md = page.get('md', '')
        if md:
            markdown_parts.append(f"## Page {page_num}\n{md}")

    full_markdown = "\n\n".join(markdown_parts)

    if not full_markdown or len(full_markdown.strip()) == 0:
        return IndexDocumentResponse(
            success=False,
            doc_id=doc_id,
            error_code="EMPTY_DOCUMENT",
            error="Document has no content to index",
            processing_time=round(time.time() - start_time, 2)
        )

    logger.info(f"Built markdown: {len(full_markdown)} chars from {len(pages_data)} pages")

    # ========================================================================
    # Extract sections
    # ========================================================================
    sections = _extract_sections_from_markdown(full_markdown)
    logger.info(f"Extracted {len(sections)} sections")

    # ========================================================================
    # Get or initialize chunker and embedding service
    # ========================================================================
    try:
        from .chunking import get_chunker, get_embedding_service
        chunker = get_chunker()
        embedding_service = get_embedding_service(pinecone_client=pinecone_client)
    except Exception as e:
        logger.error(f"Failed to initialize chunking components: {e}")
        return IndexDocumentResponse(
            success=False,
            doc_id=doc_id,
            error_code="INIT_ERROR",
            error=f"Failed to initialize chunking: {str(e)}",
            processing_time=round(time.time() - start_time, 2)
        )

    # ========================================================================
    # Chunk document with v5 model tagging
    # ========================================================================
    try:
        # Build metadata for v5 tagging
        chunk_metadata = {
            'doc_id': doc_id,
            'models_covered': request.models_covered,
            'selected_models': request.selected_models,
            'referenced_selections': request.referenced_selections,
            'filename': request.filename,
            'file_type': '.pdf'  # Default to PDF
        }

        document_chunks = chunker.chunk_document(
            markdown=full_markdown,
            sections=sections,
            document_id=doc_id,
            filename=request.filename,
            metadata=chunk_metadata
        )

        logger.info(f"Created {document_chunks.total_chunks} chunks, "
                    f"{document_chunks.total_tokens} tokens, "
                    f"{document_chunks.chunks_skipped} skipped")

    except Exception as e:
        logger.error(f"Failed to chunk document: {e}")
        return IndexDocumentResponse(
            success=False,
            doc_id=doc_id,
            error_code="CHUNKING_ERROR",
            error=f"Failed to chunk document: {str(e)}",
            processing_time=round(time.time() - start_time, 2)
        )

    # ========================================================================
    # Generate embeddings and store in Pinecone + Supabase
    # ========================================================================
    try:
        processing_result = await embedding_service.process_document_chunks(document_chunks)

        if not processing_result.get('success'):
            return IndexDocumentResponse(
                success=False,
                doc_id=doc_id,
                chunks_created=document_chunks.total_chunks,
                error_code="EMBEDDING_ERROR",
                error=f"Failed to generate embeddings: {processing_result.get('error')}",
                processing_time=round(time.time() - start_time, 2)
            )

        # Extract results
        pinecone_result = processing_result.get('pinecone_result', {})
        supabase_result = processing_result.get('supabase_result', {})

        vectors_upserted = pinecone_result.get('upserted_count', 0)

        logger.info(f"Successfully indexed document {doc_id}: "
                    f"{document_chunks.total_chunks} chunks, "
                    f"{vectors_upserted} vectors, "
                    f"{document_chunks.total_tokens} tokens")

        return IndexDocumentResponse(
            success=True,
            doc_id=doc_id,
            chunks_created=document_chunks.total_chunks,
            chunks_skipped=document_chunks.chunks_skipped,
            vectors_upserted=vectors_upserted,
            total_tokens=document_chunks.total_tokens,
            statistics=document_chunks.get_statistics(),
            processing_time=round(time.time() - start_time, 2)
        )

    except Exception as e:
        logger.error(f"Failed to generate embeddings and store: {e}")
        return IndexDocumentResponse(
            success=False,
            doc_id=doc_id,
            chunks_created=document_chunks.total_chunks,
            error_code="STORAGE_ERROR",
            error=f"Failed to store chunks: {str(e)}",
            processing_time=round(time.time() - start_time, 2)
        )


# ============================================================================
# CHAT ENDPOINTS - LangGraph Integration with DIP Tables
# ============================================================================

# Chat imports - only import if chat functionality is enabled
chat_enabled = os.getenv('CHAT_MODULE_ENABLED', 'false').lower() == 'true'

if chat_enabled:
    try:
        from .chat.chat_models import ChatRequest, ChatResponse, HealthResponse as ChatHealthResponse
        from .chat.services.dip_retriever import DIPRetriever
        from .chat.services.production_dip_retriever import ProductionDIPRetriever
        from .chat.workflows.chat_workflow_sequential import ChatWorkflowSequential  # Moved to module level for easier mocking
        from datetime import datetime

        # Environment-based DIP connector selection
        dip_environment = os.getenv('DIP_ENVIRONMENT', 'staging').lower()

        if dip_environment == 'production':
            chat_dip_retriever = ProductionDIPRetriever()
            logger.info("🚀 Production DIP connector initialized")
        else:
            chat_dip_retriever = DIPRetriever()
            logger.info("🧪 Staging DIP connector initialized (default)")

        logger.info(f"DIP Environment: {dip_environment}")

        logger.info("✅ Chat module enabled and initialized - endpoints registered")

        @app.post("/v1/chat/process", response_model=ChatResponse)
        async def process_chat(request: ChatRequest, stream: bool = False):
            """
            Process chat query using LangGraph workflow with DIP integration.

            Args:
                request: ChatRequest with query, systems_context, etc.
                stream: If True, return SSE stream instead of JSON response

            Returns:
                ChatResponse (JSON) or StreamingResponse (SSE if stream=True)
            """
            start_time = datetime.now()

            try:
                # === STREAMING BRANCH ===
                if stream:
                    logger.info("🌊 STREAMING MODE: Returning SSE response")

                    async def stream_events():
                        """Generator that yields SSE events"""
                        try:
                            from .chat.services.llm_service import LLMService

                            llm_service = LLMService()
                            workflow = ChatWorkflowSequential(llm_service, chat_dip_retriever, pinecone_client)

                            async for event in workflow.process_chat_streaming(
                                user_query=request.query,
                                systems_context=request.systems_context or [],
                                thread_id=request.thread_id,
                                conversation_summary=request.conversation_summary,
                                memory_context=request.memory_context,
                                synthesis_model=request.synthesis_model,
                                resolved_model_aliases=request.resolved_model_aliases or []
                            ):
                                event_type = event.pop("event")
                                yield f"event: {event_type}\ndata: {json.dumps(event)}\n\n"
                        except Exception as e:
                            logger.error(f"Stream error: {e}", exc_info=True)
                            yield f"event: error\ndata: {json.dumps({'error': str(e)})}\n\n"

                    return StreamingResponse(
                        stream_events(),
                        media_type="text/event-stream",
                        headers={
                            "Cache-Control": "no-cache",
                            "X-Accel-Buffering": "no",
                            "Connection": "keep-alive"
                        }
                    )

                # === NORMAL JSON RESPONSE (unchanged below) ===

                # === TIMING INSTRUMENTATION: Measure endpoint overhead ===
                import_start = datetime.now()

                # Initialize sequential workflow (LangGraph removed)
                from .chat.services.llm_service import LLMService
                # ChatWorkflowSequential imported at module level (line 806) for easier mocking
                from .chat.debug_logger import chat_debug

                import_duration = (datetime.now() - import_start).total_seconds() * 1000

                # Structured chat logging
                logger.info("Chat request received", extra={
                    'log_type': 'CHAT',
                    'details': {
                        'query': request.query[:100] + ('...' if len(request.query) > 100 else ''),
                        'thread_id': request.thread_id or 'new',
                        'systems_count': len(request.systems_context or [])
                    }
                })

                chat_debug.step('ENDPOINT_INIT', {
                    'endpoint': '/v1/chat/process',
                    'workflow_type': 'sequential',
                    'query': request.query[:100]
                })

                # === TIMING: LLMService initialization ===
                llm_init_start = datetime.now()
                llm_service = LLMService()
                llm_init_duration = (datetime.now() - llm_init_start).total_seconds() * 1000

                # === TIMING: Workflow initialization ===
                workflow_init_start = datetime.now()
                workflow = ChatWorkflowSequential(llm_service, chat_dip_retriever, pinecone_client)
                workflow_init_duration = (datetime.now() - workflow_init_start).total_seconds() * 1000

                logger.info(f"⏱️ ENDPOINT OVERHEAD: imports={import_duration:.0f}ms, LLMService_init={llm_init_duration:.0f}ms, workflow_init={workflow_init_duration:.0f}ms, total_overhead={(import_duration + llm_init_duration + workflow_init_duration):.0f}ms")

                # Process through sequential workflow with conversation memory
                chat_debug.step('WORKFLOW_START', {
                    'systems_count': len(request.systems_context or []),
                    'has_thread_id': bool(request.thread_id),
                    'has_conversation_summary': bool(request.conversation_summary),
                    'has_memory_context': bool(request.memory_context)
                })

                workflow_start = datetime.now()
                workflow_result = await workflow.process_chat(
                    user_query=request.query,
                    systems_context=request.systems_context or [],
                    thread_id=request.thread_id,
                    conversation_summary=request.conversation_summary,
                    memory_context=request.memory_context,
                    synthesis_model=request.synthesis_model,
                    resolved_model_aliases=request.resolved_model_aliases or []
                )
                workflow_duration = (datetime.now() - workflow_start).total_seconds() * 1000

                chat_debug.timing('WORKFLOW_COMPLETE', workflow_duration, {
                    'has_response': bool(workflow_result.get("response")),
                    'sources_count': len(workflow_result.get("sources", [])),
                    'has_score': bool(workflow_result.get("score"))
                })

                # Log workflow completion
                logger.info("Workflow complete", extra={
                    'log_type': 'RESPONSE',
                    'details': {
                        'duration_ms': f"{workflow_duration:.0f}ms",
                        'sources': len(workflow_result.get("sources", [])),
                        'score': workflow_result.get("score", 0.0)
                    }
                })

                thread_id = request.thread_id

                # === TIMING: Response building ===
                response_build_start = datetime.now()

                # Normalize classification to match schema
                classification = workflow_result.get("classification", {})
                if classification and "intent" in classification:
                    normalized_classification = {
                        "primary": classification.get("intent", "unknown"),
                        "confidence": classification.get("confidence", 0.0),
                        "table_types": classification.get("table_types", []),
                        "equipment_context": classification.get("equipment_context"),
                        "reasoning": classification.get("reasoning")
                    }
                else:
                    normalized_classification = classification

                # Calculate all timing
                response_build_duration = (datetime.now() - response_build_start).total_seconds() * 1000
                total_duration = (datetime.now() - start_time).total_seconds() * 1000
                total_overhead = import_duration + llm_init_duration + workflow_init_duration + response_build_duration

                # Log success with overhead breakdown
                logger.info("Chat request successful", extra={
                    'log_type': 'SUCCESS',
                    'details': {
                        'total_duration_ms': f"{total_duration:.0f}ms",
                        'response_length': len(workflow_result.get("response", "")),
                        'classification': normalized_classification.get('primary', 'unknown') if normalized_classification else 'unknown'
                    }
                })

                # === TIMING: Final overhead summary ===
                logger.info(f"⏱️ ENDPOINT TIMING SUMMARY: total={total_duration:.0f}ms, workflow={workflow_duration:.0f}ms, overhead={total_overhead:.0f}ms (imports={import_duration:.0f}ms, llm_init={llm_init_duration:.0f}ms, workflow_init={workflow_init_duration:.0f}ms, response_build={response_build_duration:.0f}ms)")

                # Inject overhead timing into detailed_metrics for dashboard visibility
                detailed_metrics = workflow_result.get("detailed_metrics") or {}
                if "timing_summary" not in detailed_metrics:
                    detailed_metrics["timing_summary"] = {}
                detailed_metrics["timing_summary"]["endpoint_overhead_ms"] = int(total_overhead)
                detailed_metrics["timing_summary"]["endpoint_breakdown"] = {
                    "imports_ms": int(import_duration),
                    "llm_init_ms": int(llm_init_duration),
                    "workflow_init_ms": int(workflow_init_duration),
                    "response_build_ms": int(response_build_duration)
                }

                return ChatResponse(
                    response=workflow_result["response"],
                    thread_id=thread_id,
                    sources=workflow_result.get("sources", []),
                    score=workflow_result.get("score"),
                    classification=normalized_classification,
                    processing_time_ms=workflow_result.get("processing_time_ms", 0),
                    metadata=workflow_result.get("metadata", {}),
                    detailed_metrics=detailed_metrics  # Now includes overhead timing
                )

            except Exception as e:
                from .chat.debug_logger import chat_debug
                chat_debug.error('ENDPOINT_ERROR', e, {
                    'query': request.query[:100],
                    'systems_count': len(request.systems_context or [])
                })

                # Structured error logging
                logger.error("Chat request failed", extra={
                    'log_type': 'ERROR',
                    'details': {
                        'error': str(e),
                        'query': request.query[:100],
                        'systems_count': len(request.systems_context or [])
                    }
                }, exc_info=True)

                raise HTTPException(status_code=500, detail=f"Chat processing failed: {str(e)}")

        @app.get("/v1/chat/health")
        async def chat_health():
            """Chat module health check"""
            try:
                # Test DIP retriever
                dip_health = chat_dip_retriever.health_check()

                # Include environment and connector information
                connector_type = "production" if isinstance(chat_dip_retriever, ProductionDIPRetriever) else "staging"

                return {
                    "status": "healthy",
                    "timestamp": datetime.now().isoformat(),
                    "environment": {
                        "dip_environment": dip_environment,
                        "connector_type": connector_type
                    },
                    "services": {
                        "workflow": "sequential (LangGraph removed)",
                        "dip_retriever": dip_health['status'],
                        "dip_connector": f"{connector_type} ({dip_health.get('service', 'Unknown')})",
                        "chat_module": "enabled"
                    }
                }
            except Exception as e:
                return {
                    "status": "unhealthy",
                    "timestamp": datetime.now().isoformat(),
                    "error": str(e)
                }

    except ImportError as e:
        logger.warning(f"Chat dependencies not available: {e}")

        @app.get("/v1/chat/health")
        async def chat_health_unavailable():
            return {
                "status": "unavailable",
                "timestamp": datetime.now().isoformat(),
                "error": "Chat dependencies not installed",
                "services": {"chat_module": "disabled"}
            }
else:
    logger.info("Chat module disabled (set CHAT_MODULE_ENABLED=true to enable)")

# ============================================================================
# VISION ANALYSIS ENDPOINTS (Stage 6-7)
# ============================================================================

@app.post("/v1/vision/analyze-pages", response_model=VisionAnalyzeResponse)
async def analyze_pages_with_vision(request: VisionAnalyzeRequest):
    """
    Stage 6: Analyze PDF pages using LlamaParse layout data (text-based detection).

    Replaces Claude Vision with deterministic text-based model detection:
    - Downloads llamaparse_raw.json from Storage
    - Scans headings and table cells for model mentions
    - Determines universal vs model-specific content
    - Filters figures by user's model selection
    - Outputs confidence levels and attribution warnings
    """
    import time

    start_time = time.time()
    analysis_paths = []
    warnings = []
    pages_skipped = 0

    # Universal section indicators
    UNIVERSAL_SECTIONS = [
        'SAFETY', 'TABLE OF CONTENTS', 'RECORD OF OWNERSHIP',
        'WARRANTY', 'DISCLAIMER', 'PRECAUTION', 'NOTICE'
    ]

    def find_models_in_text(text, all_models, all_referenced):
        """Find model numbers mentioned in text."""
        if not text:
            return [], []
        found_primary = []
        found_referenced = []
        text_upper = text.upper()
        for model in all_models:
            if re.search(rf'\b{re.escape(model.upper())}\b', text_upper):
                found_primary.append(model)
        for model in all_referenced:
            if re.search(rf'\b{re.escape(model.upper())}\b', text_upper):
                found_referenced.append(model)
        return found_primary, found_referenced

    def is_universal_section(text):
        """Check if text indicates a universal section."""
        if not text:
            return False
        text_upper = text.upper()
        return any(section in text_upper for section in UNIVERSAL_SECTIONS)

    def analyze_page_for_models(page_data, all_models, all_referenced, user_models):
        """
        Analyze a page to determine model applicability.
        Scans headings, body text, AND table cells.
        Returns confidence and attribution_warnings.

        Args:
            all_models: All primary models in the manual (models_covered)
            all_referenced: User's selected referenced systems
            user_models: User's selected primary models (for referenced-only pages)
        """
        items = page_data.get('items', [])
        all_primary = set()
        all_ref = set()
        headings = []
        attribution_warnings = []
        source_type = None  # Track where we found models

        # Scan all items including table cells
        for item in items:
            item_type = item.get('type', '')
            value = item.get('value', item.get('md', ''))

            primary, referenced = find_models_in_text(value, all_models, all_referenced)
            if primary:
                if item_type == 'heading' and not source_type:
                    source_type = 'heading'
                elif item_type == 'table' and source_type != 'heading':
                    source_type = 'table'
                    attribution_warnings.append('MODEL_FROM_TABLE_CELL')
                elif not source_type:
                    source_type = 'body'
            all_primary.update(primary)
            all_ref.update(referenced)

            if item_type == 'heading':
                headings.append(value)

            # Also scan table rows if present
            if item_type == 'table' and 'rows' in item:
                for row in item.get('rows', []):
                    for cell in row:
                        cell_text = cell.get('value', '') if isinstance(cell, dict) else str(cell)
                        p, r = find_models_in_text(cell_text, all_models, all_referenced)
                        if p and source_type != 'heading':
                            source_type = 'table'
                            if 'MODEL_FROM_TABLE_CELL' not in attribution_warnings:
                                attribution_warnings.append('MODEL_FROM_TABLE_CELL')
                        all_primary.update(p)
                        all_ref.update(r)

        all_primary = list(all_primary)
        all_ref = list(all_ref)

        # Determine confidence based on source
        if source_type == 'heading':
            confidence = 'high'
        elif source_type == 'table':
            confidence = 'medium'
        elif source_type == 'body':
            confidence = 'medium'
        else:
            confidence = 'low'

        # Check for universal indicators
        is_universal_by_section = any(is_universal_section(h) for h in headings)
        # Exact match required for "mentions all models"
        all_models_set = set(all_models) if isinstance(all_models, list) else all_models
        mentions_all_models = set(all_primary) == all_models_set
        mentions_some_models = len(all_primary) > 0 and not mentions_all_models
        no_models_mentioned = len(all_primary) == 0

        # Decision logic
        if mentions_some_models:
            return {
                'is_universal': False,
                'applies_to_models': all_primary,
                'referenced_systems': all_ref,
                'confidence': confidence,
                'attribution_warnings': attribution_warnings,
                'evidence': f"Specific models mentioned: {all_primary}"
            }
        elif mentions_all_models:
            return {
                'is_universal': True,
                'applies_to_models': all_models.copy() if isinstance(all_models, list) else list(all_models),
                'referenced_systems': all_ref,
                'confidence': 'high',
                'attribution_warnings': attribution_warnings,
                'evidence': f"All models mentioned: {all_primary}"
            }
        elif is_universal_by_section:
            return {
                'is_universal': True,
                'applies_to_models': all_models.copy() if isinstance(all_models, list) else list(all_models),
                'referenced_systems': all_ref,
                'confidence': 'high',
                'attribution_warnings': attribution_warnings,
                'evidence': f"Universal section: {headings[0] if headings else 'unknown'}"
            }
        elif no_models_mentioned:
            # B2: Check if referenced systems match user's selection before skipping
            matching_refs = set(all_ref) & set(all_referenced)
            if matching_refs:
                # Page is about a referenced system the user selected - KEEP
                # Use models_covered (doc-universal) not user selection for storage (Decision B2)
                attribution_warnings.append('APPLIES_TO_DEFAULTED_FROM_REFERENCED_ONLY_PAGE')
                attribution_warnings.append('MODEL_ATTRIBUTION_DEFAULTED')
                return {
                    'is_universal': True,
                    'applies_to_models': all_models.copy() if isinstance(all_models, list) else list(all_models),
                    'referenced_systems': list(matching_refs),
                    'confidence': 'medium',
                    'attribution_warnings': attribution_warnings,
                    'evidence': f"Referenced system page: {list(matching_refs)} (applies_to defaulted to models_covered)"
                }
            # No primary models AND no matching referenced systems
            # Decision A: Keep as doc-universal (applies to all models_covered)
            attribution_warnings.append('MODEL_ATTRIBUTION_DEFAULTED')
            attribution_warnings.append('MODEL_CONFIDENCE_LOW')
            return {
                'is_universal': True,
                'applies_to_models': all_models.copy() if isinstance(all_models, list) else list(all_models),
                'referenced_systems': all_ref,
                'confidence': 'low',
                'attribution_warnings': attribution_warnings,
                'evidence': "No models mentioned; defaulted to doc-universal (models_covered)"
            }
        else:
            return {
                'is_universal': True,
                'applies_to_models': all_models.copy() if isinstance(all_models, list) else list(all_models),
                'referenced_systems': all_ref,
                'confidence': 'low',
                'attribution_warnings': ['MODEL_ATTRIBUTION_DEFAULTED'],
                'evidence': "Fallback to universal"
            }

    def should_keep_for_user(model_info, user_models, user_referenced):
        """Decide if figure is relevant to user's selection."""
        # Note: unknown_attribution skip removed per Decision A - no-model pages
        # with diagrams are now kept as doc-universal
        if model_info['is_universal']:
            return True, "universal"
        for um in user_models:
            if um in model_info['applies_to_models']:
                return True, f"matches primary ({um})"
        matching_refs = set(user_referenced or []) & set(model_info['referenced_systems'])
        if matching_refs:
            return True, f"matches referenced ({list(matching_refs)})"
        return False, f"not relevant (page has {model_info['applies_to_models']})"

    def extract_figure_context(items: list, figure_index: int) -> tuple:
        """
        Extract title, description, figure_reference from LlamaParse items array.
        Correlates layout picture index with items array image elements.

        Returns: (title, description, figure_reference)
        """
        # Find all image items in order (these correspond to layout pictures)
        image_items = [(i, item) for i, item in enumerate(items)
                       if item.get('type') == 'image']

        if figure_index >= len(image_items):
            return None, None, None

        idx, image_item = image_items[figure_index]

        # figure_reference from alt attribute (e.g., "FIG. 3-8")
        figure_reference = image_item.get('alt')

        # title: look backwards for preceding heading (H2 or H3)
        title = None
        for i in range(idx - 1, -1, -1):
            prev_item = items[i]
            if prev_item.get('type') == 'heading':
                title = prev_item.get('value')
                break
            if prev_item.get('type') == 'image':
                break  # Stop at previous image

        # description: look forwards for legend/callout text (lines starting with -)
        description = None
        for i in range(idx + 1, len(items)):
            next_item = items[i]
            if next_item.get('type') == 'text':
                text = next_item.get('value', '').strip()
                # Check if it looks like a legend (bullet points or numbered list)
                if text.startswith('-') or text.startswith('•') or (len(text) > 0 and text[0].isdigit()):
                    description = text
                    break
            if next_item.get('type') in ('image', 'heading'):
                break  # Stop at next image or heading

        return title, description, figure_reference

    def find_related_elements(page_data, layout, picture_bbox):
        """
        Find elements spatially related to a picture (captions, parts lists).

        IMPORTANT: In LlamaParse JSON, the "legend / parts list" is often in pages[].items[]
        (with bBox in pixels), not in pages[].layout[]. If we only use layout[] we will
        systematically truncate the parts list when cropping.
        """
        pic_x = float(picture_bbox.get('x', 0) or 0)
        pic_y = float(picture_bbox.get('y', 0) or 0)
        pic_w = float(picture_bbox.get('w', 0) or 0)
        pic_h = float(picture_bbox.get('h', 0) or 0)
        pic_bottom = pic_y + pic_h
        pic_right = pic_x + pic_w

        page_w = float(page_data.get('width', 0) or 0)
        page_h = float(page_data.get('height', 0) or 0)

        CAPTION_RE = re.compile(r'^\s*(FIGURE|FIG\.)\s*\d+\b', re.IGNORECASE)
        LEGEND_RE = re.compile(r'^\s*\d+\s*(?:[–-]|:)\s*', re.IGNORECASE)
        PART_NUMBER_RE = re.compile(r'\bPART\s+NUMBER\b', re.IGNORECASE)
        FOOTER_RE = re.compile(r'\b(OPERATION\s+MANUAL|JH\s+SERIES|ALL\s+RIGHTS\s+RESERVED)\b', re.IGNORECASE)

        def _bbox_right(b): return float(b.get('x', 0) or 0) + float(b.get('w', 0) or 0)
        def _bbox_bottom(b): return float(b.get('y', 0) or 0) + float(b.get('h', 0) or 0)

        def _x_overlap_ratio(a, b):
            ax0 = float(a.get('x', 0) or 0)
            ax1 = _bbox_right(a)
            bx0 = float(b.get('x', 0) or 0)
            bx1 = _bbox_right(b)
            overlap = max(0.0, min(ax1, bx1) - max(ax0, bx0))
            denom = max(1e-6, min(float(a.get('w', 0) or 0), float(b.get('w', 0) or 0)))
            return overlap / denom

        def _likely_footer(text, bbox):
            if not text:
                return False
            t = str(text).strip()
            if not t:
                return False
            # Footers tend to live in the bottom margin and include boilerplate.
            if float(bbox.get('y', 0) or 0) > 0.92 and len(t) <= 80:
                return True
            if FOOTER_RE.search(t):
                return True
            return False

        def _classify_text(text):
            t = str(text or "").strip()
            if not t:
                return None
            if CAPTION_RE.search(t):
                return "caption"
            if LEGEND_RE.search(t) or PART_NUMBER_RE.search(t):
                return "legend"
            return None

        # Build candidate blocks from BOTH layout[] (normalized) and items[] (pixel bBox -> normalized).
        candidates = []
        for elem in (layout or []):
            label = elem.get('label', '')
            bbox = elem.get('bbox', {}) or {}
            if label in ('pageHeader', 'pageFooter'):
                continue
            if label == 'picture' and abs(float(bbox.get('y', 0) or 0) - pic_y) < 0.01:
                continue
            candidates.append({
                "source": "layout",
                "label": label,
                "bbox": {
                    "x": float(bbox.get('x', 0) or 0),
                    "y": float(bbox.get('y', 0) or 0),
                    "w": float(bbox.get('w', 0) or 0),
                    "h": float(bbox.get('h', 0) or 0),
                },
                "text": None,
            })

        if page_w > 0 and page_h > 0:
            for item in (page_data.get('items', []) or []):
                bb = item.get('bBox') or item.get('bbox') or {}
                if not isinstance(bb, dict):
                    continue
                if not all(k in bb for k in ('x', 'y', 'w', 'h')):
                    continue
                text = item.get('value', item.get('md', ''))
                # Normalize pixel bbox to 0-1
                nb = {
                    "x": float(bb.get('x', 0) or 0) / page_w,
                    "y": float(bb.get('y', 0) or 0) / page_h,
                    "w": float(bb.get('w', 0) or 0) / page_w,
                    "h": float(bb.get('h', 0) or 0) / page_h,
                }
                candidates.append({
                    "source": "item",
                    "label": item.get('type', 'text') or 'text',
                    "bbox": nb,
                    "text": text,
                })

        # Only consider candidates below picture and reasonably aligned in X.
        below = []
        for c in candidates:
            b = c["bbox"]
            if float(b.get('y', 0) or 0) < pic_bottom - 0.01:
                continue
            if _x_overlap_ratio(b, picture_bbox) < 0.20:
                continue
            if c.get("text") and _likely_footer(c.get("text"), b):
                continue
            below.append(c)

        below.sort(key=lambda c: (float(c["bbox"].get("y", 0) or 0), float(c["bbox"].get("x", 0) or 0)))

        min_x, min_y = pic_x, pic_y
        max_x, max_y = pic_right, pic_bottom
        related = []

        def _include(c):
            nonlocal min_x, max_x, max_y
            b = c["bbox"]
            related.append(c)
            min_x = min(min_x, float(b.get('x', 0) or 0))
            max_x = max(max_x, _bbox_right(b))
            max_y = max(max_y, _bbox_bottom(b))

        # Step 1: capture caption blocks immediately below the picture.
        anchor_bottom = pic_bottom
        for c in below:
            b = c["bbox"]
            dy = float(b.get('y', 0) or 0) - anchor_bottom
            if dy < -0.01:
                continue
            if dy > 0.12:
                break
            if c.get("label") == "caption" or _classify_text(c.get("text")) == "caption":
                _include(c)

        anchor_bottom = max(anchor_bottom, max_y)

        # Step 2: capture legend / parts list blocks that start below caption/picture and continue downward.
        started = False
        for c in below:
            b = c["bbox"]
            y0 = float(b.get('y', 0) or 0)
            if y0 < anchor_bottom - 0.01:
                continue
            gap = y0 - anchor_bottom

            label = c.get("label") or ""
            cls = _classify_text(c.get("text"))
            is_tableish = label in ("table", "form", "keyValueRegion")
            is_legendish = (cls == "legend") or is_tableish

            # Don't jump to unrelated blocks far away.
            if not started:
                if gap > 0.18:
                    break
                if not is_legendish:
                    continue
                started = True
                _include(c)
                anchor_bottom = max(anchor_bottom, _bbox_bottom(b))
                continue

            # Once started, keep chaining contiguous legend-ish blocks.
            if gap > 0.08:
                break
            if is_legendish:
                _include(c)
                anchor_bottom = max(anchor_bottom, _bbox_bottom(b))

        return {
            'x': min_x, 'y': min_y,
            'w': max(0.0, max_x - min_x),
            'h': max(0.0, max_y - min_y)
        }, related

    try:
        logger.info(f"LlamaParse-based analysis starting: doc_id={request.doc_id}, pages={request.pages}")

        if not request.selected_models:
            return VisionAnalyzeResponse(
                success=False,
                processing_time=time.time() - start_time,
                error="selected_models cannot be empty"
            )

        if not supabase:
            return VisionAnalyzeResponse(
                success=False,
                processing_time=time.time() - start_time,
                error="Supabase client not available"
            )

        # Download llamaparse_raw.json from Storage
        json_path = f"manuals/{request.doc_id}/llamaparse_raw.json"
        logger.debug(f"Downloading LlamaParse JSON from: {json_path}")

        try:
            json_response = supabase.storage.from_('documents').download(json_path)
            if not json_response:
                return VisionAnalyzeResponse(
                    success=False,
                    processing_time=time.time() - start_time,
                    error=f"llamaparse_raw.json not found at {json_path}"
                )
            llamaparse_data = json.loads(json_response.decode('utf-8'))
        except Exception as dl_err:
            return VisionAnalyzeResponse(
                success=False,
                processing_time=time.time() - start_time,
                error=f"Failed to download/parse llamaparse_raw.json: {dl_err}"
            )

        pages_data = llamaparse_data.get('pages', [])
        logger.info(f"Loaded {len(pages_data)} pages from llamaparse_raw.json")

        # Parse page range
        pages_to_analyze = _parse_page_range(request.pages)

        # models_covered is required - contains all primary models in the manual
        if not request.models_covered or len(request.models_covered) == 0:
            return VisionAnalyzeResponse(
                success=False,
                processing_time=time.time() - start_time,
                error="MODELS_COVERED_MISSING: Document is missing models_covered; rerun model detection before vision."
            )

        all_models = request.models_covered
        user_models = request.selected_models
        user_referenced = request.referenced_selections or []

        for page_data in pages_data:
            page_num = page_data.get('page', 0)

            # Skip if not in requested range
            if page_num not in pages_to_analyze:
                continue

            try:
                layout = page_data.get('layout', [])

                # Analyze page for model applicability
                model_info = analyze_page_for_models(page_data, all_models, user_referenced, user_models)

                # Find figures and tables in layout
                # Sort by y then x to match reading order (items array order)
                pictures = sorted(
                    [
                        elem for elem in layout
                        if elem.get('label') == 'picture'
                        and not elem.get('isLikelyNoise', False)
                        and elem.get('bbox', {}).get('h', 0) > 0.08
                    ],
                    key=lambda e: (e.get('bbox', {}).get('y', 0), e.get('bbox', {}).get('x', 0))
                )
                tables = [
                    elem for elem in layout
                    if elem.get('label') in ('table', 'form')
                    and not elem.get('isLikelyNoise', False)
                    and elem.get('bbox', {}).get('h', 0) > 0.05
                ]

                elements_to_process = pictures + tables

                if not elements_to_process:
                    logger.debug(f"Page {page_num}: No figures/tables found")
                    continue

                # Check if page is relevant to user
                keep, reason = should_keep_for_user(model_info, user_models, user_referenced)

                if not keep:
                    pages_skipped += 1
                    logger.info(f"Page {page_num}: SKIP - {reason}")
                    warnings.append({
                        'page_number': page_num,
                        'code': 'PAGE_SKIPPED_NOT_RELEVANT',
                        'reason': reason,
                        'models_on_page': model_info['applies_to_models']
                    })
                    continue

                logger.info(f"Page {page_num}: KEEP - {reason} ({len(pictures)} pictures, {len(tables)} tables)")

                # Build figures array for analysis result
                # Get items array for context extraction (title, description, figure_reference)
                items = page_data.get('items', [])

                figures = []
                for i, elem in enumerate(pictures):
                    elem_bbox = elem.get('bbox', {})
                    merged_bbox, related = find_related_elements(page_data, layout, elem_bbox)

                    # Extract context from LlamaParse items
                    title, description, figure_ref = extract_figure_context(items, i)

                    # Convert bbox from 0-1 to 0-100 percentage
                    # Note: 'type' field intentionally omitted - Stage 7 hardcodes asset_kind
                    # and uses element.get('type') for asset_type (specific subtype like 'exploded_view')
                    figures.append({
                        'id': f"fig_{page_num}_{i}",
                        'title': title,
                        'description': description,
                        'figure_reference': figure_ref,
                        'bbox': {
                            'x': merged_bbox['x'] * 100,
                            'y': merged_bbox['y'] * 100,
                            'width': merged_bbox['w'] * 100,
                            'height': merged_bbox['h'] * 100
                        },
                        'applies_to_models': model_info['applies_to_models'],
                        'referenced_systems': model_info['referenced_systems'],
                        'is_universal': model_info['is_universal'],
                        'confidence': model_info['confidence'],
                        'attribution_warnings': model_info['attribution_warnings'],
                        'related_elements': len(related)
                    })

                # Build tables array
                tables_out = []
                for i, elem in enumerate(tables):
                    elem_bbox = elem.get('bbox', {})
                    tables_out.append({
                        'id': f"tbl_{page_num}_{i}",
                        'title': None,
                        'description': None,
                        'figure_reference': None,
                        'bbox': {
                            'x': elem_bbox.get('x', 0) * 100,
                            'y': elem_bbox.get('y', 0) * 100,
                            'width': elem_bbox.get('w', 0) * 100,
                            'height': elem_bbox.get('h', 0) * 100
                        },
                        'applies_to_models': model_info['applies_to_models'],
                        'referenced_systems': model_info['referenced_systems'],
                        'is_universal': model_info['is_universal'],
                        'confidence': model_info['confidence'],
                        'attribution_warnings': model_info['attribution_warnings']
                    })

                # Build analysis result
                analysis_result = {
                    'figures': figures,
                    'tables': tables_out,
                    'model_info': model_info,
                    '_metadata': {
                        'page_number': page_num,
                        'doc_id': request.doc_id,
                        'selected_models': user_models,
                        'detection_method': 'llamaparse_text',
                        'input_tokens': 0,
                        'output_tokens': 0
                    }
                }

                # Save to Supabase Storage
                analysis_path = f"manuals/{request.doc_id}/vision/analysis/page_{page_num:04d}.json"
                analysis_json = json.dumps(analysis_result, indent=2)

                supabase.storage.from_('documents').upload(
                    analysis_path,
                    analysis_json.encode('utf-8'),
                    file_options={"content-type": "text/plain", "upsert": "true"}
                )

                analysis_paths.append(VisionAnalysisPath(
                    page_number=page_num,
                    analysis_path=analysis_path,
                    figures_found=len(figures),
                    tables_found=len(tables_out)
                ))

                logger.info(f"Page {page_num}: saved {len(figures)} figures, {len(tables_out)} tables")

            except Exception as page_error:
                logger.error(f"Failed to process page {page_num}: {page_error}")
                warnings.append({
                    'page_number': page_num,
                    'error': str(page_error),
                    'code': 'PAGE_ANALYSIS_FAILED'
                })

        if len(analysis_paths) == 0 and len(pages_to_analyze) > 0:
            return VisionAnalyzeResponse(
                success=False,
                pages_analyzed=0,
                pages_skipped=pages_skipped,
                warnings=warnings,
                processing_time=time.time() - start_time,
                error="TEXT_ANALYSIS_FAILED: No pages with figures found or all skipped"
            )

        logger.info(f"LlamaParse analysis complete: {len(analysis_paths)} pages with assets, {pages_skipped} skipped")

        return VisionAnalyzeResponse(
            success=True,
            pages_analyzed=len(analysis_paths),
            pages_skipped=pages_skipped,
            analysis_paths=analysis_paths,
            warnings=warnings,
            processing_time=time.time() - start_time
        )

    except Exception as e:
        logger.error(f"LlamaParse analysis failed: {e}", exc_info=True)
        return VisionAnalyzeResponse(
            success=False,
            pages_analyzed=len(analysis_paths),
            pages_skipped=pages_skipped,
            analysis_paths=analysis_paths,
            warnings=warnings,
            processing_time=time.time() - start_time,
            error=str(e)
        )


@app.post("/v1/vision/crop-figures", response_model=VisionCropResponse)
async def crop_figures_from_analysis(request: VisionCropRequest):
    """
    Stage 7: Crop figures and tables from PDF based on Vision analysis.

    - Re-renders pages referenced by analysis_paths
    - Crops figures/tables using bbox from analysis JSON
    - Uploads cropped images to Supabase Storage
    - Creates manifest.json
    """
    import time
    import io
    from PIL import Image

    start_time = time.time()
    assets = []
    warnings = []
    figures_cropped = 0
    tables_cropped = 0

    try:
        logger.info(f"Figure cropping starting: doc_id={request.doc_id}, pages={len(request.analysis_paths)}")

        if not supabase:
            return VisionCropResponse(
                success=False,
                processing_time=time.time() - start_time,
                error="Supabase client not available"
            )

        # Download PDF
        logger.debug(f"Downloading PDF from storage: {request.storage_path}")
        pdf_bytes = supabase.storage.from_('documents').download(request.storage_path)

        if not pdf_bytes:
            return VisionCropResponse(
                success=False,
                processing_time=time.time() - start_time,
                error=f"Failed to download PDF from {request.storage_path}"
            )

        import pypdfium2 as pdfium
        pdf = pdfium.PdfDocument(pdf_bytes)

        for analysis_info in request.analysis_paths:
            page_num = analysis_info.page_number
            analysis_path = analysis_info.analysis_path

            try:
                # Download analysis JSON
                analysis_bytes = supabase.storage.from_('documents').download(analysis_path)
                if not analysis_bytes:
                    warnings.append({
                        'page_number': page_num,
                        'error': f"Could not download {analysis_path}",
                        'code': 'ANALYSIS_DOWNLOAD_FAILED'
                    })
                    continue

                analysis = json.loads(analysis_bytes.decode('utf-8'))

                # Render page
                page = pdf[page_num - 1]
                scale = 150 / 72
                bitmap = page.render(scale=scale)
                pil_image = bitmap.to_pil()
                img_width, img_height = pil_image.size

                # Process figures
                for idx, figure in enumerate(_sort_elements_by_bbox(analysis.get('figures', []))):
                    try:
                        asset = await _crop_and_upload_element(
                            pil_image, img_width, img_height,
                            figure, idx, 'figure',
                            request.doc_id, page_num, analysis_path,
                            supabase
                        )
                        if asset:
                            assets.append(asset)
                            figures_cropped += 1
                    except Exception as crop_error:
                        warnings.append({
                            'page_number': page_num,
                            'asset_kind': 'figure',
                            'asset_index': idx,
                            'error': str(crop_error),
                            'code': 'CROP_FAILED'
                        })

                # Process tables
                for idx, table in enumerate(_sort_elements_by_bbox(analysis.get('tables', []))):
                    try:
                        asset = await _crop_and_upload_element(
                            pil_image, img_width, img_height,
                            table, idx, 'table',
                            request.doc_id, page_num, analysis_path,
                            supabase
                        )
                        if asset:
                            assets.append(asset)
                            tables_cropped += 1
                    except Exception as crop_error:
                        warnings.append({
                            'page_number': page_num,
                            'asset_kind': 'table',
                            'asset_index': idx,
                            'error': str(crop_error),
                            'code': 'CROP_FAILED'
                        })

            except Exception as page_error:
                logger.error(f"Failed to process page {page_num} for cropping: {page_error}")
                warnings.append({
                    'page_number': page_num,
                    'error': str(page_error),
                    'code': 'PAGE_CROP_FAILED'
                })

        pdf.close()

        # Generate search_blobs for all assets
        if assets:
            try:
                logger.info(f"Generating search_blobs for {len(assets)} assets...")
                # Download llamaparse_raw.json for snippet extraction
                llamaparse_path = f"manuals/{request.doc_id}/llamaparse_raw.json"
                llamaparse_bytes = supabase.storage.from_('documents').download(llamaparse_path)
                llamaparse_data = json.loads(llamaparse_bytes.decode('utf-8')) if llamaparse_bytes else {}

                assets = await _generate_search_blobs(assets, llamaparse_data, request.doc_id)
                blobs_generated = sum(1 for a in assets if a.search_blob)
                logger.info(f"Generated {blobs_generated} search_blobs")
            except Exception as blob_error:
                logger.warning(f"Search blob generation failed: {blob_error}")
                warnings.append({
                    'code': 'SEARCH_BLOB_GENERATION_FAILED',
                    'error': str(blob_error)
                })

        # Create manifest
        manifest_path = None
        try:
            manifest = {
                'doc_id': request.doc_id,
                'pages_analyzed': len(request.analysis_paths),
                'failed_pages': [w['page_number'] for w in warnings if w.get('code') == 'PAGE_CROP_FAILED'],
                'assets': [a.dict() for a in assets]
            }
            manifest_path = f"manuals/{request.doc_id}/vision/assets/manifest.json"
            supabase.storage.from_('documents').upload(
                manifest_path,
                json.dumps(manifest, indent=2).encode('utf-8'),
                file_options={"content-type": "text/plain", "upsert": "true"}
            )
        except Exception as manifest_error:
            logger.warning(f"Failed to create manifest: {manifest_error}")

        logger.info(f"Cropping complete: {figures_cropped} figures, {tables_cropped} tables")

        return VisionCropResponse(
            success=True,
            assets=assets,
            figures_cropped=figures_cropped,
            tables_cropped=tables_cropped,
            manifest_path=manifest_path,
            warnings=warnings,
            processing_time=time.time() - start_time
        )

    except Exception as e:
        logger.error(f"Figure cropping failed: {e}", exc_info=True)
        return VisionCropResponse(
            success=False,
            assets=assets,
            figures_cropped=figures_cropped,
            tables_cropped=tables_cropped,
            warnings=warnings,
            processing_time=time.time() - start_time,
            error=str(e)
        )


# ============================================================================
# VISION HELPER FUNCTIONS
# ============================================================================

def _parse_page_range(page_spec: str) -> list:
    """Parse page range like '1-10' or '1,5,10' into list of page numbers."""
    pages = set()
    for part in page_spec.split(','):
        part = part.strip()
        if '-' in part:
            start, end = part.split('-')
            pages.update(range(int(start), int(end) + 1))
        else:
            pages.add(int(part))
    return sorted(pages)


def _build_vision_prompt(context: str, model_context: str) -> str:
    """Build the Vision analysis prompt."""
    return f"""Analyze this page from a technical manual for TECHNICAL CONTENT ONLY.

Context: {context}
{model_context}

IMPORTANT: Only extract TECHNICAL diagrams and tables that would help someone operate, maintain, install, or troubleshoot the equipment.

SKIP these (do NOT include in output):
- Generic safety/warning icons (fire hazard, PPE, electrical shock symbols, etc.)
- Table of contents, indexes, chapter headers
- Logos, branding, decorative images
- Copyright notices, revision histories
- Generic instructional icons (hand gestures, arrows, etc.)

INCLUDE these:
- Equipment diagrams showing the actual product (engine, saildrive, etc.)
- Exploded views with part callouts
- Wiring diagrams and electrical schematics
- Installation diagrams showing how equipment connects
- Dimensional drawings with measurements
- Specification tables with technical data
- Parts lists with part numbers
- Troubleshooting tables
- Maintenance procedure diagrams
- Fluid flow diagrams, cooling system layouts

Return a JSON object with:

1. **figures**: Array of TECHNICAL diagrams only:
   - type: "exploded_view" | "wiring_diagram" | "schematic" | "photo" | "flowchart" | "installation_diagram" | "dimensional_drawing" | "comparison_chart" | "cutaway" | "system_layout" | "other"
   - title: Title or caption if visible (e.g., "Figure 2", "Engine Overview")
   - description: What the figure shows technically (1-2 sentences)
   - bbox: Bounding box as percentage of page {{x: 0-100, y: 0-100, width: 0-100, height: 0-100}}
     IMPORTANT: bbox must include ONLY these elements that belong to THIS figure:
       * The diagram/image itself
       * The title (e.g., "Figure 1", "Engine Overview")
       * Callout numbers/lines pointing to parts within the diagram
       * The legend/parts list that belongs to THIS figure
     DO NOT include in bbox:
       * Safety warning labels that happen to be on the same page
       * Other figures on the same page
       * Page headers/footers
       * Unrelated text or tables
   - figure_reference: Any reference number like "Figure 3.2"
   - applies_to_models: Which of the user's PRIMARY models this applies to (list, or ["all"] if universal)
   - referenced_systems: Which of the user's REFERENCED SYSTEMS appear in this figure (from the list above, or empty if none)

2. **tables**: Array of TECHNICAL tables only (skip TOC, indexes):
   - type: "parts_list" | "specifications" | "comparison" | "procedure_steps" | "troubleshooting" | "wiring" | "torque_specs" | "fluid_capacities" | "other"
   - title: Table title if visible
   - description: What technical data the table contains
   - bbox: Bounding box as percentage - include ONLY:
       * The table title/header
       * All column headers
       * All data rows
     DO NOT include unrelated content on the same page.
   - columns: List of column headers
   - applies_to_models: Which of the user's PRIMARY models this applies to
   - referenced_systems: Which of the user's REFERENCED SYSTEMS are mentioned

3. **page_metadata**:
   - page_number: If visible
   - primary_content: "diagram" | "table" | "text" | "mixed" | "specifications" | "skip" (use "skip" if page has no technical content)
   - models_mentioned: List of specific model numbers mentioned
   - systems_referenced: List of referenced systems mentioned

If the page has NO relevant technical content (only safety icons, TOC, etc.), return empty arrays for figures and tables.

Return ONLY valid JSON, no markdown code blocks."""


def _parse_vision_response(response_text: str) -> dict:
    """Parse Vision response, handling markdown code blocks."""
    text = response_text.strip()

    # Remove markdown code blocks
    if "```json" in text:
        json_start = text.find("```json") + 7
        json_end = text.find("```", json_start)
        text = text[json_start:json_end].strip()
    elif "```" in text:
        json_start = text.find("```") + 3
        json_end = text.find("```", json_start)
        text = text[json_start:json_end].strip()

    try:
        return json.loads(text)
    except json.JSONDecodeError as e:
        return {"parse_error": str(e), "raw_response": response_text, "figures": [], "tables": []}


async def _canonicalize_analysis(analysis: dict, selected_models: list, page_num: int, warnings: list) -> dict:
    """Canonicalize model tags in analysis result."""

    async def process_element(element: dict, element_type: str, idx: int):
        """Process applies_to_models and referenced_systems for an element."""
        raw_applies = element.get('applies_to_models', [])

        # Handle "all" sentinel or empty/missing
        if not raw_applies or raw_applies == ['all'] or raw_applies == 'all':
            element['applies_to_models'] = selected_models.copy()
            element['is_universal'] = True
            if raw_applies != ['all']:
                warnings.append({
                    'page_number': page_num,
                    'element_type': element_type,
                    'element_index': idx,
                    'issue': 'unknown_attribution',
                    'code': 'DEFAULTED_TO_UNIVERSAL'
                })
        else:
            # Canonicalize each model
            canonical_applies = []
            for model in raw_applies:
                canonical = await canonicalize_model(model)
                # Only include if in selected_models
                if canonical in selected_models:
                    canonical_applies.append(canonical)
                elif normalize_model_key(model) in [normalize_model_key(s) for s in selected_models]:
                    # Find the matching selected model
                    for s in selected_models:
                        if normalize_model_key(model) == normalize_model_key(s):
                            canonical_applies.append(s)
                            break

            if not canonical_applies:
                # None matched - default to universal
                element['applies_to_models'] = selected_models.copy()
                element['is_universal'] = True
                warnings.append({
                    'page_number': page_num,
                    'element_type': element_type,
                    'element_index': idx,
                    'issue': 'no_valid_models',
                    'raw_models': raw_applies,
                    'code': 'DEFAULTED_TO_UNIVERSAL'
                })
            else:
                element['applies_to_models'] = canonical_applies
                element['is_universal'] = (set(canonical_applies) == set(selected_models))

        # Canonicalize referenced_systems
        raw_refs = element.get('referenced_systems', [])
        if raw_refs:
            canonical_refs = []
            for ref in raw_refs:
                if ref:
                    canonical = await canonicalize_model(ref)
                    if canonical and canonical not in canonical_refs:
                        canonical_refs.append(canonical)
            element['referenced_systems'] = canonical_refs
        else:
            element['referenced_systems'] = []

        return element

    # Process figures
    for idx, fig in enumerate(analysis.get('figures', [])):
        analysis['figures'][idx] = await process_element(fig, 'figure', idx)

    # Process tables
    for idx, tbl in enumerate(analysis.get('tables', [])):
        analysis['tables'][idx] = await process_element(tbl, 'table', idx)

    return analysis


def _sort_elements_by_bbox(elements: list) -> list:
    """Sort elements by bbox: top-to-bottom, then left-to-right."""
    def sort_key(e):
        bbox = e.get('bbox', {})
        return (bbox.get('y', 0), bbox.get('x', 0))

    return sorted(elements, key=sort_key)


# Deterministic filtering/refinement defaults (tune after first real run)
_VISION_MIN_AREA_PCT = 0.005          # 0.5% of page area (icons tend to be smaller)
_VISION_MAX_AREA_PCT = 0.98           # near-full-page boxes are often wrong
_VISION_MIN_INK_RATIO = 0.01          # drop near-empty regions
_VISION_MAX_AREA_LOW_INK_RATIO = 0.02 # if huge bbox but mostly empty -> junk
# Refinement/crop tuning (conservative default; avoid ballooning into unrelated content)
_VISION_REFINE_PAD_RATIO_FIGURE = 0.08     # expand before refinement (figure)
_VISION_REFINE_PAD_RATIO_TABLE = 0.08      # expand before refinement (table)
_VISION_REFINE_MIN_CONTOUR_AREA_FIGURE = 0.0005  # of padded ROI area
_VISION_REFINE_MIN_CONTOUR_AREA_TABLE = 0.0005   # of padded ROI area
_VISION_REFINE_GUARD_PAD_RATIO_FIGURE = 0.02     # expand AFTER refinement (small safety)
_VISION_REFINE_GUARD_PAD_RATIO_TABLE = 0.02      # expand AFTER refinement (small safety)
_VISION_REFINE_MAX_EXPAND_FACTOR_FIGURE = 1.8    # cap refined bbox area vs original
_VISION_REFINE_MAX_EXPAND_FACTOR_TABLE = 1.6
_VISION_REFINE_MAX_AREA_PCT_FIGURE = 0.70        # if refinement balloons, fall back
_VISION_REFINE_MAX_AREA_PCT_TABLE = 0.85
_VISION_CROP_PAD_RATIO = 0.09         # crop-time padding safety margin (increased from 0.06 to capture headers)


def _is_valid_bbox_pct(bbox: dict) -> bool:
    try:
        x = float(bbox.get('x'))
        y = float(bbox.get('y'))
        w = float(bbox.get('width'))
        h = float(bbox.get('height'))
    except Exception:
        return False
    return (0 <= x <= 100) and (0 <= y <= 100) and (w > 0) and (h > 0) and (w <= 100) and (h <= 100)


def _bbox_area_pct(bbox: dict) -> float:
    # bbox is in percent coordinates; total page area is 100*100 = 10,000
    return (float(bbox.get('width', 0)) * float(bbox.get('height', 0))) / 10000.0


def _bbox_pct_to_px(bbox_pct: dict, img_width: int, img_height: int) -> tuple[int, int, int, int]:
    x0 = int(float(bbox_pct.get('x', 0)) / 100 * img_width)
    y0 = int(float(bbox_pct.get('y', 0)) / 100 * img_height)
    w = int(float(bbox_pct.get('width', 0)) / 100 * img_width)
    h = int(float(bbox_pct.get('height', 0)) / 100 * img_height)
    return (x0, y0, x0 + w, y0 + h)


def _bbox_px_to_pct(bbox_px: tuple[int, int, int, int], img_width: int, img_height: int) -> dict:
    x0, y0, x1, y1 = bbox_px
    x0 = max(0, min(int(x0), img_width))
    y0 = max(0, min(int(y0), img_height))
    x1 = max(0, min(int(x1), img_width))
    y1 = max(0, min(int(y1), img_height))
    w = max(0, x1 - x0)
    h = max(0, y1 - y0)
    return {
        'x': (x0 / img_width) * 100 if img_width else 0,
        'y': (y0 / img_height) * 100 if img_height else 0,
        'width': (w / img_width) * 100 if img_width else 0,
        'height': (h / img_height) * 100 if img_height else 0,
    }


def _pad_bbox_px(bbox_px: tuple[int, int, int, int], img_width: int, img_height: int, pad_ratio: float) -> tuple[int, int, int, int]:
    x0, y0, x1, y1 = bbox_px
    w = max(1, x1 - x0)
    h = max(1, y1 - y0)
    pad_x = int(w * pad_ratio)
    pad_y = int(h * pad_ratio)
    return (
        max(0, x0 - pad_x),
        max(0, y0 - pad_y),
        min(img_width, x1 + pad_x),
        min(img_height, y1 + pad_y),
    )


def _pad_bbox_pct(bbox_pct: dict, pad_ratio: float) -> dict:
    """Pad a percentage bbox by a ratio of its width/height (clamped to 0..100)."""
    try:
        x = float(bbox_pct.get('x', 0))
        y = float(bbox_pct.get('y', 0))
        w = float(bbox_pct.get('width', 0))
        h = float(bbox_pct.get('height', 0))
    except Exception:
        return bbox_pct

    if w <= 0 or h <= 0:
        return bbox_pct

    pad_x = w * pad_ratio
    pad_y = h * pad_ratio

    x2 = max(0.0, x - pad_x)
    y2 = max(0.0, y - pad_y)
    w2 = min(100.0 - x2, w + 2 * pad_x)
    h2 = min(100.0 - y2, h + 2 * pad_y)
    return {'x': x2, 'y': y2, 'width': w2, 'height': h2}

def _select_final_bbox_pct(original_bbox: dict, refined_bbox: dict, kind: str) -> tuple[dict, dict | None]:
    """
    Prevent refinement from ballooning into unrelated content.
    Returns (final_bbox, fallback_meta_or_None).
    """
    if not _is_valid_bbox_pct(original_bbox) or not _is_valid_bbox_pct(refined_bbox):
        return original_bbox if _is_valid_bbox_pct(original_bbox) else refined_bbox, {
            'code': 'BBOX_REFINEMENT_FALLBACK',
            'reason': 'invalid_bbox_input'
        }

    orig_area = _bbox_area_pct(original_bbox)
    ref_area = _bbox_area_pct(refined_bbox)

    max_factor = _VISION_REFINE_MAX_EXPAND_FACTOR_FIGURE if kind == 'figure' else _VISION_REFINE_MAX_EXPAND_FACTOR_TABLE
    max_area = _VISION_REFINE_MAX_AREA_PCT_FIGURE if kind == 'figure' else _VISION_REFINE_MAX_AREA_PCT_TABLE

    # If original is tiny, allow some growth but not uncontrolled.
    if orig_area > 0 and ref_area > orig_area * max_factor:
        return _pad_bbox_pct(original_bbox, _VISION_REFINE_GUARD_PAD_RATIO_FIGURE if kind == 'figure' else _VISION_REFINE_GUARD_PAD_RATIO_TABLE), {
            'code': 'BBOX_REFINEMENT_FALLBACK',
            'reason': f'expanded_too_much:{orig_area:.6f}->{ref_area:.6f}'
        }

    if ref_area > max_area:
        return _pad_bbox_pct(original_bbox, _VISION_REFINE_GUARD_PAD_RATIO_FIGURE if kind == 'figure' else _VISION_REFINE_GUARD_PAD_RATIO_TABLE), {
            'code': 'BBOX_REFINEMENT_FALLBACK',
            'reason': f'ref_area_too_large:{ref_area:.6f}'
        }

    return refined_bbox, None


def _try_import_cv2():
    try:
        import cv2  # type: ignore
        import numpy as np  # type: ignore
        return cv2, np
    except Exception:
        return None, None


def _ink_ratio(pil_image, bbox_pct: dict) -> float | None:
    """Return fraction of 'ink' pixels within bbox, or None if cv2 unavailable."""
    cv2, np = _try_import_cv2()
    if not cv2 or not np:
        return None

    img_width, img_height = pil_image.size
    x0, y0, x1, y1 = _bbox_pct_to_px(bbox_pct, img_width, img_height)
    x0, y0, x1, y1 = _pad_bbox_px((x0, y0, x1, y1), img_width, img_height, 0.0)
    if x1 <= x0 or y1 <= y0:
        return 0.0

    arr = np.array(pil_image.convert('RGB'))
    gray = cv2.cvtColor(arr, cv2.COLOR_RGB2GRAY)
    roi = gray[y0:y1, x0:x1]
    if roi.size == 0:
        return 0.0

    blur = cv2.GaussianBlur(roi, (3, 3), 0)
    _, th = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    return float((th > 0).mean())


def _refine_bbox_with_cv(pil_image, bbox_pct: dict, kind: str) -> tuple[dict, dict]:
    """Refine a percent bbox using OpenCV contours; returns (refined_bbox_pct, meta)."""
    cv2, np = _try_import_cv2()
    if not cv2 or not np:
        return bbox_pct, {'method': 'opencv_contours', 'refined': False, 'reason': 'cv2_unavailable'}

    img_width, img_height = pil_image.size
    x0, y0, x1, y1 = _bbox_pct_to_px(bbox_pct, img_width, img_height)

    pad_ratio = _VISION_REFINE_PAD_RATIO_FIGURE if kind == 'figure' else _VISION_REFINE_PAD_RATIO_TABLE
    min_contour_ratio = _VISION_REFINE_MIN_CONTOUR_AREA_FIGURE if kind == 'figure' else _VISION_REFINE_MIN_CONTOUR_AREA_TABLE
    x0, y0, x1, y1 = _pad_bbox_px((x0, y0, x1, y1), img_width, img_height, pad_ratio)
    if x1 <= x0 or y1 <= y0:
        return bbox_pct, {'method': 'opencv_contours', 'refined': False, 'reason': 'invalid_bbox_px'}

    arr = np.array(pil_image.convert('RGB'))
    gray = cv2.cvtColor(arr, cv2.COLOR_RGB2GRAY)
    roi = gray[y0:y1, x0:x1]
    if roi.size == 0:
        return bbox_pct, {'method': 'opencv_contours', 'refined': False, 'reason': 'empty_roi'}

    blur = cv2.GaussianBlur(roi, (3, 3), 0)
    _, th = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)

    # Mild morphology to reduce speckle without ballooning.
    th = cv2.morphologyEx(th, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3)), iterations=1)

    contours, _ = cv2.findContours(th, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    roi_area = max(1, int(th.shape[0] * th.shape[1]))
    min_contour_area = int(roi_area * min_contour_ratio)

    used = []
    for c in contours:
        area = cv2.contourArea(c)
        if area >= min_contour_area:
            used.append(c)

    meta = {
        'method': 'opencv_contours',
        'kind': kind,
        'pad_ratio': pad_ratio,
        'contours_total': int(len(contours)),
        'contours_used': int(len(used)),
        'min_contour_area_px': int(min_contour_area),
    }

    if not used:
        meta['refined'] = False
        meta['reason'] = 'no_contours'
        meta['ink_ratio'] = float((th > 0).mean()) if th.size else 0.0
        return bbox_pct, meta

    xs0, ys0, xs1, ys1 = [], [], [], []
    for c in used:
        x, y, w, h = cv2.boundingRect(c)
        xs0.append(x)
        ys0.append(y)
        xs1.append(x + w)
        ys1.append(y + h)

    rx0 = x0 + min(xs0)
    ry0 = y0 + min(ys0)
    rx1 = x0 + max(xs1)
    ry1 = y0 + max(ys1)

    refined_pct = _bbox_px_to_pct((rx0, ry0, rx1, ry1), img_width, img_height)
    meta['refined'] = True
    meta['ink_ratio'] = float((th > 0).mean()) if th.size else 0.0
    return refined_pct, meta


def _filter_and_refine_analysis(
    analysis: dict,
    pil_image,
    selected_models: list,
    referenced_selections: list,
    page_num: int,
) -> tuple[dict, list]:
    """Filter likely-junk elements and refine bboxes, returning (analysis, warnings)."""
    warnings = []

    def should_drop(element: dict, element_type: str) -> tuple[bool, str]:
        bbox = element.get('bbox', {})
        if not _is_valid_bbox_pct(bbox):
            return True, 'invalid_bbox'

        area_pct = _bbox_area_pct(bbox)
        if area_pct < _VISION_MIN_AREA_PCT:
            return True, f'too_small_area_pct:{area_pct:.6f}'

        ink = _ink_ratio(pil_image, bbox)
        if ink is not None and ink < _VISION_MIN_INK_RATIO:
            return True, f'low_ink_ratio:{ink:.6f}'

        if area_pct > _VISION_MAX_AREA_PCT:
            if ink is not None and ink < _VISION_MAX_AREA_LOW_INK_RATIO:
                return True, f'huge_bbox_low_ink:{area_pct:.6f}:{ink:.6f}'

        # No drop
        return False, ''

    def process_list(elements: list, element_type: str) -> list:
        kept = []
        for idx, el in enumerate(elements or []):
            drop, reason = should_drop(el, element_type)
            if drop:
                warnings.append({
                    'page_number': page_num,
                    'element_type': element_type,
                    'element_index': idx,
                    'code': 'FILTERED_OUT_AS_JUNK',
                    'reason': reason,
                })
                continue

            bbox = el.get('bbox', {})
            el['original_bbox'] = bbox
            refined_bbox, meta = _refine_bbox_with_cv(pil_image, bbox, element_type)
            guard = _VISION_REFINE_GUARD_PAD_RATIO_FIGURE if element_type == 'figure' else _VISION_REFINE_GUARD_PAD_RATIO_TABLE
            candidate_bbox = _pad_bbox_pct(refined_bbox, guard)
            final_bbox, fallback = _select_final_bbox_pct(bbox, candidate_bbox, element_type)
            el['bbox'] = final_bbox
            el['bbox_refinement'] = meta
            if fallback:
                warnings.append({
                    'page_number': page_num,
                    'element_type': element_type,
                    'element_index': idx,
                    **fallback
                })

            # Ensure required arrays are present for downstream consumers
            if 'applies_to_models' not in el or not el.get('applies_to_models'):
                el['applies_to_models'] = selected_models.copy()
                el['is_universal'] = True
                warnings.append({
                    'page_number': page_num,
                    'element_type': element_type,
                    'element_index': idx,
                    'code': 'DEFAULTED_TO_UNIVERSAL',
                    'issue': 'missing_applies_to_models_after_refine',
                })

            if 'referenced_systems' not in el or el.get('referenced_systems') is None:
                el['referenced_systems'] = []

            kept.append(el)
        return kept

    analysis['figures'] = process_list(analysis.get('figures', []), 'figure')
    analysis['tables'] = process_list(analysis.get('tables', []), 'table')

    return analysis, warnings


async def _crop_and_upload_element(
    pil_image, img_width: int, img_height: int,
    element: dict, idx: int, asset_kind: str,
    doc_id: str, page_num: int, analysis_path: str,
    storage_client
) -> VisionAsset:
    """Crop an element from the page image and upload to storage."""
    import io

    bbox = element.get('bbox', {})
    if not bbox:
        return None

    # Convert percentage bbox to pixels
    x = int(bbox.get('x', 0) / 100 * img_width)
    y = int(bbox.get('y', 0) / 100 * img_height)
    width = int(bbox.get('width', 0) / 100 * img_width)
    height = int(bbox.get('height', 0) / 100 * img_height)

    # Ensure bounds are valid (clamp to image dimensions)
    x = max(0, min(x, img_width))
    y = max(0, min(y, img_height))
    right = min(x + width, img_width)
    bottom = min(y + height, img_height)

    # Extra padding to reduce label/callout clipping (keeps bbox metadata unchanged)
    pad_x = int(max(1, (right - x) * _VISION_CROP_PAD_RATIO))
    pad_y = int(max(1, (bottom - y) * _VISION_CROP_PAD_RATIO))
    x = max(0, x - pad_x)
    y = max(0, y - pad_y)
    right = min(img_width, right + pad_x)
    bottom = min(img_height, bottom + pad_y)

    if right <= x or bottom <= y:
        return None

    # Crop using Vision's bbox (should include title, callouts, legend)
    cropped = pil_image.crop((x, y, right, bottom))

    # Save to buffer
    img_buffer = io.BytesIO()
    cropped.save(img_buffer, format='JPEG', quality=95)
    img_buffer.seek(0)

    # Upload to storage
    storage_path = f"manuals/{doc_id}/vision/assets/{asset_kind}/page_{page_num:04d}_{asset_kind}_{idx:02d}.jpg"

    storage_client.storage.from_('documents').upload(
        storage_path,
        img_buffer.read(),
        file_options={"content-type": "image/jpeg", "upsert": "true"}
    )

    # Build asset_json (full element payload)
    import time as time_module
    asset_json = {
        **element,
        'cropped_at': time_module.time(),
        'crop_dimensions': {'width': right - x, 'height': bottom - y},
        'crop_padding_ratio': _VISION_CROP_PAD_RATIO,
        'crop_bbox_px': {'x0': x, 'y0': y, 'x1': right, 'y1': bottom},
    }

    return VisionAsset(
        doc_id=doc_id,
        page_number=page_num,
        asset_kind=asset_kind,
        asset_index=idx,
        asset_type=element.get('type'),
        title=element.get('title'),
        description=element.get('description'),
        figure_reference=element.get('figure_reference'),
        bbox=bbox,
        storage_path=storage_path,
        analysis_path=analysis_path,
        applies_to_models=element.get('applies_to_models', []),
        referenced_systems=element.get('referenced_systems', []),
        is_universal=element.get('is_universal', False),
        asset_json=asset_json
    )


# ============================================================================
# SEARCH BLOB GENERATION (for asset searchability)
# ============================================================================

async def _generate_search_blobs(
    assets: List[VisionAsset],
    llamaparse_data: dict,
    doc_id: str
) -> List[VisionAsset]:
    """
    Generate search_blob for each asset using OpenAI gpt-4o-mini.

    Uses the surrounding text from llamaparse to create searchable descriptions.
    Uses AsyncOpenAI with parallel batches of 10 for speed.
    """
    import asyncio
    from openai import AsyncOpenAI

    openai_client = AsyncOpenAI(api_key=os.getenv('OPENAI_API_KEY'))
    pages_by_num = {p['page']: p for p in llamaparse_data.get('pages', [])}

    BATCH_SIZE = 10

    async def process_single_asset(asset: VisionAsset) -> VisionAsset:
        """Generate search_blob for a single asset."""
        try:
            page_data = pages_by_num.get(asset.page_number, {})
            snippet = _extract_snippet_for_asset(page_data, asset.asset_index, asset.asset_kind)

            prompt = f"""You are helping make a technical diagram searchable. Given the following information about a figure/diagram from a marine equipment manual, write a concise searchable description (100-150 words max).

Include:
- What type of diagram this is (wiring diagram, exploded view, installation diagram, parts list, schematic, etc.)
- Key components or parts shown
- What system or equipment it relates to
- Any part numbers or references visible
- What a technician might search for to find this diagram

ASSET INFO:
- Page: {asset.page_number}
- Type: {asset.asset_kind}
- Title: {asset.title or 'Unknown'}
- Figure Reference: {asset.figure_reference or 'None'}
- Existing Description: {asset.description or 'None'}

SURROUNDING TEXT FROM DOCUMENT:
{snippet or 'No surrounding text available'}

Write a natural, searchable description. Do not use bullet points. Do not repeat "this diagram shows" - just describe what it is."""

            response = await openai_client.chat.completions.create(
                model='gpt-4o-mini',
                messages=[{'role': 'user', 'content': prompt}],
                max_tokens=300,
                temperature=0.3
            )

            asset.search_blob = response.choices[0].message.content.strip() if response.choices else None

        except Exception as e:
            logger.warning(f"Failed to generate search_blob for page {asset.page_number} idx {asset.asset_index}: {e}")
            asset.search_blob = None

        return asset

    # Process in parallel batches of 10
    for i in range(0, len(assets), BATCH_SIZE):
        batch = assets[i:i + BATCH_SIZE]
        batch_num = (i // BATCH_SIZE) + 1
        total_batches = (len(assets) + BATCH_SIZE - 1) // BATCH_SIZE
        logger.info(f"Processing search_blob batch {batch_num}/{total_batches} ({len(batch)} assets)")
        await asyncio.gather(*[process_single_asset(a) for a in batch])

    return assets


def _extract_snippet_for_asset(page_data: dict, asset_index: int, asset_kind: str) -> str:
    """Extract surrounding text snippet for an asset from LlamaParse page data."""
    items = page_data.get('items', [])
    layout = page_data.get('layout', [])

    # Find layout elements of this kind
    layout_label = 'picture' if asset_kind == 'figure' else 'table'
    layout_elements = sorted(
        [el for el in layout if el.get('label') == layout_label and not el.get('isLikelyNoise')],
        key=lambda e: (e.get('bbox', {}).get('y', 0), e.get('bbox', {}).get('x', 0))
    )

    if asset_index >= len(layout_elements):
        return ''

    # Find image items (correlate with layout pictures for figures)
    image_items = [(i, item) for i, item in enumerate(items) if item.get('type') == 'image']

    snippet_parts = []

    if asset_kind == 'figure' and asset_index < len(image_items):
        image_idx, image_item = image_items[asset_index]

        # Get items before (up to 10, stop at previous image)
        for i in range(image_idx - 1, max(0, image_idx - 10) - 1, -1):
            item = items[i]
            if item.get('type') == 'image':
                break
            if item.get('type') == 'heading':
                snippet_parts.insert(0, f"[HEADING] {item.get('value', '')}")
                break
            if item.get('type') == 'text' and item.get('value', '').strip():
                snippet_parts.insert(0, f"[TEXT] {item.get('value', '').strip()}")

        # Add figure reference
        if image_item.get('alt'):
            snippet_parts.append(f"[FIGURE REF] {image_item.get('alt')}")

        # Get items after (up to 15, stop at next image or heading)
        for i in range(image_idx + 1, min(len(items), image_idx + 15)):
            item = items[i]
            if item.get('type') in ('image', 'heading'):
                break
            if item.get('type') == 'text' and item.get('value', '').strip():
                snippet_parts.append(f"[TEXT] {item.get('value', '').strip()}")
    else:
        # Fallback for tables or unmatched figures
        for item in items[:20]:
            if item.get('type') == 'heading':
                snippet_parts.append(f"[HEADING] {item.get('value', '')}")
            elif item.get('type') == 'text' and item.get('value', '').strip():
                snippet_parts.append(f"[TEXT] {item.get('value', '').strip()[:200]}")

    return '\n'.join(snippet_parts)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
