"""
Vector embeddings and storage integration.

Handles:
- OpenAI embedding generation for chunks
- Pinecone vector upsert with new metadata format
- Supabase backup storage
- Batch processing for efficiency
"""

import os
import logging
from typing import List, Dict, Any
from openai import OpenAI

from .models import Chunk, DocumentChunks

logger = logging.getLogger(__name__)


class EmbeddingService:
    """
    Service for generating embeddings and storing chunks.

    Integrates with:
    - OpenAI API for text-embedding-3-large (3,072 dimensions)
    - Pinecone for vector storage
    - Supabase for full chunk backup
    """

    def __init__(self, pinecone_client=None):
        """
        Initialize embedding service.

        Args:
            pinecone_client: Existing PineconeClient instance

        Note: Supabase storage uses HTTP REST API directly, no client needed.
        """
        # OpenAI client for embeddings
        api_key = os.getenv('OPENAI_API_KEY')
        if not api_key:
            raise ValueError("OPENAI_API_KEY not found in environment")
        self.openai_client = OpenAI(api_key=api_key)

        # External clients
        self.pinecone_client = pinecone_client

        logger.info("Initialized EmbeddingService")

    async def process_document_chunks(
        self,
        document_chunks: DocumentChunks
    ) -> Dict[str, Any]:
        """
        Process all chunks in a document.

        Generates embeddings and stores in Pinecone + Supabase.

        Args:
            document_chunks: DocumentChunks object with all chunks

        Returns:
            Dict with processing results
        """
        try:
            logger.info(
                f"Processing {document_chunks.total_chunks} chunks "
                f"for document {document_chunks.filename}"
            )

            # Generate embeddings for all chunks
            await self._generate_embeddings(document_chunks.chunks)

            # Store in Pinecone
            pinecone_result = await self._store_in_pinecone(document_chunks)

            # Store in Supabase
            supabase_result = await self._store_in_supabase(document_chunks)

            logger.info(
                f"Successfully processed document {document_chunks.filename}: "
                f"Pinecone={pinecone_result['success']}, "
                f"Supabase={supabase_result['success']}"
            )

            return {
                "success": True,
                "document_id": document_chunks.document_id,
                "total_chunks": document_chunks.total_chunks,
                "total_tokens": document_chunks.total_tokens,
                "pinecone_result": pinecone_result,
                "supabase_result": supabase_result,
                "statistics": document_chunks.get_statistics()
            }

        except Exception as e:
            logger.error(f"Failed to process document chunks: {e}")
            return {
                "success": False,
                "error": str(e)
            }

    async def _generate_embeddings(self, chunks: List[Chunk]) -> None:
        """
        Generate OpenAI embeddings for all chunks.

        Modifies chunks in-place to add dense_vector.
        Uses batch processing for efficiency.
        """
        try:
            # Batch size for OpenAI API (max 2048 per request)
            batch_size = 100

            for i in range(0, len(chunks), batch_size):
                batch = chunks[i:i + batch_size]
                texts = [chunk.content for chunk in batch]

                logger.debug(f"Generating embeddings for batch {i//batch_size + 1}")

                # Generate embeddings
                response = self.openai_client.embeddings.create(
                    model="text-embedding-3-large",
                    input=texts,
                    encoding_format="float"
                )

                # Assign embeddings to chunks
                for j, chunk in enumerate(batch):
                    chunk.dense_vector = response.data[j].embedding

            logger.info(f"Generated embeddings for {len(chunks)} chunks")

        except Exception as e:
            logger.error(f"Failed to generate embeddings: {e}")
            raise

    async def _store_in_pinecone(
        self,
        document_chunks: DocumentChunks
    ) -> Dict[str, Any]:
        """
        Store chunks in Pinecone with new metadata format.

        Uses existing PineconeClient.upsert_vectors() method.
        """
        try:
            if not self.pinecone_client:
                logger.warning("Pinecone client not available, skipping storage")
                return {
                    "success": True,
                    "simulated": True,
                    "upserted_count": 0
                }

            # Get vectors formatted for Pinecone
            vectors = document_chunks.get_pinecone_vectors()

            # Upsert using existing client method
            result = self.pinecone_client.upsert_vectors(vectors)

            logger.info(
                f"Stored {result.get('upserted_count', 0)} vectors in Pinecone"
            )

            return result

        except Exception as e:
            logger.error(f"Failed to store in Pinecone: {e}")
            return {
                "success": False,
                "error": str(e)
            }

    async def _store_in_supabase(
        self,
        document_chunks: DocumentChunks
    ) -> Dict[str, Any]:
        """
        Store full chunks in Supabase for backup and analytics.

        Stores content, metadata, and sparse vectors.
        Uses HTTP REST API instead of SDK to avoid compatibility issues.
        """
        import os
        import requests

        try:
            # Get Supabase credentials from environment
            supabase_url = os.getenv('SUPABASE_URL')
            supabase_key = os.getenv('PY_SUPABASE_SERVICE_KEY')

            if not supabase_url or not supabase_key:
                logger.warning("Supabase credentials not available, skipping storage")
                return {
                    "success": True,
                    "simulated": True,
                    "stored_count": 0
                }

            # Get records formatted for Supabase
            records = document_chunks.get_supabase_records()

            if not records:
                logger.warning("No chunks to store in Supabase")
                return {
                    "success": True,
                    "stored_count": 0
                }

            # Prepare HTTP request (matching legacy pattern)
            url = supabase_url.rstrip("/")
            headers = {
                "apikey": supabase_key,
                "Authorization": f"Bearer {supabase_key}",
                "Content-Type": "application/json",
                "Prefer": "resolution=merge-duplicates"
            }

            # Insert into document_chunks table via REST API
            response = requests.post(
                f"{url}/rest/v1/document_chunks",
                headers=headers,
                json=records
            )

            if response.status_code in [200, 201]:
                logger.info(f"Stored {len(records)} chunks in Supabase")
                return {
                    "success": True,
                    "stored_count": len(records)
                }
            else:
                logger.error(f"Failed to insert chunks: {response.status_code} {response.text}")
                return {
                    "success": False,
                    "error": f"HTTP {response.status_code}: {response.text}",
                    "stored_count": 0
                }

        except Exception as e:
            logger.error(f"Failed to store in Supabase: {e}")
            return {
                "success": False,
                "error": str(e),
                "stored_count": 0
            }


# Global service instance
_embedding_service: Any = None


def get_embedding_service(pinecone_client=None) -> EmbeddingService:
    """Get or create global embedding service instance."""
    global _embedding_service
    if _embedding_service is None:
        _embedding_service = EmbeddingService(
            pinecone_client=pinecone_client
        )
    return _embedding_service
