# Code Update #44: Render Deployment Guide - Complete Production Setup

**Date:** 2025-11-15
**Status:** 📋 READY FOR DEPLOYMENT
**Priority:** HIGH - Production Infrastructure Migration

---

## 🎯 **What This Guide Does**

Moves your entire BoatOS system from running on your laptop to Render.com cloud hosting, making it accessible globally 24/7.

**What gets deployed:**
- Main App (chat interface, document processing, anchor watch)
- Python Sidecar (AI/LLM processing)
- Maintenance Agent (task management)

**What stays the same:**
- Supabase (database) - already cloud-based ✅
- Pinecone (vectors) - already cloud-based ✅
- Raspberry Pi GPS - writes directly to Supabase ✅
- All your data and configurations

---

## ⏱️ **Time Estimate**

- **Setup & Configuration:** 1-2 hours
- **Initial Deployment:** 30-45 minutes (build times)
- **Testing & Verification:** 30-60 minutes
- **DNS Propagation:** 0-48 hours (usually instant)

**Total:** Plan for 2-4 hours for complete migration

---

## 💰 **Monthly Cost: $39**

| Service | Tier | RAM | Cost |
|---------|------|-----|------|
| Main App | Starter | 512MB | $7/mo |
| Python Sidecar | Standard | 2GB | $25/mo |
| Maintenance Agent | Starter | 512MB | $7/mo |
| **Total** | | | **$39/mo** |

**Free Tier Option:** Start with free tier ($0/mo) to test, then upgrade once verified.

---

## 📋 **Prerequisites Checklist**

Before you start, make sure you have:

- [ ] Render.com account (sign up at https://render.com)
- [ ] GitHub account connected to Render
- [ ] Access to DNS settings for `catamaranos.com`
- [ ] All API keys ready (see Section 1 below)
- [ ] Code pushed to GitHub on correct branches:
  - [ ] Main app: `Stable-v4-Working` branch
  - [ ] Maintenance agent: `Agent-Enablement` branch

---

# PART 1: USER INSTRUCTIONS (For Brad)

## Step 1: Gather All Environment Variables

You'll need to set 35+ environment variables. **Copy this template and fill in your actual values.**

### 📝 **Main App Environment Variables** (Service 1)

Create a file locally called `main-app-env.txt` with these values:

```bash
# Runtime
NODE_ENV=production
PORT=3000
APP_VERSION=1.0.0

# Admin Authentication
ADMIN_TOKEN=<GENERATE_NEW_STRONG_TOKEN_HERE>
# ☝️ Use a password generator for this! Make it 32+ characters

# Cross-Service URLs (Fill these in AFTER deploying services - see Step 3)
PYTHON_SIDECAR_URL=https://boatos-python.onrender.com
MAINTENANCE_SERVICE_URL=https://admin.catamaranos.com

# Supabase
SUPABASE_URL=<your_supabase_project_url>
SUPABASE_SERVICE_KEY=<your_supabase_service_role_key>
SUPABASE_ANON_KEY=<your_supabase_anon_key>

# Pinecone
PINECONE_API_KEY=<your_pinecone_api_key>
PINECONE_INDEX=<your_index_name>
PINECONE_ENVIRONMENT=<your_environment>
PINECONE_NAMESPACE=REIMAGINEDDOCS
DEFAULT_NAMESPACE=REIMAGINEDDOCS

# OpenAI
OPENAI_API_KEY=<your_openai_api_key>
OPENAI_MODEL=gpt-4.1-mini

# LlamaParse
LLAMAPARSE_API_KEY=<your_llamaparse_key>

# Anthropic
ANTHROPIC_API_KEY=<your_anthropic_key>

# Perplexity
PERPLEXITY_API_KEY=<your_perplexity_key>

# Timeouts & Config
PYTHON_CHAT_TIMEOUT_MS=120000
CHAT_CONTEXT_SIZE=20
CONTEXT_LOADING_TIMEOUT_MS=1800
SYSTEM_SEARCH_TIMEOUT_MS=1200

# Document Processing
DOC_CHUNKS_TABLE=document_chunks
DOC_CHUNKS_PAGE_COL=page_start
DOC_CHUNKS_TEXT_COL=content

# Anthropic Rate Limiting
ANTHROPIC_API_DELAY=1.2

# Anchor Watch Configuration
ANCHOR_WATCH_SAFE_RATIO=0.7
ANCHOR_WATCH_WARNING_RATIO=0.9
ANCHOR_WATCH_CENTROID_SAMPLES=20
ANCHOR_WATCH_STALE_THRESHOLD_SEC=300
```

---

### 📝 **Python Sidecar Environment Variables** (Service 2)

Create `python-sidecar-env.txt`:

```bash
# Runtime
PORT=8000
NODE_ENV=production

# Supabase
SUPABASE_URL=<your_supabase_project_url>
SUPABASE_SERVICE_KEY=<your_supabase_service_role_key>

# OpenAI
OPENAI_API_KEY=<your_openai_api_key>

# Anthropic
ANTHROPIC_API_KEY=<your_anthropic_key>

# Perplexity
PERPLEXITY_API_KEY=<your_perplexity_key>

# Pinecone
PINECONE_API_KEY=<your_pinecone_api_key>
PINECONE_INDEX=<your_index_name>
PINECONE_ENVIRONMENT=<your_environment>

# LlamaParse
LLAMAPARSE_API_KEY=<your_llamaparse_key>

# Feature Flags
USE_SEMANTIC_CHUNKING=true

# Logging
LOG_LEVEL=INFO
```

---

### 📝 **Maintenance Agent Environment Variables** (Service 3)

Create `maintenance-agent-env.txt`:

```bash
# Runtime
NODE_ENV=production
PORT=3001

# Supabase
SUPABASE_URL=<your_supabase_project_url>
SUPABASE_SERVICE_KEY=<your_supabase_service_role_key>

# Pinecone
PINECONE_API_KEY=<your_pinecone_api_key>
PINECONE_INDEX=<your_index_name>
PINECONE_ENVIRONMENT=<your_environment>

# OpenAI
OPENAI_API_KEY=<your_openai_api_key>

# Admin Token (same as main app)
ADMIN_TOKEN=<SAME_TOKEN_AS_MAIN_APP>
```

---

## Step 2: Create Services in Render

### 🔧 **Service 1: Main App**

1. **Go to Render Dashboard:** https://dashboard.render.com
2. **Click "New +" → "Web Service"**
3. **Connect Repository:**
   - Select: `mailbradsimmscom/REIMAGINEDAPPV2`
   - Click "Connect"
4. **Configure Service:**
   ```
   Name: boatos-main
   Region: Oregon (US West) - Choose closest to you
   Branch: Stable-v4-Working
   Root Directory: (leave blank)
   Runtime: Node
   Build Command: npm install
   Start Command: npm start
   ```
5. **Choose Plan:**
   - Start with "Free" to test, OR
   - Choose "Starter" ($7/mo) for always-on
6. **Add Environment Variables:**
   - Click "Advanced" → "Add Environment Variable"
   - Copy/paste from `main-app-env.txt` (one at a time or bulk add)
   - **SKIP** `PYTHON_SIDECAR_URL` and `MAINTENANCE_SERVICE_URL` for now
7. **Click "Create Web Service"**
8. **Wait for deployment** (5-10 minutes)
9. **Save the URL:** Copy the URL (e.g., `https://boatos-main.onrender.com`)

---

### 🐍 **Service 2: Python Sidecar**

1. **Click "New +" → "Web Service"**
2. **Connect Repository:**
   - Select: `mailbradsimmscom/REIMAGINEDAPPV2` (same repo!)
   - Click "Connect"
3. **Configure Service:**
   ```
   Name: boatos-python
   Region: Oregon (same as main app)
   Branch: Stable-v4-Working
   Root Directory: python-sidecar
   Runtime: Python 3
   Build Command: pip install -r requirements.txt
   Start Command: python -m app.main
   ```
4. **Choose Plan:**
   - **Recommended:** Standard ($25/mo) - Python needs 2GB RAM for LLM processing
   - OR "Free" to test (may run out of memory)
5. **Add Environment Variables:**
   - Copy/paste from `python-sidecar-env.txt`
6. **Click "Create Web Service"**
7. **Wait for deployment** (10-15 minutes - lots of Python dependencies)
8. **Save the URL:** Copy the URL (e.g., `https://boatos-python.onrender.com`)

---

### 🔧 **Service 3: Maintenance Agent**

1. **Click "New +" → "Web Service"**
2. **Connect Repository:**
   - Select: `mailbradsimmscom/maintenance-agent` (different repo!)
   - Click "Connect"
3. **Configure Service:**
   ```
   Name: boatos-maintenance
   Region: Oregon (same as others)
   Branch: Agent-Enablement
   Root Directory: (leave blank)
   Runtime: Node
   Build Command: npm install
   Start Command: npm start
   ```
4. **Choose Plan:**
   - Start with "Free" to test, OR
   - Choose "Starter" ($7/mo) for always-on
5. **Add Environment Variables:**
   - Copy/paste from `maintenance-agent-env.txt`
6. **Click "Create Web Service"**
7. **Wait for deployment** (5-10 minutes)
8. **Save the URL:** Copy the URL (e.g., `https://boatos-maintenance.onrender.com`)

---

## Step 3: Update Cross-Service URLs

Now that all services are deployed, update the URLs:

### Update Main App (Service 1):

1. Go to "boatos-main" service in Render
2. Click "Environment" tab
3. **Add/Update these variables:**
   ```
   PYTHON_SIDECAR_URL=https://boatos-python.onrender.com
   MAINTENANCE_SERVICE_URL=https://boatos-maintenance.onrender.com
   ```
   **OR** if you want to use custom domain for maintenance:
   ```
   MAINTENANCE_SERVICE_URL=https://admin.catamaranos.com
   ```
4. Click "Save Changes"
5. Service will auto-redeploy (2-3 minutes)

---

## Step 4: Configure Custom Domains

### 🌐 **Set Up chat.catamaranos.com → Main App**

**In Render:**
1. Go to "boatos-main" service
2. Click "Settings" tab
3. Scroll to "Custom Domain"
4. Click "Add Custom Domain"
5. Enter: `chat.catamaranos.com`
6. Copy the CNAME value shown (e.g., `boatos-main.onrender.com`)

**In Your DNS Provider (e.g., Cloudflare, Namecheap):**
1. Log in to DNS management
2. Add a new CNAME record:
   ```
   Type: CNAME
   Name: chat
   Value: boatos-main.onrender.com
   TTL: Auto or 300
   Proxy: Disable (DNS only)
   ```
3. Save

**Back in Render:**
- Wait 1-5 minutes
- Render will auto-verify and provision SSL certificate
- Status will change to "Verified"

---

### 🌐 **Set Up admin.catamaranos.com → Maintenance Agent**

**In Render:**
1. Go to "boatos-maintenance" service
2. Click "Settings" tab
3. Scroll to "Custom Domain"
4. Click "Add Custom Domain"
5. Enter: `admin.catamaranos.com`
6. Copy the CNAME value shown

**In Your DNS Provider:**
1. Add a new CNAME record:
   ```
   Type: CNAME
   Name: admin
   Value: boatos-maintenance.onrender.com
   TTL: Auto or 300
   Proxy: Disable (DNS only)
   ```
2. Save

**Back in Render:**
- Wait for verification
- SSL certificate will be auto-provisioned

---

## Step 5: Test All Services

### ✅ **Test Main App**

1. **Open browser:** https://chat.catamaranos.com (or Render URL if DNS not set up yet)
2. **Check health endpoint:**
   - Go to: `https://chat.catamaranos.com/health`
   - Should see: `{"status":"ok"}`
3. **Test chat interface:**
   - Open: `https://chat.catamaranos.com/`
   - Try sending a chat message
   - Verify it responds

---

### ✅ **Test Python Sidecar**

1. **Open browser:** Use the Render-provided URL (e.g., `https://boatos-python.onrender.com`)
2. **Check health endpoint:**
   - Go to: `https://boatos-python.onrender.com/health`
   - Should see: `{"status":"healthy"}`
3. **Check from Main App:**
   - Chat should work (proves Python connectivity)

---

### ✅ **Test Maintenance Agent**

1. **Open browser:** https://admin.catamaranos.com (or Render URL)
2. **Check health endpoint:**
   - Go to: `https://admin.catamaranos.com/health`
   - Should see: `{"status":"ok"}`
3. **Test mobile dashboard:**
   - Open: `https://chat.catamaranos.com/unified-mobile.html`
   - Check that "Add Task" and "Maintenance" buttons work
   - Verify they navigate to admin.catamaranos.com

---

### ✅ **Test Anchor Watch**

1. **Open:** `https://chat.catamaranos.com/anchor-watch-admin.html`
2. **Verify:**
   - Map loads
   - GPS position shows (from Raspberry Pi → Supabase)
   - Can set anchor position
   - Status updates

---

### ✅ **Test Document Upload**

1. **Open admin dashboard:** `https://chat.catamaranos.com/admin.html`
2. **Login with admin token** (the one you set in env vars)
3. **Upload a test PDF:**
   - Go to "Manage Docs"
   - Upload a small PDF
   - Wait for processing (2-5 minutes)
   - Check status in "Job History"
4. **Verify processing worked:**
   - Check logs in Render (Main App and Python Sidecar)
   - Should see LlamaParse processing
   - Should see chunks created

---

## Step 6: Monitor & Verify

### 📊 **Check Logs**

**For each service:**
1. Go to service in Render dashboard
2. Click "Logs" tab
3. Look for errors (red text)
4. Verify startup messages

**What to look for:**
- Main App: `Server listening on http://0.0.0.0:3000`
- Python: `Application startup complete`
- Maintenance Agent: `Server listening on http://0.0.0.0:3001`

---

### 🚨 **Common Issues & Fixes**

| Issue | Symptom | Fix |
|-------|---------|-----|
| **Service won't start** | Build fails, red status | Check logs, verify env vars are set correctly |
| **Python out of memory** | 503 errors, restarts | Upgrade to Standard tier ($25/mo) |
| **CORS errors** | Chat doesn't work from mobile | Verify `NODE_ENV=production` is set |
| **Chat times out** | Spinning, no response | Check `PYTHON_SIDECAR_URL` is correct |
| **Tasks don't save** | 401/403 errors | Verify `ADMIN_TOKEN` matches across services |
| **GPS not showing** | No position on anchor watch | Check Raspberry Pi is writing to Supabase (unrelated to Render) |

---

## Step 7: Upgrade to Paid Tier (Optional)

If you started with free tier and everything works:

1. Go to each service
2. Click "Settings" → "Instance Type"
3. Select paid tier:
   - Main App: Starter ($7/mo)
   - Python Sidecar: **Standard ($25/mo)** - Needs RAM!
   - Maintenance Agent: Starter ($7/mo)
4. Click "Save"
5. Services will redeploy

**Benefits of paid tier:**
- No cold starts (always on)
- More RAM and CPU
- Better performance
- No 15-minute idle shutdown

---

## Step 8: Update Mobile URL Detection (If Needed)

Your mobile pages auto-detect production URLs. Verify this works:

1. **Test from your phone:**
   - Open: `https://chat.catamaranos.com/unified-mobile.html`
   - Tap "Add Task" or "Maintenance"
   - Should navigate to: `https://admin.catamaranos.com`

2. **If it doesn't work:**
   - Check mobile detection code in `unified-mobile.html`
   - Function `getMaintenanceUrl()` should detect `chat.catamaranos.com`

---

## ✅ **Deployment Complete!**

Once all tests pass, you're done! Your system is now:
- ✅ Running in the cloud 24/7
- ✅ Accessible from anywhere
- ✅ Automatically scaling
- ✅ SSL-secured
- ✅ Backed up by Render

---

## 📱 **Mobile Testing Checklist**

Test from your phone on boat's WiFi or cellular:

- [ ] Open unified mobile dashboard
- [ ] Chat works
- [ ] Anchor watch shows GPS position
- [ ] Can create tasks
- [ ] Can view todos
- [ ] Can complete tasks
- [ ] Cross-navigation works (3000 ↔ 3001)

---

## 🔄 **Rollback Plan**

If something goes wrong and you need to revert to laptop:

1. **Stop using the cloud URLs** - Keep using `http://localhost:3000`
2. **Don't delete laptop setup** - Keep it as backup
3. **Render stays deployed** - You can debug without taking it down
4. **Fix issues** - Deploy updates to fix
5. **Try again** - Switch back to cloud URLs once fixed

**Note:** Your data stays in Supabase either way, so no data loss.

---

## 🎉 **Success Criteria**

You're successfully deployed when:
- ✅ All 3 services show "Live" status in Render
- ✅ Chat works from `https://chat.catamaranos.com`
- ✅ Maintenance agent works from `https://admin.catamaranos.com`
- ✅ Mobile dashboard works on phone
- ✅ Anchor watch shows GPS data
- ✅ Document upload processes successfully
- ✅ No errors in any service logs

---

# PART 2: AI ASSISTANT CONTEXT (For Claude/Sonnet 4.5)

## Overview

This deployment migrates a 3-service marine boat operating system from local laptop development to Render.com cloud hosting. The system is production-ready and currently running locally with native Node.js and Python (no Docker).

---

## System Architecture

### Three Services from Two Git Repositories

**Repository 1: REIMAGINEDAPPV2**
- URL: `https://github.com/mailbradsimmscom/REIMAGINEDAPPV2.git`
- Branch: `Stable-v4-Working`
- Contains:
  - Main Node.js app (port 3000)
  - Python sidecar (port 8000, in `/python-sidecar` subdirectory)

**Repository 2: maintenance-agent**
- URL: `https://github.com/mailbradsimmscom/maintenance-agent.git`
- Branch: `Agent-Enablement`
- Contains:
  - Maintenance agent Node.js app (port 3001)

---

## Service Configurations

### Service 1: Main App (boatos-main)

**Source:**
- Repo: `REIMAGINEDAPPV2`
- Branch: `Stable-v4-Working`
- Root: `/` (project root)

**Runtime:**
- Node.js 20 (native buildpack, NO Docker)
- Build: `npm install`
- Start: `npm start` (runs `node src/start.js`)
- Entry: `src/start.js` → `src/index.js` → Express app

**Responsibilities:**
- Express API server
- Chat proxy (Node.js processing before Python)
- Document upload orchestration
- Admin routes
- Static file serving (frontend HTML/JS)
- Anchor watch API
- Equipment extraction
- Cross-service orchestration

**Dependencies:**
- Python Sidecar (for LLM processing)
- Maintenance Agent (for task management)
- Supabase (database)
- Pinecone (vectors)
- OpenAI, Anthropic, Perplexity APIs

**Environment Variables:** 35+ (see user section above)

**Health Check:** `GET /health` returns `{"status":"ok"}`

**Custom Domain:** `chat.catamaranos.com`

---

### Service 2: Python Sidecar (boatos-python)

**Source:**
- Repo: `REIMAGINEDAPPV2` (SAME as Service 1!)
- Branch: `Stable-v4-Working`
- Root: `/python-sidecar` ← **Critical: Must set root directory**

**Runtime:**
- Python 3.11 (native buildpack, NO Docker)
- Build: `pip install -r requirements.txt`
- Start: `python -m app.main` (FastAPI app)
- Entry: `app/main.py`

**Why No Docker:**
- Previously used Docker for tesseract-ocr system dependency
- Now using LlamaParse (cloud API) exclusively
- No system dependencies needed
- Native buildpack works fine

**Responsibilities:**
- LlamaParse PDF parsing
- Semantic chunking
- Embedding generation (OpenAI)
- Query classification (OpenAI)
- DIP extraction (Anthropic Claude - 4 types)
- Response synthesis (GPT-5 or GPT-4.1-mini)
- Perplexity web search
- Pinecone vector operations

**Memory Requirements:**
- **Minimum:** 1GB (Starter tier)
- **Recommended:** 2GB (Standard tier $25/mo)
- **Why:** LLM processing, embeddings, large context windows

**Environment Variables:** 15+ (see user section above)

**Health Check:** `GET /health` returns `{"status":"healthy"}`

**Access:** Internal only (called by Main App), OR expose on `https://boatos-python.onrender.com`

---

### Service 3: Maintenance Agent (boatos-maintenance)

**Source:**
- Repo: `maintenance-agent` (DIFFERENT repo!)
- Branch: `Agent-Enablement`
- Root: `/` (project root)

**Runtime:**
- Node.js 20 (native buildpack, NO Docker)
- Build: `npm install`
- Start: `npm start` (runs `node src/index.js`)
- Entry: `src/index.js`

**Responsibilities:**
- Autonomous task discovery
- User task management (CRUD)
- Task completion tracking
- Hours tracking
- Agent status monitoring
- ToDo aggregation
- Integration with Pinecone for maintenance schedule extraction

**Dependencies:**
- Supabase (database)
- Pinecone (for task extraction)
- OpenAI (for task discovery)

**Environment Variables:** 10+ (see user section above)

**Health Check:** `GET /health` returns `{"status":"ok"}`

**Custom Domain:** `admin.catamaranos.com`

---

## Cross-Service Communication

### Main App → Python Sidecar
- **URL:** Set via `PYTHON_SIDECAR_URL` env var
- **Value:** `https://boatos-python.onrender.com`
- **Alternative:** Use Render private networking: `http://boatos-python:8000` (faster, free)
- **Endpoints Called:**
  - `POST /v1/process-document` - Document processing
  - `POST /v1/chat/stream` - Chat processing
  - `POST /v1/embeddings` - Generate embeddings
  - `POST /v1/dip/extract` - DIP extraction

### Main App → Maintenance Agent
- **URL:** Set via `MAINTENANCE_SERVICE_URL` env var
- **Value:** `https://admin.catamaranos.com` (after custom domain set up)
- **Alternative:** `https://boatos-maintenance.onrender.com`
- **Endpoints Called:**
  - `GET /admin/api/todo` - Fetch todos for unified mobile
  - (Most communication is user-initiated via frontend)

### Frontend → Both Apps
- **Main App:** `https://chat.catamaranos.com`
- **Maintenance Agent:** `https://admin.catamaranos.com`
- **CORS:** Already configured in `src/app.js:19-43`
  - Production allowlist includes both domains
  - Auto-detects based on `NODE_ENV`

---

## CORS Configuration

**Location:** `src/app.js:19-43`

**Production Allowlist:**
```javascript
const allowedOrigins = env.NODE_ENV === 'production'
  ? [
      'https://chat.catamaranos.com',
      'https://admin.catamaranos.com'
    ]
  : [
      'http://localhost:3000',
      'http://localhost:3001',
      'http://192.168.20.106:3000',
      'http://192.168.20.106:3001'
    ];
```

**Critical:** Must set `NODE_ENV=production` in Render for CORS to work correctly.

---

## Mobile URL Detection

**Location:** `src/public/unified-mobile.html`

**Logic:**
```javascript
function getMaintenanceUrl() {
    const hostname = window.location.hostname;
    const protocol = window.location.protocol;

    // Production
    if (hostname === 'chat.catamaranos.com') {
        return 'https://admin.catamaranos.com';
    }

    // Localhost
    if (hostname === 'localhost') {
        return 'http://localhost:3001';
    }

    // Local IP
    if (hostname.match(/^\d+\.\d+\.\d+\.\d+$/)) {
        return `${protocol}//${hostname}:3001`;
    }

    return 'http://localhost:3001';
}
```

**Behavior:**
- Auto-detects production domain
- Routes to correct maintenance agent URL
- No code changes needed for deployment

---

## Environment Variable Strategy

### Shared Across Services
- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`
- `PINECONE_API_KEY`
- `PINECONE_INDEX`
- `PINECONE_ENVIRONMENT`
- `OPENAI_API_KEY`
- `ADMIN_TOKEN` (main app + maintenance agent)

### Service-Specific
- Main App: `PYTHON_SIDECAR_URL`, `MAINTENANCE_SERVICE_URL`
- Python Sidecar: `LLAMAPARSE_API_KEY`, `ANTHROPIC_API_KEY`, `PERPLEXITY_API_KEY`
- Maintenance Agent: (no unique keys, uses shared ones)

### Critical for Production
- `NODE_ENV=production` (all services)
- `ADMIN_TOKEN` (generate new strong token, 32+ chars)
- `PYTHON_SIDECAR_URL` (set AFTER deploying Python service)
- `MAINTENANCE_SERVICE_URL` (set AFTER deploying maintenance service)

---

## Data Flow Examples

### Document Upload Flow
1. User uploads PDF to Main App: `POST /docs/ingest`
2. Main App validates, stores in Supabase Storage
3. Main App calls Python Sidecar: `POST /v1/process-document`
4. Python: LlamaParse parses PDF
5. Python: Semantic chunking (400-1200 tokens)
6. Python: Generate embeddings (OpenAI)
7. Python: Store in Pinecone
8. Main App: Extract colloquial keywords (OpenAI)
9. Main App: DIP extraction (4x Anthropic Claude calls)
10. Update job status to completed

**Total Time:** 2-5 minutes
**LLM Calls:** 5-7

### Chat Processing Flow
1. User sends message to Main App: `POST /chat/messages`
2. Main App: Get conversation context (last 20 messages)
3. Main App: Extract equipment mentions (parallel keyword + LLM)
4. Main App: Infer relationships if needed (LLM)
5. Main App calls Python Sidecar: `POST /v1/chat/stream`
6. Python: Classify query (OpenAI)
7. Python: Retrieve data (DIP tables + Pinecone)
8. Python: Rank chunks (OpenAI)
9. Python: **PARALLEL:**
   - OpenAI synthesis (GPT-5)
   - Perplexity web search
10. Python: Assemble response with 3 sources
11. Main App: Save to database
12. Frontend: Display with source bubbles

**Total Time:** 10-14 seconds
**LLM Calls:** 4-6

---

## Database Schema (Supabase)

### Key Tables
- `documents` - Document metadata
- `document_chunks` - Text chunks with embeddings
- `jobs` - Processing job status
- `systems` - Equipment catalog (200+ marine systems)
- `chat_sessions` - User sessions
- `chat_threads` - Conversation threads with `equipment_context` JSONB
- `chat_messages` - Individual messages
- `anchor_watch_zones` - Anchor watch configuration
- `anchor_watch_alerts` - Alert history
- `gps_position` - GPS data (written by Raspberry Pi)
- `user_tasks` - User-created tasks
- `boatos_tasks` - System-generated tasks
- `task_completions` - Completion history

### DIP Tables (4 types, 2 versions each)
- `spec_suggestions` / `staging_spec_suggestions`
- `playbook_hints` / `staging_playbook_hints`
- `intent_router` / `staging_intent_router`
- `golden_tests` / `staging_golden_tests`

---

## External Dependencies

### Already Cloud-Based (No Changes Needed)
- ✅ Supabase (PostgreSQL)
- ✅ Pinecone (vectors)
- ✅ OpenAI API
- ✅ Anthropic API
- ✅ Perplexity API
- ✅ LlamaParse API
- ✅ Raspberry Pi GPS → Supabase

### Not in Code (No Deployment)
- Raspberry Pi stays on boat
- Writes directly to Supabase `gps_position` table
- No code changes needed

---

## Deployment Risks & Mitigations

### Risk 1: Python Out of Memory
**Symptom:** Service crashes, 503 errors, restarts
**Cause:** LLM processing needs 2GB RAM
**Fix:** Upgrade to Standard tier ($25/mo)
**Prevention:** Start with Standard tier for Python

### Risk 2: Cold Starts (Free Tier)
**Symptom:** First request after 15 min idle takes 15-30s
**Cause:** Free tier spins down after inactivity
**Fix:** Upgrade to paid tier
**Prevention:** Use paid tier for production

### Risk 3: Environment Variables Not Set
**Symptom:** Service starts but crashes on first request
**Cause:** Missing API keys
**Fix:** Check logs, add missing vars
**Prevention:** Use checklist above

### Risk 4: CORS Errors
**Symptom:** Chat works on Render URL but not custom domain
**Cause:** `NODE_ENV` not set to `production`
**Fix:** Set `NODE_ENV=production`
**Prevention:** Set in initial deployment

### Risk 5: Cross-Service URLs Wrong
**Symptom:** Chat doesn't work, timeouts
**Cause:** `PYTHON_SIDECAR_URL` not set or incorrect
**Fix:** Update env var with correct URL
**Prevention:** Deploy services first, then update URLs

### Risk 6: Build Failures
**Symptom:** "Build failed" status, red in Render
**Cause:** Missing dependencies, wrong root directory
**Fix:** Check logs, verify root directory for Python service
**Prevention:** Test locally before deploying

---

## Testing Strategy

### Smoke Tests (Must Pass)
1. ✅ All 3 services show "Live" in Render
2. ✅ Health endpoints return 200 OK
3. ✅ Chat sends message and gets response
4. ✅ Mobile dashboard loads
5. ✅ Cross-navigation works (3000 ↔ 3001)

### Integration Tests (Should Pass)
1. ✅ Document upload processes successfully
2. ✅ Anchor watch shows GPS data
3. ✅ Tasks can be created
4. ✅ Tasks can be completed
5. ✅ Admin dashboard works

### Performance Tests (Nice to Have)
1. ⏱️ Chat response < 15 seconds
2. ⏱️ Document processing < 5 minutes
3. ⏱️ Page load < 2 seconds
4. ⏱️ No memory errors in logs

---

## Monitoring & Debugging

### Render Dashboard Metrics
- **Metrics Tab:** CPU, Memory, Network usage
- **Logs Tab:** Real-time logs with search
- **Events Tab:** Deployments, restarts, scaling

### Log Locations (In Render)
- **Main App:** Dashboard → boatos-main → Logs
- **Python Sidecar:** Dashboard → boatos-python → Logs
- **Maintenance Agent:** Dashboard → boatos-maintenance → Logs

### Key Log Messages to Look For

**Success:**
```
Main App: "Server listening on http://0.0.0.0:3000"
Python: "Application startup complete"
Python: "INFO:     Uvicorn running on http://0.0.0.0:8000"
Maintenance: "Server listening on http://0.0.0.0:3001"
```

**Errors:**
```
"Cannot find module" → Missing dependency
"ECONNREFUSED" → Service can't reach another service
"401 Unauthorized" → ADMIN_TOKEN mismatch
"Out of memory" → Need to upgrade tier
"Module not found: OPENAI_API_KEY" → Env var not set
```

---

## Cost Optimization

### Free Tier Limitations
- ❌ Spins down after 15 min idle
- ❌ Cold start: 15-30 seconds
- ❌ 512MB RAM (Python will struggle)
- ✅ Good for testing

### Paid Tier Benefits
- ✅ Always on (no cold starts)
- ✅ More RAM (2GB for Python)
- ✅ Better CPU
- ✅ Faster response times

### Recommended Setup ($39/mo)
- Main App: Starter ($7) - 512MB sufficient
- Python: **Standard ($25)** - NEEDS 2GB for LLM processing
- Maintenance: Starter ($7) - 512MB sufficient

### Budget Option ($21/mo)
- All 3 on Starter ($7 each)
- Python may run out of memory during heavy processing
- Monitor and upgrade if needed

---

## DNS Configuration Details

### CNAME Records Needed

**At your DNS provider (e.g., Cloudflare, Namecheap, GoDaddy):**

1. **chat.catamaranos.com**
   ```
   Type: CNAME
   Name: chat
   Value: boatos-main.onrender.com
   TTL: 300 (or Auto)
   Proxy: Disabled (DNS only)
   ```

2. **admin.catamaranos.com**
   ```
   Type: CNAME
   Name: admin
   Value: boatos-maintenance.onrender.com
   TTL: 300 (or Auto)
   Proxy: Disabled (DNS only)
   ```

### SSL Certificates
- Render auto-provisions Let's Encrypt certificates
- Automatically renews
- No manual setup needed
- Takes 1-5 minutes after DNS verification

### Verification
- Render checks DNS every few minutes
- Status shows "Pending" → "Verified"
- SSL certificate issued automatically
- Access via HTTPS (HTTP auto-redirects)

---

## Rollback Procedure

### If Deployment Fails

1. **Don't panic** - Your data is safe in Supabase
2. **Check logs** - Identify the error
3. **Keep laptop running** - Continue using local setup
4. **Fix and redeploy** - Or ask Claude for help
5. **Don't delete services** - Debugging is easier with them running

### Quick Rollback
- Change mobile URLs back to `http://localhost:3000`
- Continue using laptop
- Debug Render deployment
- Try again when ready

---

## Post-Deployment Tasks

### Week 1: Monitor
- Check logs daily
- Monitor memory usage (especially Python)
- Verify all features work
- Test from different devices

### Week 2: Optimize
- Review metrics
- Upgrade Python to Standard if needed
- Set up health check notifications
- Document any issues

### Month 1: Cleanup
- Remove laptop as primary (keep as backup)
- Update bookmarks to production URLs
- Train on Render dashboard
- Set up backup strategy

---

## Troubleshooting Guide

### "Service Unavailable" (503)
- Check service status in Render dashboard
- Look for "Crashed" status
- View logs for crash reason
- Common: Out of memory (upgrade tier)

### Chat Doesn't Respond
1. Check Main App logs for errors
2. Check Python Sidecar logs
3. Verify `PYTHON_SIDECAR_URL` is correct
4. Test Python health endpoint directly

### Mobile Navigation Broken
1. Check CORS configuration
2. Verify `NODE_ENV=production`
3. Check custom domains are set up
4. Test URL detection logic

### Document Upload Fails
1. Check Main App logs
2. Check Python Sidecar logs
3. Verify LlamaParse API key
4. Check Supabase Storage permissions

### Tasks Don't Save
1. Check `ADMIN_TOKEN` matches across services
2. Verify Maintenance Agent is running
3. Check Supabase connection
4. View browser console for errors

---

## Code References for Debugging

### Key Files to Check

**Main App:**
- `src/app.js:19-43` - CORS configuration
- `src/config/env.js` - Environment validation
- `src/routes/admin/index.js` - Admin routes
- `src/services/chat-proxy.service.js` - Chat orchestration
- `src/services/document.service.js` - Document processing

**Python Sidecar:**
- `python-sidecar/app/main.py` - Entry point
- `python-sidecar/app/chunking/parser.py` - LlamaParse integration
- `python-sidecar/requirements.txt` - Python dependencies

**Maintenance Agent:**
- `src/index.js` - Entry point
- `src/services/todo.service.js` - Task aggregation
- `src/config/env.js` - Environment validation

---

## Success Metrics

### Technical Success
- ✅ All services deployed and running
- ✅ All health checks passing
- ✅ No errors in logs
- ✅ Custom domains working
- ✅ SSL certificates active

### Functional Success
- ✅ Chat works from any device
- ✅ Document upload processes
- ✅ Anchor watch shows GPS
- ✅ Mobile dashboard works on phone
- ✅ Tasks can be managed
- ✅ Cross-navigation works

### Performance Success
- ✅ Chat response < 15s
- ✅ No out of memory errors
- ✅ No cold starts (paid tier)
- ✅ Page loads < 3s

---

## Next Steps After Deployment

1. **Update documentation** - Note production URLs
2. **Set up monitoring alerts** - Email on service down
3. **Schedule backups** - Database snapshots
4. **Plan for scaling** - If usage grows
5. **Security review** - Rotate admin token quarterly
6. **Cost review** - Monitor monthly spend

---

**End of AI Context Section**

---

## Notes

- This deployment preserves all existing functionality
- No data migration needed (Supabase stays the same)
- Raspberry Pi GPS continues working (writes directly to Supabase)
- All deprecated code and Dockerfiles are artifacts, ignore them
- System has been running locally for months, code is stable
- Mobile-first design already built in
- CORS already configured for production domains
- URL detection already handles production domains

**Ready to deploy!**
