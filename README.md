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
- **Modular router architecture** for clean separation of concerns
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
│   │   ├── document.routes.js
│   │   ├── chat.routes.js
│   │   ├── admin.routes.js
│   │   └── health.route.js
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

# Check code formatting
npm run lint

# Build for production
npm run build
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

## 🌐 API Endpoints

### Health & Status
- `GET /health` - Server health check
- `GET /admin/health` - Detailed system health

### Document Management
- `POST /admin/docs/ingest` - Upload and process document
- `GET /admin/docs/ingest/:jobId` - Get job status
- `GET /admin/docs/jobs` - List all jobs
- `GET /admin/docs/documents` - List all documents

### Chat System
- `POST /chat/enhanced/process` - Process chat message
- `GET /chat/enhanced/history/:threadId` - Get chat history
- `GET /chat/enhanced/chats` - List user chats
- `GET /chat/enhanced/context/:threadId` - Get chat context

### Systems Search
- `GET /systems` - List all systems
- `GET /systems/:assetUid` - Get specific system
- `GET /systems/search?q=query` - Search systems

### Pinecone Vector Search
- `GET /pinecone/search` - Search documents
- `GET /pinecone/stats` - Get index statistics
- `GET /pinecone/chunks/:docId` - Get document chunks

### Admin Dashboard
- `GET /admin` - Admin dashboard UI
- `GET /admin/logs` - System logs
- `GET /admin/systems` - System overview
- `GET /admin/pinecone` - Pinecone status

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
