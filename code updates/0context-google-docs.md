REIMAGINEDAPPV2 Architecture Documentation - Google Docs Version

SYSTEM LANDSCAPE

REIMAGINEDAPPV2 Backend
Main Node.js application that handles web requests and orchestrates all backend operations
• Calls: Python Sidecar, Supabase, Pinecone, OpenAI APIs
• Routes: All /api/* endpoints, /admin/* endpoints
• Port: 3000, Environment: Production

Python Sidecar
Specialized microservice for document processing and LLM operations
• Calls: OpenAI API, Supabase database
• Routes: /process, /extract, /analyze
• Port: 8000, Framework: FastAPI

Supabase
PostgreSQL database that stores structured data and handles file storage
• Receives: User data, chat history, document metadata, DIP results
• Provides: Real-time subscriptions, file storage, authentication

Pinecone
Vector database that stores document embeddings for semantic search
• Receives: Document embeddings, search queries
• Provides: Similarity search, vector storage, metadata filtering

OpenAI
External API service that provides LLM capabilities for text generation and analysis
• Models: gpt-4, gpt-3.5-turbo, text-embedding-ada-002
• Endpoints: /v1/chat/completions, /v1/embeddings

NODE.JS CONTAINERS

API ROUTES LAYER (42 routes)

Chat Routes
GET /api/chat/sessions
Lists user chat sessions
• Calls: chat.repository.js → listChatSessions()
• Middleware: validateResponse, EnvelopeSchema
• Returns: Array of chat sessions with metadata

GET /api/chat/history
Retrieves chat message history for a thread
• Calls: chat.repository.js → getChatHistory()
• Parameters: threadId, limit, cursor
• Returns: Paginated chat messages

POST /api/chat/process
Processes user messages and generates responses
• Calls: chat-proxy.service.js → processUserMessage()
• Body: userQuery, options
• Returns: AI-generated response with metadata

Document Routes
POST /api/document/ingest
Ingests and processes documents
• Calls: document.service.js → createIngestJob()
• Body: file, metadata, options
• Returns: Job ID and processing status

GET /api/document/jobs/:jobId
Gets document processing job status
• Calls: document.repository.js → getJobStatus()
• Returns: Job status, progress, results

Admin Routes
GET /admin/dashboard
Returns admin dashboard overview
• Calls: systems.repository.js → listSystems()
• Middleware: adminOnly, validateResponse
• Returns: System metrics and status

GET /admin/health
System health check
• Calls: guards/index.js → getExternalServiceStatus()
• Returns: Service availability status

BUSINESS LOGIC LAYER (42 services)

Chat Services
chat-proxy.service.js
Main chat orchestration service
• processUserMessage(): Processes user messages through Python sidecar
• retrieveWithSpecBias(): Retrieves relevant context with specification bias
• listUserChats(): Lists user's chat conversations

Document Services
document.service.js
Document processing and management
• createIngestJob(): Creates document ingestion jobs
• getDocumentStatus(): Gets document processing status
• extractTextPreview(): Extracts text preview from documents

DIP Services
dip.service.js
Document Intelligence Pipeline processing
• runDIPPacket(): Runs DIP processing on documents
• checkDIPAvailability(): Checks if DIP processing is available
• Calls External: Python Sidecar /v1/runDocIntelligencePacket

LLM Services
llm.service.js
Language model operations
• enhanceQuery(): Enhances user queries for better retrieval
• summarizeConversation(): Summarizes chat conversations
• generateChatName(): Generates names for chat conversations
• synthesizeAnswer(): Synthesizes answers from retrieved context
• classifyQueryIntent(): Classifies user query intent
• generateAssetSummary(): Generates summaries for assets

DATA ACCESS LAYER (14 repositories)

Chat Repository
chat.repository.js
Chat data management
• listChatSessions(): Lists user chat sessions with pagination
• getChatHistory(): Retrieves chat message history
• createChatMessage(): Creates new chat messages
• createChatMessageWithSequence(): Creates messages with sequence numbers
• Tables: chat_sessions, chat_threads, chat_messages

Document Repository
document.repository.js
Document and job management
• updateJobStatusV2(): Updates job status with version 2 schema
• updateJobDIPSuccess(): Updates DIP processing success status
• createOrUpdateDocument(): Creates or updates document records
• getJobStatus(): Retrieves job processing status
• Tables: jobs, documents

Systems Repository
systems.repository.js
System asset management
• listSystems(): Lists system assets with pagination
• getSystemByAssetUid(): Retrieves system by asset UID
• Tables: systems, assets

MIDDLEWARE STACK (9 middleware)

admin.js
Admin-only access control
• adminOnly(): Validates admin authentication
• Checks: x-admin-token header

validate.js
Request validation
• validate(): Validates request body/query parameters
• Uses: Zod schemas

validateResponse.js
Response validation
• validateResponse(): Validates API responses
• Uses: Zod schemas

GUARDS SYSTEM

guards/index.js
External service availability checks
• isPineconeConfigured(): Checks Pinecone configuration
• isSupabaseConfigured(): Checks Supabase configuration
• isOpenAIConfigured(): Checks OpenAI configuration
• isSidecarConfigured(): Checks Python sidecar configuration
• getExternalServiceStatus(): Gets status of all external services

PYTHON CONTAINERS

Document Processors
dip_processor.py
Main document intelligence pipeline
• processDocument(): Processes documents through DIP pipeline
• extractStructuredData(): Extracts structured data from documents
• Calls External: OpenAI GPT-4 API
• Returns: Structured JSON, metadata, confidence scores

LLM Services
llm_service.py
Language model interface
• generateResponse(): Generates LLM responses
• createEmbeddings(): Creates text embeddings
• Calls External: OpenAI /v1/chat/completions, /v1/embeddings

Utilities
file_utils.py
File handling utilities
• validateFile(): Validates uploaded files
• extractText(): Extracts text from various file formats
• convertFormat(): Converts between file formats

FUNCTION DOCUMENTATION

CHAT FUNCTIONS

processUserMessage Function
File: services/chat-proxy.service.js
Purpose: Main entry point for processing user chat messages through Python sidecar
Parameters:
• userQuery: string - User's chat message
• options: object - Processing options (context, preferences, etc.)
Returns: {response: string, metadata: object, conversationId: string}
Calls External: Python Sidecar /chat/process endpoint
Called By: POST /api/chat/process
Error Handling: Returns structured error responses with error codes

listChatSessions Function
File: repositories/chat.repository.js
Purpose: Retrieves paginated list of user chat sessions
Parameters:
• userId: string - User identifier
• limit: number - Maximum number of sessions to return
• cursor: string - Pagination cursor
Returns: {sessions: Array, nextCursor: string, hasMore: boolean}
Database Queries:
• SELECT * FROM chat_sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?
Called By: GET /api/chat/sessions

getChatHistory Function
File: repositories/chat.repository.js
Purpose: Retrieves chat message history for a specific thread
Parameters:
• threadId: string - Chat thread identifier
• limit: number - Maximum messages to return
• cursor: string - Pagination cursor
Returns: {messages: Array, nextCursor: string, hasMore: boolean}
Database Queries:
• SELECT * FROM chat_messages WHERE thread_id = ? ORDER BY created_at DESC LIMIT ?
Called By: GET /api/chat/history

createChatMessage Function
File: repositories/chat.repository.js
Purpose: Creates a new chat message in the database
Parameters:
• threadId: string - Chat thread identifier
• role: string - Message role (user, assistant, system)
• content: string - Message content
• metadata: object - Additional message metadata
Returns: {messageId: string, createdAt: string}
Database Queries:
• INSERT INTO chat_messages (thread_id, role, content, metadata) VALUES (?, ?, ?, ?)
Called By: Chat processing services

createChatMessageWithSequence Function
File: repositories/chat.repository.js
Purpose: Creates chat messages with sequence numbers for ordered processing
Parameters:
• threadId: string - Chat thread identifier
• role: string - Message role
• content: string - Message content
• sequenceNumber: number - Message sequence number
• metadata: object - Additional metadata
Returns: {messageId: string, sequenceNumber: number}
Database Queries:
• INSERT INTO chat_messages (thread_id, role, content, sequence_number, metadata) VALUES (?, ?, ?, ?, ?)
Called By: Sequential chat processing workflows

DOCUMENT FUNCTIONS

createIngestJob Function
File: services/document.service.js
Purpose: Creates document ingestion jobs for processing
Parameters:
• fileBuffer: Buffer - Document file data
• metadata: object - Document metadata (name, type, size)
• options: object - Processing options
Returns: {jobId: string, status: string, estimatedTime: number}
Calls: document.repository.js → createJob()
Called By: POST /api/document/ingest

updateJobStatusV2 Function
File: repositories/document.repository.js
Purpose: Updates job status using version 2 schema
Parameters:
• jobId: string - Job identifier
• statusV2: object - New status object with version 2 format
Returns: {jobId: string, status: object, updatedAt: string}
Database Queries:
• UPDATE jobs SET status_v2 = ?, updated_at = NOW() WHERE job_id = ?
Called By: Document processing services

updateJobDIPSuccess Function
File: repositories/document.repository.js
Purpose: Updates DIP processing success status
Parameters:
• jobId: string - Job identifier
• dipSuccess: boolean - DIP processing success status
Returns: {jobId: string, dipSuccess: boolean, updatedAt: string}
Database Queries:
• UPDATE jobs SET dip_success = ?, updated_at = NOW() WHERE job_id = ?
Called By: DIP processing completion handlers

createOrUpdateDocument Function
File: repositories/document.repository.js
Purpose: Creates new documents or updates existing ones
Parameters:
• docData: object - Document data (id, name, type, metadata)
Returns: {documentId: string, createdAt: string, updatedAt: string}
Database Queries:
• INSERT INTO documents (...) VALUES (...) ON CONFLICT (id) DO UPDATE SET ...
Called By: Document ingestion workflows

DIP FUNCTIONS

runDIPPacket Function
File: services/dip.service.js
Purpose: Runs Document Intelligence Pipeline processing on documents
Parameters:
• docId: string - Document identifier
• filePath: string - Path to document file
• outputDir: string - Output directory for results
• options: object - Processing options
Returns: {success: boolean, outputFiles: object, processingTime: number}
Calls External: Python Sidecar /v1/runDocIntelligencePacket
Called By: Document processing workflows
Error Handling: Retries and fallback mechanisms

checkDIPAvailability Function
File: services/dip.service.js
Purpose: Checks if DIP processing service is available
Parameters: None
Returns: {available: boolean, version: string, health: object}
Calls External: Python Sidecar /health endpoint
Called By: System health checks and service guards

LLM FUNCTIONS

enhanceQuery Function
File: services/llm.service.js
Purpose: Enhances user queries for better retrieval and processing
Parameters:
• query: string - Original user query
• context: object - Additional context information
Returns: {enhancedQuery: string, confidence: number, suggestions: Array}
Calls External: OpenAI API
Called By: Chat and search processing

summarizeConversation Function
File: services/llm.service.js
Purpose: Summarizes chat conversations for better context management
Parameters:
• messages: Array - Array of chat messages
• maxLength: number - Maximum summary length
Returns: {summary: string, keyPoints: Array, sentiment: string}
Calls External: OpenAI API
Called By: Chat history management

generateChatName Function
File: services/llm.service.js
Purpose: Generates descriptive names for chat conversations
Parameters:
• messages: Array - Initial chat messages
• maxLength: number - Maximum name length
Returns: {name: string, confidence: number}
Calls External: OpenAI API
Called By: Chat session creation

synthesizeAnswer Function
File: services/llm.service.js
Purpose: Synthesizes answers from retrieved context and user queries
Parameters:
• query: string - User query
• contextBlocks: Array - Retrieved context blocks
• options: object - Synthesis options
Returns: {answer: string, sources: Array, confidence: number}
Calls External: OpenAI API
Called By: Chat response generation

classifyQueryIntent Function
File: services/llm.service.js
Purpose: Classifies user query intent for appropriate routing
Parameters:
• query: string - User query
• context: object - Additional context
Returns: {intent: string, confidence: number, entities: Array}
Calls External: OpenAI API
Called By: Query routing and processing

generateAssetSummary Function
File: services/llm.service.js
Purpose: Generates summaries for system assets and documents
Parameters:
• assetData: object - Asset information
• userQuery: string - User query context
• assetHints: object - Asset-specific hints
• contextBlocks: Array - Additional context blocks
Returns: {summary: string, keyFeatures: Array, relevanceScore: number}
Calls External: OpenAI API
Called By: Asset search and recommendation systems

SYSTEM FUNCTIONS

listSystems Function
File: repositories/systems.repository.js
Purpose: Lists system assets with pagination and filtering
Parameters:
• limit: number - Maximum number of systems to return
• cursor: string - Pagination cursor
Returns: {systems: Array, nextCursor: string, hasMore: boolean}
Database Queries:
• SELECT * FROM systems ORDER BY created_at DESC LIMIT ? OFFSET ?
Called By: GET /admin/dashboard

getSystemByAssetUid Function
File: repositories/systems.repository.js
Purpose: Retrieves system information by asset UID
Parameters:
• assetUid: string - Asset unique identifier
Returns: {system: object, metadata: object}
Database Queries:
• SELECT * FROM systems WHERE asset_uid = ?
Called By: System detail views

GUARD FUNCTIONS

isPineconeConfigured Function
File: services/guards/index.js
Purpose: Checks if Pinecone vector database is properly configured
Parameters: None
Returns: boolean - True if Pinecone is configured
Checks: PYTHON_SIDECAR_URL environment variable
Used By: Vector search operations

isSupabaseConfigured Function
File: services/guards/index.js
Purpose: Checks if Supabase database is properly configured
Parameters: None
Returns: boolean - True if Supabase is configured
Checks: SUPABASE_URL and service role key environment variables
Used By: Database operations

isOpenAIConfigured Function
File: services/guards/index.js
Purpose: Checks if OpenAI API is properly configured
Parameters: None
Returns: boolean - True if OpenAI is configured
Checks: OPENAI_API_KEY environment variable
Used By: LLM operations

isSidecarConfigured Function
File: services/guards/index.js
Purpose: Checks if Python sidecar service is properly configured
Parameters: None
Returns: boolean - True if sidecar is configured
Checks: PYTHON_SIDECAR_URL environment variable
Used By: Document processing operations

getExternalServiceStatus Function
File: services/guards/index.js
Purpose: Gets status of all external services
Parameters: None
Returns: {services: object, overall: string} - Status of each service
Calls: All individual guard functions
Called By: GET /admin/health

SYSTEM FLOW

1. User Request → REIMAGINEDAPPV2 Backend
2. Backend → Routes Layer (validates request)
3. Routes → Services Layer (business logic)
4. Services → Repositories Layer (data access)
5. Services → External APIs (Supabase, Pinecone, OpenAI)
6. Python Sidecar → Document processing and LLM operations
7. Response → Back to user through backend

KEY RELATIONSHIPS

• Routes → Services: All business logic flows through service layer
• Services → Repositories: Data access is abstracted through repository pattern
• Services → External APIs: Direct calls to Supabase, Pinecone, OpenAI
• Backend → Python Sidecar: Document processing and complex LLM operations
• Python Sidecar → OpenAI: Advanced LLM processing for DIP extraction
• All Components → Supabase: Primary data storage and user management
