#!/bin/bash

# CI Test Script for Guardrails
# Tests: ESLint, Router imports, Route map, Sanity checks, Test matrix, Runtime monitoring, Zod coverage

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

# 4. Sanity Checks
echo "✅ Running sanity checks..."
./scripts/sanity-checks.sh || {
  echo "❌ Sanity checks failed"
  exit 1
}
echo "✅ Sanity checks passed"

# 5. Test Matrix Coverage Analysis
echo "✅ Running test coverage analysis..."
./scripts/test-coverage.sh || {
  echo "❌ Test coverage analysis failed"
  exit 1
}
echo "✅ Test coverage analysis passed"

# 6. Runtime Monitoring
echo "✅ Running runtime monitoring..."
./scripts/runtime-monitoring.sh || {
  echo "❌ Runtime monitoring failed"
  exit 1
}
echo "✅ Runtime monitoring passed"

# 7. Zod Coverage Analysis
echo "✅ Running Zod coverage analysis..."
npm run zod:coverage || {
  echo "❌ Zod coverage analysis failed"
  exit 1
}
echo "✅ Zod coverage analysis passed"

echo ""
echo "🎉 All CI guardrail tests passed!"
echo "=================================="
