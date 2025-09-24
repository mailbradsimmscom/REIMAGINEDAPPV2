# Routing Architecture - Detailed Module Analysis

## 🚦 **Main Router Structure**

### `src/index.js` - Application Bootstrap
**Purpose**: Central application entry point and router mounting
**What it mounts**:
```javascript
// Health & System Routes
app.use('/health', healthRouter);
app.use('/systems', systemsRouter);

// Chat System Routes  
app.use('/chat', chatRouter);

// Document Management Routes
app.use('/document', documentRouter);

// Admin Dashboard Routes
app.use('/admin', adminRouter);

// Vector Database Routes
app.use('/pinecone', pineconeRouter);

// Testing Routes
app.use('/test-normalizer', testNormalizerRouter);
```

**What it imports**:
- `app.js` - Express application instance
- `logger.js` - Logging utilities
- All router modules
- Middleware modules (security, error handling, admin gate)
- Debug tools and startup services

**Key Functions**:
- `safeMount()` - Safely mounts routers with error handling
- `ensureLexicons()` - Validates critical config files at startup

---

## 🎯 **Admin Router Hub** (`src/routes/admin/index.js`)

**Purpose**: Central admin API router with authentication
**Authentication**: All routes protected by `adminOnly` middleware (requires `x-admin-token`)

### **What it mounts**:
```javascript
// Dashboard & Health
router.use('/dashboard', dashboardRouter);     // GET /admin/dashboard
router.use('/health', healthRouter);           // GET /admin/api/health

// System Management
router.use('/systems', systemsRouter);         // GET /admin/api/systems
router.use('/systems/minimal', systemsMinimalRoute); // GET /admin/api/systems/minimal

// Data Management
router.use('/manufacturers', manufacturersRouter); // GET /admin/api/manufacturers
router.use('/models', modelsRouter);           // GET /admin/api/models
router.use('/logs', logsRouter);              // GET /admin/api/logs

// Document Processing
router.use('/jobs', jobsRouter);              // GET /admin/api/jobs
router.use('/chunks', chunksRouter);          // GET /admin/api/chunks
router.use('/dip', dipRouter);                // GET /admin/api/dip

// AI & Suggestions
router.use('/suggestions', suggestionsRouter); // GET /admin/api/suggestions
router.use('/suggestions/spec', suggestionsSpecRoute); // POST /admin/api/suggestions/spec/accept

// Vector Database
router.use('/pinecone', pineconeRouter);       // GET /admin/api/pinecone

// Performance & Monitoring
router.use('/metrics', metricsRouter);        // GET /admin/api/metrics
router.use('/snapshots', snapshotsRouter);    // GET /admin/api/snapshots

// Text Processing
router.use('/text-extraction', textExtractionRouter); // GET /admin/api/text-extraction

// Intent & Playbooks
router.use('/intent-router', intentRouter);    // GET /admin/api/intent-router
router.use('/playbooks', playbooksRouter);    // GET /admin/api/playbooks
```

---

## 💬 **Chat Router Hub** (`src/routes/chat/index.js`)

**Purpose**: Chat functionality routing
**What it mounts**:
```javascript
// Main Chat Processing
router.use('/process', processRouter);         // POST /chat/process

// Thread Management
router.use('/thread-by-session', threadBySessionRouter); // GET /chat/thread-by-session
router.use('/list', listRouter);              // GET /chat/list
router.use('/history', historyRouter);        // GET /chat/history
router.use('/context', contextRouter);        // GET /chat/context

// Thread Operations
router.use('/delete', deleteRouter);          // DELETE /chat/delete
router.use('/session-delete', sessionDeleteRouter); // DELETE /chat/session-delete
```

---

## 📄 **Document Router Hub** (`src/routes/document/index.js`)

**Purpose**: Document management routing
**What it mounts**:
```javascript
// Document Upload & Processing
router.use('/ingest', ingestRouter);          // POST /document/ingest

// Document Retrieval
router.use('/documents', documentsRouter);     // GET /document/documents
router.use('/get-one', getOneRouter);         // GET /document/get-one/:id

// Job Management
router.use('/jobs', jobsRouter);              // GET /document/jobs
router.use('/job-status', jobStatusRouter);   // GET /document/job-status/:id
```

---

## 🔍 **Individual Route File Analysis**

### **Document Routes**

#### `src/routes/document/ingest.route.js`
**Purpose**: Document upload endpoint
**Method**: `POST /admin/docs/ingest`
**What it does**:
- Uses Busboy for multipart form data parsing
- Validates system metadata (manufacturer_norm, model_norm)
- Creates document record in database
- Creates processing job
- Calls document service for processing

**What it imports**:
- `Busboy` - Multipart form parsing
- `document.service.js` - Document processing logic
- `uploadDocument.schema.js` - Validation schemas
- `adminOnly` middleware - Authentication

#### `src/routes/document/documents.route.js`
**Purpose**: List all documents
**Method**: `GET /documents`
**What it does**:
- Retrieves document list from database
- Applies filtering and pagination
- Returns formatted document data

#### `src/routes/document/get-one.route.js`
**Purpose**: Get single document details
**Method**: `GET /documents/:id`
**What it does**:
- Retrieves specific document by ID
- Includes related metadata and processing status

#### `src/routes/document/jobs.route.js`
**Purpose**: List processing jobs
**Method**: `GET /jobs`
**What it does**:
- Retrieves job list from database
- Shows job status and progress
- Includes error information for failed jobs

#### `src/routes/document/job-status.route.js`
**Purpose**: Get job processing status
**Method**: `GET /jobs/:id/status`
**What it does**:
- Retrieves specific job status
- Shows processing progress
- Returns error details if failed

### **Admin Routes**

#### `src/routes/admin/dashboard.route.js`
**Purpose**: Serve admin dashboard
**Method**: `GET /admin`
**What it does**:
- Serves `src/public/admin.htm` HTML file
- Provides admin dashboard interface

#### `src/routes/admin/health.route.js`
**Purpose**: System health check
**Method**: `GET /admin/api/health`
**What it does**:
- Checks system uptime and memory usage
- Validates external service connectivity
- Returns health status

#### `src/routes/admin/systems.route.js`
**Purpose**: System data management
**Method**: `GET /admin/api/systems`
**What it does**:
- Lists all systems in database
- Provides system metadata and specifications
- Includes document counts per system

#### `src/routes/admin/systems-minimal.route.js`
**Purpose**: Minimal system list for UI dropdowns
**Method**: `GET /admin/api/systems/minimal`
**What it does**:
- Returns lightweight system list
- Optimized for frontend dropdowns
- Includes only essential fields (id, name, manufacturer, model)

#### `src/routes/admin/suggestions.route.js`
**Purpose**: AI suggestions management
**Method**: `GET /admin/api/suggestions`
**What it does**:
- Lists AI-generated suggestions
- Shows suggestion status (pending, accepted, rejected)
- Includes confidence scores and source information

#### `src/routes/admin/suggestions-spec.route.js`
**Purpose**: Accept spec suggestions
**Method**: `POST /admin/api/suggestions/spec/accept`
**What it does**:
- Accepts individual spec suggestions
- Merges approved specs into production tables
- Implements idempotency to prevent duplicates
- Creates audit trail for changes

#### `src/routes/admin/jobs.route.js`
**Purpose**: Admin job management
**Method**: `GET /admin/api/jobs`
**What it does**:
- Lists all processing jobs
- Shows detailed job status and progress
- Includes error logs for failed jobs

#### `src/routes/admin/chunks.route.js`
**Purpose**: Document chunks management
**Method**: `GET /admin/api/chunks`
**What it does**:
- Lists document chunks
- Shows chunk metadata and content
- Includes vector embedding information

#### `src/routes/admin/dip.route.js`
**Purpose**: DIP packet management
**Method**: `GET /admin/api/dip`
**What it does**:
- Lists Document Intelligence Packets
- Shows DIP processing status
- Includes generated insights and metadata

#### `src/routes/admin/metrics.route.js`
**Purpose**: Performance metrics
**Method**: `GET /admin/api/metrics`
**What it does**:
- Returns system performance metrics
- Shows API response times and error rates
- Includes chat health statistics

#### `src/routes/admin/logs.route.js`
**Purpose**: Application logs
**Method**: `GET /admin/api/logs`
**What it does**:
- Retrieves application log entries
- Supports filtering by level and time range
- Returns formatted log data

### **Chat Routes**

#### `src/routes/chat/process.route.js`
**Purpose**: Main chat processing endpoint
**Method**: `POST /chat/process`
**What it does**:
- Processes user chat messages
- Orchestrates entire chat flow
- Returns AI assistant responses

**What it imports**:
- `chat-orchestrator.service.js` - Main chat processing logic
- `chat.schema.js` - Request validation
- `logger.js` - Logging utilities

#### `src/routes/chat/thread-by-session.route.js`
**Purpose**: Get thread by session
**Method**: `GET /chat/thread-by-session`
**What it does**:
- Retrieves chat thread for specific session
- Returns thread history and context

#### `src/routes/chat/list.route.js`
**Purpose**: List chat sessions
**Method**: `GET /chat/list`
**What it does**:
- Lists all chat sessions
- Shows session metadata and activity

#### `src/routes/chat/history.route.js`
**Purpose**: Chat history
**Method**: `GET /chat/history`
**What it does**:
- Retrieves chat message history
- Supports pagination and filtering

#### `src/routes/chat/context.route.js`
**Purpose**: Chat context
**Method**: `GET /chat/context`
**What it does**:
- Returns current chat context
- Includes system information and recent messages

#### `src/routes/chat/delete.route.js`
**Purpose**: Delete chat thread
**Method**: `DELETE /chat/delete`
**What it does**:
- Deletes specific chat thread
- Removes all associated messages

#### `src/routes/chat/session-delete.route.js`
**Purpose**: Delete chat session
**Method**: `DELETE /chat/session-delete`
**What it does**:
- Deletes entire chat session
- Removes all threads and messages

---

## 🔗 **Route Dependencies & Connections**

### **Authentication Flow**
```
Admin Routes → adminOnly middleware → x-admin-token validation
Public Routes → No authentication required
Chat Routes → Session-based authentication
```

### **Data Flow Patterns**
```
1. Request → Route Handler → Service Layer → Repository Layer → Database
2. Response ← Route Handler ← Service Layer ← Repository Layer ← Database
```

### **Error Handling Flow**
```
Route Error → errorHandler middleware → Standardized error response
Validation Error → Zod schema validation → 400 Bad Request
Authentication Error → adminOnly middleware → 401 Unauthorized
```

### **Service Integration**
```
Document Routes → document.service.js → Python Sidecar
Chat Routes → chat-orchestrator.service.js → OpenAI API
Admin Routes → Various services → Supabase Database
```

This detailed routing architecture shows exactly how each route connects to services, what data it processes, and how the entire request/response flow works through your application.
