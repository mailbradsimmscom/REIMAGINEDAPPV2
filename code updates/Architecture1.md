# BoatOS Render Architecture - Production Deployment

**Document Version:** 1.1
**Last Updated:** 2025-11-15 (Added Telegram/SMS notifications)
**Status:** Production Active

---

## Table of Contents

1. [Overview](#overview)
2. [Service Architecture](#service-architecture)
3. [URL Structure](#url-structure)
4. [Cross-Service Communication](#cross-service-communication)
5. [CORS Configuration](#cors-configuration)
6. [Environment Variables](#environment-variables)
7. [Data Flow](#data-flow)
8. [Deployment Process](#deployment-process)
9. [Mobile Navigation System](#mobile-navigation-system)
10. [Notification System](#notification-system)
11. [External Dependencies](#external-dependencies)

---

## Overview

BoatOS is deployed as a **microservices architecture** on Render.com, consisting of 3 independent services that communicate via HTTPS and share a common Supabase PostgreSQL database.

### Design Principles

- **Separation of Concerns:** Each service has a specific responsibility
- **Stateless Services:** All state stored in Supabase, not in-memory
- **Environment-Based Configuration:** Different settings for development vs production
- **Cross-Service Navigation:** Services link to each other via hostname detection
- **Shared Authentication:** Admin token validated by all services

---

## Service Architecture

### Service 1: Main App (boatos-main)

**Purpose:** Public-facing chat interface and admin dashboard
**Port:** 3000 (in production, Render handles HTTPS)
**Technology:** Node.js 20 + Express.js (ESM)
**Repository:** `mailbradsimmscom/REIMAGINEDAPPV2`
**Branch:** `Stable-v4-Working`
**Render URL:** `https://boatos-main.onrender.com`
**Custom Domain:** `https://chat.catamaranos.com` (planned)

**Responsibilities:**
- Serve chat interface (index.html, index-mobile.html)
- Serve admin dashboard (admin.htm)
- Serve testing tools (testing*.html)
- Serve mobile unified dashboard (unified-mobile.html)
- Proxy chat requests to Python sidecar
- Handle document uploads
- Serve anchor watch UI
- Validate admin authentication
- Static file serving

**Key Routes:**
- `GET /` → index.html (desktop chat)
- `GET /public/index-mobile.html` → mobile chat
- `GET /unified-mobile.html` → mobile dashboard
- `GET /public/anchor-watch-admin.html` → anchor watch
- `GET /admin` → admin.htm (dashboard)
- `POST /admin/api/*` → admin APIs (requires x-admin-token)
- `GET /public/*` → static files

**Build Process:**
- Build Command: `npm install`
- Start Command: `node src/server.js`
- Auto-deploy: On git push to Stable-v4-Working

### Service 2: Python Sidecar (boatos-python)

**Purpose:** Heavy LLM processing, document parsing, chat synthesis
**Port:** 8000
**Technology:** Python 3.11 + FastAPI + Uvicorn
**Repository:** `mailbradsimmscom/REIMAGINEDAPPV2` (subdirectory: python-sidecar)
**Branch:** `Stable-v4-Working`
**Render URL:** `https://boatos-python.onrender.com`

**Responsibilities:**
- Process chat messages (DIP extraction, Pinecone search, Perplexity web search)
- Generate chat responses via OpenAI
- Parse PDF documents via LlamaParse
- Extract equipment specifications via Claude
- Generate embeddings for Pinecone
- Handle 3-source data synthesis (DIP + Pinecone + Perplexity)

**Key Endpoints:**
- `POST /chat` → Process chat message, return response with 3 data sources
- `POST /parse-document` → Parse PDF, return chunks
- `GET /health` → Health check
- `GET /pinecone/stats` → Vector database statistics

**Build Process:**
- Build Command: `pip install -r requirements.txt`
- Start Command: `python -m app.main`
- Auto-deploy: On git push to Stable-v4-Working

**Critical APIs Used:**
- OpenAI (embeddings, chat completion)
- Anthropic Claude (DIP extraction)
- Perplexity (web search)
- LlamaParse (PDF parsing)
- Pinecone (vector search)

### Service 3: Maintenance Agent (boatos-maintenance)

**Purpose:** Autonomous maintenance task management and scheduling
**Port:** 3001
**Technology:** Node.js 20 + Express.js (ESM)
**Repository:** `mailbradsimmscom/maintenance-agent`
**Branch:** `Agent-Enablement`
**Render URL:** `https://boatos-maintenance.onrender.com`
**Custom Domain:** `https://admin.catamaranos.com` (planned)

**Responsibilities:**
- Manage user tasks (create, edit, complete, delete)
- Manage BoatOS maintenance tasks (scheduled from manuals)
- Background job processing (task scheduling, reminders)
- Mobile maintenance interface (app-mobile.html)
- User task mobile interface (user-tasks-mobile.html)
- Hours tracking for equipment
- Agent status monitoring

**Key Routes:**
- `GET /app-mobile.html` → mobile maintenance dashboard
- `GET /user-tasks-mobile.html` → add user task
- `GET /edit-user-task-mobile.html` → edit user task
- `GET /admin/api/todo` → get all tasks (requires x-admin-token)
- `POST /admin/api/user-tasks` → create user task
- `POST /admin/api/user-tasks/:id/complete` → complete task
- `GET /health` → health check

**Build Process:**
- Build Command: `npm install`
- Start Command: `node src/index.js`
- Auto-deploy: On git push to Agent-Enablement

**Background Jobs:**
- System processor: Process new systems from manuals
- Scheduler: Create tasks from maintenance schedules
- Cron interval: Every 15 minutes

---

## URL Structure

### Production URLs (Render)

```
Main App:        https://boatos-main.onrender.com
Python Sidecar:  https://boatos-python.onrender.com
Maintenance:     https://boatos-maintenance.onrender.com
```

### Custom Domains (Planned)

```
Chat Interface:  https://chat.catamaranos.com → boatos-main
Admin Dashboard: https://admin.catamaranos.com → boatos-maintenance
```

### Development URLs (Localhost)

```
Main App:        http://localhost:3000
Python Sidecar:  http://localhost:8000
Maintenance:     http://localhost:3001
```

### Local Network URLs (Mobile Testing)

```
Main App:        http://192.168.20.106:3000
Maintenance:     http://192.168.20.106:3001
```

---

## Cross-Service Communication

### Communication Patterns

```
┌──────────────────┐
│  User Browser    │
└────────┬─────────┘
         │
         ↓ (HTTPS)
┌──────────────────────────────────────────────────────┐
│  Main App (boatos-main.onrender.com)                 │
│  - Receives user requests                            │
│  - Serves HTML/CSS/JS                                │
│  - Proxies chat to Python sidecar                    │
└────────┬─────────────────────────────┬───────────────┘
         │                             │
         ↓ (Internal HTTPS)            ↓ (CORS HTTPS)
┌─────────────────────┐    ┌────────────────────────────┐
│  Python Sidecar     │    │  Maintenance Agent         │
│  (boatos-python)    │    │  (boatos-maintenance)      │
│  - Process chat     │    │  - Manage tasks            │
│  - Call LLM APIs    │    │  - Background jobs         │
└──────┬──────────────┘    └────────┬───────────────────┘
       │                            │
       ↓                            ↓
┌─────────────────────────────────────────────────────┐
│  Shared Supabase PostgreSQL Database                │
│  - Chat threads, messages, sessions                 │
│  - Documents, chunks, embeddings metadata           │
│  - Equipment, systems, tasks                        │
│  - User tasks, completions                          │
│  - GPS data (from Raspberry Pi)                     │
└─────────────────────────────────────────────────────┘
       │
       ↓
┌─────────────────────────────────────────────────────┐
│  External Services                                  │
│  - Pinecone (vector database)                       │
│  - OpenAI (LLM, embeddings)                         │
│  - Anthropic Claude (DIP extraction)                │
│  - Perplexity (web search)                          │
│  - LlamaParse (PDF parsing)                         │
└─────────────────────────────────────────────────────┘
```

### Service-to-Service Calls

#### Main App → Python Sidecar

**Endpoint:** `POST https://boatos-python.onrender.com/chat`
**Purpose:** Process chat messages
**Authentication:** None (internal service call)
**Environment Variable:** `PYTHON_SIDECAR_URL`

```javascript
// src/services/chat-proxy.service.js
const pythonUrl = getEnv().PYTHON_SIDECAR_URL; // https://boatos-python.onrender.com
const response = await fetch(`${pythonUrl}/chat`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ message, threadId, ... })
});
```

#### Main App → Maintenance Agent

**Endpoint:** Various (health, tasks, etc.)
**Purpose:** Check status, proxy requests
**Authentication:** None (not currently used in main app)
**Environment Variable:** `MAINTENANCE_SERVICE_URL`

```javascript
// Not heavily used yet - planned for future integration
const maintenanceUrl = getEnv().MAINTENANCE_SERVICE_URL;
```

#### Mobile Browser → Maintenance Agent

**Endpoint:** `GET https://boatos-maintenance.onrender.com/admin/api/todo`
**Purpose:** Fetch user tasks for mobile dashboard
**Authentication:** `x-admin-token` header
**CORS:** Must be configured to allow `boatos-main.onrender.com` origin

```javascript
// src/public/unified-mobile.html
const MAINTENANCE_URL = getMaintenanceUrl(); // Detects hostname
const response = await fetch(`${MAINTENANCE_URL}/admin/api/todo`, {
  headers: { 'x-admin-token': ADMIN_TOKEN }
});
```

---

## CORS Configuration

### Why CORS Matters

CORS (Cross-Origin Resource Sharing) controls which origins can make requests to a service. Without proper CORS configuration, browser-based JavaScript cannot make requests from one Render service to another.

### Main App CORS (src/app.js)

**Allows requests from:**
- Development: `localhost:3000`, `localhost:3001`, `192.168.20.106:3000`, `192.168.20.106:3001`
- Production: `chat.catamaranos.com`, `admin.catamaranos.com`, `boatos-main.onrender.com`, `boatos-python.onrender.com`, `boatos-maintenance.onrender.com`

```javascript
app.use(cors({
  origin: function(origin, callback) {
    const allowedOrigins = env.NODE_ENV === 'development'
      ? ['http://localhost:3000', 'http://localhost:3001',
         'http://192.168.20.106:3000', 'http://192.168.20.106:3001']
      : ['https://chat.catamaranos.com', 'https://admin.catamaranos.com',
         'https://boatos-main.onrender.com',
         'https://boatos-python.onrender.com',
         'https://boatos-maintenance.onrender.com'];

    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));
```

### Maintenance Agent CORS (src/index.js)

**Allows requests from:**
- Development: Same as Main App
- Production: Same as Main App

```javascript
app.use(cors({
  origin: function(origin, callback) {
    const allowedOrigins = config.nodeEnv === 'development'
      ? ['http://localhost:3000', 'http://localhost:3001',
         'http://192.168.20.106:3000', 'http://192.168.20.106:3001']
      : ['https://chat.catamaranos.com', 'https://admin.catamaranos.com',
         'https://boatos-main.onrender.com',
         'https://boatos-maintenance.onrender.com'];

    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));
```

### Python Sidecar CORS

**Status:** Not configured (internal service, called server-side only)
**Why:** Main App calls Python sidecar from Node.js server (server-to-server), not from browser (no CORS needed)

### CORS Troubleshooting

**Symptom:** "Cross-Origin Request Blocked" or "Not allowed by CORS" in browser console

**Checklist:**
1. Is `NODE_ENV=production` set in Render environment?
2. Is the requesting origin in the allowlist?
3. Has the service restarted after CORS changes?
4. Is the browser caching old CORS preflight responses? (Try hard refresh)

---

## Environment Variables

### Critical Variables (All Services)

**NODE_ENV**
- Values: `development` or `production`
- Controls: CORS allowlist, logging behavior, URL detection
- **MUST be `production` in Render**

### Main App (boatos-main)

```bash
# Service configuration
NODE_ENV=production
PORT=3000

# Database
SUPABASE_URL=https://xxxxxxxx.supabase.co
SUPABASE_ANON_KEY=eyJhbGci...
PY_SUPABASE_SERVICE_KEY=eyJhbGci...  # Service role key for admin operations

# External services
PYTHON_SIDECAR_URL=https://boatos-python.onrender.com
MAINTENANCE_SERVICE_URL=https://boatos-maintenance.onrender.com

# Authentication
ADMIN_TOKEN=d0bf5af4f2e469d29e051e39e9569a76a283ad4d5c68935e38321320137b05d0

# AI services (for equipment extraction, if used directly)
OPENAI_API_KEY=sk-proj-...
ANTHROPIC_API_KEY=sk-ant-...
```

### Python Sidecar (boatos-python)

```bash
# Service configuration
NODE_ENV=production
PORT=8000
CHAT_MODULE_ENABLED=true

# Database
SUPABASE_URL=https://xxxxxxxx.supabase.co
SUPABASE_KEY=eyJhbGci...  # Service role key

# AI services
OPENAI_API_KEY=sk-proj-...QBpkA  # MUST be full 168 characters
ANTHROPIC_API_KEY=sk-ant-...
PERPLEXITY_API_KEY=pplx-...

# Vector database
PINECONE_API_KEY=...
PINECONE_INDEX_NAME=boat-manuals
PINECONE_NAMESPACE=default

# Document processing
LLAMA_CLOUD_API_KEY=llx-...
```

### Maintenance Agent (boatos-maintenance)

```bash
# Service configuration
NODE_ENV=production
PORT=3001

# Database
SUPABASE_URL=https://xxxxxxxx.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGci...  # Service role key

# Authentication
ADMIN_TOKEN=d0bf5af4f2e469d29e051e39e9569a76a283ad4d5c68935e38321320137b05d0

# AI services (for task processing)
OPENAI_API_KEY=sk-proj-...
ANTHROPIC_API_KEY=sk-ant-...

# Vector database (for manual search)
PINECONE_API_KEY=...
PINECONE_INDEX_NAME=boat-manuals
PINECONE_NAMESPACE=default
```

### Common Pitfalls

1. **Truncated API Keys:** OpenAI keys are ~168 characters. Render can truncate on paste. Verify full key is saved.
2. **Missing NODE_ENV:** Defaults to development mode, uses wrong CORS/URLs
3. **Wrong Supabase Key:** Main app needs service role key (`PY_SUPABASE_SERVICE_KEY`), not anon key
4. **Service URL Variables:** Must point to Render URLs in production, not localhost

---

## Data Flow

### Chat Message Flow

```
1. User types message in browser
   ↓
2. Browser sends POST to Main App
   POST https://boatos-main.onrender.com/admin/api/chat/threads/:id/messages
   ↓
3. Main App receives request
   - Validates admin token
   - Saves message to Supabase
   ↓
4. Main App proxies to Python Sidecar
   POST https://boatos-python.onrender.com/chat
   ↓
5. Python Sidecar processes message
   - Extracts DIPs (Claude API)
   - Searches Pinecone vectors (OpenAI embeddings + Pinecone query)
   - Searches web (Perplexity API)
   - Synthesizes response (OpenAI chat completion)
   ↓
6. Python Sidecar returns response to Main App
   {
     response: "AI response text",
     dip_results: [...],  // Blue bubbles
     pinecone_results: [...],  // Green bubbles
     perplexity_citations: [...]  // Purple citations
   }
   ↓
7. Main App saves response to Supabase
   ↓
8. Main App returns to browser
   {
     success: true,
     data: {
       message: { id, content, ... },
       response: { ... }
     }
   }
   ↓
9. Browser displays chat response with 3 data sources
```

### User Task Flow

```
1. User opens unified-mobile.html
   ↓
2. JavaScript detects hostname, sets MAINTENANCE_URL
   if (hostname === 'boatos-main.onrender.com')
     MAINTENANCE_URL = 'https://boatos-maintenance.onrender.com'
   ↓
3. Browser fetches tasks from Maintenance Agent
   GET https://boatos-maintenance.onrender.com/admin/api/todo
   Headers: { 'x-admin-token': '...' }
   ↓
4. Maintenance Agent receives request
   - CORS checks origin (boatos-main.onrender.com) ✓ allowed
   - Validates admin token
   - Queries Supabase for user tasks
   ↓
5. Maintenance Agent returns tasks
   {
     success: true,
     data: {
       todos: [
         { id, title, description, dueDate, type: 'user_task', ... },
         ...
       ]
     }
   }
   ↓
6. Browser renders tasks in "User To-Do" section
```

### Anchor Watch Flow

```
1. Raspberry Pi GPS sensor collects coordinates
   ↓
2. Pi writes directly to Supabase (gps_data table)
   INSERT INTO gps_data (latitude, longitude, timestamp, ...)
   ↓
3. User opens anchor-watch-admin.html
   ↓
4. Browser fetches anchor watch status from Main App
   GET https://boatos-main.onrender.com/admin/api/anchor-watch/status
   Headers: { 'x-admin-token': '...' }
   ↓
5. Main App queries Supabase
   - Gets latest GPS reading from gps_data
   - Gets anchor watch settings (if active)
   - Calculates distance from anchor point
   ↓
6. Main App returns status
   {
     success: true,
     data: {
       active: true,
       status: 'safe',  // or 'warning', 'dragging'
       distance_meters: 7,
       radius_meters: 50,
       ...
     }
   }
   ↓
7. Browser displays status on button
   "Anchor Alarm - Safe (7m)"
```

---

## Deployment Process

### Automatic Deployment (Render)

**Trigger:** Git push to monitored branch
**Process:**
1. Developer pushes code to GitHub
2. Render webhook detects new commit
3. Render pulls latest code
4. Render runs build command
5. Render runs start command
6. Service restarts with new code
7. Health check verifies service is up

**Deployment Time:**
- Main App: ~5 minutes
- Python Sidecar: ~8 minutes (pip install slower)
- Maintenance Agent: ~5 minutes

### Manual Deployment

**Via Render Dashboard:**
1. Go to service page
2. Click "Manual Deploy" → "Deploy latest commit"
3. Or click "Clear build cache & deploy" (slower, fresh install)

### Deployment Checklist

Before deploying to production:

- [ ] All tests passing locally
- [ ] Environment variables verified in Render dashboard
- [ ] NODE_ENV=production set for all services
- [ ] CORS allowlists include all necessary origins
- [ ] API keys are complete (not truncated)
- [ ] Submodules updated (if applicable)
- [ ] Git commits pushed to monitored branches
- [ ] Documentation updated

After deployment:

- [ ] Check Render logs for errors
- [ ] Verify health endpoints (`/health`)
- [ ] Test chat interface (all 3 data sources working)
- [ ] Test mobile dashboard (tasks loading, navigation working)
- [ ] Test cross-service navigation (no 404s or CORS errors)
- [ ] Check browser console for JavaScript errors

---

## Mobile Navigation System

### Architecture

The mobile navigation is a **shared component** injected by JavaScript into all mobile pages on the maintenance agent.

**File:** `maintenance-agent/public/js/mobile-nav.js`
**Loaded by:** All `*-mobile.html` pages via `<script src="/js/mobile-nav.js"></script>`

### How It Works

```javascript
// 1. Detect current hostname
const hostname = window.location.hostname;

// 2. Determine URL for port 3000 (Main App)
let port3000Url;
if (hostname === 'admin.catamaranos.com') {
  port3000Url = 'https://chat.catamaranos.com';
} else if (hostname === 'boatos-maintenance.onrender.com') {
  port3000Url = 'https://boatos-main.onrender.com';
} else if (hostname === 'localhost') {
  port3000Url = 'http://localhost:3000';
} else if (hostname.match(/^\d+\.\d+\.\d+\.\d+$/)) {
  port3000Url = `${protocol}//${hostname}:3000`;
} else {
  port3000Url = 'http://localhost:3000';  // Fallback
}

// 3. Set navigation links
document.getElementById('mobileNavHome').href = `${port3000Url}/public/unified-mobile.html`;
document.getElementById('mobileNavAnchor').href = `${port3000Url}/public/anchor-watch-admin.html`;
document.getElementById('mobileNavChat').href = `${port3000Url}/public/index-mobile.html`;
document.getElementById('mobileNavMaintenance').href = '/app-mobile.html';  // Current service
```

### Navigation Bar HTML

```html
<nav class="mobile-bottom-nav">
  <div class="mobile-nav-items">
    <a href="#" id="mobileNavHome" class="mobile-nav-item">
      <div class="mobile-nav-icon">🏠</div>
      <div class="mobile-nav-label">Home</div>
    </a>
    <a href="#" id="mobileNavAnchor" class="mobile-nav-item">
      <div class="mobile-nav-icon">⚓</div>
      <div class="mobile-nav-label">Anchor</div>
    </a>
    <a href="/app-mobile.html" class="mobile-nav-item">
      <div class="mobile-nav-icon">🔧</div>
      <div class="mobile-nav-label">Maintenance</div>
    </a>
    <a href="#" id="mobileNavChat" class="mobile-nav-item">
      <div class="mobile-nav-icon">💬</div>
      <div class="mobile-nav-label">Chat</div>
    </a>
  </div>
</nav>
```

### Navigation Flows

**From Unified Mobile Dashboard (Main App):**
- User taps "Add Task" card → `https://boatos-maintenance.onrender.com/user-tasks-mobile.html`
- User taps "Maintenance" card → `https://boatos-maintenance.onrender.com/app-mobile.html`
- Bottom nav "Maintenance" → `https://boatos-maintenance.onrender.com/app-mobile.html`

**From Maintenance Pages (Maintenance Agent):**
- Bottom nav "Home" → `https://boatos-main.onrender.com/public/unified-mobile.html`
- Bottom nav "Anchor" → `https://boatos-main.onrender.com/public/anchor-watch-admin.html`
- Bottom nav "Chat" → `https://boatos-main.onrender.com/public/index-mobile.html`

### Active Page Detection

The navigation highlights the current page:

```javascript
const currentPath = window.location.pathname;

if (currentPath.includes('unified-mobile.html')) {
  document.querySelector('[data-page="home"]').classList.add('active');
} else if (currentPath.includes('anchor-watch')) {
  document.querySelector('[data-page="anchor"]').classList.add('active');
} else if (currentPath.includes('app-mobile.html') ||
           currentPath.includes('todos-mobile.html') ||
           currentPath.includes('user-tasks-mobile.html')) {
  document.querySelector('[data-page="maintenance"]').classList.add('active');
} else if (currentPath.includes('index-mobile.html')) {
  document.querySelector('[data-page="chat"]').classList.add('active');
}
```

---

## Notification System

### Overview

BoatOS implements a **dual-channel notification system** for anchor watch monitoring with smart redundancy:

- **Telegram Bot:** All updates, user commands, periodic monitoring (free)
- **Twilio SMS:** Critical alerts only (warning, dragging, GPS lost)

### Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Anchor Watch Alerts Service                            │
│  - Background monitoring (every 20 seconds)              │
│  - Status change detection                               │
│  - Alert routing (Telegram vs SMS)                       │
│  - Frequency management (debouncing, periodic)           │
└────────────────┬────────────────────────────────────────┘
                 │
      ┌──────────┴──────────┐
      ↓                     ↓
┌─────────────────┐   ┌──────────────────┐
│  Telegram       │   │  Twilio SMS      │
│  - All updates  │   │  - Critical only │
│  - Commands     │   │  - Warning       │
│  - Safe status  │   │  - Dragging      │
│  - Periodic     │   │  - GPS lost      │
└─────────────────┘   └──────────────────┘
```

### Services

**1. telegram.service.js**
- Send formatted messages to Telegram users
- Markdown formatting with emojis
- Status updates, alerts, confirmations

**2. telegram-bot.service.js**
- Poll Telegram API for commands (1 second interval)
- Handle user commands: `/start`, `/status`, `/positions`, `/help`
- Polling mode (works on localhost and Render without webhook)

**3. twilio.service.js**
- Send SMS via Twilio API
- Plain text formatting (no markdown)
- Critical alerts only

**4. anchor-watch-alerts.service.js**
- Monitor anchor watch status every 20 seconds
- Detect status changes (safe ↔ warning ↔ dragging)
- Route to appropriate channels
- Debounce repeat alerts (1 minute minimum)
- Send periodic "all good" updates (30 minutes)

### Alert Strategy

**Telegram (All Updates):**
- User commands (any time): `/status`, `/positions`
- Activation/deactivation confirmations
- All status changes (safe, warning, dragging, GPS lost)
- Periodic updates (every 30 min if safe)

**SMS (Critical Only):**
- ⚠️ Warning - Approaching safe zone limit
- 🚨 Dragging - Anchor is dragging
- 📡 GPS Lost - No position data

**Cost Optimization:**
- Normal operations: Telegram only (free)
- Critical alerts: Both channels (redundancy for safety)
- Estimated cost: $0-0.50/month (Twilio SMS)

### Data Flow

**Anchor Watch Alert Flow:**

```
1. Background Service: Check status every 20 seconds
   ↓
2. Anchor Watch Service: Get current status from GPS + DB
   ↓
3. Alerts Service: Detect status change?
   ↓
4a. No change → Check for periodic update (30 min)
   ↓
4b. Status changed → Determine if critical
   ↓
5a. Not critical → Telegram only
   ↓
5b. Critical (warning/dragging/gps_lost) → Telegram + SMS
   ↓
6. User receives alert(s) on phone
```

**User Command Flow:**

```
1. User sends /status to Telegram bot
   ↓
2. Telegram API → Bot Service (polling)
   ↓
3. Bot Service: Parse command
   ↓
4. Anchor Watch Service: Get current status
   ↓
5. Telegram Service: Format response
   ↓
6. Telegram API → User receives message
```

### Configuration

**Telegram:**
```bash
TELEGRAM_BOT_TOKEN=your_bot_token_here
TELEGRAM_CHAT_ID=1382446578
```

**Twilio:**
```bash
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_auth_token_here
TWILIO_PHONE_NUMBER=+13656614969
TWILIO_SMS_TO=+14165696940
```

### Commands Available

| Command | Description | Example Response |
|---------|-------------|------------------|
| `/start` | Register user, get Chat ID | `Your Chat ID is: 1382446578` |
| `/status` | Current anchor watch status | Status, distance, position, last updated |
| `/positions` | Last 5 GPS positions | Table of recent positions with distances |
| `/help` | Show available commands | List of all commands |

### Alert Examples

**Telegram Status Update:**
```
⚓ Anchor Watch Status

✅ Status: Safe

📏 Distance: 7m from anchor
🎯 Safe Radius: 50m
📍 Position: 12.602200, -61.450300
⚓ Anchor: 12.602150, -61.450280

⏰ Updated: 10:45:32 PM
```

**SMS Critical Alert:**
```
🚨 ANCHOR DRAGGING ALERT 🚨

ANCHOR IS DRAGGING!

Distance: 65m from anchor point
Safe radius: 50m

IMMEDIATE ACTION REQUIRED
```

### Lifecycle Management

**Server Startup (Production Only):**
```javascript
// src/start.js
const env = getEnv();
if (env.NODE_ENV === 'production') {
  await telegramBotService.start();     // Start polling (production only)
  anchorWatchAlertsService.start();     // Start monitoring (production only)
  logger.info('Telegram bot and alerts initialized (production mode)');
} else {
  logger.info('Telegram bot disabled in development mode (production only)');
}
```

**Why Production Only:**
- Prevents Telegram 409 Conflict errors (only ONE bot instance can poll)
- Localhost runs with `NODE_ENV=development` (bot disabled)
- Render runs with `NODE_ENV=production` (bot enabled)
- Developers can run localhost without interfering with production

**Anchor Watch Activation:**
```javascript
// User activates via admin page
await anchorWatchService.activate(lat, lon, radius);

// Notifications sent:
// - Telegram: "Anchor Watch Activated..."
// - SMS: None (not critical)
```

**Status Change (Safe → Dragging):**
```javascript
// Background service detects change
const isCritical = status === 'dragging';

// Alerts sent:
// - Telegram: "ANCHOR DRAGGING ALERT..."
// - SMS: "ANCHOR IS DRAGGING!" (critical = true)
```

**Deactivation:**
```javascript
// User deactivates via admin page
await anchorWatchService.deactivate();

// Notifications sent:
// - Telegram: "Anchor Watch Deactivated"
// - SMS: None
// - Monitoring stops (no more alerts)
```

**Graceful Shutdown:**
```javascript
// SIGTERM or SIGINT received
const env = getEnv();
if (env.NODE_ENV === 'production') {
  await telegramBotService.stop();      // Stop polling (if running)
  anchorWatchAlertsService.stop();      // Stop monitoring (if running)
}
server.close();
```

### Production Considerations

**Polling vs Webhook:**
- Current: Polling mode (checks Telegram every 1 second)
- Works on localhost and Render
- ~60 API calls/minute (well under Telegram limits)
- Future: Switch to webhook for production (more efficient)

**Multi-User Support:**
- Current: Single user (one chat ID, one phone number)
- Future: Support array of recipients for crew alerts

**Alert History:**
- Current: Alerts sent but not stored
- Future: Store in database for incident analysis

### Monitoring

**Logs to Watch:**
```
[INFO] Telegram bot started with polling enabled
[INFO] Anchor watch alerts monitoring started
[INFO] Status change alert sent (from: safe, to: warning, smsSent: true)
[INFO] SMS sent successfully
```

**Health Checks:**
- Telegram bot polling: Every 1 second
- Anchor watch monitoring: Every 20 seconds
- Both services restart on server restart

---

## External Dependencies

### Supabase (PostgreSQL Database)

**URL:** `https://xxxxxxxx.supabase.co`
**Type:** Managed PostgreSQL with real-time subscriptions
**Tables:** 30+ (systems, equipment, documents, chunks, chat_threads, chat_messages, tasks, user_tasks, gps_data, etc.)

**Access:**
- Main App: Service role key (for admin operations)
- Python Sidecar: Service role key (full access)
- Maintenance Agent: Service role key (full access)
- Raspberry Pi: Service role key (GPS writes)

### Pinecone (Vector Database)

**Index:** `boat-manuals`
**Namespace:** `default`
**Dimensions:** 1536 (OpenAI text-embedding-ada-002)
**Metric:** Cosine similarity

**Usage:**
- Store document chunk embeddings
- Semantic search for relevant manual sections
- Python sidecar generates embeddings via OpenAI, stores in Pinecone
- Chat queries Pinecone for relevant chunks (green bubbles)

### OpenAI

**Models Used:**
- `text-embedding-ada-002` - Generate embeddings for Pinecone
- `gpt-4-turbo` - Chat synthesis
- `gpt-3.5-turbo` - Equipment extraction (cheaper)

**API Key Location:** Python Sidecar (primary), Main App (equipment extraction)

### Anthropic Claude

**Model:** `claude-3-sonnet-20240229`
**Usage:** DIP (Document Information Pairs) extraction from user messages
**API Key Location:** Python Sidecar

### Perplexity

**Model:** `sonar-pro`
**Usage:** Web search for real-world marine insights and current information
**API Key Location:** Python Sidecar

### LlamaParse

**Cloud-based PDF parsing** (no local tesseract)
**Usage:** Parse uploaded PDF manuals into structured chunks
**API Key Location:** Python Sidecar

### Telegram Bot API

**Bot Username:** `@REIMAGINEDSV_bot`
**Bot URL:** `t.me/REIMAGINEDSV_bot`
**Mode:** Polling (1 second intervals)

**Usage:**
- Anchor watch status updates and alerts
- User commands (`/start`, `/status`, `/positions`, `/help`)
- Activation/deactivation notifications
- Periodic "all good" updates (every 30 min)

**API Key Location:** Main App
**Cost:** Free (unlimited messages)

**Features:**
- Markdown formatting with emojis
- Command handling via polling
- No webhook needed (works on localhost)
- Graceful shutdown support

### Twilio SMS

**Account SID:** `ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`
**Phone Number:** `+13656614969` (sender)
**Recipient:** `+14165696940`

**Usage:**
- Critical anchor watch alerts only
- Warning status (approaching limit)
- Dragging status (anchor dragging)
- GPS lost status (no position data)

**API Key Location:** Main App
**Cost:** ~$0.0075 per SMS (~$0-0.50/month typical use)

**Features:**
- Plain text SMS (no formatting)
- Immediate delivery
- Works without internet app
- Redundancy for safety-critical alerts

---

## Monitoring and Health Checks

### Health Endpoints

```bash
# Main App
curl https://boatos-main.onrender.com/health
# Response: { status: 'ok', service: 'main-app' }

# Python Sidecar
curl https://boatos-python.onrender.com/health
# Response: { status: 'healthy' }

# Maintenance Agent
curl https://boatos-maintenance.onrender.com/health
# Response: { status: 'healthy', agent_enabled: true }
```

### Render Logs

**Access:** Render Dashboard → Service → Logs tab

**Main App Logs:**
- Request logging (method, path, status, duration)
- Chat proxy calls
- Admin API calls
- Anchor watch status checks

**Python Sidecar Logs:**
- Chat processing steps
- LLM API calls (OpenAI, Claude, Perplexity)
- Pinecone queries
- Error traces

**Maintenance Agent Logs:**
- Task creation/completion
- Background job runs (every 15 min)
- API requests

### Common Log Patterns

**Success:**
```
[INFO] Request started - GET /health
[INFO] Request completed - 200 OK (5ms)
```

**CORS Error:**
```
[ERROR] Not allowed by CORS - origin: https://some-unauthorized-site.com
```

**Missing Environment Variable:**
```
[ERROR] Environment variable OPENAI_API_KEY is required but not set
```

### Performance Monitoring

**Expected Response Times:**
- Health checks: <100ms
- Static files: <200ms
- Simple API calls: <500ms
- Chat processing: 10-15 seconds (3 LLM calls + Pinecone search)
- Document parsing: 30-60 seconds (depends on PDF size)

---

## Security

### Authentication

**Admin Token:** SHA-256 hash stored in environment variables
**Header:** `x-admin-token`
**Validated by:** All `/admin/api/*` routes on Main App and Maintenance Agent

### HTTPS

All Render services use automatic HTTPS with Let's Encrypt certificates.

### Database Security

Supabase Row Level Security (RLS) is **disabled** - application handles all access control via service role keys.

### API Key Management

- All API keys stored in Render environment variables (not in code)
- Keys are masked in Render UI (click "Reveal" to see)
- Keys are NOT committed to git (`.env` in `.gitignore`)

---

## Disaster Recovery

### Database Backups

Supabase provides automatic daily backups (7-day retention on free tier, 30-day on pro).

### Service Rollback

Render keeps deployment history. To rollback:
1. Go to service → Deploys tab
2. Click "Rollback" on previous working deployment

### Manual Recovery

If all services down:
1. Check Render status page
2. Check environment variables (especially NODE_ENV)
3. Check recent git commits for breaking changes
4. Redeploy from last known good commit
5. Check external service status (Supabase, Pinecone, OpenAI)

---

## Cost Estimate

**Render Services (Starter plan: $7/month each):**
- Main App: $7/month
- Python Sidecar: $7/month
- Maintenance Agent: $7/month
- **Total Render: $21/month**

**Supabase:**
- Free tier (sufficient for now)
- Pro tier: $25/month (if needed for longer backups, more storage)

**Pinecone:**
- Free tier: 1 index, up to 100K vectors
- Paid: ~$70/month for production scale

**OpenAI:**
- Pay-as-you-go
- Estimated: $20-50/month (depends on usage)

**Anthropic Claude:**
- Pay-as-you-go
- Estimated: $10-30/month

**Perplexity:**
- Pay-as-you-go
- Estimated: $5-15/month

**Grand Total: ~$100-200/month** (current usage, development-scale)

---

## Future Enhancements

### Custom Domains

**Current:** Using Render URLs (`boatos-main.onrender.com`)
**Planned:** Custom domains (`chat.catamaranos.com`, `admin.catamaranos.com`)

**Setup:**
1. Configure CNAME in GoDaddy DNS
2. Add custom domain in Render dashboard
3. Update CORS allowlists
4. Update hostname detection in JavaScript

### Service-to-Service Authentication

**Current:** Python sidecar has no authentication (internal calls only)
**Planned:** Shared secret or JWT for service-to-service calls

### Monitoring and Alerts

**Current:** Manual log checking
**Planned:**
- Uptime monitoring (UptimeRobot)
- Error tracking (Sentry)
- Performance monitoring (New Relic or DataDog)
- Slack/email alerts for failures

### Load Balancing

**Current:** Single instance per service
**Planned:** Multiple instances with load balancer (if traffic grows)

---

## Appendix: Quick Reference

### Service URLs

```bash
# Production
Main:       https://boatos-main.onrender.com
Python:     https://boatos-python.onrender.com
Maintenance: https://boatos-maintenance.onrender.com

# Development
Main:       http://localhost:3000
Python:     http://localhost:8000
Maintenance: http://localhost:3001
```

### Git Repositories

```bash
# Main App + Python Sidecar
git clone https://github.com/mailbradsimmscom/REIMAGINEDAPPV2.git
cd REIMAGINEDAPPV2
git checkout Stable-v4-Working

# Maintenance Agent (submodule)
cd maintenance-agent
git checkout Agent-Enablement
```

### Environment Variables Quick Copy

See [Environment Variables](#environment-variables) section for complete list.

### Common Commands

```bash
# Local development
npm run dev                 # Start Main App
cd python-sidecar && python -m app.main  # Start Python Sidecar
cd maintenance-agent && node src/index.js  # Start Maintenance Agent

# Deploy to Render
git push origin Stable-v4-Working  # Main App + Python
git push origin Agent-Enablement   # Maintenance Agent

# Check logs
# Use Render dashboard → Service → Logs tab
```

---

**End of Architecture Document**
