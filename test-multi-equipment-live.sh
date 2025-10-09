#!/bin/bash

THREAD_ID="test-multi-equipment-$(date +%s)"

echo "Testing multi-equipment extraction..."
echo "Thread ID: $THREAD_ID"
echo ""

curl -X POST "http://localhost:3000/chat/process" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "My GPS is not showing the same on my V100 and Zeus",
    "thread_id": "'"$THREAD_ID"'"
  }'
