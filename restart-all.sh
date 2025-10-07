#!/bin/bash

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}🔄 Restarting All Services...${NC}"
echo "================================"

# Step 1: Kill Python on port 8000
echo -e "${RED}🛑 Killing Python on port 8000...${NC}"
lsof -ti :8000 | xargs kill -9 2>/dev/null
sleep 1

# Step 2: Kill Node services on port 3000
echo -e "${RED}🛑 Killing Node services on port 3000...${NC}"
lsof -ti :3000 | xargs kill -9 2>/dev/null
sleep 1

# Step 3: Kill any npm/node processes for worker
echo -e "${RED}🛑 Killing Node worker processes...${NC}"
# Kill any npm run dev:worker processes
pkill -f "npm.*dev:worker" 2>/dev/null
pkill -f "node.*worker" 2>/dev/null
sleep 1

# Verify everything is dead
echo -e "${YELLOW}✓ Verifying ports are clear...${NC}"
if lsof -i :8000 >/dev/null 2>&1; then
    echo -e "${RED}⚠️  Warning: Port 8000 still in use${NC}"
fi
if lsof -i :3000 >/dev/null 2>&1; then
    echo -e "${RED}⚠️  Warning: Port 3000 still in use${NC}"
fi

echo ""
echo -e "${GREEN}🚀 Starting services...${NC}"
echo "================================"

# Start Python with venv (background)
echo -e "${GREEN}1. Starting Python sidecar (port 8000)...${NC}"
cd /Users/brad/code/REIMAGINEDAPPV2/python-sidecar
source venv/bin/activate
python3 -m app.main > ../logs/python.log 2>&1 &
PYTHON_PID=$!
deactivate
cd ..
sleep 3

# Check if Python started successfully
if lsof -i :8000 >/dev/null 2>&1; then
    echo -e "${GREEN}   ✓ Python service started (PID: $PYTHON_PID)${NC}"
else
    echo -e "${RED}   ✗ Python service failed to start${NC}"
    exit 1
fi

# Start Node main service (background)
echo -e "${GREEN}2. Starting Node main service (port 3000)...${NC}"
npm run dev > logs/node-main.log 2>&1 &
NODE_MAIN_PID=$!
sleep 3

# Check if Node started successfully
if lsof -i :3000 >/dev/null 2>&1; then
    echo -e "${GREEN}   ✓ Node main service started (PID: $NODE_MAIN_PID)${NC}"
else
    echo -e "${RED}   ✗ Node main service failed to start${NC}"
    exit 1
fi

# Start Node worker (background)
echo -e "${GREEN}3. Starting Node worker service...${NC}"
npm run dev:worker > logs/node-worker.log 2>&1 &
NODE_WORKER_PID=$!
sleep 2
echo -e "${GREEN}   ✓ Node worker service started (PID: $NODE_WORKER_PID)${NC}"

echo ""
echo -e "${GREEN}✅ All services restarted successfully!${NC}"
echo "================================"
echo "Services running:"
echo "  • Python sidecar: http://localhost:8000 (PID: $PYTHON_PID)"
echo "  • Node main:      http://localhost:3000 (PID: $NODE_MAIN_PID)"
echo "  • Node worker:    (PID: $NODE_WORKER_PID)"
echo ""
echo "Logs available at:"
echo "  • logs/python.log"
echo "  • logs/node-main.log"
echo "  • logs/node-worker.log"
echo ""
echo -e "${YELLOW}To monitor: tail -f logs/*.log${NC}"
echo -e "${YELLOW}To stop all: ./restart-all.sh (will kill before restart)${NC}"