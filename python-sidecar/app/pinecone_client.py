import os
import time
import uuid
from typing import List, Dict, Any
from pinecone import Pinecone
from openai import OpenAI
import logging

logger = logging.getLogger(__name__)

class PineconeClient:
    def __init__(self):
        self.openai_client = OpenAI(api_key=os.getenv('OPENAI_API_KEY'))
        self.pinecone_api_key = os.getenv('PINECONE_API_KEY')
        self.index_name = os.getenv('PINECONE_INDEX', 'reimaginedsv')
        self.namespace = os.getenv('PINECONE_NAMESPACE', 'REIMAGINEDDOCS')
        
        # Initialize Pinecone
        if self.pinecone_api_key:
            self.pinecone = Pinecone(api_key=self.pinecone_api_key)
            self.index = self.pinecone.Index(self.index_name)
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
    
    def get_index_stats(self) -> Dict[str, Any]:
        """Get Pinecone index statistics"""
        try:
            if not self.index:
                logger.warning("Pinecone not initialized, cannot get stats")
                return {
                    "success": False,
                    "error": "Pinecone not initialized"
                }
            
            # Get index statistics
            stats = self.index.describe_index_stats()
            
            # Convert namespaces to JSON-serializable format
            namespaces_dict = {}
            if stats.namespaces:
                for namespace_name, namespace_data in stats.namespaces.items():
                    namespaces_dict[namespace_name] = {
                        "vector_count": namespace_data.vector_count
                    }
            
            return {
                "success": True,
                "total_vector_count": stats.total_vector_count,
                "namespaces": namespaces_dict,
                "dimension": stats.dimension,
                "index_fullness": stats.index_fullness
            }
            
        except Exception as e:
            logger.error(f"Failed to get index stats: {e}")
            return {
                "success": False,
                "error": str(e)
            }

    def search_vectors(self, query: str, top_k: int = 10, namespace: str = None, 
                      filter_dict: Dict[str, Any] = None, include_metadata: bool = True, 
                      include_values: bool = False) -> Dict[str, Any]:
        """Search vectors in Pinecone"""
        try:
            if not self.index:
                logger.warning("Pinecone not initialized, simulating search")
                return {
                    "success": True,
                    "matches": [],
                    "namespace": namespace or self.namespace,
                    "simulated": True
                }
            
            # Generate embedding for query
            embedding_result = self.generate_embedding(query)
            if not embedding_result["success"]:
                return {
                    "success": False,
                    "error": f"Failed to generate embedding: {embedding_result['error']}"
                }
            
            # Search in Pinecone
            search_results = self.index.query(
                vector=embedding_result["vector"],
                top_k=top_k,
                namespace=namespace or self.namespace,
                filter=filter_dict,
                include_metadata=include_metadata,
                include_values=include_values
            )
            
            # Convert matches to JSON-serializable format
            matches = []
            for match in search_results.matches:
                match_dict = {
                    "id": match.id,
                    "score": match.score,
                    "metadata": match.metadata or {},
                    "values": match.values if include_values else None
                }
                matches.append(match_dict)
            
            return {
                "success": True,
                "matches": matches,
                "namespace": namespace or self.namespace,
                "query": query
            }
            
        except Exception as e:
            logger.error(f"Failed to search vectors: {e}")
            return {
                "success": False,
                "error": str(e)
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
