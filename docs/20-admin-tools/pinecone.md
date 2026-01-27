# Pinecone Admin

## Overview

Pinecone is the vector database storing document embeddings for semantic search. The admin UI allows viewing, editing, and managing vectors.

**Who uses it:** Administrators, developers
**Access:** `/public/pinecone-admin.html`

---

## Key Concepts

| Term | Definition |
|------|------------|
| **Vector** | Embedding representation of a text chunk |
| **Embedding** | 3072-dimensional float array (text-embedding-3-large) |
| **Metadata** | Associated data (doc_id, page, asset_uid, content) |
| **Score** | Similarity score (0-1, higher = more similar) |
| **Namespace** | Logical partition: `REIMAGINEDDOCS` |
| **Index** | Pinecone database: `reimaginedsv` |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Pinecone Admin UI                                              │
│  └── Search, view, delete vectors                               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Node.js Backend                                                │
│  ├── pinecone.router.js (public search)                         │
│  ├── pinecone-admin.route.js (admin ops)                        │
│  └── pinecone.repository.js (Pinecone client)                   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Python Sidecar                                                 │
│  └── pinecone_client.py (embedding + upsert)                    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Pinecone Cloud (AWS us-east-1)                                 │
│  └── Index: reimaginedsv                                        │
│  └── Namespace: REIMAGINEDDOCS                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Key Functions (pinecone_client.py)

### PineconeClient Initialization

```python
# python-sidecar/app/pinecone_client.py:11-24
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
```

### generate_embedding

```python
# python-sidecar/app/pinecone_client.py:26-57
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
```

### search_vectors

```python
# python-sidecar/app/pinecone_client.py:95-150
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
        return {"success": False, "error": str(e)}
```

### upsert_vectors

```python
# python-sidecar/app/pinecone_client.py:152-205
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
            # Handle both old format (vector) and new format (values)
            values = vector_data.get("values") or vector_data.get("vector")
            pinecone_vectors.append({
                "id": vector_data["id"],
                "values": values,
                "metadata": vector_data["metadata"]
            })

        # Log first vector's metadata for debugging
        if pinecone_vectors:
            logger.info(f"Upserting {len(pinecone_vectors)} vectors to Pinecone namespace={self.namespace}")
            logger.info(f"Sample metadata (first vector): {pinecone_vectors[0]['metadata']}")

        # Upsert to Pinecone
        self.index.upsert(
            vectors=pinecone_vectors,
            namespace=self.namespace
        )

        processing_time = time.time() - start_time
        logger.info(f"Successfully upserted {len(vectors)} vectors in {processing_time:.2f}s")

        return {
            "success": True,
            "upserted_count": len(vectors),
            "namespace": self.namespace,
            "processing_time": processing_time
        }

    except Exception as e:
        logger.error(f"Failed to upsert vectors: {e}")
        return {"success": False, "error": str(e), "processing_time": time.time() - start_time}
```

### delete_vectors

```python
# python-sidecar/app/pinecone_client.py:207-243
def delete_vectors(self, ids: List[str], namespace: str = None) -> Dict[str, Any]:
    """Delete vectors from Pinecone by IDs"""
    start_time = time.time()

    if not self.index:
        logger.warning("Pinecone not initialized, simulating delete")
        return {
            "success": True,
            "deleted_count": len(ids),
            "namespace": namespace or self.namespace,
            "simulated": True
        }

    try:
        # Delete vectors from Pinecone
        self.index.delete(
            ids=ids,
            namespace=namespace or self.namespace
        )

        processing_time = time.time() - start_time

        return {
            "success": True,
            "deleted_count": len(ids),
            "namespace": namespace or self.namespace,
            "processing_time": processing_time
        }

    except Exception as e:
        logger.error(f"Failed to delete vectors: {e}")
        return {"success": False, "error": str(e)}
```

### get_index_stats

```python
# python-sidecar/app/pinecone_client.py:59-93
def get_index_stats(self) -> Dict[str, Any]:
    """Get Pinecone index statistics"""
    try:
        if not self.index:
            return {"success": False, "error": "Pinecone not initialized"}

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
        return {"success": False, "error": str(e)}
```

---

## Files & Locations

| Purpose | Path |
|---------|------|
| Admin UI | `src/public/pinecone-admin.html` |
| Router | `src/routes/pinecone.router.js` |
| Admin routes | `src/routes/admin/pinecone-admin.route.js` |
| Repository | `src/repositories/pinecone.repository.js` |
| **Python client** | `python-sidecar/app/pinecone_client.py` |

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/pinecone/search` | Semantic search |
| GET | `/admin/api/pinecone/stats` | Index statistics |
| POST | `/admin/api/pinecone/query` | Query vectors |
| POST | `/admin/api/pinecone/delete` | Delete vectors |
| POST | `/admin/api/pinecone/update-metadata` | Update metadata |

---

## Vector Metadata Schema

Each vector in Pinecone has metadata:

```json
{
  "doc_id": "sha256-hash-of-file",
  "asset_uid": "engine-yanmar-4jh57",
  "manufacturer": "Yanmar",
  "model": "4JH57",
  "page": 15,
  "chunk_index": 3,
  "chunk_type": "text",
  "chunk_id": "uuid",
  "content": "The oil filter should be changed every 250 hours..."
}
```

### Key Metadata Fields

| Field | Description |
|-------|-------------|
| `doc_id` | Source document SHA256 hash |
| `asset_uid` | Equipment this chunk relates to |
| `manufacturer` | Equipment manufacturer |
| `model` | Equipment model |
| `page` | Page number in PDF |
| `chunk_index` | Order within document |
| `chunk_type` | text/ocr/table |
| `content` | Actual text content |

---

## Index Configuration

| Setting | Value |
|---------|-------|
| Index Name | `reimaginedsv` (from PINECONE_INDEX) |
| Dimension | 3072 (text-embedding-3-large) |
| Metric | cosine |
| Cloud | AWS us-east-1 |
| Namespace | `REIMAGINEDDOCS` |

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PINECONE_API_KEY` | - | Pinecone API key |
| `PINECONE_INDEX` | `reimaginedsv` | Index name |
| `PINECONE_NAMESPACE` | `REIMAGINEDDOCS` | Namespace |

---

## How Chat Uses Pinecone

```
1. User asks: "How do I change the oil filter?"
     │
     ▼
2. Query classified, keywords extracted
     │  └── Keywords: "oil filter", "change"
     │
     ▼
3. search_vectors() called
     │  ├── Generate embedding for query
     │  ├── Search with filter: { asset_uid: "engine-yanmar-4jh57" }
     │  └── top_k: 20
     │
     ▼
4. Matches returned with scores
     │  └── [{ score: 0.87, metadata: { content: "Oil filter change..." } }]
     │
     ▼
5. Top chunks injected into LLM prompt
     └── AI generates response using retrieved context
```

See [Chat Data Flow](../10-user-features/chat.md#python-sidecar-steps-chat_workflow_sequentialpy)

---

## Testing

| Test File | What It Tests |
|-----------|---------------|
| `tests/integration/pinecone.test.js` | Pinecone API |

---

## What We DON'T Do

| Misconception | Reality |
|---------------|---------|
| "Pinecone stores documents" | **No.** Only vectors. PDFs in Supabase Storage. |
| "Update content in Pinecone" | **No.** Delete and re-embed to change content. |
| "Free to query unlimited" | **No.** Pinecone has query limits per plan. |
| "Uses ada-002" | **No.** Uses text-embedding-3-large (3072 dims). |
| "Can update metadata in place" | **Careful.** Better to delete + re-upsert. |

---

## Related Docs

- [Documents](./documents.md) - Document processing pipeline
- [Chat](../10-user-features/chat.md) - Uses Pinecone for RAG
- [Python Sidecar](../30-backend/python-sidecar.md) - Pinecone client
