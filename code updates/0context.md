# REIMAGINEDAPPV2 Architecture Documentation

## System Landscape
- **REIMAGINEDAPPV2 Backend**: Main Node.js application that handles web requests and orchestrates all backend operations
  - [Calls: Python Sidecar, Supabase, Pinecone, OpenAI APIs]
  - [Routes: All /api/* endpoints, /admin/* endpoints]
  - [Port: 3000, Environment: Production]

- **Python Sidecar**: Specialized microservice for document processing and LLM operations
  - [Calls: OpenAI API, Supabase database]
  - [Routes: /process, /extract, /analyze]
  - [Port: 8000, Framework: FastAPI]

- **Supabase**: PostgreSQL database that stores structured data and handles file storage
  - [Receives: User data, chat history, document metadata, DIP results]
  - [Provides: Real-time subscriptions, file storage, authentication]

- **Pinecone**: Vector database that stores document embeddings for semantic search
  - [Receives: Document embeddings, search queries]
  - [Provides: Similarity search, vector storage, metadata filtering]

- **OpenAI**: External API service that provides LLM capabilities for text generation and analysis
  - [Models: gpt-4, gpt-3.5-turbo, text-embedding-ada-002]
  - [Endpoints: /v1/chat/completions, /v1/embeddings]

## Node.js Containers

### API Routes Layer (42 routes)
- **routes/admin/dashboard.route.js**: Handles admin dashboard requests and provides system overview data
  - [Routes: GET /admin/dashboard, POST /admin/analytics]
  - [Calls: services/admin.service.js, repositories/analytics.repository.js]
  - [Middleware: adminOnly, validateRequest]

- **routes/chat/list.route.js**: Manages chat conversation listing and retrieval for users
  - [Routes: GET /api/chat/list, POST /api/chat/create]
  - [Calls: services/chat.service.js, repositories/chat.repository.js]
  - [Passes: userId, pagination params, filters]

- **routes/admin/health.route.js**: Provides system health status and monitoring endpoints
  - [Routes: GET /admin/health, GET /admin/status]
  - [Calls: services/health.service.js]
  - [Returns: System status, uptime, dependencies]

### Business Logic Layer (42 services)
- **services/chat.service.js**: Orchestrates chat operations and manages conversation flow
  - [Calls: repositories/chat.repository.js, services/llm.service.js]
  - [Calls External: OpenAI API, Pinecone vector search]
  - [Passes: Message content, conversation context, user preferences]

- **services/dip.service.js**: Coordinates document intelligence pipeline processing
  - [Calls: Python Sidecar /process endpoint]
  - [Calls: repositories/document.repository.js]
  - [Passes: Document file, processing parameters, callback URL]

- **services/user.service.js**: Handles user management and authentication logic
  - [Calls: repositories/user.repository.js, Supabase Auth]
  - [Functions: createUser, authenticate, updateProfile]
  - [Returns: User tokens, profile data, permissions]

### Data Access Layer (14 repositories)
- **repositories/chat.repository.js**: Manages database operations for chat data storage and retrieval
  - [Calls: Supabase database]
  - [Tables: chats, messages, conversations]
  - [Operations: CRUD, search, pagination]

- **repositories/document.repository.js**: Handles document metadata and file operations
  - [Calls: Supabase storage, database]
  - [Operations: upload, download, metadata CRUD]
  - [File types: PDF, DOCX, TXT, images]

- **repositories/user.repository.js**: Provides database access for user account management
  - [Calls: Supabase Auth, users table]
  - [Operations: profile CRUD, preferences, settings]
  - [Returns: User data, preferences, permissions]

### Middleware Stack (9 middleware)
- **middleware/auth.middleware.js**: Handles authentication and authorization
  - [Validates: JWT tokens, session data]
  - [Routes: All protected endpoints]
  - [Calls: Supabase Auth verification]

- **middleware/validation.middleware.js**: Input validation and sanitization
  - [Uses: Zod schemas]
  - [Validates: Request body, query params, headers]
  - [Returns: Validated data or error responses]

### Data Models & Schemas (13 models)
- **models/chat.schema.js**: Zod schemas for chat-related data validation
  - [Schemas: MessageSchema, ConversationSchema, ChatRequestSchema]
  - [Used by: Chat routes, services, repositories]

- **models/user.schema.js**: User data validation schemas
  - [Schemas: UserSchema, ProfileSchema, AuthSchema]
  - [Used by: User routes, authentication middleware]

## Python Containers

### Document Processors (1 processor)
- **dip_processor.py**: Main document intelligence pipeline that extracts structured data from uploaded documents
  - [Calls: OpenAI GPT-4 API, extraction_service.py]
  - [Receives: Document file, processing instructions]
  - [Returns: Structured JSON, metadata, confidence scores]
  - [Processes: PDFs, DOCX, images, text files]

### LLM Services (4 services)
- **llm_service.py**: Interfaces with OpenAI API for text generation and document analysis
  - [Calls: OpenAI /v1/chat/completions, /v1/embeddings]
  - [Models: gpt-4, text-embedding-ada-002]
  - [Passes: Prompt templates, document content, system instructions]

- **extraction_service.py**: Specialized service for extracting structured data from unstructured documents
  - [Calls: llm_service.py, file_utils.py]
  - [Extracts: Entities, relationships, key information]
  - [Returns: Structured data, confidence scores, metadata]

### Utilities (16 utilities)
- **file_utils.py**: Helper functions for file handling and document processing
  - [Imports: os, pathlib, mimetypes, PyPDF2]
  - [Functions: validate_file, extract_text, convert_format]
  - [Supports: Multiple file formats, validation, conversion]

- **validation_utils.py**: Input validation and data sanitization utilities
  - [Functions: validate_input, sanitize_data, check_permissions]
  - [Used by: All services and processors]

## System Flow
1. **User Request** → REIMAGINEDAPPV2 Backend
2. **Backend** → Routes Layer (validates request)
3. **Routes** → Services Layer (business logic)
4. **Services** → Repositories Layer (data access)
5. **Services** → External APIs (Supabase, Pinecone, OpenAI)
6. **Python Sidecar** → Document processing and LLM operations
7. **Response** → Back to user through backend

## Key Relationships
- **Routes → Services**: All business logic flows through service layer
- **Services → Repositories**: Data access is abstracted through repository pattern
- **Services → External APIs**: Direct calls to Supabase, Pinecone, OpenAI
- **Backend → Python Sidecar**: Document processing and complex LLM operations
- **Python Sidecar → OpenAI**: Advanced LLM processing for DIP extraction
- **All Components → Supabase**: Primary data storage and user management
