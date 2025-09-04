#!/bin/bash

# CI Test Script for Guardrails
# Tests: ESLint, Router imports, Route map

set -e  # Exit on any error

echo "🔍 Running CI Guardrail Tests..."
echo "=================================="

# 1. ESLint Test
echo "✅ Running ESLint..."
npx eslint src/ tests/ || {
  echo "❌ ESLint failed"
  exit 1
}
echo "✅ ESLint passed"

# 2. Router Import Test
echo "✅ Running router import test..."
node tests/smoke/router-imports.test.js || {
  echo "❌ Router import test failed"
  exit 1
}
echo "✅ Router import test passed"

# 3. Route Map Test
echo "✅ Running route map test..."
node tests/smoke/route-map.test.js || {
  echo "❌ Route map test failed"
  exit 1
}
echo "✅ Route map test passed"

echo ""
echo "🎉 All CI guardrail tests passed!"
echo "=================================="
