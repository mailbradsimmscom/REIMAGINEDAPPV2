import pdfplumber
import pytesseract
from PIL import Image
import io
import time
import logging
from typing import List, Dict, Any, Optional
import numpy as np

from .models import ParseResponse, PageElement, Table, TableCell, BoundingBox

def _to_bbox(b):
    # Accept BoundingBox | dict | (x0,y0,x1,y1) tuple/list
    if isinstance(b, BoundingBox):
        return b
    if isinstance(b, (list, tuple)) and len(b) == 4:
        x0, y0, x1, y1 = b
        return BoundingBox(x0=float(x0), y0=float(y0), x1=float(x1), y1=float(y1))
    if isinstance(b, dict):
        return BoundingBox(x0=float(b["x0"]), y0=float(b["y0"]), x1=float(b["x1"]), y1=float(b["y1"]))
    raise ValueError(f"Unsupported bbox format: {type(b)} -> {b}")

# Configuration constants
OCR_DPI = 300
OCR_MIN_CONF = 0.35
TEXT_MIN_LEN = 20
TEXT_MIN_ALNUM = 10

logger = logging.getLogger(__name__)

class PDFParser:
    def __init__(self):
        self.tesseract_available = self._check_tesseract()
    
    def _check_tesseract(self) -> bool:
        """Check if Tesseract is available"""
        try:
            pytesseract.get_tesseract_version()
            return True
        except Exception as e:
            logger.warning(f"Tesseract not available: {e}")
            return False
    
    async def parse_pdf(self, content: bytes, extract_tables: bool = True, ocr_enabled: bool = True) -> ParseResponse:
        """Parse PDF content and extract text, tables, and metadata"""
        start_time = time.time()
        
        try:
            # Open PDF with pdfplumber
            with pdfplumber.open(io.BytesIO(content)) as pdf:
                pages_total = len(pdf.pages)
                pages_parsed = 0
                pages_ocr = 0
                tables_found = 0
                elements = []
                tables = []
                
                # Process each page
                for page_num, page in enumerate(pdf.pages, 1):
                    logger.info(f"Processing page {page_num}/{pages_total}")
                    
                    # Check if page has text layer using proper detection
                    has_text_layer = bool(page.chars)
                    
                    logger.info(f"Processing page {page_num}/{pages_total} has_text_layer={has_text_layer}")
                    
                    if has_text_layer:
                        # Extract text elements
                        text_elements = self._extract_text_elements(page, page_num)
                        elements.extend(text_elements)
                        
                        # If text extraction failed (no elements), fall back to OCR
                        if not text_elements and ocr_enabled:
                            logger.info(f"Text extraction failed on page {page_num}, falling back to OCR")
                            ocr_elements = await self._extract_ocr_elements(page, page_num)
                            elements.extend(ocr_elements)
                            pages_ocr += 1
                        
                        # Extract tables if requested
                        if extract_tables:
                            page_tables = self._extract_tables(page, page_num)
                            tables.extend(page_tables)
                            tables_found += len(page_tables)
                        
                        pages_parsed += 1
                    else:
                        # No text layer, use OCR if enabled
                        if ocr_enabled and self.tesseract_available:
                            ocr_elements = await self._extract_ocr_elements(page, page_num)
                            elements.extend(ocr_elements)
                            pages_ocr += 1
                            pages_parsed += 1
                        else:
                            logger.warning(f"Page {page_num} no text layer and OCR disabled — skipped")
                
                # Calculate processing time
                processing_time = time.time() - start_time
                
                # Sanity check: ensure elements is a list (catch un-awaited coroutines)
                if not isinstance(elements, list):
                    raise Exception(f"Elements should be a list, got {type(elements)}. This indicates an un-awaited async function call.")
                
                # Create response
                response = ParseResponse(
                    success=True,
                    filename="document.pdf",
                    pages_total=pages_total,
                    pages_parsed=pages_parsed,
                    pages_ocr=pages_ocr,
                    tables_found=tables_found,
                    elements=elements,
                    tables=tables,
                    metadata={
                        "parser": "pdfplumber",
                        "ocr_available": self.tesseract_available,
                        "ocr_enabled": ocr_enabled,
                        "extract_tables": extract_tables
                    },
                    processing_time=processing_time
                )
                
                logger.info(f"PDF parsing completed: {pages_total} pages, {tables_found} tables, {len(elements)} elements")
                return response
                
        except Exception as e:
            logger.error(f"Failed to parse PDF: {e}")
            raise Exception(f"PDF parsing failed: {e}")
    
    async def parse_pdf_from_url(self, file_url: str, extract_tables: bool = True, ocr_enabled: bool = True) -> ParseResponse:
        """Parse PDF from URL"""
        import httpx
        
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(file_url)
                response.raise_for_status()
                content = response.content
                
                return await self.parse_pdf(content, extract_tables, ocr_enabled)
                
        except Exception as e:
            logger.error(f"Failed to fetch PDF from URL: {e}")
            raise Exception(f"Failed to fetch PDF from URL: {e}")
    
    def _extract_text_elements(self, page, page_num: int) -> List[PageElement]:
        """Extract text elements from page"""
        elements = []
        
        # Extract text using proper API
        text = (page.extract_text() or "").strip()
        
        # If text extraction failed, return empty list to trigger OCR fallback
        if not text:
            return []
        
        if text:
            element = PageElement(
                page=page_num,
                element_type='text',
                content=text,
                bbox=BoundingBox(
                    x0=0,
                    y0=0,
                    x1=page.width,
                    y1=page.height
                ),
                has_text_layer=True,
                ocr_used=False
            )
            elements.append(element)
            logger.info(f"Text layer extracted {len(text)} characters from page {page_num}")
        
        return elements
    
    def _extract_tables(self, page, page_num: int) -> List[Table]:
        """Extract tables from page"""
        tables = []
        
        # Extract tables using pdfplumber
        page_tables = page.extract_tables()
        
        for table_idx, table_data in enumerate(page_tables):
            if not table_data:
                continue
            
            # Get table bounding box and normalize it
            raw_table_bbox = page.find_tables()[table_idx].bbox if page.find_tables() else None
            table_bbox = _to_bbox(raw_table_bbox) if raw_table_bbox else BoundingBox(x0=0, y0=0, x1=100, y1=100)
            
            # Create table cells
            cells = []
            for row_idx, row in enumerate(table_data):
                for col_idx, cell_text in enumerate(row):
                    if cell_text and cell_text.strip():
                        # Estimate cell bbox (simplified)
                        cell_bbox = BoundingBox(
                            x0=col_idx * 100,  # Simplified
                            y0=row_idx * 50,   # Simplified
                            x1=(col_idx + 1) * 100,
                            y1=(row_idx + 1) * 50
                        )
                        
                        cell = TableCell(
                            text=cell_text.strip(),
                            bbox=cell_bbox,
                            row=row_idx,
                            col=col_idx
                        )
                        cells.append(cell)
            
            if cells:
                table = Table(
                    table_id=f"table_{page_num}_{table_idx}",
                    page=page_num,
                    bbox=table_bbox,
                    cells=cells,
                    rows=len(table_data),
                    cols=len(table_data[0]) if table_data else 0
                )
                tables.append(table)
        
        return tables
    
    async def _extract_ocr_elements(self, page, page_num: int) -> List[PageElement]:
        """Extract text using OCR with confidence checking"""
        elements = []
        
        try:
            # Convert page to image at higher DPI
            page_image = page.to_image(resolution=300)
            image = page_image.original
            
            # Perform OCR with better settings
            ocr_text = pytesseract.image_to_string(image, lang="eng", config="--psm 6")
            ocr_text = (ocr_text or "").strip()
            
            # Skip empty OCR results
            if not ocr_text:
                logger.warning(f"OCR produced empty text on page {page_num}")
                return []
            
            # Create OCR element with full page bbox
            element = PageElement(
                page=page_num,
                element_type='ocr',
                content=ocr_text,
                bbox=BoundingBox(
                    x0=0,
                    y0=0,
                    x1=page.width,
                    y1=page.height
                ),
                has_text_layer=False,
                ocr_used=True,
                confidence=0.8  # Default confidence
            )
            elements.append(element)
            
            logger.info(f"OCR completed for page {page_num}: {len(ocr_text)} characters")
            
        except Exception as e:
            logger.error(f"OCR failed for page {page_num}: {e}")
            # Don't create empty elements on OCR failure
            return []
        
        return elements
