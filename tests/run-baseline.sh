#!/bin/bash

# Test execution script for baseline API validation
# This script runs the comprehensive test suite to validate all current functionality

set -e

echo "🧪 Starting Baseline API Test Suite"
echo "=================================="

# Check if server is running
echo "📡 Checking server status..."
if ! curl -s http://localhost:3000/health > /dev/null; then
    echo "❌ Server is not running on port 3000"
    echo "   Please start the server with: npm run dev"
    exit 1
fi

echo "✅ Server is running"

# Run the baseline tests
echo "🚀 Running baseline tests..."
node --test tests/baseline.test.js

echo ""
echo "🎉 Baseline test suite completed!"
echo ""
echo "📊 Test Summary:"
echo "   - All endpoints validated"
echo "   - Response formats verified"
echo "   - Error handling tested"
echo "   - Static files confirmed"
echo ""
echo "✅ Your system is ready for Zod integration!"
