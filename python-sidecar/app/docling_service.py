"""
Docling PDF extraction service.

Provides CPU-based PDF-to-text/markdown extraction using Docling's DocumentConverter.
Called by Content MCP over HTTP to avoid needing Python/Docker on the Node service.

Reference: Content MCP/POC/scripts/docling_extract.py
"""

import json
import logging
import os
import tempfile
from typing import Any

logger = logging.getLogger("docling_service")

# ---------------------------------------------------------------------------
# Force CPU-only execution at module load (before any torch/docling import)
# ---------------------------------------------------------------------------
os.environ.setdefault("DOCLING_DEVICE", "cpu")
os.environ.setdefault("CUDA_VISIBLE_DEVICES", "")
os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")

# ---------------------------------------------------------------------------
# Lazy-loaded converter (heavy import, ~10-30s on first call)
# ---------------------------------------------------------------------------
_converter = None


def _get_converter():
    global _converter
    if _converter is None:
        logger.info("Loading Docling DocumentConverter (first request — this takes 10-30s)...")
        from docling.document_converter import DocumentConverter  # type: ignore
        _converter = DocumentConverter()
        logger.info("DocumentConverter ready.")
    return _converter


# ---------------------------------------------------------------------------
# Extraction helpers (ported from Content MCP POC docling_extract.py)
# ---------------------------------------------------------------------------

def _safe_jsonable(value: Any) -> Any:
    """Ensure value is JSON-serializable; fall back to str()."""
    try:
        json.dumps(value)
        return value
    except Exception:
        return str(value)


def _extract_docling_outputs(doc: Any) -> dict[str, Any]:
    """Best-effort extraction across docling API variations."""
    markdown = None
    text = None
    data = None

    for method in ("export_to_markdown", "to_markdown"):
        if hasattr(doc, method):
            try:
                markdown = getattr(doc, method)()
                break
            except Exception:
                pass

    for method in ("export_to_text", "to_text"):
        if hasattr(doc, method):
            try:
                text = getattr(doc, method)()
                break
            except Exception:
                pass

    for method in ("export_to_dict", "to_dict", "dict"):
        if hasattr(doc, method):
            try:
                val = getattr(doc, method)()
                data = _safe_jsonable(val)
                break
            except Exception:
                pass

    if markdown is None:
        markdown = ""
    if text is None:
        text = markdown if isinstance(markdown, str) else str(markdown)
    if data is None:
        data = {"repr": str(doc)}

    return {"markdown": markdown, "text": text, "data": data}


# ---------------------------------------------------------------------------
# Main extraction entry point
# ---------------------------------------------------------------------------

def extract_pdf(pdf_bytes: bytes, document_id: str | None = None) -> dict[str, Any]:
    """
    Convert PDF bytes to text, markdown, and raw JSON using Docling.

    Returns dict with keys: markdown, text, raw_json.
    Raises on failure.
    """
    label = document_id or "unknown"
    logger.info(f"[{label}] Starting Docling extraction ({len(pdf_bytes)} bytes)")

    converter = _get_converter()

    # Write PDF to temp file (DocumentConverter needs a file path)
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=True) as tmp:
        tmp.write(pdf_bytes)
        tmp.flush()

        result = converter.convert(tmp.name)

    doc = getattr(result, "document", result)
    extracted = _extract_docling_outputs(doc)

    markdown = extracted["markdown"] if isinstance(extracted["markdown"], str) else str(extracted["markdown"])
    text = extracted["text"] if isinstance(extracted["text"], str) else str(extracted["text"])

    if not text.strip():
        raise ValueError("Docling produced empty text output")

    logger.info(f"[{label}] Extraction complete: {len(text)} text chars, {len(markdown)} markdown chars")

    return {
        "markdown": markdown,
        "text": text,
        "raw_json": extracted["data"],
    }
