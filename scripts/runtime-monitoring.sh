#!/bin/bash

# Runtime Monitoring Script for REIMAGINEDAPPV2
# Monitors logs for runtime issues and validation problems

set -e

echo "🔍 Running Runtime Monitoring..."
echo "================================"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
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

# Function to check for critical errors in logs
check_log_errors() {
    local error_type=$1
    local pattern=$2
    local description=$3
    
    echo "Checking for $description..."
    
    if find logs/ -name "*.log" -exec grep -l "$pattern" {} \; > /dev/null 2>&1; then
        echo -e "${RED}❌ Found $description in logs${NC}"
        echo "Files with errors:"
        find logs/ -name "*.log" -exec grep -l "$pattern" {} \;
        echo "Recent errors (last 5):"
        find logs/ -name "*.log" -exec grep "$pattern" {} \; | tail -5
        return 1
    else
        print_status 0 "No $description found"
        return 0
    fi
}

# Function to analyze error patterns
analyze_error_patterns() {
    local pattern=$1
    local description=$2
    
    echo "Analyzing $description patterns..."
    
    local error_count=$(find logs/ -name "*.log" -exec grep -c "$pattern" {} \; 2>/dev/null | awk '{sum += $1} END {print sum}')
    
    if [ "$error_count" -gt 0 ]; then
        echo -e "${YELLOW}⚠️  Found $error_count $description occurrences${NC}"
        echo "Error distribution:"
        find logs/ -name "*.log" -exec grep "$pattern" {} \; | head -10
        return 1
    else
        print_status 0 "No $description patterns found"
        return 0
    fi
}

# Check 1: "Cannot set headers" errors (critical)
echo -e "${BLUE}1. Checking for 'Cannot set headers' errors...${NC}"
if ! check_log_errors "critical" "Cannot set headers" "double-send errors"; then
    echo -e "${RED}CRITICAL: Double-send errors detected - immediate attention required${NC}"
    echo "This indicates response headers are being set multiple times."
    echo "Check route handlers for multiple response.send() calls."
fi

# Check 2: Validation stack traces (should be 400 envelopes)
echo -e "${BLUE}2. Checking for validation stack traces...${NC}"
if ! check_log_errors "validation" "ValidationError\|ZodError" "validation stack traces"; then
    echo -e "${YELLOW}WARNING: Validation errors not being handled as 400 envelopes${NC}"
    echo "Validation errors should be caught and returned as 400 responses."
    echo "Check middleware and error handling."
fi

# Check 3: Method guard violations
echo -e "${BLUE}3. Checking for method guard violations...${NC}"
if ! check_log_errors "method" "METHOD_NOT_ALLOWED" "method guard violations"; then
    echo -e "${YELLOW}INFO: Method guard violations detected${NC}"
    echo "This is expected behavior when wrong HTTP methods are used."
    echo "Count: $(find logs/ -name "*.log" -exec grep -c "METHOD_NOT_ALLOWED" {} \; 2>/dev/null | awk '{sum += $1} END {print sum}')"
fi

# Check 4: Admin authentication failures
echo -e "${BLUE}4. Checking for admin authentication failures...${NC}"
if ! check_log_errors "auth" "ADMIN_DISABLED\|FORBIDDEN" "admin authentication failures"; then
    echo -e "${YELLOW}INFO: Admin authentication failures detected${NC}"
    echo "This is expected behavior for unauthorized admin access."
    echo "Count: $(find logs/ -name "*.log" -exec grep -c "ADMIN_DISABLED\|FORBIDDEN" {} \; 2>/dev/null | awk '{sum += $1} END {print sum}')"
fi

# Check 5: Service disabled errors
echo -e "${BLUE}5. Checking for service disabled errors...${NC}"
if ! check_log_errors "service" "PINECONE_DISABLED\|SERVICE_DISABLED" "service disabled errors"; then
    echo -e "${YELLOW}INFO: Service disabled errors detected${NC}"
    echo "This is expected when external services are not configured."
    echo "Count: $(find logs/ -name "*.log" -exec grep -c "PINECONE_DISABLED\|SERVICE_DISABLED" {} \; 2>/dev/null | awk '{sum += $1} END {print sum}')"
fi

# Check 6: Error envelope consistency
echo -e "${BLUE}6. Checking for malformed error envelopes...${NC}"
if ! check_log_errors "envelope" "success.*false.*error" "malformed error envelopes"; then
    echo -e "${YELLOW}WARNING: Potential malformed error envelopes detected${NC}"
    echo "Check that all error responses follow the envelope format."
fi

# Check 7: High error rates
echo -e "${BLUE}7. Analyzing error rates...${NC}"
total_errors=$(find logs/ -name "*.log" -exec grep -c "ERROR" {} \; 2>/dev/null | awk '{sum += $1} END {print sum}')
total_requests=$(find logs/ -name "*.log" -exec grep -c "GET\|POST\|PUT\|DELETE" {} \; 2>/dev/null | awk '{sum += $1} END {print sum}')

if [ "$total_requests" -gt 0 ]; then
    error_rate=$((total_errors * 100 / total_requests))
    echo "Total errors: $total_errors"
    echo "Total requests: $total_requests"
    echo "Error rate: ${error_rate}%"
    
    if [ "$error_rate" -gt 10 ]; then
        echo -e "${RED}❌ High error rate detected: ${error_rate}%${NC}"
        echo "Consider investigating error patterns."
    elif [ "$error_rate" -gt 5 ]; then
        echo -e "${YELLOW}⚠️  Elevated error rate: ${error_rate}%${NC}"
        echo "Monitor for increasing trends."
    else
        print_status 0 "Error rate is acceptable: ${error_rate}%"
    fi
else
    print_status 0 "No request logs found for error rate calculation"
fi

# Check 8: Recent activity
echo -e "${BLUE}8. Checking recent activity...${NC}"
recent_errors=$(find logs/ -name "*.log" -exec grep "ERROR" {} \; 2>/dev/null | grep "$(date '+%Y-%m-%d')" | wc -l)
recent_requests=$(find logs/ -name "*.log" -exec grep "GET\|POST\|PUT\|DELETE" {} \; 2>/dev/null | grep "$(date '+%Y-%m-%d')" | wc -l)

echo "Today's errors: $recent_errors"
echo "Today's requests: $recent_requests"

if [ "$recent_requests" -gt 0 ]; then
    today_error_rate=$((recent_errors * 100 / recent_requests))
    echo "Today's error rate: ${today_error_rate}%"
    
    if [ "$today_error_rate" -gt 20 ]; then
        echo -e "${RED}❌ High today error rate: ${today_error_rate}%${NC}"
    elif [ "$today_error_rate" -gt 10 ]; then
        echo -e "${YELLOW}⚠️  Elevated today error rate: ${today_error_rate}%${NC}"
    else
        print_status 0 "Today's error rate is acceptable: ${today_error_rate}%"
    fi
fi

echo ""
echo "================================"
echo -e "${GREEN}🎉 Runtime monitoring completed!${NC}"
echo ""
echo "Monitoring Summary:"
echo "✅ Double-send error detection"
echo "✅ Validation error monitoring"
echo "✅ Method guard violation tracking"
echo "✅ Admin authentication monitoring"
echo "✅ Service disabled error tracking"
echo "✅ Error envelope consistency"
echo "✅ Error rate analysis"
echo "✅ Recent activity monitoring"
echo ""
echo "For detailed analysis, check the logs directory."
echo "To run monitoring: ./scripts/runtime-monitoring.sh"
