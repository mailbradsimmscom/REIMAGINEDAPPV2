from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import json
import logging
from typing import Optional, Dict, Any
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
    DIPRequest, DIPResponse, DIPPacketRequest, DIPPacketResponse, DIPGenerateRequest
)
from .pinecone_client import pinecone_client
from .dip_processor import DIPProcessor

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
supabase_key = os.getenv('SUPABASE_SERVICE_KEY') or os.getenv('SUPABASE_SERVICE_ROLE_KEY')
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
# CHAT ENDPOINTS - LangGraph Integration with DIP Tables
# ============================================================================

# Chat imports - only import if chat functionality is enabled
chat_enabled = os.getenv('CHAT_MODULE_ENABLED', 'false').lower() == 'true'

if chat_enabled:
    try:
        from .chat.chat_models import ChatRequest, ChatResponse, HealthResponse as ChatHealthResponse
        from .chat.services.dip_retriever import DIPRetriever
        from .chat.services.production_dip_retriever import ProductionDIPRetriever
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
        async def process_chat(request: ChatRequest):
            """
            Process chat query using LangGraph workflow with DIP integration
            """
            start_time = datetime.now()

            try:
                # Initialize sequential workflow (LangGraph removed)
                from .chat.services.llm_service import LLMService
                from .chat.workflows.chat_workflow_sequential import ChatWorkflowSequential
                from .chat.debug_logger import chat_debug

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

                llm_service = LLMService()
                workflow = ChatWorkflowSequential(llm_service, chat_dip_retriever, pinecone_client)

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
                    memory_context=request.memory_context
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

                # Log success
                total_duration = (datetime.now() - start_time).total_seconds() * 1000
                logger.info("Chat request successful", extra={
                    'log_type': 'SUCCESS',
                    'details': {
                        'total_duration_ms': f"{total_duration:.0f}ms",
                        'response_length': len(workflow_result.get("response", "")),
                        'classification': normalized_classification.get('primary', 'unknown') if normalized_classification else 'unknown'
                    }
                })

                return ChatResponse(
                    response=workflow_result["response"],
                    thread_id=thread_id,
                    sources=workflow_result.get("sources", []),
                    score=workflow_result.get("score"),
                    classification=normalized_classification,
                    processing_time_ms=workflow_result.get("processing_time_ms", 0),
                    metadata=workflow_result.get("metadata", {}),
                    detailed_metrics=workflow_result.get("detailed_metrics")  # Pass through metrics
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

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
