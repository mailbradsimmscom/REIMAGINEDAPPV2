# REIMAGINEDAPPV2 - Complete Code Module Documentation

## Architecture Overview

This project follows a **layered architecture** with clear separation of concerns:

```
┌─────────────────────────────────────────────────────────────┐
│                    PRESENTATION LAYER                      │
│  Frontend (HTML/CSS/JS) + Admin Dashboard + Public Routes  │
├─────────────────────────────────────────────────────────────┤
│                     APPLICATION LAYER                       │
│        Routes → Services → Repositories → Database          │
├─────────────────────────────────────────────────────────────┤
│                      INFRASTRUCTURE                        │
│    Middleware + Guards + Schemas + Utils + External APIs   │
└─────────────────────────────────────────────────────────────┘
```

---

## 🚀 **ENTRY POINTS**

### `src/index.js` - Main Application Entry
**Purpose**: Application bootstrap and router mounting
**Imports**: 
- `app.js` (Express app)
- All routers (health, systems, chat, document, admin, etc.)
- Middleware (security, error handling, admin gate)
- Debug tools and startup services

**Mounts**:
- `/health` → healthRouter
- `/systems` → systemsRouter  
- `/chat` → chatRouter
- `/document` → documentRouter
- `/admin` → adminRouter
- `/pinecone` → pineconeRouter

**Key Functions**:
- `safeMount()` - Safely mounts routers with error handling
- `ensureLexicons()` - Validates critical config files at startup

### `src/start.js` - Server Startup
**Purpose**: HTTP server initialization
**Imports**: `app.js`, `logger.js`
**Functions**: `getPort()` - Gets port from env or defaults to 3000

### `src/start-job-processor.js` - Background Worker
**Purpose**: Processes queued DIP jobs
**Imports**: `job.processor.js`
**Function**: Starts continuous job processing loop

---

## 🎯 **ROUTING LAYER**

### **Main Routers**

#### `src/routes/admin/index.js` - Admin API Hub
**Purpose**: Central admin router with authentication
**Middleware**: `adminOnly` (x-admin-token required)
**Mounts**:
- `/dashboard` → dashboardRouter
- `/health` → healthRouter  
- `/systems` → systemsRouter
- `/logs` → logsRouter
- `/manufacturers` → manufacturersRouter
- `/models` → modelsRouter
- `/pinecone` → pineconeRouter
- `/metrics` → metricsRouter
- `/suggestions` → suggestionsRouter
- `/suggestions/spec` → suggestionsSpecRoute
- `/systems/minimal` → systemsMinimalRoute
- `/dip` → dipRouter
- `/snapshots` → snapshotsRouter
- `/text-extraction` → textExtractionRouter
- `/jobs` → jobsRouter
- `/chunks` → chunksRouter
- `/intent-router` → intentRouter
- `/playbooks` → playbooksRouter

#### `src/routes/chat/index.js` - Chat API Hub
**Purpose**: Chat functionality routing
**Mounts**:
- `/process` → process.route.js (main chat processing)
- `/thread-by-session` → thread-by-session.route.js
- `/list` → list.route.js
- `/history` → history.route.js
- `/context` → context.route.js
- `/delete` → delete.route.js
- `/session-delete` → session-delete.route.js

#### `src/routes/document/index.js` - Document API Hub
**Purpose**: Document management routing
**Mounts**:
- `/ingest` → ingest.route.js (document upload)
- `/documents` → documents.route.js
- `/get-one` → get-one.route.js
- `/jobs` → jobs.route.js
- `/job-status` → job-status.route.js

### **Individual Route Files**

#### Document Routes
- **`ingest.route.js`**: `POST /admin/docs/ingest` - Document upload with Busboy multipart parsing
- **`documents.route.js`**: `GET /documents` - List documents
- **`get-one.route.js`**: `GET /documents/:id` - Get single document
- **`jobs.route.js`**: `GET /jobs` - List processing jobs
- **`job-status.route.js`**: `GET /jobs/:id/status` - Job status

#### Admin Routes
- **`dashboard.route.js`**: `GET /admin` - Serves admin dashboard HTML
- **`health.route.js`**: `GET /admin/api/health` - System health check
- **`systems.route.js`**: `GET /admin/api/systems` - List systems
- **`systems-minimal.route.js`**: `GET /admin/api/systems/minimal` - Minimal system list
- **`logs.route.js`**: `GET /admin/api/logs` - Application logs
- **`manufacturers.route.js`**: `GET /admin/api/manufacturers` - Manufacturer list
- **`models.route.js`**: `GET /admin/api/models` - Model list
- **`metrics.route.js`**: `GET /admin/api/metrics` - Performance metrics
- **`suggestions.route.js`**: `GET /admin/api/suggestions` - AI suggestions
- **`suggestions-spec.route.js`**: `POST /admin/api/suggestions/spec/accept` - Accept spec suggestions
- **`dip.route.js`**: `GET /admin/api/dip` - DIP packets
- **`jobs.route.js`**: `GET /admin/api/jobs` - Admin job management
- **`chunks.route.js`**: `GET /admin/api/chunks` - Document chunks
- **`pinecone.route.js`**: `GET /admin/api/pinecone` - Vector database status

---

## 🧠 **SERVICE LAYER**

### **Core Services**

#### `src/services/chat-orchestrator.service.js` - Chat Flow Coordinator
**Purpose**: Main chat processing orchestrator
**Imports**: 
- `intent-router.service.js` - Query routing
- `fact-first.service.js` - Fact-based responses
- `pinecone-retrieval.service.js` - Vector search
- `assistant-response.service.js` - Response generation
- `summarization.service.js` - Thread summarization
- `context-utils.js` - Context management

**Key Functions**:
- `processUserMessage()` - Main chat processing pipeline
- `checkServiceAvailability()` - Validates required services
- `handleSpecialIntent()` - Handles summarize/asset_summary intents

#### `src/services/document.service.js` - Document Processing
**Purpose**: Document ingestion and job processing
**Imports**:
- `dip.service.js` - DIP generation
- `systems.repository.js` - System lookup
- `guards/index.js` - Service availability checks

**Key Functions**:
- `ingestDocument()` - Document upload processing
- `processJob()` - Background job processing
- `callPythonSidecar()` - PDF processing via Python
- `checkSidecarAvailability()` - Sidecar health check

#### `src/services/job.processor.js` - Background Worker
**Purpose**: Processes queued DIP jobs
**Imports**: `document.service.js`
**Key Functions**:
- `processPendingJobs()` - Continuous job processing loop
- `processJob()` - Individual job processing

### **AI/ML Services**

#### `src/services/intent-router.service.js` - Query Classification
**Purpose**: Classifies user intents and routes queries
**Key Functions**:
- `classifyUserIntent()` - Intent classification
- `routeQuery()` - Query routing logic

#### `src/services/fact-first.service.js` - Fact-Based Responses
**Purpose**: Provides fact-based responses from knowledge base
**Key Functions**:
- `getFactFirstResponse()` - Fact retrieval
- `shouldAttemptFactFirst()` - Decision logic

#### `src/services/pinecone-retrieval.service.js` - Vector Search
**Purpose**: Pinecone vector database operations
**Key Functions**:
- `retrieveWithSpecBias()` - Spec-biased retrieval
- `performPineconeRetrieval()` - Vector search

#### `src/services/assistant-response.service.js` - Response Generation
**Purpose**: Generates AI assistant responses
**Key Functions**:
- `generateEnhancedAssistantResponse()` - Main response generation

#### `src/services/summarization.service.js` - Thread Management
**Purpose**: Chat thread summarization and naming
**Key Functions**:
- `summarizeThread()` - Thread summarization
- `generateThreadName()` - Thread naming
- `shouldSummarizeThread()` - Summarization decision

### **DIP Pipeline Services**

#### `src/services/dip.service.js` - DIP Generation
**Purpose**: Document Intelligence Packet generation
**Key Functions**:
- `generateDIP()` - DIP creation
- `runDIPPacket()` - Complete DIP processing

#### `src/services/dip.generation.service.js` - DIP Orchestration
**Purpose**: Orchestrates DIP and suggestion generation
**Key Functions**:
- `generateDIPAndSuggestions()` - Complete pipeline

#### `src/services/suggestions.merge.service.js` - Suggestion Management
**Purpose**: Merges approved suggestions into production
**Key Functions**:
- `acceptSpecSuggestion()` - Accept spec suggestions
- `upsertSpec()` - Spec upsert helper

### **Utility Services**

#### `src/services/llm.service.js` - LLM Operations
**Purpose**: Large Language Model operations
**Key Functions**:
- `enhanceQuery()` - Query enhancement
- Various LLM utility functions

#### `src/services/query-normalizer.js` - Query Processing
**Purpose**: Normalizes and processes user queries
**Key Functions**:
- Query normalization and processing

#### `src/services/viewRefresh.service.js` - Database Views
**Purpose**: Refreshes database views
**Key Functions**:
- `refreshKnowledgeFactsViewSafe()` - Safe view refresh

---

## 🗄️ **REPOSITORY LAYER**

### **Database Repositories**

#### `src/repositories/supabaseClient.js` - Database Client
**Purpose**: Supabase client configuration
**Exports**: `getSupabaseClient()`, `getSupabaseStorageClient()`

#### `src/repositories/systems.repository.js` - Systems Data
**Purpose**: System data operations
**Key Functions**:
- `listSystems()` - List all systems
- `getSystemByAssetUid()` - Get system by asset UID
- `getSystemByUid()` - Get system by UUID
- `searchSystems()` - Search systems
- `lookupSystemByManufacturerAndModel()` - Manufacturer/model lookup
- `updateSpecKeywords()` - Update spec keywords
- `listMinimal()` - Minimal system list

#### `src/repositories/document.repository.js` - Document Data
**Purpose**: Document data operations
**Key Functions**:
- Document CRUD operations
- Job management
- Status updates

#### `src/repositories/document-chunks.repository.js` - Document Chunks
**Purpose**: Document chunk operations
**Key Functions**:
- `addSpecTag()` - Add spec tags to chunks

#### `src/repositories/chat.repository.js` - Chat Data
**Purpose**: Chat session and message data
**Key Functions**:
- Session management
- Message storage
- Thread operations

#### `src/repositories/suggestions.repository.js` - Suggestions Data
**Purpose**: AI suggestion data operations
**Key Functions**:
- Suggestion CRUD operations
- Status management

#### `src/repositories/pinecone.repository.js` - Vector Database
**Purpose**: Pinecone vector operations
**Key Functions**:
- Vector upsert/query operations
- Namespace management

### **External Service Clients**

#### `src/repositories/sidecar.client.js` - Python Sidecar
**Purpose**: Python sidecar communication
**Key Functions**:
- Sidecar API calls
- Health checks

#### `src/clients/openai.client.js` - OpenAI API
**Purpose**: OpenAI API client
**Key Functions**:
- OpenAI API operations

---

## 🛡️ **MIDDLEWARE LAYER**

### **Security Middleware**

#### `src/middleware/security.js` - Security Headers
**Purpose**: Security headers and rate limiting
**Exports**: `securityHeaders`, `basicRateLimit`

#### `src/middleware/admin.js` - Admin Authentication
**Purpose**: Admin route protection
**Exports**: `adminOnly`, `adminGate`
**Function**: Validates `x-admin-token` header

### **Request Processing**

#### `src/middleware/error.js` - Error Handling
**Purpose**: Global error handling
**Exports**: `errorHandler`, `notFoundHandler`

#### `src/middleware/requestLogging.js` - Request Logging
**Purpose**: Request/response logging

#### `src/middleware/validate.js` - Input Validation
**Purpose**: Zod schema validation
**Exports**: `validate()` - Generic validation middleware

#### `src/middleware/validateResponse.js` - Response Validation
**Purpose**: Response schema validation

#### `src/middleware/serviceGuards.js` - Service Guards
**Purpose**: External service availability checks

#### `src/middleware/trace404.js` - 404 Tracing
**Purpose**: 404 request tracing

---

## 📋 **SCHEMA LAYER**

### **Validation Schemas**

#### `src/schemas/index.js` - Schema Exports
**Purpose**: Centralized schema exports

#### `src/schemas/id.schema.js` - ID Validation
**Purpose**: ID format validation
**Exports**: `SystemUid`, `HashOrUuid`

#### `src/schemas/suggestions.schema.js` - Suggestion Validation
**Purpose**: Suggestion data validation
**Exports**: `SpecKeywordSchema`, `AcceptSpecPayload`

#### `src/schemas/uploadDocument.schema.js` - Upload Validation
**Purpose**: Document upload validation
**Exports**: `systemMetadataSchema`

#### `src/schemas/ingestion.schema.js` - Ingestion Validation
**Purpose**: DIP ingestion validation

#### `src/schemas/chat.schema.js` - Chat Validation
**Purpose**: Chat data validation

#### `src/schemas/systems.schema.js` - Systems Validation
**Purpose**: System data validation

#### `src/schemas/health.schema.js` - Health Validation
**Purpose**: Health check validation

#### `src/schemas/envelope.schema.js` - Response Envelope
**Purpose**: Standard response format validation

---

## 🎨 **FRONTEND LAYER**

### **Admin Dashboard**

#### `src/public/admin.htm` - Admin Dashboard HTML
**Purpose**: Main admin dashboard page
**Structure**: Modular sections with `data-include` attributes
**Sections**:
- Dashboard, Doc Upload, DIP, Jobs, Chunks
- Metrics, Health, Systems, Suggestions

#### `src/public/js/admin/boot.js` - Admin Bootstrap
**Purpose**: Admin dashboard initialization
**Imports**: All section controllers
**Exports**: `window.AdminState`, `window.adminFetch`
**Key Functions**:
- `hydrateIncludes()` - Loads partial HTML
- `initRouter()` - Sets up routing

#### `src/public/js/admin/router.js` - Frontend Routing
**Purpose**: Client-side routing for admin sections
**Key Functions**:
- `initRouter()` - Route initialization

### **Section Controllers**

#### `src/public/js/admin/sections/dashboard.js` - Dashboard Controller
**Purpose**: Dashboard metrics and health display
**Key Functions**:
- `loadHealthMetrics()` - Health data loading
- `loadDatabaseMetrics()` - Database metrics
- `loadVectorMetrics()` - Vector database metrics
- `loadPerformanceMetrics()` - Performance data

#### `src/public/js/admin/sections/doc-upload.js` - Document Upload
**Purpose**: Document upload interface
**Key Functions**:
- `loadManufacturers()` - Manufacturer dropdown
- `loadModels()` - Model dropdown
- `setupEventListeners()` - Form handling

#### `src/public/js/admin/sections/systems.js` - Systems Management
**Purpose**: Systems data display and management
**Key Functions**:
- `loadSystems()` - Systems data loading
- `initializeSystemsSection()` - Section initialization

#### `src/public/js/admin/sections/jobs.js` - Job Management
**Purpose**: Job processing display
**Key Functions**:
- `loadJobs()` - Jobs data loading
- `initializeJobsSection()` - Section initialization

#### `src/public/js/admin/sections/suggestions.js` - Suggestions Management
**Purpose**: AI suggestions display and approval
**Key Functions**:
- Suggestion loading and approval

### **Public Frontend**

#### `src/public/index.html` - Main Public Page
**Purpose**: Public-facing application

#### `src/public/app.js` - Public App Logic
**Purpose**: Public application JavaScript

#### `src/public/js/include-loader.js` - HTML Includes
**Purpose**: Dynamic HTML loading system
**Key Functions**:
- `hydrateIncludes()` - Loads HTML partials

---

## 🔧 **UTILITY LAYER**

### **Core Utilities**

#### `src/utils/logger.js` - Logging
**Purpose**: Centralized logging system
**Exports**: `logger` with request logging capabilities

#### `src/utils/context-utils.js` - Context Management
**Purpose**: Chat context utilities
**Key Functions**:
- `isFollowUpQuestion()` - Follow-up detection
- `containsAmbiguousPronoun()` - Pronoun detection
- `extractEquipmentTerms()` - Equipment term extraction
- `hasExistingSystemsContext()` - Context checking
- `contextRewrite()` - Context rewriting

#### `src/utils/formatter.js` - Data Formatting
**Purpose**: Data formatting utilities

#### `src/utils/fuzzyMatcher.js` - Fuzzy Matching
**Purpose**: Fuzzy string matching

#### `src/utils/specFilter.js` - Spec Filtering
**Purpose**: Specification filtering

#### `src/utils/units.normalizer.js` - Units Normalization
**Purpose**: Unit conversion and normalization

#### `src/utils/metrics.js` - Metrics Collection
**Purpose**: Application metrics

#### `src/utils/snapshots.service.js` - Snapshots
**Purpose**: Data snapshots

### **Configuration**

#### `src/config/env.js` - Environment Configuration
**Purpose**: Environment variable management
**Key Functions**:
- `getEnv()` - Environment variable access
- Zod schema validation for env vars

#### `src/config/personality.js` - AI Personality
**Purpose**: AI personality configuration

### **Constants**

#### `src/constants/errorCodes.js` - Error Codes
**Purpose**: Standardized error codes

### **Guards**

#### `src/services/guards/index.js` - Service Guards
**Purpose**: External service availability checks
**Exports**: 
- `isSupabaseConfigured()`
- `isPineconeConfigured()`
- `isOpenAIConfigured()`
- `isSidecarConfigured()`

#### Individual Guard Files:
- `supabase.guard.js` - Supabase availability
- `pinecone.guard.js` - Pinecone availability  
- `openai.guard.js` - OpenAI availability
- `sidecar.guard.js` - Python sidecar availability

---

## 🔄 **DATA FLOW ARCHITECTURE**

### **Document Processing Flow**
```
1. Upload → ingest.route.js → document.service.js
2. Job Creation → document.repository.js → jobs table
3. Job Processing → job.processor.js → document.service.js
4. Python Sidecar → PDF parsing → DIP generation
5. Vector Storage → pinecone.repository.js
6. Suggestions → suggestions.repository.js
7. Admin Approval → suggestions.merge.service.js → Production tables
```

### **Chat Processing Flow**
```
1. User Query → chat/process.route.js → chat-orchestrator.service.js
2. Intent Classification → intent-router.service.js
3. Context Bootstrap → context-utils.js
4. Fact-First Check → fact-first.service.js
5. Vector Retrieval → pinecone-retrieval.service.js
6. Response Generation → assistant-response.service.js
7. Thread Management → summarization.service.js
8. Storage → chat.repository.js
```

### **Admin Dashboard Flow**
```
1. Page Load → admin.htm → boot.js
2. Section Loading → include-loader.js → HTML partials
3. Data Loading → adminFetch() → Admin API routes
4. Section Controllers → Individual section logic
5. User Actions → API calls → Backend services
```

---

## 🔗 **KEY CONNECTIONS**

### **Critical Dependencies**
- **Python Sidecar**: Required for document processing, DIP generation
- **Supabase**: Database, storage, authentication
- **Pinecone**: Vector database for semantic search
- **OpenAI**: LLM operations, response generation

### **Service Dependencies**
- **Document Service** → DIP Service → Python Sidecar
- **Chat Orchestrator** → Intent Router → Fact-First → Pinecone Retrieval
- **Job Processor** → Document Service → Python Sidecar
- **Suggestions Merge** → Systems Repository → Document Chunks Repository

### **Frontend Dependencies**
- **Admin Dashboard** → Admin API Routes → Backend Services
- **Section Controllers** → window.adminFetch → Admin Authentication
- **Include Loader** → HTML Partials → Section Controllers

This documentation provides a complete map of your codebase architecture, showing how all modules connect and what each one does. Each layer has clear responsibilities and the data flows are well-defined.
