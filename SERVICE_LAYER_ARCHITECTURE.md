# Service Layer Architecture - Complete Module Analysis

## 🧠 **Core Service Modules**

### **Chat Orchestrator Service** (`src/services/chat-orchestrator.service.js`)

**Purpose**: Main chat processing coordinator - orchestrates entire chat flow
**What it does**:
- Processes user chat messages end-to-end
- Coordinates multiple AI services
- Manages chat context and thread state
- Handles special intents (summarize, asset_summary)

**What it imports**:
```javascript
// Core Services
import { routeQuery } from './intent-router.service.js';
import { getFactFirstResponse, shouldAttemptFactFirst } from './fact-first.service.js';
import { retrieveWithSpecBias } from './pinecone-retrieval.service.js';
import { generateEnhancedAssistantResponse } from './assistant-response.service.js';
import { summarizeThread, generateThreadName, shouldSummarizeThread } from './summarization.service.js';

// Repositories
import { searchSystems } from '../repositories/systems.repository.js';
import chatRepository from '../repositories/chat.repository.js';

// Utilities
import { enhanceQuery } from './llm.service.js';
import { logger } from '../utils/logger.js';
import { isSupabaseConfigured, isOpenAIConfigured, isPineconeConfigured } from './guards/index.js';
import { 
  isFollowUpQuestion, 
  containsAmbiguousPronoun, 
  extractEquipmentTerms,
  hasExistingSystemsContext,
  getExistingSystemsContext,
  contextRewrite,
  withTimeout
} from '../utils/context-utils.js';
```

**Key Functions**:
- `processUserMessage()` - Main chat processing pipeline
- `checkServiceAvailability()` - Validates required services (Supabase, OpenAI, Pinecone)
- `handleSpecialIntent()` - Handles summarize/asset_summary intents
- `bootstrapContext()` - Builds chat context
- `storeMessagesAndUpdateThread()` - Persists chat data

**How it connects**:
- **Input**: User query from chat routes
- **Output**: AI assistant response
- **Dependencies**: Intent router, fact-first service, Pinecone retrieval, response generation

---

### **Document Service** (`src/services/document.service.js`)

**Purpose**: Document ingestion and processing coordinator
**What it does**:
- Handles document upload and processing
- Creates and manages processing jobs
- Coordinates with Python sidecar for PDF processing
- Manages DIP generation pipeline

**What it imports**:
```javascript
// Core Dependencies
import { getSupabaseClient, getSupabaseStorageClient } from '../repositories/supabaseClient.js';
import documentRepository from '../repositories/document.repository.js';
import { lookupSystemByManufacturerAndModel } from '../repositories/systems.repository.js';
import { logger } from '../utils/logger.js';
import { getEnv } from '../config/env.js';
import { isSupabaseConfigured, isSidecarConfigured } from '../services/guards/index.js';
import { systemMetadataSchema } from '../schemas/uploadDocument.schema.js';
import dipService from './dip.service.js';
```

**Key Functions**:
- `ingestDocument()` - Document upload processing
- `processJob()` - Background job processing
- `callPythonSidecar()` - PDF processing via Python sidecar
- `checkSidecarAvailability()` - Sidecar health check
- `checkSupabaseAvailability()` - Database health check
- `simulateProcessing()` - Testing mode processing

**How it connects**:
- **Input**: Document upload from admin routes
- **Output**: Processing jobs and DIP packets
- **Dependencies**: Python sidecar, Supabase, DIP service

---

### **Job Processor Service** (`src/services/job.processor.js`)

**Purpose**: Background worker for processing queued DIP jobs
**What it does**:
- Continuously processes queued jobs
- Updates job status and progress
- Handles job failures and error reporting
- Runs as separate process

**What it imports**:
```javascript
import documentService from './document.service.js';
import documentRepository from '../repositories/document.repository.js';
import { logger } from '../utils/logger.js';
```

**Key Functions**:
- `processPendingJobs()` - Continuous job processing loop
- `processJob()` - Individual job processing
- `sleep()` - Utility for job polling intervals

**How it connects**:
- **Input**: Queued jobs from database
- **Output**: Processed jobs and DIP packets
- **Dependencies**: Document service, document repository

---

## 🤖 **AI/ML Service Modules**

### **Intent Router Service** (`src/services/intent-router.service.js`)

**Purpose**: Query classification and routing
**What it does**:
- Classifies user intents (question, command, summarize, etc.)
- Routes queries to appropriate processing pipelines
- Determines processing strategy based on intent

**Key Functions**:
- `classifyUserIntent()` - Intent classification using LLM
- `routeQuery()` - Query routing logic
- `determineProcessingPipeline()` - Pipeline selection

**How it connects**:
- **Input**: User queries from chat orchestrator
- **Output**: Intent classification and routing decisions
- **Dependencies**: LLM service, OpenAI API

---

### **Fact-First Service** (`src/services/fact-first.service.js`)

**Purpose**: Fact-based response system
**What it does**:
- Provides fact-based responses from knowledge base
- Checks if query can be answered with existing facts
- Bypasses vector search for known facts

**Key Functions**:
- `getFactFirstResponse()` - Fact retrieval and response generation
- `shouldAttemptFactFirst()` - Decision logic for fact-first approach
- `checkKnowledgeBase()` - Knowledge base queries

**How it connects**:
- **Input**: User queries from chat orchestrator
- **Output**: Fact-based responses or null
- **Dependencies**: Knowledge repository, LLM service

---

### **Pinecone Retrieval Service** (`src/services/pinecone-retrieval.service.js`)

**Purpose**: Vector database operations and retrieval
**What it does**:
- Performs semantic search using Pinecone
- Implements spec-biased retrieval
- Manages vector embeddings and similarity search

**Key Functions**:
- `retrieveWithSpecBias()` - Spec-biased vector retrieval
- `performPineconeRetrieval()` - Main vector search
- `enhanceQueryWithSpecs()` - Query enhancement with specifications

**How it connects**:
- **Input**: Enhanced queries from chat orchestrator
- **Output**: Relevant document chunks and metadata
- **Dependencies**: Pinecone repository, Pinecone API

---

### **Assistant Response Service** (`src/services/assistant-response.service.js`)

**Purpose**: AI response generation
**What it does**:
- Generates AI assistant responses
- Combines context, retrieved data, and user query
- Formats responses for chat interface

**Key Functions**:
- `generateEnhancedAssistantResponse()` - Main response generation
- `combineContextAndRetrieval()` - Context combination
- `formatResponse()` - Response formatting

**How it connects**:
- **Input**: User query, context, retrieved data
- **Output**: Formatted AI response
- **Dependencies**: LLM service, OpenAI API

---

### **Summarization Service** (`src/services/summarization.service.js`)

**Purpose**: Chat thread management and summarization
**What it does**:
- Summarizes long chat threads
- Generates thread names
- Manages thread state and context

**Key Functions**:
- `summarizeThread()` - Thread summarization
- `generateThreadName()` - Thread naming
- `shouldSummarizeThread()` - Summarization decision logic

**How it connects**:
- **Input**: Chat threads and messages
- **Output**: Summarized threads and names
- **Dependencies**: LLM service, chat repository

---

## 📄 **DIP Pipeline Services**

### **DIP Service** (`src/services/dip.service.js`)

**Purpose**: Document Intelligence Packet generation
**What it does**:
- Generates DIP packets from documents
- Coordinates with Python sidecar for processing
- Manages DIP file creation and storage

**What it imports**:
```javascript
import { logger } from '../utils/logger.js';
import { getEnv } from '../config/env.js';
```

**Key Functions**:
- `generateDIP()` - DIP packet generation
- `runDIPPacket()` - Complete DIP processing
- `checkDIPAvailability()` - DIP service health check

**How it connects**:
- **Input**: Document files and metadata
- **Output**: DIP packets and insights
- **Dependencies**: Python sidecar, document repository

---

### **DIP Generation Service** (`src/services/dip.generation.service.js`)

**Purpose**: Orchestrates DIP and suggestion generation
**What it does**:
- Coordinates complete DIP pipeline
- Generates AI suggestions from DIP data
- Manages suggestion storage and processing

**Key Functions**:
- `generateDIPAndSuggestions()` - Complete pipeline orchestration
- `processDIPData()` - DIP data processing
- `generateSuggestions()` - AI suggestion generation

**How it connects**:
- **Input**: Document processing jobs
- **Output**: DIP packets and AI suggestions
- **Dependencies**: DIP service, suggestions service

---

### **Suggestions Merge Service** (`src/services/suggestions.merge.service.js`)

**Purpose**: Merges approved suggestions into production
**What it does**:
- Accepts and processes approved suggestions
- Merges suggestions into production tables
- Creates audit trails for changes
- Implements idempotency

**What it imports**:
```javascript
import { logger } from '../utils/logger.js';
import { getSupabaseClient } from '../repositories/supabaseClient.js';
import { getSystemByUid, updateSpecKeywords } from '../repositories/systems.repository.js';
import { addSpecTag } from '../repositories/document-chunks.repository.js';
```

**Key Functions**:
- `acceptSpecSuggestion()` - Accept spec suggestions
- `upsertSpec()` - Spec upsert helper
- `createAuditTrail()` - Audit logging
- `checkIdempotency()` - Duplicate prevention

**How it connects**:
- **Input**: Approved suggestions from admin
- **Output**: Updated production data
- **Dependencies**: Systems repository, document chunks repository

---

## 🔧 **Utility Services**

### **LLM Service** (`src/services/llm.service.js`)

**Purpose**: Large Language Model operations
**What it does**:
- Provides LLM API access
- Handles query enhancement
- Manages LLM configuration and responses

**Key Functions**:
- `enhanceQuery()` - Query enhancement
- `generateResponse()` - LLM response generation
- `classifyIntent()` - Intent classification

**How it connects**:
- **Input**: Text queries and prompts
- **Output**: LLM responses
- **Dependencies**: OpenAI client, OpenAI API

---

### **Query Normalizer Service** (`src/services/query-normalizer.js`)

**Purpose**: Query processing and normalization
**What it does**:
- Normalizes user queries
- Processes query text
- Handles query formatting

**Key Functions**:
- `normalizeQuery()` - Query normalization
- `processQuery()` - Query processing
- `formatQuery()` - Query formatting

**How it connects**:
- **Input**: Raw user queries
- **Output**: Normalized queries
- **Dependencies**: Text processing utilities

---

### **View Refresh Service** (`src/services/viewRefresh.service.js`)

**Purpose**: Database view management
**What it does**:
- Refreshes database views
- Manages view updates
- Handles view dependencies

**Key Functions**:
- `refreshKnowledgeFactsViewSafe()` - Safe view refresh
- `updateViews()` - View updates
- `checkViewDependencies()` - Dependency checking

**How it connects**:
- **Input**: View refresh requests
- **Output**: Updated database views
- **Dependencies**: Supabase client, database

---

## 🔗 **Service Dependencies & Data Flow**

### **Chat Processing Flow**
```
1. User Query → Chat Orchestrator
2. Intent Classification → Intent Router Service
3. Context Bootstrap → Context Utils
4. Fact-First Check → Fact-First Service
5. Vector Retrieval → Pinecone Retrieval Service
6. Response Generation → Assistant Response Service
7. Thread Management → Summarization Service
8. Storage → Chat Repository
```

### **Document Processing Flow**
```
1. Upload → Document Service
2. Job Creation → Document Repository
3. Job Processing → Job Processor Service
4. Python Sidecar → PDF Processing
5. DIP Generation → DIP Service
6. Vector Storage → Pinecone Repository
7. Suggestions → Suggestions Repository
8. Admin Approval → Suggestions Merge Service
```

### **Service Dependencies**
```
Chat Orchestrator → Intent Router → LLM Service → OpenAI API
Chat Orchestrator → Fact-First Service → Knowledge Repository
Chat Orchestrator → Pinecone Retrieval → Pinecone Repository
Chat Orchestrator → Assistant Response → LLM Service
Document Service → DIP Service → Python Sidecar
Job Processor → Document Service → Python Sidecar
Suggestions Merge → Systems Repository → Supabase
```

### **External Service Integration**
```
LLM Service → OpenAI API
Pinecone Retrieval → Pinecone API
Document Service → Python Sidecar
All Services → Supabase Database
View Refresh → Supabase Views
```

This comprehensive service layer analysis shows exactly how each service module works, what it imports, what it does, and how all the services connect together to form the complete application architecture.
