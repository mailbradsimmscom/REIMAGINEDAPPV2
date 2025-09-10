# Reimagined App V2

Enterprise application scaffold built with **Node.js 20**, **Express.js**, **ES modules**, and **Python sidecar** for document processing.

## 🚀 Quick Start

### Prerequisites

- **Node.js 20+** (Required for ES modules and native features)
- **Docker & Docker Compose** (For containerized services)
- **Git** (For version control)

### 1. Clone and Setup

```bash
# Clone the repository
git clone <your-repo-url>
cd REIMAGINEDAPPV2

# Install Node.js dependencies
npm install

# Copy environment template
cp .env.example .env
```

### 2. Environment Configuration

Edit `.env` file with your credentials:

```bash
# Required: Supabase Configuration
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_KEY=your_supabase_service_key

# Required: Pinecone Configuration  
PINECONE_API_KEY=your_pinecone_api_key
PINECONE_INDEX=your_pinecone_index_name
PINECONE_REGION=your_pinecone_region
PINECONE_CLOUD=your_pinecone_cloud
PINECONE_NAMESPACE=REIMAGINEDDOCS

# Required: OpenAI Configuration
OPENAI_API_KEY=your_openai_api_key
OPENAI_MODEL=gpt-4

# Optional: Application Configuration
NODE_ENV=development
PORT=3000
APP_VERSION=1.0.0

# Optional: Search Configuration
SEARCH_RANK_FLOOR=0.5
SEARCH_MAX_ROWS=8
SUMMARY_FREQUENCY=5

# Optional: Python Sidecar Configuration
PYTHON_SIDECAR_URL=http://localhost:8000
SIDECAR_HEALTH_CHECK_INTERVAL=30000
SIDECAR_STARTUP_TIMEOUT=30000
```

### 3. Database Setup

Run the database setup scripts:

```bash
# Setup database schema
psql -h your_supabase_host -U your_username -d your_database -f database-setup.sql

# Setup document processing functions
psql -h your_supabase_host -U your_username -d your_database -f database-document-processing.sql

# Update search systems function
psql -h your_supabase_host -U your_username -d your_database -f update-search-systems-function.sql
```

### 4. Start Services

```bash
# Start all services (Node.js + Python sidecar)
docker-compose up -d

# Or start without containers (development)
npm run dev
```

### 5. Verify Installation

```bash
# Check Node.js server health
curl http://localhost:3000/health

# Check Python sidecar health  
curl http://localhost:8000/health

# Access admin dashboard
open http://localhost:3000/admin
```

## 🧪 Testing

This project uses a comprehensive test suite with:
- **Node.js native test runner** (`node:test`)
- **Supertest** for HTTP integration testing
- **59 integration tests** covering all endpoints
- **Security testing** (headers, CORS, rate limiting, authentication)
- **Validation testing** (Zod schema validation)

### Test Coverage
- ✅ **Health endpoints** - System health monitoring
- ✅ **Systems endpoints** - System management and search
- ✅ **Chat endpoints** - Enhanced chat functionality
- ✅ **Admin endpoints** - Administrative functions (with authentication)
- ✅ **Document endpoints** - Document management
- ✅ **Pinecone endpoints** - Vector database operations
- ✅ **Security features** - Headers, CORS, rate limiting

### Running Tests
```bash
# Run all integration tests
npm test

# Run tests in watch mode
npm run test:watch

# Run all tests (unit + integration)
npm run test:all
```

## 🔄 CI/CD

This project includes a GitHub Actions CI pipeline that:
- **Runs on every push and pull request**
- **Tests against Node.js 20.x**
- **Validates all 59 integration tests**
- **Ensures Express migration stability**
- **Guards against regressions**

### CI Pipeline Features
- ✅ **Automated testing** on push/PR
- ✅ **Environment validation** with mock credentials
- ✅ **Test result reporting** with detailed summaries
- ✅ **Cache optimization** for faster builds
- ✅ **Multi-platform support** (Ubuntu)

The CI pipeline is configured in `.github/workflows/test.yml` and runs automatically when you push to `main` or `develop` branches or create pull requests.

## 🏗️ Architecture

### Express.js Server
- **Modern web framework** with middleware support
- **Modular router architecture** with split endpoint files for maintainability
- **Barrel export pattern** for clean import interfaces
- **Central error handling** with consistent response format
- **Security middleware** with body size limits and admin authentication
- **Static file serving** for frontend assets

### API Endpoints
- **Health**: `/health` - Server health check
- **Systems**: `/systems/*` - Equipment management
- **Chat**: `/chat/enhanced/*` - AI-powered chat interface
- **Admin**: `/admin/*` - Administrative dashboard and tools
- **Documents**: `/admin/docs/*` - Document processing and management
- **Pinecone**: `/pinecone/*` - Vector search and AI operations

### Document Processing Pipeline
- **Upload**: PDF documents via admin interface
- **Processing**: Python sidecar extracts text and creates chunks
- **Persistence**: Chunks stored in Supabase database and storage
- **Embedding**: Text chunks embedded and stored in Pinecone
- **DIP Generation**: Document Intelligence Packets created from chunks
- **Storage**: DIP files and suggestions stored in Supabase storage

### Security Features
- **Admin Gate**: Header-based authentication for admin routes
- **Body Size Limits**: 2MB limit on request bodies
- **Error Handling**: Centralized error middleware
- **Input Validation**: Zod schema validation for all requests

## 📁 Project Structure

```
REIMAGINEDAPPV2/
├── src/
│   ├── config/
│   │   └── env.js                 # Centralized environment config
│   ├── repositories/              # Database access layer
│   │   ├── supabaseClient.js
│   │   ├── document.repository.js
│   │   ├── chat.repository.js
│   │   ├── systems.repository.js
│   │   └── pinecone.repository.js
│   ├── services/                  # Business logic layer
│   │   ├── document.service.js
│   │   ├── chat.service.js
│   │   ├── enhanced-chat.service.js
│   │   ├── pinecone.service.js
│   │   └── systems.service.js
│   ├── routes/                    # HTTP endpoints layer
│   │   ├── health.router.js       # Health check endpoint
│   │   ├── systems.router.js      # Systems management
│   │   ├── pinecone.router.js     # Vector operations
│   │   ├── admin/                 # Admin endpoints (split)
│   │   │   ├── index.js           # Barrel export
│   │   │   ├── dashboard.route.js  # Admin dashboard
│   │   │   ├── health.route.js    # Admin health
│   │   │   ├── systems.route.js   # Admin systems
│   │   │   ├── logs.route.js      # Admin logs
│   │   │   ├── manufacturers.route.js # Admin manufacturers
│   │   │   ├── models.route.js    # Admin models
│   │   │   └── pinecone.route.js  # Admin pinecone
│   │   ├── document/              # Document endpoints (split)
│   │   │   ├── index.js           # Barrel export
│   │   │   ├── ingest.route.js    # Document ingestion
│   │   │   ├── jobs.route.js      # Job listing
│   │   │   ├── job-status.route.js # Job status
│   │   │   ├── documents.route.js # Document listing
│   │   │   └── get-one.route.js   # Single document
│   │   └── chat/                  # Chat endpoints (split)
│   │       ├── index.js           # Barrel export
│   │       ├── process.route.js   # Message processing
│   │       ├── history.route.js    # Chat history
│   │       ├── list.route.js      # Chat listing
│   │       ├── context.route.js   # Chat context
│   │       ├── delete.route.js    # Body-based deletion
│   │       └── session-delete.route.js # Path-based deletion
│   ├── utils/
│   │   └── logger.js              # Centralized logging
│   ├── public/                    # Static files
│   │   ├── index.html
│   │   ├── admin.html
│   │   └── app.js
│   ├── index.js                   # Main server entry point
│   └── start.js                   # Development entry point
├── python-sidecar/                # Python document processing
│   ├── app/
│   │   ├── main.py
│   │   ├── parser.py
│   │   ├── models.py
│   │   └── pinecone_client.py
│   ├── requirements.txt
│   └── Dockerfile
├── logs/                          # Application logs
├── tests/                         # Test files
├── docker-compose.yml             # Container orchestration
├── Dockerfile                     # Node.js container
├── package.json                   # Node.js dependencies
└── README.md                      # This file
```

## 🔧 Development Scripts

### Package Management

```bash
# Install dependencies
npm install

# Add new dependency
npm install package-name

# Update dependencies
npm update

# Check for security vulnerabilities
npm audit
```

### Development Commands

```bash
# Start development server with auto-reload
npm run dev

# Start production server
npm start

# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Generate dependency graphs
npm run docs:generate

# Clean generated documentation
npm run docs:clean
```

### Docker Commands

```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f

# View specific service logs
docker-compose logs -f app
docker-compose logs -f python-sidecar

# Stop all services
docker-compose down

# Rebuild containers
docker-compose up --build -d

# Access container shell
docker-compose exec app sh
docker-compose exec python-sidecar bash
```

### Database Commands

```bash
# Connect to Supabase database
psql -h your_supabase_host -U your_username -d your_database

# Run database migrations
psql -h your_supabase_host -U your_username -d your_database -f database-setup.sql

# Check database tables
psql -h your_supabase_host -U your_username -d your_database -c "\dt"

# Backup database
pg_dump -h your_supabase_host -U your_username your_database > backup.sql
```

## 🌐 API Endpoints & Schemas

### Complete Route List

#### Health & Status
- `GET /health` - Basic server health check
- `GET /health/services` - Service status check (Supabase, Pinecone, OpenAI, Sidecar)
- `GET /health/ready` - Readiness check
- `GET /admin/health` - Detailed system health with memory stats

#### Chat System (Enhanced)
- `POST /chat/enhanced/process` - Process user message with AI response
- `GET /chat/enhanced/history?threadId={id}&limit={n}` - Get chat history
- `GET /chat/enhanced/list?limit={n}&cursor={cursor}` - List user chat sessions
- `GET /chat/enhanced/context?threadId={id}` - Get chat context and metadata
- `DELETE /chat/enhanced/delete` - Delete chat session (body-based)
- `DELETE /chat/{sessionId}` - Delete chat session (path-based)

#### Systems Management
- `GET /systems?limit={n}&cursor={cursor}` - List all systems
- `GET /systems/{assetUid}` - Get specific system by asset UID
- `GET /systems/search?q={query}&limit={n}` - Search systems with relevance ranking

#### Document Management
- `POST /admin/docs/ingest` - Upload and process document
- `GET /admin/docs/ingest/{jobId}` - Get job status
- `GET /admin/docs/jobs?limit={n}&offset={n}` - List all processing jobs
- `GET /admin/docs/documents?limit={n}&offset={n}` - List all documents
- `GET /admin/docs/{docId}` - Get specific document details

#### Pinecone Vector Search
- `POST /pinecone/search` - Search documents with vector similarity
- `GET /pinecone/stats` - Get index statistics and namespace info
- `GET /pinecone/chunks/{docId}` - Get document chunks
- `POST /pinecone/query` - Advanced query with context

#### Admin Dashboard
- `GET /admin` - Admin dashboard UI
- `GET /admin/logs?level={level}&limit={n}&correlationId={id}` - System logs
- `GET /admin/systems` - System overview and counts
- `GET /admin/pinecone` - Pinecone status and sidecar health
- `GET /admin/manufacturers` - Top manufacturers list
- `GET /admin/models?manufacturer={name}` - Models for specific manufacturer

### Zod Schema Documentation

#### Common Schemas (`src/schemas/common.schema.js`)
```typescript
// Pagination for list endpoints
paginationQuerySchema = {
  limit: number (1-100, default: 10),
  offset: number (min: 0, default: 0)
}

// Search query parameters
searchQuerySchema = {
  q: string (min: 2, max: 100)
}
```

#### Health Schemas (`src/schemas/health.schema.js`)
```typescript
// Basic health response
BasicHealthData = {
  status: "healthy",
  timestamp: string (ISO datetime),
  uptime: number
}

// Service status response
ServiceStatusData = {
  status: "healthy" | "degraded",
  services: {
    supabase: boolean,
    pinecone: boolean,
    openai: boolean,
    sidecar: boolean
  },
  timestamp: string (ISO datetime)
}

// Admin health response
AdminHealthData = {
  status: string,
  timestamp: string,
  uptime: number,
  memory: {
    rss: number,
    heapTotal: number,
    heapUsed: number,
    external: number
  },
  environment: string,
  version: string
}
```

#### Chat Schemas (`src/schemas/chat.schema.js`)
```typescript
// Process message request
chatProcessRequestSchema = {
  message: string (min: 1),
  sessionId?: string,
  threadId?: string
}

// Process message response
ChatProcessData = {
  sessionId: string,
  threadId: string,
  userMessage: {
    id: string,
    content: string,
    role: string,
    createdAt: string
  },
  assistantMessage: {
    id: string,
    content: string,
    role: string,
    createdAt: string,
    sources?: array
  },
  systemsContext?: array,
  enhancedQuery?: string,
  sources?: array
}

// Chat history query
chatHistoryQuerySchema = {
  threadId: string (min: 1),
  limit: number (1-100, default: 50)
}

// Chat history response
ChatHistoryData = {
  threadId: string,
  messages: array of {
    id: string,
    content: string,
    role: "system" | "user" | "assistant",
    createdAt: string,
    metadata?: object
  },
  count: number
}

// Chat list query
chatListQuerySchema = {
  limit: number (1-100, default: 20),
  cursor?: string
}

// Chat list response
ChatListData = {
  chats: array of {
    id: string,
    name: string,
    description: string,
    createdAt: string,
    updatedAt: string,
    latestThread?: {
      id: string,
      name: string,
      createdAt: string,
      updatedAt: string,
      metadata?: object
    }
  },
  count: number,
  nextCursor?: string | null
}
```

#### Systems Schemas (`src/schemas/systems.schema.js`)
```typescript
// Systems list query
systemsListQuerySchema = {
  limit?: number (1-100, default: 25),
  cursor?: string
}

// Systems search query
systemsSearchQuerySchema = {
  q: string (2-100 chars),
  limit?: number (1-100)
}

// Systems list response
SystemsListData = {
  systems: array of {
    asset_uid: string,
    system_norm: string,
    subsystem_norm: string,
    manufacturer_norm: string,
    model_norm: string,
    canonical_model_id: string,
    description: string | null,
    manual_url: string | null,
    oem_page: string | null,
    spec_keywords: string | null,
    synonyms_fts: string,
    synonyms_human: string,
    search: string
  },
  nextCursor: string | null
}

// Systems search response
SystemsSearchData = {
  systems: array of {
    // Same as list + rank field
    rank: number
  },
  meta: {
    floor: number,
    maxRows: number,
    rawCount: number,
    filteredCount: number,
    query: string
  }
}
```

#### Document Schemas (`src/schemas/document.schema.js`)
```typescript
// Document ingest metadata
documentIngestMetadataSchema = {
  manufacturer?: string,
  model?: string,
  revisionDate?: string,
  language?: string,
  brandFamily?: string,
  sourceUrl?: string
}

// Document jobs query
documentJobsQuerySchema = {
  limit: number (1-100, default: 50),
  offset: number (min: 0, default: 0)
}

// Document jobs response
DocumentJobsData = {
  jobs: array of {
    job_id: string,
    status: string,
    doc_id: string,
    upload_id: string | null,
    storage_path: string | null,
    params: object,
    counters: object,
    error: object | null,
    created_at: string,
    started_at: string | null,
    updated_at: string,
    completed_at: string | null
  },
  count: number,
  limit: number,
  offset: number
}

// Document list response
DocumentDocumentsData = {
  documents: array of {
    doc_id: string,
    manufacturer: string | null,
    model: string | null,
    revision_date: string | null,
    language: string | null,
    brand_family: string | null,
    source_url: string | null,
    last_ingest_version: string | null,
    last_job_id: string | null,
    last_ingested_at: string | null,
    chunk_count: number,
    table_count: number,
    pages_total: number,
    created_at: string,
    updated_at: string
  },
  count: number,
  limit: number,
  offset: number
}
```

#### Pinecone Schemas (`src/schemas/pinecone.schema.js`)
```typescript
// Pinecone search request
pineconeSearchRequestSchema = {
  query: string (min: 1),
  topK: number (1-100, default: 10),
  namespace?: string,
  filter?: object
}

// Pinecone search response
PineconeSearchData = {
  query: string,
  enhancedQuery: string,
  results: array of {
    documentId: string,
    manufacturer: string,
    model: string,
    filename: string,
    revisionDate: string,
    bestScore: number,
    chunks: array of {
      id: string,
      score: number,
      relevanceScore: number,
      content: string,
      page: number,
      chunkIndex: number,
      chunkType: string
    }
  },
  metadata: {
    totalResults: number,
    searchTime: string
  }
}

// Pinecone stats response
PineconeStatsData = {
  totalVectors: number,
  dimension: number,
  indexFullness: number,
  namespaces: object of {
    vector_count: number
  },
  lastUpdated: string
}
```

#### Admin Schemas (`src/schemas/admin.schema.js`)
```typescript
// Admin logs query
adminLogsQuerySchema = {
  level: "all" | "error" | "warn" | "info" | "debug" (default: "all"),
  limit: number (1-1000, default: 100),
  correlationId?: string
}

// Admin logs response
AdminLogsData = {
  logs: array of {
    timestamp: string,
    level: string,
    message: string,
    correlationId?: string,
    metadata?: object
  },
  count: number,
  timestamp: string
}

// Admin manufacturers response
AdminManufacturersData = {
  total: number,
  top: array of {
    manufacturer_norm: string
  },
  lastUpdated: string
}

// Admin models query
adminModelsQuerySchema = {
  manufacturer: string (min: 1)
}

// Admin models response
AdminModelsData = {
  models: array of {
    model_norm: string,
    manufacturer_norm: string
  },
  count: number,
  manufacturer: string,
  lastUpdated: string
}

// Admin systems response
AdminSystemsData = {
  totalSystems: number,
  lastUpdated: string,
  databaseStatus: string,
  documentsCount: number,
  jobsCount: number
}

// Admin pinecone response
AdminPineconeData = {
  status: string,
  index: string,
  namespace: string,
  vectors: string | number,
  totalVectors: number,
  dimension: string | number,
  indexFullness: string,
  lastChecked: string,
  sidecarHealth: {
    status: string,
    version?: string,
    tesseractAvailable?: boolean,
    error?: string
  }
}
```

#### Envelope Schema (`src/schemas/envelope.schema.js`)
```typescript
// Standard response envelope
EnvelopeSchema = {
  success: true | false,
  data?: any,           // Present when success: true
  error?: {             // Present when success: false
    code: string,
    message: string,
    details?: any
  },
  requestId?: string    // Optional correlation ID
}
```

### Schema Validation Features

- **Input Validation**: All request bodies and query parameters validated with Zod
- **Response Validation**: All responses validated against envelope schemas
- **Type Safety**: TypeScript-style type definitions for all data structures
- **Error Handling**: Consistent error envelope format across all endpoints
- **Pagination**: Standardized pagination with `limit`/`offset` or `cursor`-based
- **Filtering**: Query parameter validation for search and filtering operations

## 🔍 Troubleshooting

### Common Issues

#### 1. Python Sidecar Not Starting
```bash
# Check Python sidecar logs
docker-compose logs python-sidecar

# Verify Python dependencies
docker-compose exec python-sidecar pip list

# Restart Python sidecar
docker-compose restart python-sidecar
```

#### 2. Database Connection Issues
```bash
# Test database connection
psql -h your_supabase_host -U your_username -d your_database -c "SELECT 1;"

# Check environment variables
echo $SUPABASE_URL
echo $SUPABASE_SERVICE_KEY
```

#### 3. Pinecone Connection Issues
```bash
# Test Pinecone connection
curl -X GET "https://controller.${PINECONE_REGION}.pinecone.io/databases" \
  -H "Api-Key: ${PINECONE_API_KEY}"

# Check Pinecone index status
curl -X GET "https://controller.${PINECONE_REGION}.pinecone.io/databases/${PINECONE_INDEX}" \
  -H "Api-Key: ${PINECONE_API_KEY}"
```

#### 4. File Upload Issues
```bash
# Check file permissions
ls -la src/public/

# Check storage bucket configuration
# Verify Supabase storage bucket exists and is accessible
```

### Log Locations

- **Application logs**: `logs/combined.log`
- **Error logs**: `logs/error.log`
- **Info logs**: `logs/info.log`
- **Warning logs**: `logs/warn.log`

### Performance Monitoring

```bash
# Monitor system resources
docker stats

# Check application memory usage
curl http://localhost:3000/admin/health | jq '.memory'

# Monitor log file sizes
du -h logs/*.log
```

## 🚀 Deployment

### Production Setup

1. **Environment Configuration**
   ```bash
   NODE_ENV=production
   PORT=3000
   ```

2. **Database Setup**
   ```bash
   # Run production database migrations
   psql -h your_production_host -U your_username -d your_database -f database-setup.sql
   ```

3. **Container Deployment**
   ```bash
   # Build production images
   docker-compose -f docker-compose.prod.yml build

   # Deploy to production
   docker-compose -f docker-compose.prod.yml up -d
   ```

### Environment Variables for Production

```bash
# Required for production
NODE_ENV=production
SUPABASE_URL=your_production_supabase_url
SUPABASE_SERVICE_KEY=your_production_service_key
PINECONE_API_KEY=your_production_pinecone_key
OPENAI_API_KEY=your_production_openai_key

# Optional production settings
PORT=3000
LOG_LEVEL=info
SIDECAR_HEALTH_CHECK_INTERVAL=60000
```

## 📚 Architecture

### Design Principles

- **Repository Pattern**: All database access through repositories
- **Service Layer**: Business logic in services only
- **Route Layer**: HTTP endpoints only
- **ES Modules**: Modern JavaScript with import/export
- **Containerization**: Docker for consistent environments
- **Microservices**: Node.js + Python sidecar architecture

### Technology Stack

- **Backend**: Node.js 20 with ES modules
- **Database**: Supabase (PostgreSQL)
- **Vector Database**: Pinecone
- **AI/ML**: OpenAI GPT-4
- **Document Processing**: Python with FastAPI
- **Containerization**: Docker & Docker Compose
- **Logging**: Structured JSON logging

## 🤝 Contributing

1. Follow the cursor rules in `.cursorrules`
2. Keep files under 260 lines
3. Use ES modules only
4. Follow repository/service/route separation
5. Add proper logging for new features
6. Test changes before committing

## 📄 License

This project is proprietary and confidential.

---

**Need Help?** Check the logs in `logs/` directory or contact the development team.
