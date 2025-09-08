from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.responses import JSONResponse
import json
import logging
from typing import Optional, Dict, Any
import os
from pathlib import Path
from dotenv import load_dotenv

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
    DIPRequest, DIPResponse, DIPPacketRequest, DIPPacketResponse
)
from .pinecone_client import pinecone_client
from .dip_processor import DIPProcessor

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Create FastAPI app
app = FastAPI(
    title="PDF Parser Sidecar",
    description="PDF parsing and OCR service for document processing pipeline",
    version="1.0.0"
)

# Initialize parser and DIP processor
parser = PDFParser()
dip_processor = DIPProcessor()

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
        logger.info("Getting Pinecone index statistics")
        
        # Get stats from Pinecone client
        stats = pinecone_client.get_index_stats()
        
        if not stats["success"]:
            raise HTTPException(status_code=500, detail=stats["error"])
        
        logger.info(f"Retrieved Pinecone stats: {stats['total_vector_count']} total vectors")
        return JSONResponse(content=stats)
        
    except Exception as e:
        logger.error(f"Failed to get Pinecone stats: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/v1/pinecone/search")
async def search_pinecone(request: dict):
    """Search Pinecone vectors"""
    try:
        logger.info("Searching Pinecone vectors")
        
        # Parse request body properly
        query = request.get("query", "")
        top_k = request.get("topK", 10)
        namespace = request.get("namespace", "REIMAGINEDDOCS")
        filter_dict = request.get("filter", {})
        include_metadata = request.get("includeMetadata", True)
        include_values = request.get("includeValues", False)
        
        logger.info(f"Search params: query='{query}', top_k={top_k}, namespace='{namespace}'")
        
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
        
        logger.info(f"Search completed: {len(search_results['matches'])} results")
        return JSONResponse(content=search_results)
        
    except Exception as e:
        logger.error(f"Failed to search Pinecone: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/v1/parse", response_model=ParseResponse)
async def parse_pdf(
    file: UploadFile = File(...),
    extract_tables: bool = Form(True),
    ocr_enabled: bool = Form(True)
):
    """Parse PDF and extract text, tables, and metadata"""
    try:
        logger.info(f"Parsing PDF: {file.filename}")
        
        # Read file content
        content = await file.read()
        
        # Parse the PDF
        result = await parser.parse_pdf(
            content,
            extract_tables=extract_tables,
            ocr_enabled=ocr_enabled
        )
        
        logger.info(f"PDF parsed successfully: {file.filename}")
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
        logger.info(f"Parsing PDF from URL: {request.file_url}")
        
        # Parse the PDF from URL
        result = await parser.parse_pdf_from_url(
            request.file_url,
            extract_tables=request.extract_tables,
            ocr_enabled=request.ocr_enabled
        )
        
        logger.info(f"PDF parsed successfully from URL")
        return result
        
    except Exception as e:
        logger.error(f"Failed to parse PDF from URL: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/v1/embed", response_model=EmbeddingResponse)
async def generate_embedding(request: EmbeddingRequest):
    """Generate embedding for text"""
    try:
        logger.info("Generating embedding for text")
        
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
        logger.info(f"Upserting {len(request.vectors)} vectors to Pinecone")
        
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
        logger.info(f"Processing document for Pinecone: {file.filename}")
        
        # Parse metadata
        metadata = json.loads(doc_metadata)
        
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
        
        return {
            "success": pinecone_result["success"],
            "filename": file.filename,
            "chunks_processed": pinecone_result["chunks_processed"],
            "vectors_upserted": pinecone_result["vectors_upserted"],
            "namespace": pinecone_result["namespace"],
            "processing_time": pinecone_result["processing_time"],
            "error": pinecone_result.get("error")
        }
        
    except Exception as e:
        logger.error(f"Failed to process document for Pinecone: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/v1/dip", response_model=DIPResponse)
async def generate_dip(
    file: UploadFile = File(...),
    doc_id: str = Form(...),
    options: str = Form("{}")
):
    """Generate DIP (Document Intelligence Packet) from uploaded PDF"""
    try:
        logger.info(f"Generating DIP for document {doc_id}: {file.filename}")
        
        # Parse options
        try:
            dip_options = json.loads(options)
        except json.JSONDecodeError:
            dip_options = {}
        
        # Read file content
        content = await file.read()
        
        # Parse the PDF first
        parse_result = await parser.parse_pdf(
            content,
            extract_tables=True,
            ocr_enabled=True
        )
        
        if not parse_result.success:
            raise HTTPException(status_code=500, detail="Failed to parse PDF for DIP generation")
        
        # Process document for DIP
        dip_data = dip_processor.process_document(parse_result.elements, doc_id)
        
        logger.info(f"DIP generation completed for {doc_id}: "
                   f"{dip_data['entities_count']} entities, "
                   f"{dip_data['hints_count']} hints, "
                   f"{dip_data['tests_count']} tests")
        
        return DIPResponse(**dip_data)
        
    except Exception as e:
        logger.error(f"Failed to generate DIP: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/v1/runDocIntelligencePacket", response_model=DIPPacketResponse)
async def run_dip_packet(request: DIPPacketRequest):
    """Run complete DIP packet processing and save files"""
    try:
        logger.info(f"Running DIP packet processing for document {request.doc_id}")
        
        # Check if file exists
        file_path = Path(request.file_path)
        if not file_path.exists():
            raise HTTPException(status_code=404, detail=f"File not found: {request.file_path}")
        
        # Read file content
        with open(file_path, 'rb') as f:
            content = f.read()
        
        # Parse the PDF
        parse_result = await parser.parse_pdf(
            content,
            extract_tables=True,
            ocr_enabled=True
        )
        
        if not parse_result.success:
            raise HTTPException(status_code=500, detail="Failed to parse PDF for DIP packet")
        
        # Process document for DIP
        dip_data = dip_processor.process_document(parse_result.elements, request.doc_id)
        
        # Save DIP files
        output_files = dip_processor.save_dip_files(dip_data, request.output_dir)
        
        logger.info(f"DIP packet processing completed for {request.doc_id}")
        
        return DIPPacketResponse(
            success=True,
            doc_id=request.doc_id,
            output_files=output_files,
            entities_file=output_files['entities_file'],
            spec_hints_file=output_files['spec_hints_file'],
            golden_tests_file=output_files['golden_tests_file'],
            processing_time=dip_data['processing_time']
        )
        
    except Exception as e:
        logger.error(f"Failed to run DIP packet processing: {e}")
        return DIPPacketResponse(
            success=False,
            doc_id=request.doc_id,
            output_files={},
            entities_file="",
            spec_hints_file="",
            golden_tests_file="",
            processing_time=0.0,
            error=str(e)
        )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
