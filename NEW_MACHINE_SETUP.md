# New Machine Setup Guide for REIMAGINEDAPPV2

## Prerequisites

### System Requirements
- **Node.js 20+** (required, check with `node --version`)
- **Python 3.8+** (for Python sidecar)
- **Git** (to clone repository)
- **Tesseract OCR** (optional, for PDF OCR)

### Install System Dependencies

```bash
# macOS (using Homebrew)
brew install node@20 python@3.11 tesseract poppler

# Ubuntu/Debian
sudo apt update
sudo apt install nodejs npm python3 python3-pip python3-venv tesseract-ocr poppler-utils

# Verify installations
node --version      # Should be 20+
python3 --version   # Should be 3.8+
tesseract --version # Optional for OCR
pdftotext -v       # Optional for PDF text extraction
```

## Setup Steps

### 1. Clone Repository & Setup

```bash
# Clone the repo
git clone <your-repo-url> REIMAGINEDAPPV2
cd REIMAGINEDAPPV2

# Copy environment variables
cp .env.example .env
# IMPORTANT: Edit .env with your actual values:
# - SUPABASE_URL
# - SUPABASE_SERVICE_KEY
# - OPENAI_API_KEY
# - SERPAPI_KEY (for manual hunter)
# - LLAMAPARSE_API_KEY (currently broken, but keep for future)
# - ADMIN_TOKEN
```

### 2. Node.js Setup

```bash
# Install Node dependencies
npm install

# Verify Node setup
npm run test:no-sidecar  # Should pass basic tests
```

### 3. Python Sidecar Setup

```bash
cd python-sidecar

# Create virtual environment
python3 -m venv venv

# Activate virtual environment
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install Python dependencies
pip install -r requirements.txt

# Verify Python setup
python3 -m app.main  # Should start on port 8000
# Press Ctrl+C to stop

# Deactivate virtual environment
deactivate
cd ..
```

### 4. Create Required Directories

```bash
# Create log directories
mkdir -p logs/api logs/debug logs/python

# Create manual hunter directories
mkdir -p scripts/agents/manual-hunter-results/pdfs

# Create document storage directories (if needed)
mkdir -p documents/manuals
```

### 5. Start Services

#### Option A: Use the restart-all script (Recommended)
```bash
# Make script executable
chmod +x restart-all.sh

# Start all services
./restart-all.sh

# Services will run on:
# - Python sidecar: http://localhost:8000
# - Node.js API: http://localhost:3000
```

#### Option B: Manual Start (for debugging)
```bash
# Terminal 1: Start Python sidecar
cd python-sidecar
source venv/bin/activate
python3 -m app.main

# Terminal 2: Start Node.js server
npm run dev

# Terminal 3: Monitor logs
tail -f logs/python.log logs/api/node-api.log
```

### 6. Verify Everything Works

```bash
# Check Python sidecar health
curl http://localhost:8000/health

# Check Node API health
curl http://localhost:3000/health

# Check admin endpoints (needs ADMIN_TOKEN from .env)
curl -H "x-admin-token: YOUR_ADMIN_TOKEN" http://localhost:3000/admin/api/health
```

## Manual Hunter Specific Setup

### Required Environment Variables
```bash
# In .env file, ensure these are set:
SERPAPI_KEY=<your-serpapi-key>          # For Google searches
OPENAI_API_KEY=<your-openai-key>        # For GPT-4o-mini validation
LLAMAPARSE_API_KEY=<your-llamaparse-key> # Currently broken, but keep
```

### CSV Files Needed
```bash
# The manual hunter needs these CSV files in scripts/agents/:
- systems-needing-manuals.csv         # Main list (136 systems)
- systems-needing-manuals-test.csv    # Test list (3 systems)
- systems-needing-manuals-yanmar-test.csv # Yanmar test (7 systems)
```

### Running Manual Hunter

```bash
# Test with 3 systems
TEST_MODE=true node scripts/agents/manual-hunter.js

# Test with Yanmar systems
TEST_YANMAR=true node scripts/agents/manual-hunter.js

# Run full batch (be careful - uses API credits!)
node scripts/agents/manual-hunter.js
```

## Important Files & Their State

### Modified Files (from this session)
- `manual-hunter.js` - Modified to use Python sidecar
- `manual-hunter-config.js` - Validation currently ENABLED
- `manual-hunter-python-parser.js` - NEW file for Python integration
- `manual-hunter-blacklist.json` - Contains 1 legitimate + 7 false positives

### Downloaded PDFs
- Location: `scripts/agents/manual-hunter-results/pdfs/`
- Count: ~122 PDFs already downloaded
- Size: ~750MB total

## Known Issues & Warnings

### 1. PDF Parsing
- **LlamaParser**: BROKEN - returns 404 for all job polls
- **pdf-parse**: BROKEN - ESM import issues
- **Python sidecar**: WORKING - using pdfplumber

### 2. Blacklist Cleanup Needed
```bash
# Current blacklist has 7 false positives from Yanmar
# Located at: scripts/agents/manual-hunter-blacklist.json
# Should only contain the ACR EPIRB entry
```

### 3. Marine Safety Context
- This is a **safety-critical marine system**
- Wrong manuals can cause equipment damage ($10,000+)
- Always validate PDFs are correct before use

## Troubleshooting

### Port Already in Use
```bash
# Kill Python on port 8000
lsof -ti :8000 | xargs kill -9

# Kill Node on port 3000
lsof -ti :3000 | xargs kill -9
```

### Python Module Not Found
```bash
cd python-sidecar
source venv/bin/activate
pip install -r requirements.txt
```

### Node Module Issues
```bash
rm -rf node_modules package-lock.json
npm install
```

### Logs for Debugging
```bash
# Python sidecar logs
tail -f logs/python.log

# Node API logs
tail -f logs/api/node-api.log

# Debug logs
tail -f logs/debug/node-debug.log
```

## Testing the Setup

### Test Python PDF Parser
```bash
# Create test script
cat > test-pdf-parser.js << 'EOF'
import fetch from 'node-fetch';
import fs from 'fs';

const testPDF = 'scripts/agents/manual-hunter-results/pdfs/Yanmar_port_engine.pdf';

if (!fs.existsSync(testPDF)) {
  console.log('No test PDF found');
  process.exit(1);
}

const formData = new FormData();
const pdfBuffer = fs.readFileSync(testPDF);
const blob = new Blob([pdfBuffer], { type: 'application/pdf' });
formData.append('file', blob, 'test.pdf');
formData.append('extract_tables', 'false');
formData.append('ocr_enabled', 'false');

const response = await fetch('http://localhost:8000/v1/parse', {
  method: 'POST',
  body: formData
});

const result = await response.json();
console.log('Parse success:', result.success);
console.log('Pages parsed:', result.pages_parsed);
console.log('Text extracted:', result.elements?.[0]?.content?.substring(0, 200));
EOF

node test-pdf-parser.js
```

## Final Checklist

- [ ] Node.js 20+ installed
- [ ] Python 3.8+ installed
- [ ] Virtual environment created in python-sidecar
- [ ] All npm packages installed
- [ ] All pip packages installed
- [ ] .env file configured with API keys
- [ ] Log directories created
- [ ] Both services start successfully
- [ ] Health checks pass
- [ ] Test PDF parsing works

## Support Files Created

This setup guide was created after discovering:
- LlamaParser API is broken (404 errors)
- pdf-parse has ESM compatibility issues
- Python sidecar with pdfplumber is the working solution
- Manual validation is critical for marine safety

**Remember**: Always follow CLAUDE.md rules - no code changes without approval!