 1. DOCUMENT UPLOAD AND PROCESSING FLOW

  Synchronous Phase:

  1. Receive multipart form (ingest.route.js:38-122):
    - Parse multipart data with Busboy
    - Extract file buffer and metadata
  2. Validate metadata (ingest.route.js:84-100):
    - Require manufacturer and model
    - Normalize metadata fields
  3. Look up system in database (document.service.js:244-292):
    - Query systems table by manufacturer/model
    - Throw error if system not found
  4. Generate doc_id (document.service.js:235):
    - SHA256 hash if not provided
    - Deterministic ID generation
  5. Create job record (document.service.js:302-325):
    - Set job_type='DIP'
    - Status='queued'
  6. Create/update document record (document.service.js:334-352):
    - Store metadata in documents table
    - Link to asset_uid
  7. Upload to Supabase Storage (document.service.js:359):
    - Store at manuals/{docId}/
    - Get storage path
  8. Verify storage (document.service.js:369):
    - Retry logic with exponential backoff
    - Confirm file exists
  9. Return job_id (document.service.js:398-402):
    - Return immediately to client
    - Continue processing async

  Asynchronous Phase (processJob):

  10. Download from storage (document.service.js:458-470):
    - Retrieve file buffer
    - Prepare for processing
  11. Call Python sidecar (document.service.js:817):
    - POST to /v1/process-document
    - 20-minute timeout

  IF USE_SEMANTIC_CHUNKING=true:
    - Parse with LlamaParse (chunking/parser.py:76):
        - [LLM CALL] Vision-based parsing
      - Extract structured markdown
    - Semantic chunking (chunking/chunker.py:108):
        - Token-based: 400-1200 tokens
      - 200-token overlap
    - Generate embeddings (chunking/embeddings.py):
        - [LLM CALL] OpenAI embeddings API
      - text-embedding-3-large model

  IF USE_SEMANTIC_CHUNKING=false:
    - Parse with pdfplumber (parser.py:49):
        - Extract text and tables
      - OCR with Tesseract if needed
  12. Update system.manual flag (document.service.js:484):
    - Set to true for asset_uid
    - Non-critical update
  13. Extract colloquial keywords (document.service.js:510):
    - [LLM CALL] via colloquial-extraction.service.js
    - Natural language terms for equipment
    - Store in systems.colloquial_keywords
  14. Run DIP extraction (document.service.js:552):
    - Call dip_extraction_cached.py
    - [LLM CALL] Anthropic Claude via Python
    - Extract 4 types: specs, procedures, intent, golden
  15. Ingest DIP to database (document.service.js:597-605):
    - Store in 4 DIP tables
    - Both staging and production versions
  16. Update job status (document.service.js:611-614):
    - Mark as 'completed'
    - Update counters

  ---
  2. CHAT PROCESSING FLOW

  Backend Processing:

  1. Receive message (process.route.js:30-31):
    - Extract message and threadId
    - Set synthesis model (default: gpt-5)
  2. Get conversation context (chat-proxy.service.js:36):
    - Call getWeightedConversationContext()
    - Retrieve last 20 messages
    - Apply weighted recency (1.0, 0.8, 0.5, 0.2)
  3. Load thread equipment (chat-proxy.service.js:44-45):
    - Get equipment_context JSONB from thread
    - Previous equipment found in conversation
  4. Quick reference check (chat-proxy.service.js:73):
    - Check if query references "it", "this", "that"
    - Extract equipment from previous context
  5. Parallel equipment search (chat-proxy.service.js:189-207):
    - Path 1: Keyword search (searchSystems)
    - Path 2: [LLM CALL] extractEquipmentName()
        - Extract equipment mentions via LLM
    - Merge and deduplicate results
  6. Equipment relationship inference (chat-proxy.service.js:95-102):
    - [LLM CALL] via inferEquipmentRelationships()
    - If no equipment found directly
    - Infer related/connected systems
  7. Update thread equipment (chat-proxy.service.js:521-523):
    - Save to chat_threads.equipment_context
    - Persist for future queries
  8. Call Python sidecar (chat-proxy.service.js:565):
    - POST to /v1/chat/process
    - Pass all context

  Python Sidecar Processing:

  9. Step 1: Query Classification (chat_workflow_sequential.py:122-130):
    - [LLM CALL] via llm_service.classify_query()
    - Classify intent and complexity
    - Extract search keywords
  10. Step 2: Data Retrieval (chat_workflow_sequential.py:133-143):
    - Query DIP tables (chat_workflow_sequential.py:418-429):
        - Search 4 tables based on classification
      - Filter by equipment context
    - Pinecone search (chat_workflow_sequential.py:452-457):
        - Generate query embedding
      - Semantic search with topK=20
    - Rank chunks (chat_workflow_sequential.py:483-487):
        - [LLM CALL] via llm_service.rank_chunks()
      - Score relevance to query
  11. Step 3: Response Synthesis (chat_workflow_sequential.py:555-563):
    - [LLM CALL] via llm_service.synthesize_response()
    - Model: GPT-5 or GPT-4.1-mini
    - Include DIP data + Pinecone chunks
    - Generate natural language response
  12. Return to Node.js (chat-proxy.service.js:606-620):
    - Format response object
    - Include sources and metadata

  Frontend Post-Processing:

  13. Save user message (app.js:654):
    - POST to /chat/messages
    - Store with sequence number
  14. Save assistant message (app.js:672):
    - POST to /chat/messages
    - Include metadata and sources
  15. Update thread (messages.route.js:57):
    - Increment message count
    - Check for summary generation

  ---
  3. DOCUMENT DELETION FLOW

  1. Get deletion preview (document-deletion.route.js:43):
    - Call getDeletionPreview()
    - Count entries in all tables
  2. Receive deletion request (document-deletion.route.js:67):
    - Validate options and confirmation
    - Check docId matches
  3. Archive storage files (document-deletion.service.js:278-365):
    - Move to deleted/{asset_uid}-{timestamp}
    - Create metadata.json
  4. Delete Pinecone vectors (document-deletion.service.js:371-409):
    - Query vectors with doc_id filter
    - Delete all matching IDs
  5. Delete document chunks (document-deletion.service.js:161):
    - Remove from document_chunks table
    - Clear chunk counters
  6. Delete jobs (document-deletion.service.js:171):
    - Remove job records
    - Clear processing history
  7. Delete DIP entries (document-deletion.service.js:456-492):
    - Delete from 4 staging tables
    - Delete from 4 production tables
  8. Clear colloquial keywords (document-deletion.service.js:217-227):
    - Update systems table
    - Set colloquial_keywords=null
  9. Create audit record (document-deletion.service.js:246-253):
    - Store in document_deletions table
    - Record all actions taken
  10. Delete from documents table (document-deletion.service.js:256-263):
    - Final step (if selected)
    - Remove document record

  ---
  4. SYSTEM SEARCH FLOW

  1. Receive search query (systems.route.js:19):
    - Extract query parameter
    - Set limit (default: 10)
  2. Call search RPC (systems.repository.js:61):
    - Execute search_systems RPC
    - Full-text search on tsvector
  3. Transform results (systems.repository.js:91-115):
    - Add rank scores
    - Include asset_uid
    - Format response

  ---
  5. LOG STREAMING FLOW

  1. Open log stream (logs.route.js:16):
    - Create SSE connection
    - Set headers for streaming
  2. Read log files (logs.service.js:45-78):
    - Open file streams
    - Apply filters (level, source)
  3. Stream to client (logs.route.js:32-48):
    - Send as Server-Sent Events
    - Real-time updates
  4. Handle disconnection (logs.route.js:50-55):
    - Clean up streams
    - Close file handles

  ---
  6. MAINTENANCE QUEUE FLOW

  1. Get pending tasks (maintenance.route.js:29):
    - Query maintenance_tasks_queue
    - Filter by status='pending'
  2. Group by criticality (maintenance.service.js:31-45):
    - High, Medium, Low
    - Sort by confidence score
  3. Approve task (maintenance.route.js:89):
    - Update status='approved'
    - Add approval notes
    - Record approver
  4. Reject task (maintenance.route.js:113):
    - Update status='rejected'
    - Add rejection reason
    - Record reviewer

  ---
  LLM CALL SUMMARY:

  Document Upload (5-7 LLM calls):

  - LlamaParse - Vision-based PDF parsing
  - OpenAI Embeddings - Vector generation
  - Colloquial Extraction - Natural language keywords
  - DIP Extraction (4x) - Specs, procedures, intent, golden

  Chat Processing (4-6 LLM calls):

  - Equipment Extraction - Find equipment mentions
  - Equipment Inference - Find related systems (conditional)
  - Query Classification - Intent and complexity
  - Chunk Ranking - Relevance scoring
  - Response Synthesis - Generate answer

  Total LLM Providers Used:

  - OpenAI - Embeddings, chat, extraction
  - Anthropic Claude - DIP extraction
  - LlamaParse - Document parsing (LlamaIndex)