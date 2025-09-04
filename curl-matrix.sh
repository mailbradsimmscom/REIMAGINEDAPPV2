#!/bin/bash

# Quick curl matrix for local validation
# Usage: ./curl-matrix.sh [PORT] (default: 3000)

PORT=${1:-3000}
BASE_URL="http://localhost:$PORT"

echo "🔍 Testing API endpoints on $BASE_URL"
echo "=================================="

# Health check
echo "✅ GET /health"
curl -s -i "$BASE_URL/health" | head -1

# Systems
echo "✅ GET /systems"
curl -s -i "$BASE_URL/systems" | head -1

# Chat endpoints
echo "✅ GET /chat"
curl -s -i "$BASE_URL/chat" | head -1

echo "✅ GET /chat/enhanced"
curl -s -i "$BASE_URL/chat/enhanced" | head -1

# Document endpoints
echo "✅ GET /document"
curl -s -i "$BASE_URL/document" | head -1

echo "✅ GET /admin/docs (expect 401/403)"
curl -s -i "$BASE_URL/admin/docs" | head -1

# Pinecone endpoints
echo "✅ GET /pinecone/query (expect 405)"
curl -s -i "$BASE_URL/pinecone/query" | head -1

echo "✅ POST /pinecone/query"
curl -s -i -X POST "$BASE_URL/pinecone/query" \
  -H 'content-type: application/json' \
  -d '{"query":"ping"}' | head -1

# Route map (dev only)
echo "✅ GET /__routes (dev only)"
curl -s -i "$BASE_URL/__routes" | head -1

echo ""
echo "🎯 Quick validation complete!"
echo "For detailed responses, remove '| head -1' from any curl command above."
