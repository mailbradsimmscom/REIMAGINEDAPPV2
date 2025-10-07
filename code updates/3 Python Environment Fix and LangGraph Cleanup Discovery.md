# Python Environment Fix and LangGraph Cleanup Discovery

**Date:** 2025-10-06
**Issue:** restart-all.sh script failing, Python environment confusion, and discovered leftover LangGraph packages

## Problem Summary

1. **Initial Issue:** restart-all.sh was incorrectly reporting Python service startup failure
2. **Root Cause:** Python venv symlinks resolved to system Python, causing confusion about which environment was active
3. **Critical Discovery:** LangGraph/LangChain packages still installed in venv despite being removed from requirements.txt

## Environment Confusion Investigation

### What We Found

1. **Python Binary Path Confusion**
   - Script used: `./venv/bin/python3`
   - This symlinked to: `python3.13` (relative)
   - Which resolved to: `/opt/homebrew/bin/python3.13` (system Python via PATH)
   - Process showed: `/opt/homebrew/Cellar/python@3.13/.../Python`
   - BUT was actually using: venv's site-packages correctly

2. **Package Discrepancy**
   ```
   requirements.txt:  # langgraph>=0.6.8  # DISABLED
   venv installed:    langchain==0.3.27, langchain-core==0.3.77, langchain-text-splitters==0.3.11
   ```

3. **Dead Code Discovery**
   - `app/chat/compatibility.py` - Still imports LangGraph
   - `app/chat/workflows/chat_workflow.py` - DEPRECATED LangGraph workflow
   - **GOOD:** Production uses `chat_workflow_sequential.py` with NO LangGraph dependencies

## Fix Applied

### Original restart-all.sh (problematic)
```bash
cd /Users/brad/code/REIMAGINEDAPPV2/python-sidecar
./venv/bin/python3 -m app.main > ../logs/python.log 2>&1 &
```

### Updated restart-all.sh (fixed)
```bash
cd /Users/brad/code/REIMAGINEDAPPV2/python-sidecar
source venv/bin/activate
python3 -m app.main > ../logs/python.log 2>&1 &
PYTHON_PID=$!
deactivate
```

### Why This Fix Works
- `source venv/bin/activate` sets PATH to prioritize venv Python
- All Python commands within activated environment use venv
- No ambiguity about which Python interpreter runs
- Standard, recommended approach for venvs

## Regression Risk Identified

**"Works on my machine" scenario detected:**
- Code runs because venv has LangGraph packages (leftover)
- New developer running `pip install -r requirements.txt` would fail
- Dead code could mislead someone into using LangGraph again

## Recommended Next Steps

1. **Clean venv to match requirements.txt**
   ```bash
   pip uninstall langchain langchain-core langchain-text-splitters langsmith -y
   ```

2. **Remove dead LangGraph code**
   - Delete `app/chat/compatibility.py`
   - Delete `app/chat/workflows/chat_workflow.py`
   - Delete related test files

3. **Verify clean environment**
   ```bash
   pip freeze | grep -i lang  # Should return nothing
   python3 -m app.main  # Should still work
   ```

## Testing Commands

```bash
# Verify correct Python is used
ps aux | grep python | grep app.main
# Should show venv path in environment

# Test service health
curl -s http://localhost:8000/health | python3 -m json.tool

# Compare packages
/Users/brad/code/REIMAGINEDAPPV2/python-sidecar/venv/bin/pip list | grep lang
/opt/homebrew/bin/pip3 list | grep lang
```

## Key Learnings

1. **Always use `source venv/bin/activate`** in scripts for clarity
2. **Regular audit:** `pip freeze` vs `requirements.txt` to catch drift
3. **Remove dead code immediately** to prevent confusion
4. **Python venvs use system binary** but isolated packages - this is normal
5. **Process name in `ps` doesn't indicate environment** - check site-packages path

## Session Context

This session revealed environment configuration debt from the LangGraph-to-sequential migration. While the production code successfully uses the sequential workflow without LangGraph, the environment and codebase contain remnants that pose regression risks. The fix ensures consistent venv usage and identified cleanup tasks to prevent future confusion.