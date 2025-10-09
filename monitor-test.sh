#!/bin/bash

# Monitor logs for test queries
echo "🔍 Monitoring logs for equipment extraction..."
echo "Press Ctrl+C to stop"
echo ""

tail -f logs/api/node-api.log | grep --line-buffered -E "EXTRACT_START|EXTRACT_PARSED|KEYWORD_FALLBACK|INFERENCE_FALLBACK|SEARCH_START|SEARCH_RESULT|COMBINED_RESULTS|equipment_context"
