# Configuration Guide

## Overview

This guide covers all configuration options for the Reimagined App V2 system, including environment variables, service configurations, and deployment settings.

## Environment Variables

### Required Configuration

#### Supabase Configuration
```bash
# Supabase project URL
SUPABASE_URL=https://your-project.supabase.co

# Service role key (for server-side operations)
SUPABASE_SERVICE_KEY=your_service_role_key

# Optional: Anonymous key (for client-side operations)
SUPABASE_ANON_KEY=your_anon_key
```

#### Pinecone Configuration
```bash
# Pinecone API key
PINECONE_API_KEY=your_pinecone_api_key

# Pinecone index name
PINECONE_INDEX=your_index_name

# Pinecone region
PINECONE_REGION=us-east-1

# Pinecone cloud provider
PINECONE_CLOUD=aws

# Namespace for document vectors
PINECONE_NAMESPACE=REIMAGINEDDOCS
```

#### OpenAI Configuration
```bash
# OpenAI API key
OPENAI_API_KEY=your_openai_api_key

# OpenAI model for embeddings
OPENAI_MODEL=gpt-4
```

#### Python Sidecar Configuration
```bash
# Python sidecar URL
PYTHON_SIDECAR_URL=http://localhost:8000
```

### Optional Configuration

#### Application Settings
```bash
# Environment
NODE_ENV=development

# Server port
PORT=3000

# Application version
APP_VERSION=1.0.0

# Admin authentication token
ADMIN_TOKEN=your_admin_token
```

#### Logging Configuration
```bash
# Log level
LOG_LEVEL=info

# Log format
LOG_FORMAT=json

# Log file location
LOG_FILE=logs/combined.log
```

#### Security Configuration
```bash
# CORS origins (comma-separated)
CORS_ORIGINS=http://localhost:3000,https://yourdomain.com

# Rate limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=500

# Request size limits
MAX_REQUEST_SIZE=2mb
```

## Service Configuration

### Node.js Server

#### Express Configuration
```javascript
// src/config/env.js
export const config = {
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  appVersion: process.env.APP_VERSION || '1.0.0',
  
  // Supabase
  supabase: {
    url: process.env.SUPABASE_URL,
    serviceKey: process.env.SUPABASE_SERVICE_KEY,
    anonKey: process.env.SUPABASE_ANON_KEY
  },
  
  // Pinecone
  pinecone: {
    apiKey: process.env.PINECONE_API_KEY,
    index: process.env.PINECONE_INDEX,
    region: process.env.PINECONE_REGION,
    cloud: process.env.PINECONE_CLOUD,
    namespace: process.env.PINECONE_NAMESPACE
  },
  
  // OpenAI
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL || 'gpt-4'
  },
  
  // Python Sidecar
  pythonSidecar: {
    url: process.env.PYTHON_SIDECAR_URL || 'http://localhost:8000'
  }
};
```

#### Middleware Configuration
```javascript
// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"]
    }
  }
}));

// CORS configuration
app.use(cors({
  origin: process.env.CORS_ORIGINS?.split(',') || ['http://localhost:3000'],
  credentials: true
}));

// Rate limiting
app.use(rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 500
}));
```

### Python Sidecar

#### FastAPI Configuration
```python
# python-sidecar/app/main.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(
    title="Document Processing Sidecar",
    version="1.0.0",
    description="Python sidecar for document processing and DIP generation"
)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

#### Environment Configuration
```python
# python-sidecar/app/config.py
import os

class Config:
    # Supabase
    SUPABASE_URL = os.getenv("SUPABASE_URL")
    SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY")
    
    # Pinecone
    PINECONE_API_KEY = os.getenv("PINECONE_API_KEY")
    PINECONE_INDEX = os.getenv("PINECONE_INDEX")
    PINECONE_REGION = os.getenv("PINECONE_REGION")
    PINECONE_CLOUD = os.getenv("PINECONE_CLOUD")
    PINECONE_NAMESPACE = os.getenv("PINECONE_NAMESPACE", "REIMAGINEDDOCS")
    
    # OpenAI
    OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
    OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4")
```

## Database Configuration

### Supabase Setup

#### Database Schema
```sql
-- documents table
CREATE TABLE documents (
    doc_id TEXT PRIMARY KEY,
    filename TEXT NOT NULL,
    file_size INTEGER,
    content_type TEXT,
    manufacturer TEXT,
    model TEXT,
    language TEXT DEFAULT 'en',
    revision_date TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- document_chunks table
CREATE TABLE document_chunks (
    chunk_id TEXT PRIMARY KEY,
    doc_id TEXT NOT NULL REFERENCES documents(doc_id),
    content_type TEXT NOT NULL CHECK (content_type IN ('text', 'table', 'image')),
    section_path TEXT,
    page_start INTEGER,
    page_end INTEGER,
    bbox JSONB,
    checksum TEXT NOT NULL,
    ingest_version TEXT,
    parser_version TEXT,
    embed_model TEXT,
    part_numbers TEXT[],
    fault_codes TEXT[],
    standards TEXT[],
    related_ids TEXT[],
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    chunk_index INTEGER,
    text TEXT,
    metadata JSONB DEFAULT '{}'::jsonb
);

-- jobs table
CREATE TABLE jobs (
    job_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    doc_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    counters JSONB DEFAULT '{}'::jsonb
);
```

#### Storage Buckets
```sql
-- Create storage bucket for documents
INSERT INTO storage.buckets (id, name, public) 
VALUES ('documents', 'documents', false);

-- Set up RLS policies
CREATE POLICY "Documents are viewable by authenticated users" ON storage.objects
FOR SELECT USING (bucket_id = 'documents');

CREATE POLICY "Documents are uploadable by authenticated users" ON storage.objects
FOR INSERT WITH CHECK (bucket_id = 'documents');
```

### Pinecone Configuration

#### Index Setup
```python
# python-sidecar/app/pinecone_client.py
import pinecone

# Initialize Pinecone
pinecone.init(
    api_key=os.getenv("PINECONE_API_KEY"),
    environment=os.getenv("PINECONE_REGION")
)

# Create or connect to index
index = pinecone.Index(os.getenv("PINECONE_INDEX"))

# Index configuration
index_config = {
    "name": "reimagined-docs",
    "dimension": 1536,  # OpenAI embedding dimension
    "metric": "cosine",
    "pods": 1,
    "replicas": 1,
    "pod_type": "p1.x1"
}
```

## Docker Configuration

### Node.js Dockerfile
```dockerfile
# Dockerfile
FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY src/ ./src/

# Create logs directory
RUN mkdir -p logs

# Expose port
EXPOSE 3000

# Start application
CMD ["npm", "start"]
```

### Python Sidecar Dockerfile
```dockerfile
# python-sidecar/Dockerfile
FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY app/ ./app/

# Expose port
EXPOSE 8000

# Start application
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

### Docker Compose
```yaml
# docker-compose.sidecar.yml
version: '3.8'

services:
  sidecar:
    build: ./python-sidecar
    ports:
      - "8000:8000"
    environment:
      - SUPABASE_URL=${SUPABASE_URL}
      - SUPABASE_SERVICE_KEY=${SUPABASE_SERVICE_KEY}
      - PINECONE_API_KEY=${PINECONE_API_KEY}
      - PINECONE_INDEX=${PINECONE_INDEX}
      - PINECONE_REGION=${PINECONE_REGION}
      - PINECONE_CLOUD=${PINECONE_CLOUD}
      - PINECONE_NAMESPACE=${PINECONE_NAMESPACE}
      - OPENAI_API_KEY=${OPENAI_API_KEY}
      - OPENAI_MODEL=${OPENAI_MODEL}
    volumes:
      - ./logs:/app/logs
    restart: unless-stopped
```

## Deployment Configuration

### Production Environment

#### Environment Variables
```bash
# Production .env
NODE_ENV=production
PORT=3000

# Supabase (production)
SUPABASE_URL=https://your-prod-project.supabase.co
SUPABASE_SERVICE_KEY=your_prod_service_key

# Pinecone (production)
PINECONE_API_KEY=your_prod_pinecone_key
PINECONE_INDEX=your_prod_index
PINECONE_REGION=us-east-1
PINECONE_CLOUD=aws
PINECONE_NAMESPACE=REIMAGINEDDOCS

# OpenAI (production)
OPENAI_API_KEY=your_prod_openai_key
OPENAI_MODEL=gpt-4

# Python Sidecar
PYTHON_SIDECAR_URL=http://sidecar:8000

# Security
ADMIN_TOKEN=your_secure_admin_token
CORS_ORIGINS=https://yourdomain.com
RATE_LIMIT_MAX_REQUESTS=1000
```

#### Production Docker Compose
```yaml
# docker-compose.prod.yml
version: '3.8'

services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - PORT=3000
      - SUPABASE_URL=${SUPABASE_URL}
      - SUPABASE_SERVICE_KEY=${SUPABASE_SERVICE_KEY}
      - PINECONE_API_KEY=${PINECONE_API_KEY}
      - PINECONE_INDEX=${PINECONE_INDEX}
      - PINECONE_REGION=${PINECONE_REGION}
      - PINECONE_CLOUD=${PINECONE_CLOUD}
      - PINECONE_NAMESPACE=${PINECONE_NAMESPACE}
      - OPENAI_API_KEY=${OPENAI_API_KEY}
      - OPENAI_MODEL=${OPENAI_MODEL}
      - PYTHON_SIDECAR_URL=http://sidecar:8000
      - ADMIN_TOKEN=${ADMIN_TOKEN}
      - CORS_ORIGINS=${CORS_ORIGINS}
    depends_on:
      - sidecar
    restart: unless-stopped

  sidecar:
    build: ./python-sidecar
    ports:
      - "8000:8000"
    environment:
      - SUPABASE_URL=${SUPABASE_URL}
      - SUPABASE_SERVICE_KEY=${SUPABASE_SERVICE_KEY}
      - PINECONE_API_KEY=${PINECONE_API_KEY}
      - PINECONE_INDEX=${PINECONE_INDEX}
      - PINECONE_REGION=${PINECONE_REGION}
      - PINECONE_CLOUD=${PINECONE_CLOUD}
      - PINECONE_NAMESPACE=${PINECONE_NAMESPACE}
      - OPENAI_API_KEY=${OPENAI_API_KEY}
      - OPENAI_MODEL=${OPENAI_MODEL}
    restart: unless-stopped
```

## Monitoring Configuration

### Logging Setup
```javascript
// src/utils/logger.js
import winston from 'winston';

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' }),
    new winston.transports.Console({
      format: winston.format.simple()
    })
  ]
});

export default logger;
```

### Health Checks
```javascript
// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: process.env.APP_VERSION,
    environment: process.env.NODE_ENV
  });
});
```

## Security Configuration

### Authentication
```javascript
// Admin middleware
const adminGate = (req, res, next) => {
  const token = req.headers['x-admin-token'];
  if (token !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized'
    });
  }
  next();
};
```

### Input Validation
```javascript
// Zod schemas
import { z } from 'zod';

const documentUploadSchema = z.object({
  manufacturer_norm: z.string().trim().min(1),
  model_norm: z.string().trim().min(1),
  language: z.string().default('en'),
  doc_id: z.string().optional(),
  revision_date: z.string().optional(),
  ocr: z.boolean().optional()
});
```

## Performance Configuration

### Rate Limiting
```javascript
// Rate limiting configuration
const rateLimit = require('express-rate-limit');

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500, // limit each IP to 500 requests per windowMs
  message: 'Too many requests from this IP'
});

app.use('/api/', limiter);
```

### Caching
```javascript
// Response caching
const cache = require('memory-cache');

const cacheMiddleware = (duration) => {
  return (req, res, next) => {
    const key = req.originalUrl;
    const cached = cache.get(key);
    
    if (cached) {
      return res.json(cached);
    }
    
    res.sendResponse = res.json;
    res.json = (body) => {
      cache.put(key, body, duration * 1000);
      res.sendResponse(body);
    };
    
    next();
  };
};
```

## Troubleshooting Configuration

### Debug Mode
```bash
# Enable debug logging
LOG_LEVEL=debug
NODE_ENV=development

# Enable request logging
DEBUG=express:*
```

### Error Handling
```javascript
// Global error handler
app.use((err, req, res, next) => {
  logger.error('Unhandled error:', err);
  
  res.status(500).json({
    success: false,
    error: process.env.NODE_ENV === 'production' 
      ? 'Internal server error' 
      : err.message
  });
});
```

## Configuration Validation

### Environment Check
```javascript
// src/startup/validateConfig.js
export function validateConfig() {
  const required = [
    'SUPABASE_URL',
    'SUPABASE_SERVICE_KEY',
    'PINECONE_API_KEY',
    'PINECONE_INDEX',
    'OPENAI_API_KEY'
  ];
  
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}
```

### Service Health Checks
```javascript
// Health check for external services
export async function checkServices() {
  const checks = [
    checkSupabase(),
    checkPinecone(),
    checkOpenAI(),
    checkPythonSidecar()
  ];
  
  const results = await Promise.allSettled(checks);
  return results.map((result, index) => ({
    service: ['supabase', 'pinecone', 'openai', 'sidecar'][index],
    status: result.status === 'fulfilled' ? 'healthy' : 'unhealthy',
    error: result.status === 'rejected' ? result.reason.message : null
  }));
}
