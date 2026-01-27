# Documents

## Overview

Documents are technical manuals (PDFs) that provide the knowledge base for AI chat. Documents are uploaded, chunked, and stored in Pinecone for semantic search.

**Who uses it:** Administrators
**Access:** Upload (`/public/upload.html`), Library (`/public/documents.html`)

---

## User Flow

### Uploading a Document

```
┌─────────────────────────────────────────────────────────────────┐
│  1. Navigate to Upload page (/public/upload.html)               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  2. Select PDF + Enter Metadata                                 │
│     ├── manufacturer_norm (required)                            │
│     ├── model_norm (required)                                   │
│     └── System lookup validates equipment exists                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  3. Submit → createIngestJob() called                           │
│     ├── Generate doc_id from SHA256 hash                        │
│     ├── Look up system by manufacturer/model                    │
│     ├── Create job record (status: queued)                      │
│     └── Upload file to Supabase Storage                         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  4. Background Processing                                       │
│     ├── Parse PDF (Python sidecar)                              │
│     ├── Extract text + tables                                   │
│     ├── Chunk into sections                                     │
│     ├── Generate embeddings (text-embedding-3-large)            │
│     ├── Upsert to Pinecone                                      │
│     └── DIP extraction (structured data)                        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  5. Document ready for search                                   │
│     └── Status: ready                                           │
└─────────────────────────────────────────────────────────────────┘
```

---

## Key Concepts

| Term | Definition |
|------|------------|
| **Document** | Uploaded PDF file |
| **doc_id** | SHA256 hash of file content (deterministic) |
| **Chunk** | Section of document (~500-1000 tokens) |
| **Embedding** | 3072-dimensional vector (text-embedding-3-large) |
| **DIP** | Document Intelligence Processing - extracts structured data into 4 staging tables |
| **Staging Tables** | DIP output tables with approval workflow (pending → approved) |
| **asset_uid** | Equipment this document belongs to |
| **Namespace** | Pinecone partition: `REIMAGINEDDOCS` |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Upload UI (upload.html)                                        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Node.js Backend                                                │
│  ├── document.service.js (orchestration)                        │
│  ├── document.repository.js (Supabase)                          │
│  └── dip.ingest.service.js (DIP → staging tables)               │
└─────────────────────────────────────────────────────────────────┘
                              │
         ┌────────────────────┼────────────────────┐
         ↓                    ↓                    ↓
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│  Supabase       │  │  Python Sidecar │  │  Pinecone       │
│  Storage        │  │                 │  │                 │
│                 │  │  parser.py      │  │  vectors with   │
│  manuals/       │  │  pinecone_      │  │  metadata:      │
│  {docId}/       │  │  client.py      │  │  - doc_id       │
│  {filename}     │  │  dip_processor  │  │  - asset_uid    │
│                 │  │  .py            │  │  - page         │
└─────────────────┘  └─────────────────┘  └─────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Supabase Staging Tables (DIP Output)                           │
│  ├── staging_spec_suggestions   (specifications)                │
│  ├── staging_playbook_hints     (procedures)                    │
│  ├── staging_intent_router      (Q&A pairs)                     │
│  └── staging_golden_tests       (test cases)                    │
└─────────────────────────────────────────────────────────────────┘
```

---

## Key Functions

### Document Service (document.service.js)

**generateDocId** - Deterministic ID from file content:
```javascript
// src/services/document.service.js:64-66
generateDocId(fileBuffer) {
  return createHash('sha256').update(fileBuffer).digest('hex');
}
```

**uploadFile** - Upload to Supabase Storage:
```javascript
// src/services/document.service.js:69-127
async uploadFile(fileBuffer, fileName, docId) {
  const filePath = `manuals/${docId}/${fileName}`;

  const supabaseStorage = await this.getSupabaseStorage();
  const { data, error } = await supabaseStorage.storage
    .from('documents')
    .upload(filePath, fileBuffer, {
      contentType: 'application/pdf',
      upsert: false
    });

  if (error) {
    this.requestLogger.error('Supabase upload error', {
      error: error.message,
      code: error.code,
      docId,
      fileName
    });
    throw error;
  }

  return data.path;
}
```

**createIngestJob** - Main entry point for document upload:
```javascript
// src/services/document.service.js:206-400
async createIngestJob(fileBuffer, metadata, options = {}) {
  // 1. Generate doc_id if not provided
  const finalDocId = doc_id || this.generateDocId(fileBuffer);

  // 2. System metadata lookup - REQUIRED
  if (manufacturerNorm && modelNorm) {
    systemMetadata = await lookupSystemByManufacturerAndModel(manufacturerNorm, modelNorm);

    // Validate system exists
    const validationResult = systemMetadataSchema.safeParse(systemMetadata);
    if (!validationResult.success) {
      throw new Error('Invalid system metadata response from database');
    }
  } else {
    throw new Error('Manufacturer and model are required for document upload');
  }

  // 3. Create job record
  const jobData = {
    doc_id: finalDocId,
    job_type: 'DIP',
    status: 'queued',
    params: {
      ocr_enabled,
      dry_run,
      parser_version: '1.0.0',
      embed_model: 'text-embedding-3-large',
      namespace: 'REIMAGINEDDOCS'
    },
    counters: {
      pages_total: 0,
      pages_ocr: 0,
      tables: 0,
      chunks: 0,
      chunks_processed: 0,
      upserted: 0,
      skipped_duplicates: 0
    }
  };

  const job = await documentRepository.createJob(jobData);

  // 4. Upload file (synchronous)
  const storagePath = await this.uploadFile(fileBuffer, metadata.fileName, finalDocId);

  // 5. Verify file exists with retry (20 retries × 3s = 1 minute)
  await this.verifyFileInStorage(storagePath, job.job_id);

  // 6. Process job asynchronously (fire and forget)
  this.processJob(job.job_id).catch(error => {
    this.requestLogger.error('Background job processing failed', { jobId: job.job_id });
  });

  return { job_id: job.job_id, status: 'processing', doc_id: finalDocId };
}
```

### PDF Parser (parser.py)

**Configuration constants:**
```python
# python-sidecar/app/parser.py:24-28
OCR_DPI = 300
OCR_MIN_CONF = 0.35
TEXT_MIN_LEN = 20
TEXT_MIN_ALNUM = 10
```

**PDFParser class:**
```python
# python-sidecar/app/parser.py:31-127
class PDFParser:
    def __init__(self):
        self.tesseract_available = self._check_tesseract()

    async def parse_pdf(self, content: bytes, extract_tables: bool = True, ocr_enabled: bool = True) -> ParseResponse:
        """Parse PDF content and extract text, tables, and metadata"""

        with pdfplumber.open(io.BytesIO(content)) as pdf:
            pages_total = len(pdf.pages)
            elements = []
            tables = []

            for page_num, page in enumerate(pdf.pages, 1):
                # Check if page has text layer
                has_text_layer = bool(page.chars)

                if has_text_layer:
                    # Extract text elements
                    text_elements = self._extract_text_elements(page, page_num)
                    elements.extend(text_elements)

                    # If text extraction failed, fall back to OCR
                    if not text_elements and ocr_enabled:
                        ocr_elements = await self._extract_ocr_elements(page, page_num)
                        elements.extend(ocr_elements)

                    # Extract tables if requested
                    if extract_tables:
                        page_tables = self._extract_tables(page, page_num)
                        tables.extend(page_tables)
                else:
                    # No text layer, use OCR if enabled
                    if ocr_enabled and self.tesseract_available:
                        ocr_elements = await self._extract_ocr_elements(page, page_num)
                        elements.extend(ocr_elements)

            return ParseResponse(
                success=True,
                pages_total=pages_total,
                elements=elements,
                tables=tables,
                metadata={"parser": "pdfplumber", "ocr_enabled": ocr_enabled}
            )
```

**OCR extraction:**
```python
# python-sidecar/app/parser.py:224-266
async def _extract_ocr_elements(self, page, page_num: int) -> List[PageElement]:
    """Extract text using OCR with confidence checking"""

    # Convert page to image at higher DPI
    page_image = page.to_image(resolution=300)
    image = page_image.original

    # Perform OCR with Tesseract
    ocr_text = pytesseract.image_to_string(image, lang="eng", config="--psm 6")
    ocr_text = (ocr_text or "").strip()

    if not ocr_text:
        logger.warning(f"OCR produced empty text on page {page_num}")
        return []

    element = PageElement(
        page=page_num,
        element_type='ocr',
        content=ocr_text,
        has_text_layer=False,
        ocr_used=True,
        confidence=0.8
    )
    return [element]
```

### Pinecone Client (pinecone_client.py)

**generate_embedding:**
```python
# python-sidecar/app/pinecone_client.py:26-57
def generate_embedding(self, text: str, metadata: Dict[str, Any] = None) -> Dict[str, Any]:
    """Generate embedding for text using OpenAI"""
    response = self.openai_client.embeddings.create(
        model="text-embedding-3-large",
        input=text,
        encoding_format="float"
    )

    embedding = response.data[0].embedding
    embedding_id = str(uuid.uuid4())

    return {
        "success": True,
        "embedding_id": embedding_id,
        "vector": embedding,
        "metadata": metadata or {},
        "processing_time": processing_time
    }
```

**process_document_chunks:**
```python
# python-sidecar/app/pinecone_client.py:245-296
def process_document_chunks(self, chunks: List[Dict[str, Any]], doc_metadata: Dict[str, Any]) -> Dict[str, Any]:
    """Process document chunks and store in Pinecone"""
    vectors = []

    for i, chunk in enumerate(chunks):
        # Clean metadata - remove null values for Pinecone compatibility
        clean_doc_metadata = {k: v for k, v in doc_metadata.items() if v is not None}

        # Generate embedding for chunk text
        embedding_result = self.generate_embedding(
            text=chunk["content"],
            metadata={
                **clean_doc_metadata,
                "chunk_index": i,
                "chunk_type": chunk.get("type", "text"),
                "page": chunk.get("page", 0),
                "chunk_id": chunk.get("id", str(uuid.uuid4())),
                "content": chunk["content"]
            }
        )

        if embedding_result["success"]:
            vectors.append({
                "id": embedding_result["embedding_id"],
                "vector": embedding_result["vector"],
                "metadata": embedding_result["metadata"]
            })

    # Upsert all vectors to Pinecone
    upsert_result = self.upsert_vectors(vectors)

    return {
        "success": upsert_result["success"],
        "chunks_processed": len(chunks),
        "vectors_upserted": len(vectors),
        "namespace": self.namespace
    }
```

---

## Files & Locations

| Purpose | Path |
|---------|------|
| **Frontend** | |
| Upload page | `src/public/upload.html` |
| Document library | `src/public/documents.html` |
| **Node.js** | |
| Document routes | `src/routes/document/` |
| Document service | `src/services/document.service.js` |
| Deletion service | `src/services/document-deletion.service.js` |
| Document text | `src/services/document-text.service.js` |
| DIP orchestration | `src/services/dip.service.js` |
| DIP ingest to DB | `src/services/dip.ingest.service.js` |
| Anthropic extraction | `src/services/anthropic.extraction.service.js` |
| **Python** | |
| PDF parser | `python-sidecar/app/parser.py` |
| Pinecone client | `python-sidecar/app/pinecone_client.py` |
| DIP processor | `python-sidecar/app/dip_processor.py` |

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/document/upload` | Upload PDF |
| GET | `/document/list` | List documents |
| GET | `/document/:id` | Get document details |
| DELETE | `/document/:id` | Delete document |
| GET | `/document/:id/chunks` | Get document chunks |
| POST | `/admin/api/document-deletion/delete` | Delete with audit |

---

## Database Tables

### documents

| Column | Type | Description |
|--------|------|-------------|
| doc_id | text | **Primary key** (SHA256 hash) |
| manufacturer | text | Raw manufacturer name |
| manufacturer_norm | text | Normalized for matching |
| model | text | Raw model number |
| model_norm | text | Normalized for matching |
| asset_uid | text | FK to systems |
| system_norm | text | System category |
| subsystem_norm | text | Subsystem category |
| storage_path | text | Supabase Storage path |
| language | text | Document language (default: 'en') |
| last_ingest_version | text | Parser version |
| last_job_id | uuid | FK to jobs |
| created_at | timestamp | Upload time |
| updated_at | timestamp | Last update |

### jobs

Document processing job tracking.

| Column | Type | Description |
|--------|------|-------------|
| job_id | uuid | Primary key |
| doc_id | text | FK to documents |
| job_type | text | 'DIP' |
| status | text | queued/uploading/verifying/processing/complete/error |
| params | jsonb | Job parameters |
| counters | jsonb | Processing counters |
| created_at | timestamp | Job creation |
| updated_at | timestamp | Last update |

### DIP Staging Tables

DIP (Document Intelligence Processing) extracts structured data from documents into 4 staging tables. Data enters with `status: 'pending'` for review before approval.

#### staging_spec_suggestions

Extracted equipment specifications and parameters.

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| doc_id | text | FK to documents |
| manufacturer_norm | text | Normalized manufacturer |
| model_norm | text | Normalized model |
| asset_uid | text | FK to systems |
| parameter | text | Spec parameter name |
| normalized_parameter | text | Standardized parameter |
| value | text | Raw value |
| converted_value | numeric | Parsed numeric value |
| units | text | Raw units |
| normalized_units | text | Standardized units |
| category | text | Spec category |
| status | text | pending/approved/rejected |

#### staging_playbook_hints

Extracted procedures and maintenance steps.

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| doc_id | text | FK to documents |
| manufacturer_norm | text | Normalized manufacturer |
| model_norm | text | Normalized model |
| asset_uid | text | FK to systems |
| title | text | Procedure title |
| steps | jsonb | Array of step strings |
| expected_outcome | text | What should happen |
| preconditions | jsonb | Required conditions |
| error_codes | jsonb | Related error codes |
| status | text | pending/approved/rejected |

#### staging_intent_router

Extracted Q&A pairs for chat routing.

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| doc_id | text | FK to documents |
| manufacturer_norm | text | Normalized manufacturer |
| model_norm | text | Normalized model |
| asset_uid | text | FK to systems |
| question | text | User question |
| question_variations | jsonb | Alternative phrasings |
| answer | text | Expected answer |
| question_type | text | Category of question |
| status | text | pending/approved/rejected |

#### staging_golden_tests

Extracted test cases for validation.

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| doc_id | text | FK to documents |
| manufacturer_norm | text | Normalized manufacturer |
| model_norm | text | Normalized model |
| asset_uid | text | FK to systems |
| query | text | Test query |
| expected | text | Expected response |
| test_method | text | How to verify |
| failure_indication | text | What failure looks like |
| status | text | pending/approved/rejected |

---

## Processing Pipeline Detail

### Job Status Flow

```
queued → uploading → verifying → upload_complete → processing → complete
                                                       ↓
                                                    error
```

### Storage Path Convention

```
documents (bucket)
└── manuals/
    └── {doc_id}/              # SHA256 hash
        └── {original_filename}.pdf
```

### Embedding Configuration

| Setting | Value |
|---------|-------|
| Model | `text-embedding-3-large` |
| Dimensions | 3072 |
| Namespace | `REIMAGINEDDOCS` |
| Index | `reimaginedsv` (from PINECONE_INDEX) |

### System Flag Updates

After successful Pinecone vector upsert, the linked system's manual flags are automatically updated:

```javascript
// document.repository.js:updateSystemManualFlag()
{
  manual: true,           // Generic "has manual" flag
  Manual_Local_Copy: true // "Has local uploaded copy" flag
}
```

**Why two flags:**
- `manual` - Legacy flag, indicates system has a manual (may be URL or local)
- `Manual_Local_Copy` - Indicates a local PDF has been uploaded and processed

Both flags are set to `true` on successful upload. The Pipeline Funnel uses `Manual_Local_Copy` to detect data integrity issues (systems flagged but missing documents, or documents without flags).

---

## Batch Scripts

For bulk operations, use scripts in `scripts/bulk/`:

```bash
# Bulk upload PDFs with system lookup
node scripts/bulk/batch-upload-pdfs.js --dry-run

# Check for duplicate chunks
node scripts/bulk/check-duplicates.js

# Resync missing vectors
node scripts/bulk/resync-missing-vectors.js
```

See [Batch Scripts](../30-backend/batch-scripts.md)

---

## Testing

| Test File | What It Tests |
|-----------|---------------|
| `tests/integration/document.test.js` | Document API |

---

## What We DON'T Do

| Misconception | Reality |
|---------------|---------|
| "Documents stored in Pinecone" | **No.** Pinecone has vectors only. PDFs in Supabase Storage. |
| "One API call uploads and processes" | **No.** Upload is fast, processing is background. |
| "Can edit uploaded PDFs" | **No.** Delete and re-upload to change. |
| "doc_id is UUID" | **No.** SHA256 hash of file content. |
| "Can upload without system" | **No.** System must exist first. |

---

## Related Docs

- [Pinecone](./pinecone.md) - Vector storage
- [Systems](./systems.md) - Equipment linking
- [Batch Scripts](../30-backend/batch-scripts.md) - Bulk operations
- [Python Sidecar](../30-backend/python-sidecar.md) - Processing pipeline
