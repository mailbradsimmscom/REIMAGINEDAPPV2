#!/bin/bash

# Comprehensive Test Matrix Runner
# Runs all validation and bad-input tests to ensure complete coverage

set -e

echo "🧪 Running Comprehensive Test Matrix..."
echo "======================================"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to run test and report status
run_test() {
    local test_file=$1
    local test_name=$2
    
    echo "Running $test_name..."
    if node "$test_file" 2>/dev/null; then
        echo -e "${GREEN}✅ $test_name passed${NC}"
        return 0
    else
        echo -e "${RED}❌ $test_name failed${NC}"
        return 1
    fi
}

# Track overall success
overall_success=true

# 1. Method Guards Test
if ! run_test "tests/unit/validation/method-guards.test.js" "Method Guards Test"; then
    overall_success=false
fi

# 2. Bad Input Test (existing comprehensive test)
if ! run_test "tests/integration/bad-input.test.js" "Bad Input Test"; then
    overall_success=false
fi

# 3. Comprehensive Validation Test (new test matrix)
if ! run_test "tests/integration/comprehensive-validation.test.js" "Comprehensive Validation Test"; then
    overall_success=false
fi

# 4. Security Test (admin auth)
if ! run_test "tests/integration/security.test.js" "Security Test"; then
    overall_success=false
fi

# 5. Response Validation Test
if ! run_test "tests/integration/response-validation.test.js" "Response Validation Test"; then
    overall_success=false
fi

# 6. Pinecone Test (includes method guards)
if ! run_test "tests/integration/pinecone.test.js" "Pinecone Test"; then
    overall_success=false
fi

# 7. Health Test (includes method guards)
if ! run_test "tests/integration/health.test.js" "Health Test"; then
    overall_success=false
fi

echo ""
echo "======================================"

if [ "$overall_success" = true ]; then
    echo -e "${GREEN}🎉 All test matrix tests passed!${NC}"
    echo ""
    echo "Test Coverage Summary:"
    echo "✅ Method guards (405 responses)"
    echo "✅ Bad input validation (400 responses)"
    echo "✅ Admin authentication (401/403 responses)"
    echo "✅ Service disabled handling (typed envelopes)"
    echo "✅ Query parameter validation"
    echo "✅ Path parameter validation"
    echo "✅ Body validation"
    echo "✅ Error envelope consistency"
    echo "✅ Edge case handling"
    exit 0
else
    echo -e "${RED}❌ Some test matrix tests failed${NC}"
    echo ""
    echo "Please check the failing tests above and fix any issues."
    exit 1
fi
