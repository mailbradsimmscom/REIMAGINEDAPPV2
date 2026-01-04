# Environments

## Overview

BoatOS runs across three environments. Understanding which services run where and how they communicate prevents configuration mistakes and debugging headaches.

**Key Principle:** Services must use internal URLs for inter-service communication. Using public URLs adds 100-300ms latency per call.

---

## Environment Summary

| Environment | Services | Purpose | Key Files |
|-------------|----------|---------|-----------|
| **Local** | Node.js (3000), Python (8000), Maintenance (3001) | Development | `.env`, `restart-all.sh` |
| **Render** | boatos-main, boatos-python, boatos-maintenance | Production | Render Dashboard |
| **Pi** | Anchor alarm scripts | On-boat hardware | Pi-specific `.env` |

---

## Local Development

### Services Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser                                                        │
│  http://localhost:3000/*                                        │
└─────────────────────────────────────────────────────────────────┘
                              │
         ┌────────────────────┼────────────────────┐
         ↓                    ↓                    ↓
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│  Node.js Main   │  │  Python Sidecar │  │  Maintenance    │
│  Port 3000      │  │  Port 8000      │  │  Port 3001      │
│                 │  │                 │  │                 │
│  • API routes   │──│  • Chat/LLM     │  │  • Cron jobs    │
│  • Static files │  │  • PDF parsing  │  │  • Weather API  │
│  • Admin UI     │  │  • DIP extract  │  │  • Task queue   │
└─────────────────┘  └─────────────────┘  └─────────────────┘
         │                    │                    │
         └────────────────────┼────────────────────┘
                              ↓
                    ┌─────────────────┐
                    │  Supabase       │
                    │  (PostgreSQL)   │
                    └─────────────────┘
                              │
                    ┌─────────────────┐
                    │  Pinecone       │
                    │  (Vectors)      │
                    └─────────────────┘
```

### Service Details

| Service | Port | Entry Point | Start Command |
|---------|------|-------------|---------------|
| **Node.js Main** | 3000 | `src/start.js` | `npm run dev` |
| **Python Sidecar** | 8000 | `python-sidecar/app/main.py` | `python3 -m app.main` |
| **Maintenance Agent** | 3001 | `maintenance-agent/src/index.js` | `cd maintenance-agent && npm run dev` |

### Startup Process (src/start.js:22-50)

```javascript
const server = app.listen(port, async () => {
  logger.info(`Server listening on http://localhost:${port}`);
  printRoutes(app, logger);

  const env = getEnv();

  // Weather collector runs in ALL environments
  startWeatherCollector();

  // Other services run in PRODUCTION ONLY (prevents polling conflicts)
  if (env.NODE_ENV === 'production') {
    await telegramBotService.start();
    anchorWatchAlertsService.start();
  }
});
```

### Quick Start (restart-all.sh)

```bash
# One command to start everything
./restart-all.sh

# What it does:
# 1. Kills any existing processes on ports 3000, 3001, 8000
# 2. Starts Python sidecar (waits 14s for model loading)
# 3. Starts Node.js main (waits 5s)
# 4. Starts Maintenance agent (waits 5s)
# 5. Verifies all services are running
```

**Output:**
```
🔄 Restarting All Services...
🛑 Killing Python on port 8000...
🛑 Killing Node services on port 3000...
🛑 Killing Node services on port 3001 (maintenance-agent)...
🚀 Starting services...
1. Starting Python sidecar (port 8000)...
   ✓ Python service started (PID: 12345)
2. Starting Node main service (port 3000)...
   ✓ Node main service started (PID: 12346)
3. Starting Node maintenance-agent (port 3001)...
   ✓ Maintenance-agent started (PID: 12347)

Services running:
  • Python sidecar:     http://localhost:8000
  • Node main:          http://localhost:3000
  • Maintenance-agent:  http://localhost:3001
```

### URLs

```
# Main services
http://localhost:3000              # Node.js backend + static files
http://localhost:8000              # Python sidecar
http://localhost:3001              # Maintenance agent

# Admin UI
http://localhost:3000/admin.htm    # Admin dashboard
http://localhost:3000/landing      # Landing page
http://localhost:3000/chat         # Chat interface

# Mobile testing (use your machine's IP)
http://192.168.20.106:3000         # From mobile on same network
```

### Log Files

```
logs/
├── python.log                    # Python sidecar output
├── maintenance-agent.log         # Maintenance agent output
├── api/
│   └── node-api.log              # Node.js main output
├── chat/
│   └── node-chat.log             # Chat-specific logs
├── errors/
│   └── node-errors.log           # Error-level logs only
└── debug/
    └── node-debug.log            # All logs (verbose)
```

**Monitor all logs:**
```bash
tail -f logs/python.log logs/api/node-api.log logs/maintenance-agent.log
```

---

## Local Environment Variables

All in `.env` file at project root. Python sidecar reads from parent directory.

### Critical Variables

| Variable | Local Value | Purpose |
|----------|-------------|---------|
| `NODE_ENV` | `development` | Environment mode |
| `PORT` | `3000` | Node.js port |
| `PYTHON_SIDECAR_URL` | `http://localhost:8000` | Python sidecar URL |
| `MAINTENANCE_SERVICE_URL` | `http://localhost:3001` | Maintenance agent URL |
| `MAINTENANCE_BASE_URL` | `http://localhost:3001` | Maintenance agent page URLs (for action links) |
| `MAIN_APP_BASE_URL` | `http://localhost:3000` | Main app page URLs (for action links) |

### External Services

| Variable | Source | Purpose |
|----------|--------|---------|
| `SUPABASE_URL` | Supabase Dashboard | Database URL |
| `SUPABASE_SERVICE_KEY` | Supabase Dashboard | Database service key |
| `OPENAI_API_KEY` | OpenAI Dashboard | LLM API key |
| `OPENAI_MODEL` | Config | Model name (e.g., `gpt-4o`) |
| `VISION_MODEL` | Config | Vision model (default: `gpt-4o`) |
| `COHERE_API_KEY` | Cohere Dashboard | Chunk reranking (rerank-v3.5) |
| `PINECONE_API_KEY` | Pinecone Dashboard | Vector search API key |
| `PINECONE_INDEX` | Pinecone Dashboard | Index name |
| `ADMIN_TOKEN` | Generated | Admin authentication token |

### Optional Services

| Variable | Purpose | When Needed |
|----------|---------|-------------|
| `TELEGRAM_BOT_TOKEN` | Telegram alerts | Anchor alarm alerts |
| `TELEGRAM_CHAT_ID` | Telegram recipient | Anchor alarm alerts |
| `TWILIO_ACCOUNT_SID` | SMS alerts | Emergency notifications |
| `TWILIO_AUTH_TOKEN` | SMS auth | Emergency notifications |

### Service Disable Flags (for testing/CI)

| Variable | Effect |
|----------|--------|
| `PINECONE_DISABLED=1` | Skip Pinecone calls |
| `SIDECAR_DISABLED=1` | Skip Python sidecar calls |
| `SUPABASE_DISABLED=1` | Skip database calls |
| `OPENAI_DISABLED=1` | Skip OpenAI calls |

---

## Render (Production)

### Services

| Service | Public URL | Internal URL | Purpose |
|---------|------------|--------------|---------|
| **boatos-main** | `https://boatos-main.onrender.com` | - | Node.js backend |
| **boatos-python** | `https://boatos-python.onrender.com` | `http://boatos-python:10000` | Python sidecar |
| **boatos-maintenance** | `https://boatos-maintenance.onrender.com` | `http://boatos-maintenance:10000` | Maintenance agent |

### Critical: Internal Networking

**Services MUST use internal URLs for communication:**

```bash
# ❌ WRONG - Uses public internet (adds 100-300ms per call)
PYTHON_SIDECAR_URL=https://boatos-python.onrender.com

# ✅ CORRECT - Uses internal network (~1ms)
PYTHON_SIDECAR_URL=http://boatos-python:10000
```

Render assigns internal hostnames based on service names. Port 10000 is Render's internal port.

### Build & Start Commands

| Service | Build Command | Start Command |
|---------|---------------|---------------|
| **boatos-main** | `npm install` | `node src/start.js` |
| **boatos-python** | `pip install -r requirements.txt` | `uvicorn app.main:app --host 0.0.0.0 --port $PORT` |
| **boatos-maintenance** | `npm install` | `node src/index.js` |

### Render Environment Variables

Must match local except for URLs:

| Variable | Render Value | Difference from Local |
|----------|--------------|----------------------|
| `NODE_ENV` | `production` | Production mode enables background services |
| `PORT` | `$PORT` | Render assigns dynamically |
| `PYTHON_SIDECAR_URL` | `http://boatos-python:10000` | Internal URL |
| `MAINTENANCE_SERVICE_URL` | `http://boatos-maintenance:10000` | Internal URL |
| `MAINTENANCE_BASE_URL` | `https://boatos-maintenance.onrender.com` | Page URLs for action links |
| `MAIN_APP_BASE_URL` | `https://boatos-main.onrender.com` | Page URLs for action links |

### Deploy Branch

All services deploy from: **`Stable-v4-Working`**

### Production-Only Services (src/start.js:38-49)

These services only start when `NODE_ENV=production`:

```javascript
if (env.NODE_ENV === 'production') {
  await telegramBotService.start();      // Telegram bot polling
  anchorWatchAlertsService.start();      // Anchor alarm monitoring
}
```

**Why:** Prevents polling conflicts when multiple developers run locally.

---

## Raspberry Pi (On Boat)

### Purpose

Runs anchor alarm monitoring directly on the boat with GPS hardware. Sends Telegram alerts when anchor drags.

### Location

Code synced to: `/home/brad/Code/` on Pi

### What Runs

| Service | Purpose |
|---------|---------|
| Position monitor | Reads GPS, calculates drift |
| Telegram alerter | Sends alerts when anchor drags |

### Pi-Specific Configuration

The Pi has its own:
- `CLAUDE.md` - Pi-specific coding instructions
- `.cursorrules` - Pi coding standards
- `.env` - Pi environment variables (different from main app)

### Key Differences from Main App

| Aspect | Main App | Pi |
|--------|----------|-----|
| GPS | Uses API endpoint | Reads from hardware GPS |
| Alerts | Sends to DB | Sends via Telegram directly |
| Web UI | Full admin UI | Minimal status page |
| Database | Supabase | Local SQLite or none |

---

## Environment Sync Checklist

When changing environment variables:

### 1. Update Locally First
```bash
# Edit .env
vim .env

# Restart services
./restart-all.sh

# Test locally
curl http://localhost:3000/health
```

### 2. Update Render Dashboard
- Navigate to: Render Dashboard → Service → Environment
- Add/update variables
- Redeploy service (may happen automatically)

### 3. Verify Values Match

| Variable | Check Command |
|----------|---------------|
| `OPENAI_MODEL` | `grep OPENAI_MODEL .env` → Compare with Render |
| `PYTHON_SIDECAR_URL` | Should be `http://boatos-python:10000` on Render |

### 4. Test After Deploy

```bash
# Health checks
curl https://boatos-main.onrender.com/health
curl https://boatos-python.onrender.com/health
curl https://boatos-maintenance.onrender.com/health

# Timing check (should be <500ms after cold start)
curl -w "\nTime: %{time_total}s\n" https://boatos-main.onrender.com/health
```

---

## Common Issues

| Symptom | Likely Cause | Fix |
|---------|--------------|-----|
| Chat 3-5x slower on Render | Wrong `PYTHON_SIDECAR_URL` (using public URL) | Change to `http://boatos-python:10000` |
| "Route not found" errors | Code not deployed | Check git commit matches Render |
| LLM responses different | `OPENAI_MODEL` mismatch | Sync model name between envs |
| Timeout errors | Service cold start | Wait or enable always-on |
| Telegram not working locally | Production-only service | Set `NODE_ENV=production` (not recommended) |
| Port already in use | Previous process didn't exit | Run `./restart-all.sh` (kills first) |

---

## Graceful Shutdown

Both Node.js services handle `SIGTERM` and `SIGINT` gracefully (src/start.js:52-88):

```javascript
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  stopWeatherCollector();
  if (env.NODE_ENV === 'production') {
    await telegramBotService.stop();
    anchorWatchAlertsService.stop();
  }
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});
```

---

## Python Sidecar Details

### Startup (python-sidecar/app/main.py)

```python
# Load environment from multiple paths
env_paths = ['.env', '../.env', '../../.env']
for env_path in env_paths:
    if os.path.exists(env_path):
        load_dotenv(env_path)
        break

app = FastAPI(title="PDF Parser Sidecar", ...)
```

### Key Endpoints

| Endpoint | Purpose |
|----------|---------|
| `/health` | Health check |
| `/parse` | PDF text extraction |
| `/chat` | LLM chat processing |
| `/dip/extract` | DIP extraction |
| `/embeddings` | Generate embeddings |

---

## Maintenance Agent Details

### Architecture (maintenance-agent/src/index.js:1-8)

```javascript
/**
 * Maintenance Agent - Hybrid architecture
 * 1. Express HTTP server (port 3001) - serves APIs
 * 2. Cron-based background jobs - autonomous processing
 */
```

### Startup Sequence

1. Test Supabase connection
2. Test Pinecone connection (optional)
3. Start Express server
4. Start WebSocket server
5. Initialize cron jobs (scheduler, system processor)

### Key Features

| Feature | Description |
|---------|-------------|
| Weather API | OpenMeteo integration |
| Task scheduling | Cron-based job runner |
| System processor | Background equipment processing |
| WebSocket | Real-time updates |

---

## Related Docs

- [principles.md](./principles.md) - Coding standards and patterns
- [ci-testing.md](./ci-testing.md) - Test configuration
- [python-sidecar.md](../30-backend/python-sidecar.md) - Python service details
- [pi-deployment.md](../30-backend/pi-deployment.md) - Pi setup instructions
