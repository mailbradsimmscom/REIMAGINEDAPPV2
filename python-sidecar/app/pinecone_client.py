import os
import time
import uuid
from typing import List, Dict, Any
import pinecone
from openai import OpenAI
import logging

logger = logging.getLogger(__name__)

class PineconeClient:
    def __init__(self):
        self.openai_client = OpenAI(api_key=os.getenv('OPENAI_API_KEY'))
        self.pinecone_api_key = os.getenv('PINECONE_API_KEY')
        self.pinecone_environment = os.getenv('PINECONE_ENVIRONMENT', 'us-east-1-aws')
        self.index_name = os.getenv('PINECONE_INDEX', 'reimaginedsv')
        self.namespace = os.getenv('PINECONE_NAMESPACE', 'REIMAGINEDDOCS')
        
        # Initialize Pinecone
        if self.pinecone_api_key:
            pinecone.init(api_key=self.pinecone_api_key, environment=self.pinecone_environment)
            self.index = pinecone.Index(self.index_name)
        else:
            logger.warning("PINECONE_API_KEY not found, Pinecone operations will be simulated")
            self.index = None
    
    def generate_embedding(self, text: str, metadata: Dict[str, Any] = None) -> Dict[str, Any]:
        """Generate embedding for text using OpenAI"""
        start_time = time.time()
        
        try:
            # Generate embedding using OpenAI
            response = self.openai_client.embeddings.create(
                model="text-embedding-3-large",
                input=text,
                encoding_format="float"
            )
            
            embedding = response.data[0].embedding
            embedding_id = str(uuid.uuid4())
            
            processing_time = time.time() - start_time
            
            return {
                "success": True,
                "embedding_id": embedding_id,
                "vector": embedding,
                "metadata": metadata or {},
                "processing_time": processing_time
            }
            
        except Exception as e:
            logger.error(f"Failed to generate embedding: {e}")
            return {
                "success": False,
                "error": str(e),
                "processing_time": time.time() - start_time
            }
    
    def upsert_vectors(self, vectors: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Upsert vectors to Pinecone"""
        start_time = time.time()
        
        if not self.index:
            logger.warning("Pinecone not initialized, simulating upsert")
            return {
                "success": True,
                "upserted_count": len(vectors),
                "namespace": self.namespace,
                "processing_time": time.time() - start_time,
                "simulated": True
            }
        
        try:
            # Prepare vectors for Pinecone
            pinecone_vectors = []
            for vector_data in vectors:
                pinecone_vectors.append({
                    "id": vector_data["id"],
                    "values": vector_data["vector"],
                    "metadata": vector_data["metadata"]
                })
            
            # Upsert to Pinecone
            self.index.upsert(
                vectors=pinecone_vectors,
                namespace=self.namespace
            )
            
            processing_time = time.time() - start_time
            
            return {
                "success": True,
                "upserted_count": len(vectors),
                "namespace": self.namespace,
                "processing_time": processing_time
            }
            
        except Exception as e:
            logger.error(f"Failed to upsert vectors: {e}")
            return {
                "success": False,
                "error": str(e),
                "processing_time": time.time() - start_time
            }
    
    def process_document_chunks(self, chunks: List[Dict[str, Any]], doc_metadata: Dict[str, Any]) -> Dict[str, Any]:
        """Process document chunks and store in Pinecone"""
        start_time = time.time()
        
        try:
            vectors = []
            
            for i, chunk in enumerate(chunks):
                # Generate embedding for chunk text
                embedding_result = self.generate_embedding(
                    text=chunk["content"],
                    metadata={
                        **doc_metadata,
                        "chunk_index": i,
                        "chunk_type": chunk.get("type", "text"),
                        "page": chunk.get("page", 0),
                        "chunk_id": chunk.get("id", str(uuid.uuid4()))
                    }
                )
                
                if embedding_result["success"]:
                    vectors.append({
                        "id": embedding_result["embedding_id"],
                        "vector": embedding_result["vector"],
                        "metadata": embedding_result["metadata"]
                    })
            
            # Upsert all vectors
            upsert_result = self.upsert_vectors(vectors)
            
            processing_time = time.time() - start_time
            
            return {
                "success": upsert_result["success"],
                "chunks_processed": len(chunks),
                "vectors_upserted": len(vectors),
                "namespace": self.namespace,
                "processing_time": processing_time,
                "error": upsert_result.get("error")
            }
            
        except Exception as e:
            logger.error(f"Failed to process document chunks: {e}")
            return {
                "success": False,
                "error": str(e),
                "processing_time": time.time() - start_time
            }

# Global instance
pinecone_client = PineconeClient()
