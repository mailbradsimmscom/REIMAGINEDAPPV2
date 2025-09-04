#!/bin/bash

# Sanity Checks for REIMAGINEDAPPV2
# Run these checks to ensure code quality and prevent common issues

set -e

echo "🔍 Running sanity checks..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print status
print_status() {
    if [ $1 -eq 0 ]; then
        echo -e "${GREEN}✅ $2${NC}"
    else
        echo -e "${RED}❌ $2${NC}"
        exit 1
    fi
}

# Check 1: No helpers awaiting internally (they should return a Request)
echo "Checking for helpers awaiting internally..."
if find tests/helpers -name "*.js" -exec grep -n "return await" {} \; 2>/dev/null | grep -q .; then
    echo -e "${RED}❌ Found helpers awaiting internally - they should return a Request${NC}"
    find tests/helpers -name "*.js" -exec grep -n "return await" {} \;
    exit 1
else
    print_status 0 "No helpers awaiting internally"
fi

# Check 2: No res.json(enforceResponse(...)) double-send
echo "Checking for double-send issues..."
if find src -name "*.js" -exec grep -n "res\.json.*enforceResponse" {} \; 2>/dev/null | grep -q .; then
    echo -e "${RED}❌ Found double-send issues${NC}"
    find src -name "*.js" -exec grep -n "res\.json.*enforceResponse" {} \;
    exit 1
else
    print_status 0 "No double-send issues found"
fi

# Check 3: Routes with query/params must have validate()
echo "Checking validate() coverage for routes with query/params..."
ROUTE_COUNT=$(find src/routes -name "*.js" -exec grep -n "router\.(get|delete)(" {} \; | wc -l)
VALIDATE_COUNT=$(find src/routes -name "*.js" -exec grep -n "validate(.*'(query|params)'" {} \; | wc -l)

echo "Routes with GET/DELETE: $ROUTE_COUNT"
echo "Routes with query/params validation: $VALIDATE_COUNT"

if [ "$ROUTE_COUNT" -gt 0 ] && [ "$VALIDATE_COUNT" -eq 0 ]; then
    echo -e "${YELLOW}⚠️  Warning: Routes found but no query/params validation detected${NC}"
    echo "Routes found:"
    find src/routes -name "*.js" -exec grep -n "router\.(get|delete)(" {} \;
else
    print_status 0 "Validate() coverage looks good"
fi

# Check 4: No "Cannot set headers" errors in logs
echo "Checking for 'Cannot set headers' errors in logs..."
if find logs/ -name "*.log" -exec grep -l "Cannot set headers" {} \; > /dev/null 2>&1; then
    echo -e "${YELLOW}⚠️  Warning: Found 'Cannot set headers' errors in logs${NC}"
    echo "Files with errors:"
    find logs/ -name "*.log" -exec grep -l "Cannot set headers" {} \;
    echo "Recent errors:"
    find logs/ -name "*.log" -exec grep "Cannot set headers" {} \; | tail -5
else
    print_status 0 "No 'Cannot set headers' errors found"
fi

# Check 5: No stack traces for validation (should be 400 envelopes)
echo "Checking for validation stack traces in logs..."
if find logs/ -name "*.log" -exec grep -l "ValidationError\|ZodError" {} \; > /dev/null 2>&1; then
    echo -e "${YELLOW}⚠️  Warning: Found validation errors in logs - check if they're being handled as 400 envelopes${NC}"
    find logs/ -name "*.log" -exec grep -l "ValidationError\|ZodError" {} \;
else
    print_status 0 "No validation stack traces found"
fi

# Check 6: Method guards are properly implemented
echo "Checking method guard implementation..."
MISSING_GUARDS=$(find src/routes -name "*.js" -exec grep -n "router\.post(" {} \; 2>/dev/null | grep -v "router\.all.*methodNotAllowed" | wc -l)
if [ "$MISSING_GUARDS" -gt 0 ]; then
    echo -e "${YELLOW}⚠️  Warning: Found POST routes without method guards${NC}"
    find src/routes -name "*.js" -exec grep -n "router\.post(" {} \; | grep -v "router\.all.*methodNotAllowed"
else
    print_status 0 "Method guards properly implemented"
fi

# Check 7: Admin routes are properly gated
echo "Checking admin route protection..."
ADMIN_ROUTES=$(find src/routes/admin -name "*.js" -exec basename {} \; | wc -l)
ADMIN_GATED=$(find src/routes/admin -name "*.js" -exec grep -n "adminGate" {} \; 2>/dev/null | wc -l)

if [ "$ADMIN_ROUTES" -gt 0 ] && [ "$ADMIN_GATED" -eq 0 ]; then
    echo -e "${RED}❌ Admin routes found but no adminGate middleware detected${NC}"
    exit 1
else
    print_status 0 "Admin routes properly gated"
fi

echo -e "${GREEN}🎉 All sanity checks passed!${NC}"
