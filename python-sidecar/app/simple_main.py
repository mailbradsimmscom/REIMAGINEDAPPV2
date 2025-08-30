from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.responses import JSONResponse
import json
import logging
from typing import Optional, Dict, Any
import os

from parser import PDFParser
from models import ParseRequest, ParseResponse, HealthResponse, VersionResponse

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Create FastAPI app
app = FastAPI(
    title="PDF Parser Sidecar",
    description="PDF parsing and OCR service for document processing pipeline",
    version="1.0.0"
)

# Initialize parser
parser = PDFParser()

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

@app.post("/v1/process-document")
async def process_document_for_pinecone(
    file: UploadFile = File(...),
    doc_metadata: str = Form("{}"),
    extract_tables: bool = Form(True),
    ocr_enabled: bool = Form(True)
):
    """Parse PDF and simulate Pinecone storage"""
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
        
        # Prepare chunks for Pinecone (simulated)
        chunks = []
        for element in parse_result.elements:
            chunks.append({
                "id": f"{file.filename}_{element.page}_{len(chunks)}",
                "content": element.content,
                "type": element.element_type,
                "page": element.page
            })
        
        # Simulate Pinecone processing
        logger.info(f"Simulating Pinecone storage for {len(chunks)} chunks")
        
        return {
            "success": True,
            "filename": file.filename,
            "chunks_processed": len(chunks),
            "vectors_upserted": len(chunks),
            "namespace": "REIMAGINEDDOCS",
            "processing_time": 2.5,
            "simulated": True
        }
        
    except Exception as e:
        logger.error(f"Failed to process document for Pinecone: {e}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
