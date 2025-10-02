"""
Document processing pipeline.

Orchestrates the complete document chunking workflow:
1. Parse document with LlamaParse
2. Chunk with SemanticChunker
3. Generate embeddings
4. Store in Pinecone + Supabase

Uses LangGraph for workflow orchestration.
"""

import logging
import uuid
from typing import Dict, Any, Optional
from pathlib import Path

from .parser import get_parser
from .chunker import get_chunker
from .embeddings import get_embedding_service
from .models import DocumentChunks

logger = logging.getLogger(__name__)


class DocumentProcessor:
    """
    Enterprise document processing pipeline.

    Coordinates parsing, chunking, embedding, and storage.
    """

    def __init__(self, pinecone_client=None):
        """
        Initialize document processor.

        Args:
            pinecone_client: PineconeClient instance

        Note: Supabase storage uses HTTP REST API directly, no client needed.
        """
        self.parser = get_parser()
        self.chunker = get_chunker()
        self.embedding_service = get_embedding_service(
            pinecone_client=pinecone_client
        )

        logger.info("Initialized DocumentProcessor")

    async def process_document(
        self,
        file_path: str,
        filename: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Process a document through the complete pipeline.

        Args:
            file_path: Path to document file
            filename: Optional original filename
            metadata: Optional metadata (asset_uid, system_name, etc.)

        Returns:
            Dict with processing results:
                - success: bool
                - document_id: str
                - total_chunks: int
                - total_tokens: int
                - statistics: Dict
                - error: str (if failed)
        """
        # Use doc_id from metadata if available, otherwise generate new UUID
        document_id = (metadata or {}).get('doc_id') or str(uuid.uuid4())

        try:
            logger.info(f"Starting document processing: {filename or file_path}")

            # Step 1: Parse document with LlamaParse
            logger.info("Step 1: Parsing document...")
            parse_result = await self.parser.parse_document(
                file_path=file_path,
                filename=filename
            )

            if not parse_result['success']:
                return {
                    "success": False,
                    "error": f"Parsing failed: {parse_result.get('error')}",
                    "stage": "parsing"
                }

            logger.info(
                f"Parsed successfully: {len(parse_result['sections'])} sections, "
                f"{parse_result['metadata']['content_length']} chars"
            )

            # Step 2: Chunk document semantically
            logger.info("Step 2: Chunking document...")

            # Merge metadata
            doc_metadata = {
                **(metadata or {}),
                **parse_result['metadata'],
                'file_type': Path(file_path).suffix.lower()
            }

            document_chunks = self.chunker.chunk_document(
                markdown=parse_result['markdown'],
                sections=parse_result['sections'],
                document_id=document_id,
                filename=filename or parse_result['metadata']['filename'],
                metadata=doc_metadata
            )

            logger.info(
                f"Chunked successfully: {document_chunks.total_chunks} chunks, "
                f"{document_chunks.total_tokens} tokens"
            )

            # Step 3 & 4: Generate embeddings and store
            logger.info("Step 3-4: Generating embeddings and storing...")
            processing_result = await self.embedding_service.process_document_chunks(
                document_chunks
            )

            if not processing_result['success']:
                return {
                    "success": False,
                    "error": f"Embedding/storage failed: {processing_result.get('error')}",
                    "stage": "embedding",
                    "document_id": document_id,
                    "chunks_created": document_chunks.total_chunks
                }

            logger.info(
                f"Document processing complete: {filename} -> "
                f"{document_chunks.total_chunks} chunks, "
                f"{document_chunks.total_tokens} tokens"
            )

            return {
                "success": True,
                "document_id": document_id,
                "filename": filename or parse_result['metadata']['filename'],
                "total_chunks": document_chunks.total_chunks,
                "total_tokens": document_chunks.total_tokens,
                "statistics": document_chunks.get_statistics(),
                "pinecone_result": processing_result['pinecone_result'],
                "supabase_result": processing_result['supabase_result']
            }

        except Exception as e:
            logger.error(f"Document processing failed: {e}", exc_info=True)
            return {
                "success": False,
                "error": str(e),
                "document_id": document_id
            }


# Global processor instance
_processor_instance: Optional[DocumentProcessor] = None


def get_processor(pinecone_client=None) -> DocumentProcessor:
    """Get or create global processor instance."""
    global _processor_instance
    if _processor_instance is None:
        _processor_instance = DocumentProcessor(
            pinecone_client=pinecone_client
        )
    return _processor_instance
