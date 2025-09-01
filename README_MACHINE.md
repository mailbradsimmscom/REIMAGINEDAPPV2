# Environmental Changes - Machine Compatibility

## Critical Environmental Changes

### 1. Python Sidecar URL (BREAKING CHANGE)
**File:** `.env`
**Issue:** Different deployment environments need different URLs

```bash
# DOCKER COMPOSE ENVIRONMENT (Original Machine)
PYTHON_SIDECAR_URL=http://python-sidecar:8000

# LOCAL DEVELOPMENT (New Machine)  
PYTHON_SIDECAR_URL=http://localhost:8000
```

**Fix for Docker Environment:**
```bash
# Change back to service name for Docker Compose
PYTHON_SIDECAR_URL=http://python-sidecar:8000
```

### 2. Python Environment Setup
**Location:** `python-sidecar/venv/`
**Issue:** Virtual environment is machine-specific

**For New Machine Setup:**
```bash
cd python-sidecar
python3.11 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

**For Docker Environment:**
- Virtual environment not needed (uses container)

### 3. System Dependencies
**New Machine Requirements:**
- Node.js 20+ (via Homebrew)
- Python 3.11 (via Homebrew) 
- Tesseract OCR (via Homebrew)

**Docker Environment:**
- All dependencies handled in containers

## Quick Environment Fix

**For Docker Environment (Original Machine):**
```bash
# 1. Revert .env URL
PYTHON_SIDECAR_URL=http://python-sidecar:8000

# 2. Use Docker Compose
docker-compose up -d

# 3. Test connection
curl http://python-sidecar:8000/health
```

**For Local Environment (New Machine):**
```bash
# 1. Keep .env URL as localhost
PYTHON_SIDECAR_URL=http://localhost:8000

# 2. Start Python sidecar manually
cd python-sidecar
source venv/bin/activate
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000

# 3. Start Node.js app
npm start
```

---
**Purpose:** Track environment-specific changes that break cross-machine compatibility


npm install zod